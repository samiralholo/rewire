/**
 * BOS Core — Craving Interception Machine (XState v5)
 * ---------------------------------------------------------------------------
 * Models one traversal of the habit loop and the system's attempt to
 * interrupt it. Fully domain-agnostic: it moves IDs and scores around,
 * never domain content.
 *
 *   idle ──RISK_DETECTED──▶ vulnerable ──CRAVING_STARTED──▶ active_craving
 *    │                          │                                │
 *    └────CRAVING_STARTED───────┘◀──RISK_CLEARED / timeout       │
 *                                                                ▼
 *   idle ◀──RESOLVED── resolving ◀──(complete/skip)── intervening
 *
 * Persistence is delegated to injected actors (the machine never touches
 * WatermelonDB directly) so it stays pure and unit-testable.
 */

import { assign, fromPromise, setup } from 'xstate';
import type {
  BehaviorId,
  CravingEventId,
  CravingOutcome,
  EmotionalSnapshot,
  InterventionId,
  TriggerId,
  UnitInterval,
} from '../types';

// ---------------------------------------------------------------------------
// Context & Events
// ---------------------------------------------------------------------------

export interface CravingContext {
  behaviorId: BehaviorId;
  /** Persisted event row for this traversal; null until capture succeeds. */
  eventId: CravingEventId | null;
  triggerId: TriggerId | null;
  intensity: UnitInterval | null;
  emotionalState: EmotionalSnapshot | null;
  interventionId: InterventionId | null;
  /** Prediction score that moved us into `vulnerable` (null if user-initiated). */
  riskScore: UnitInterval | null;
  wasPredicted: boolean;
  capturedAt: number | null;
  outcome: CravingOutcome | null;
  /** Non-fatal persistence errors, surfaced to UI without breaking the flow. */
  lastError: string | null;
}

export type CravingEventMsg =
  // idle / vulnerable
  | { type: 'RISK_DETECTED'; riskScore: UnitInterval }
  | { type: 'RISK_CLEARED' }
  | { type: 'CRAVING_STARTED'; intensity: UnitInterval }
  // active_craving (capture — max 2-3 taps under stress)
  | { type: 'TRIGGER_CAPTURED'; triggerId: TriggerId | null }
  | { type: 'EMOTION_CAPTURED'; snapshot: EmotionalSnapshot }
  | { type: 'INTERVENTION_ACCEPTED'; interventionId: InterventionId }
  | { type: 'INTERVENTION_DECLINED' }
  // intervening
  | { type: 'INTERVENTION_COMPLETED' }
  | { type: 'INTERVENTION_ABORTED' }
  // resolving (zero-guilt: every outcome is just data)
  | { type: 'OUTCOME_RECORDED'; outcome: CravingOutcome }
  // any
  | { type: 'FLOW_ABANDONED' };

/** Ports the host app injects — keeps the machine free of IO. */
export interface CravingMachineDeps {
  persistCapture: (
    ctx: Pick<
      CravingContext,
      'behaviorId' | 'intensity' | 'wasPredicted' | 'riskScore'
    >,
  ) => Promise<CravingEventId>;
  persistResolution: (
    ctx: Pick<
      CravingContext,
      'eventId' | 'triggerId' | 'emotionalState' | 'interventionId' | 'outcome' | 'capturedAt'
    >,
  ) => Promise<void>;
}

const VULNERABLE_WINDOW_MS = 15 * 60 * 1000; // prediction decays after 15 min

// ---------------------------------------------------------------------------
// Machine
// ---------------------------------------------------------------------------

export const createCravingMachine = (deps: CravingMachineDeps) =>
  setup({
    types: {
      context: {} as CravingContext,
      events: {} as CravingEventMsg,
      input: {} as { behaviorId: BehaviorId },
    },
    actors: {
      persistCapture: fromPromise(
        async ({ input }: { input: CravingContext }) =>
          deps.persistCapture({
            behaviorId: input.behaviorId,
            intensity: input.intensity,
            wasPredicted: input.wasPredicted,
            riskScore: input.riskScore,
          }),
      ),
      persistResolution: fromPromise(
        async ({ input }: { input: CravingContext }) => deps.persistResolution(input),
      ),
    },
    guards: {
      /** Only escalate when the predictor is confident enough. */
      isSignificantRisk: ({ event }) =>
        event.type === 'RISK_DETECTED' && event.riskScore >= 0.5,
    },
    actions: {
      markPredicted: assign({
        wasPredicted: true,
        riskScore: ({ event }) =>
          event.type === 'RISK_DETECTED' ? event.riskScore : null,
      }),
      startCapture: assign({
        intensity: ({ event }) =>
          event.type === 'CRAVING_STARTED' ? event.intensity : null,
        capturedAt: () => Date.now(),
        outcome: null,
        lastError: null,
      }),
      resetTraversal: assign({
        eventId: null,
        triggerId: null,
        intensity: null,
        emotionalState: null,
        interventionId: null,
        riskScore: null,
        wasPredicted: false,
        capturedAt: null,
        outcome: null,
      }),
    },
  }).createMachine({
    id: 'cravingInterception',
    initial: 'idle',
    context: ({ input }) => ({
      behaviorId: input.behaviorId,
      eventId: null,
      triggerId: null,
      intensity: null,
      emotionalState: null,
      interventionId: null,
      riskScore: null,
      wasPredicted: false,
      capturedAt: null,
      outcome: null,
      lastError: null,
    }),

    states: {
      /** Baseline monitoring. The twin watches; the UI stays quiet. */
      idle: {
        entry: 'resetTraversal',
        on: {
          RISK_DETECTED: {
            guard: 'isSignificantRisk',
            target: 'vulnerable',
            actions: 'markPredicted',
          },
          CRAVING_STARTED: { target: 'active_craving', actions: 'startCapture' },
        },
      },

      /**
       * Predicted high-risk window. Pre-emptive, contextual nudge is allowed
       * here — never a random notification. Expires back to idle.
       */
      vulnerable: {
        after: { [VULNERABLE_WINDOW_MS]: { target: 'idle' } },
        on: {
          CRAVING_STARTED: { target: 'active_craving', actions: 'startCapture' },
          RISK_CLEARED: { target: 'idle' },
        },
      },

      /**
       * The user reported an urge. Capture context fast (adaptive friction:
       * every field optional), persist immediately, then offer interruption.
       */
      active_craving: {
        invoke: {
          src: 'persistCapture',
          input: ({ context }) => context,
          onDone: {
            actions: assign({ eventId: ({ event }) => event.output }),
          },
          onError: {
            // Offline-first: capture must never block the user. Log and go on.
            actions: assign({ lastError: () => 'capture_persist_failed' }),
          },
        },
        on: {
          TRIGGER_CAPTURED: {
            actions: assign({ triggerId: ({ event }) => event.triggerId }),
          },
          EMOTION_CAPTURED: {
            actions: assign({ emotionalState: ({ event }) => event.snapshot }),
          },
          INTERVENTION_ACCEPTED: {
            target: 'intervening',
            actions: assign({ interventionId: ({ event }) => event.interventionId }),
          },
          // Declining help is not failure — go straight to outcome recording.
          INTERVENTION_DECLINED: { target: 'resolving' },
          FLOW_ABANDONED: {
            target: 'resolving',
            actions: assign({ outcome: () => 'abandoned' as CravingOutcome }),
          },
        },
      },

      /** Guided interruption is running (content rendered by the domain pack). */
      intervening: {
        on: {
          INTERVENTION_COMPLETED: { target: 'resolving' },
          INTERVENTION_ABORTED: { target: 'resolving' },
          FLOW_ABANDONED: {
            target: 'resolving',
            actions: assign({ outcome: () => 'abandoned' as CravingOutcome }),
          },
        },
      },

      /**
       * Record the outcome without judgment, persist, feed the twin, return
       * to idle. If the outcome was pre-set (abandoned), persist immediately.
       */
      resolving: {
        initial: 'awaiting_outcome',
        states: {
          awaiting_outcome: {
            always: { guard: ({ context }) => context.outcome !== null, target: 'persisting' },
            on: {
              OUTCOME_RECORDED: {
                target: 'persisting',
                actions: assign({ outcome: ({ event }) => event.outcome }),
              },
            },
          },
          persisting: {
            invoke: {
              src: 'persistResolution',
              input: ({ context }) => context,
              onDone: { target: '#cravingInterception.idle' },
              onError: {
                // Data loss is worse than a stale flag: park it for retry.
                target: '#cravingInterception.idle',
                actions: assign({ lastError: () => 'resolution_persist_failed' }),
              },
            },
          },
        },
      },
    },
  });

export type CravingMachine = ReturnType<typeof createCravingMachine>;

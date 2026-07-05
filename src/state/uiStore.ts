/**
 * App Layer — Zustand UI Store (XState -> React Native bridge)
 * ---------------------------------------------------------------------------
 * Lives OUTSIDE /src/core on purpose: the core owns behavior, this file owns
 * presentation. It is a read-only projection of the craving machine plus a
 * presentation-only countdown. NO business logic here — every decision
 * (transitions, persistence, learning) stays in the machine and engine.
 *
 * Usage:
 *   const actor = createActor(machine, { input: { behaviorId } }).start();
 *   const unbind = bindCravingActor(actor);        // once, at app root
 *   ...
 *   const phase = useCravingUi((s) => s.phase);    // in any component
 */

import { create } from 'zustand';
import { useShallow } from 'zustand/react/shallow';
import type { ActorRefFrom, SnapshotFrom } from 'xstate';
import type { CravingEventMsg, CravingMachine } from '../core/machines/cravingMachine';
import type {
  CravingOutcome,
  EmotionalSnapshot,
  InterventionId,
  TriggerId,
  UnitInterval,
} from '../core/types';

type CravingActor = ActorRefFrom<CravingMachine>;
type CravingSnapshot = SnapshotFrom<CravingMachine>;

/** Flat, UI-friendly machine phase (nested resolving states collapse). */
export type InterceptorPhase =
  | 'idle'
  | 'vulnerable'
  | 'active_craving'
  | 'intervening'
  | 'resolving';

export interface CravingUiState {
  // ---- read-only projection of the machine --------------------------------
  readonly phase: InterceptorPhase;
  readonly intensity: UnitInterval | null;
  readonly triggerId: TriggerId | null;
  readonly emotionalState: EmotionalSnapshot | null;
  readonly activeInterventionId: InterventionId | null;
  readonly riskScore: UnitInterval | null;
  readonly wasPredicted: boolean;
  readonly outcome: CravingOutcome | null;
  readonly lastError: string | null;
  /** True while the resolving state is persisting to disk. */
  readonly isPersisting: boolean;

  // ---- presentation-only intervention countdown ----------------------------
  readonly timerTotalSec: number | null;
  readonly timerRemainingSec: number | null;

  // ---- actions (the ONLY writes the UI may perform here) -------------------
  /** Start the visual countdown for the active intervention. */
  startInterventionTimer: (durationSec: number) => void;
  stopInterventionTimer: () => void;
}

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

let timerHandle: ReturnType<typeof setInterval> | null = null;
/** The actor currently bound to this store (set by bindCravingActor). */
let boundActor: CravingActor | null = null;

/**
 * The ONLY write path from UI to engine: forwards an event to the bound
 * actor. Contains zero decisions — the machine's guards/transitions rule.
 */
export function sendCravingEvent(event: CravingEventMsg): void {
  if (boundActor === null) {
    console.warn('[BOS] sendCravingEvent before bindCravingActor; dropped', event.type);
    return;
  }
  boundActor.send(event);
}

const clearTimer = (): void => {
  if (timerHandle !== null) {
    clearInterval(timerHandle);
    timerHandle = null;
  }
};

const INITIAL_PROJECTION = {
  phase: 'idle' as InterceptorPhase,
  intensity: null,
  triggerId: null,
  emotionalState: null,
  activeInterventionId: null,
  riskScore: null,
  wasPredicted: false,
  outcome: null,
  lastError: null,
  isPersisting: false,
  timerTotalSec: null,
  timerRemainingSec: null,
};

export const useCravingUi = create<CravingUiState>()((set, get) => ({
  ...INITIAL_PROJECTION,

  startInterventionTimer: (durationSec) => {
    clearTimer();
    set({ timerTotalSec: durationSec, timerRemainingSec: durationSec });
    timerHandle = setInterval(() => {
      const remaining = get().timerRemainingSec;
      if (remaining === null || remaining <= 1) {
        clearTimer();
        set({ timerRemainingSec: 0 });
        return;
      }
      set({ timerRemainingSec: remaining - 1 });
    }, 1000);
  },

  stopInterventionTimer: () => {
    clearTimer();
    set({ timerTotalSec: null, timerRemainingSec: null });
  },
}));

// ---------------------------------------------------------------------------
// Bridge — subscribe the store to a running craving actor
// ---------------------------------------------------------------------------

const toPhase = (snapshot: CravingSnapshot): InterceptorPhase => {
  const value = snapshot.value;
  // Nested states ({ resolving: 'persisting' }) collapse to their parent.
  return (typeof value === 'string' ? value : Object.keys(value)[0]) as InterceptorPhase;
};

const project = (snapshot: CravingSnapshot): Partial<CravingUiState> => {
  const { context } = snapshot;
  return {
    phase: toPhase(snapshot),
    intensity: context.intensity,
    triggerId: context.triggerId,
    emotionalState: context.emotionalState,
    activeInterventionId: context.interventionId,
    riskScore: context.riskScore,
    wasPredicted: context.wasPredicted,
    outcome: context.outcome,
    lastError: context.lastError,
    isPersisting: snapshot.matches({ resolving: 'persisting' }),
  };
};

/**
 * Bind a started actor to the store. Call once (app root / provider effect);
 * returns an unbind function for cleanup. Safe across Fast Refresh: rebinding
 * replaces the previous projection on the next snapshot.
 */
export function bindCravingActor(actor: CravingActor): () => void {
  boundActor = actor;
  // Sync immediately so the UI never renders a stale phase.
  useCravingUi.setState(project(actor.getSnapshot()));

  const subscription = actor.subscribe((snapshot) => {
    const previousPhase = useCravingUi.getState().phase;
    const next = project(snapshot);
    useCravingUi.setState(next);

    // Presentation hygiene: leaving `intervening` always kills the countdown.
    if (previousPhase === 'intervening' && next.phase !== 'intervening') {
      useCravingUi.getState().stopInterventionTimer();
    }
  });

  return () => {
    boundActor = null;
    subscription.unsubscribe();
    useCravingUi.getState().stopInterventionTimer();
    useCravingUi.setState(INITIAL_PROJECTION);
  };
}

// ---------------------------------------------------------------------------
// Convenience selectors (referentially stable — safe for RN re-renders)
// ---------------------------------------------------------------------------

export const useInterceptorPhase = (): InterceptorPhase =>
  useCravingUi((s) => s.phase);

export const useActiveIntervention = (): InterventionId | null =>
  useCravingUi((s) => s.activeInterventionId);

export const useInterventionTimer = (): {
  totalSec: number | null;
  remainingSec: number | null;
  progress: number; // 0..1 for progress rings
} =>
  useCravingUi(
    useShallow((s) => ({
      totalSec: s.timerTotalSec,
      remainingSec: s.timerRemainingSec,
      progress:
        s.timerTotalSec && s.timerRemainingSec !== null
          ? 1 - s.timerRemainingSec / s.timerTotalSec
          : 0,
    })),
  );

export const useIsInterceptorBusy = (): boolean =>
  useCravingUi((s) => s.isPersisting);

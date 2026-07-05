/**
 * BOS Core — Prediction Scheduler (idle -> vulnerable feed)
 * ---------------------------------------------------------------------------
 * Periodically estimates the user's current vulnerability by blending:
 *
 *   riskScore = W_PRIOR    * pack.vulnerabilityPrior(ctx)   // domain knowledge
 *             + W_TEMPORAL * hourAffinity                    // learned rhythm
 *             + W_CUE      * cuePressure                     // learned twin edges
 *             + W_ENV      * environmentPressure             // live device context
 *
 * and dispatches RISK_DETECTED to the craving actor when the blend crosses
 * the threshold. The machine's own guard (`isSignificantRisk`, >= 0.5) is the
 * final arbiter, so a misconfigured scheduler can never force a transition.
 *
 * Design constraints honored:
 * - "No random notifications": every dispatch is contextual (the score and
 *   its inputs are computable/inspectable), and a cooldown prevents nagging.
 * - Fully offline: all inputs come from the local twin and the device clock.
 * - Domain-agnostic: the only domain knowledge enters via the DomainPack
 *   interface (`vulnerabilityPrior`), never as concrete vocabulary.
 */

import { Q, type Database } from '@nozbe/watermelondb';
import type { ActorRefFrom } from 'xstate';
import { TableName } from '../db/schema';
import { CravingEventModel, HabitEdgeModel, TriggerModel } from '../db/models';
import type { DomainPack, VulnerabilityContext } from '../registry/DomainPack';
import type { CravingMachine } from '../machines/cravingMachine';
import type { ContextProvider } from '../sensors/contextProvider';
import type { BehaviorId, TriggerCategory, UnitInterval } from '../types';

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

export interface PredictionSchedulerOptions {
  database: Database;
  actor: ActorRefFrom<CravingMachine>;
  pack: DomainPack;
  behaviorId: BehaviorId;
  /**
   * Optional device-context source. Absent (or permission-denied) the
   * environment term contributes 0 and behavior matches pre-Sprint-8.
   */
  contextProvider?: ContextProvider;
  /** Evaluation cadence. Default: every 5 minutes. */
  intervalMs?: number;
  /** Dispatch threshold. Keep aligned with the machine guard. Default 0.5. */
  riskThreshold?: UnitInterval;
  /** Minimum gap between two dispatches. Default: 30 minutes. */
  cooldownMs?: number;
  /** History window for learned signals. Default: last 200 events. */
  historyLimit?: number;
  /** Injectable clock for tests. */
  now?: () => Date;
}

export interface RiskEvaluation {
  riskScore: UnitInterval;
  prior: UnitInterval;
  hourAffinity: UnitInterval;
  cuePressure: UnitInterval;
  environmentPressure: UnitInterval;
  dispatched: boolean;
}

export interface PredictionScheduler {
  start: () => void;
  stop: () => void;
  /** Run one evaluation immediately (app foregrounded, tests). */
  evaluateNow: () => Promise<RiskEvaluation>;
}

// Blend weights: domain prior leads until the twin has enough data.
const W_PRIOR = 0.35;
const W_TEMPORAL = 0.25;
const W_CUE = 0.2;
const W_ENV = 0.2;
/** A context transition (movement change / geofence cross) is a strong,
 *  fresh signal; it decays back to nothing over this window. */
const TRANSITION_FRESHNESS_MS = 10 * 60 * 1000;

const DEFAULT_INTERVAL_MS = 5 * 60 * 1000;
const DEFAULT_COOLDOWN_MS = 30 * 60 * 1000;
const DEFAULT_HISTORY_LIMIT = 200;

const clamp01 = (x: number): number => Math.min(1, Math.max(0, x));

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export function createPredictionScheduler(
  options: PredictionSchedulerOptions,
): PredictionScheduler {
  const {
    database,
    actor,
    pack,
    behaviorId,
    contextProvider,
    intervalMs = DEFAULT_INTERVAL_MS,
    riskThreshold = 0.5,
    cooldownMs = DEFAULT_COOLDOWN_MS,
    historyLimit = DEFAULT_HISTORY_LIMIT,
    now = () => new Date(),
  } = options;

  let handle: ReturnType<typeof setInterval> | null = null;
  let unsubscribeContext: (() => void) | null = null;
  let lastDispatchAt = 0;
  let evaluating = false; // re-entrancy guard for slow queries

  // -- Learned signal 1: does the user's history cluster around this hour? --
  const computeHourAffinity = (
    events: readonly CravingEventModel[],
    at: Date,
  ): UnitInterval => {
    if (events.length < 10) return 0; // not enough history to trust rhythm
    const hour = at.getHours();
    // Count events in this hour ±1 (wrapping), normalized by a uniform rate.
    const nearHour = events.filter((e) => {
      const h = e.occurredAt.getHours();
      const dist = Math.min(Math.abs(h - hour), 24 - Math.abs(h - hour));
      return dist <= 1;
    }).length;
    const uniformExpected = (events.length * 3) / 24;
    // 1.0 when this window is ~3x its uniform share.
    return clamp01(nearHour / (uniformExpected * 3));
  };

  // -- Learned signal 2: pressure from the strongest recently-active cues ---
  const computeCuePressure = async (
    recentEvents: readonly CravingEventModel[],
  ): Promise<{ pressure: UnitInterval; categories: TriggerCategory[] }> => {
    const recentTriggerIds = [
      ...new Set(
        recentEvents
          .slice(0, 10)
          .map((e) => e.triggerId)
          .filter((id): id is string => id !== null),
      ),
    ];
    if (recentTriggerIds.length === 0) return { pressure: 0, categories: [] };

    const [cueEdges, triggers] = await Promise.all([
      database
        .get<HabitEdgeModel>(TableName.HABIT_EDGES)
        .query(
          Q.where('kind', 'cues'),
          Q.where('from_node_id', Q.oneOf(recentTriggerIds)),
          Q.where('to_node_id', behaviorId),
        )
        .fetch(),
      database
        .get<TriggerModel>(TableName.TRIGGERS)
        .query(Q.where('id', Q.oneOf(recentTriggerIds)))
        .fetch(),
    ]);

    // Mean of the top-3 localized edge weights = how loaded the context is.
    const top = cueEdges
      .map((e) => e.weight)
      .sort((a, b) => b - a)
      .slice(0, 3);
    const pressure =
      top.length > 0 ? top.reduce((sum, w) => sum + w, 0) / top.length : 0;

    return {
      pressure: clamp01(pressure),
      categories: [...new Set(triggers.map((t) => t.category))],
    };
  };

  // -- Learned signal 3: does live device context match a bound trigger? ----
  const computeEnvironmentPressure = async (
    at: Date,
  ): Promise<UnitInterval> => {
    if (!contextProvider) return 0;
    const ctx = contextProvider.getContext();
    if (ctx.movement === 'unknown' && ctx.activeGeofenceIds.length === 0) return 0;

    const bound = (
      await database
        .get<TriggerModel>(TableName.TRIGGERS)
        .query(
          Q.where('behavior_id', behaviorId),
          Q.where('sensor_binding', Q.notEq(null)),
        )
        .fetch()
    ).filter((t) => t.sensorBinding !== null);

    let pressure = 0;
    for (const trigger of bound) {
      const binding = trigger.sensorBinding;
      if (!binding) continue;
      const matches =
        binding.kind === 'movement'
          ? binding.movement === ctx.movement
          : ctx.activeGeofenceIds.includes(trigger.id);
      if (matches) pressure = Math.max(pressure, trigger.weight);
    }
    if (pressure === 0) return 0;

    // Fresh transitions carry more signal than long-standing states:
    // starting to drive is riskier than hour three of a road trip.
    const sinceTransition =
      ctx.lastTransitionAt !== null ? at.getTime() - ctx.lastTransitionAt : null;
    const freshness =
      sinceTransition !== null && sinceTransition < TRANSITION_FRESHNESS_MS
        ? 1
        : 0.5;
    return clamp01(pressure * freshness);
  };

  // -- One evaluation pass ---------------------------------------------------
  const evaluateNow = async (): Promise<RiskEvaluation> => {
    const at = now();
    const events = await database
      .get<CravingEventModel>(TableName.CRAVING_EVENTS)
      .query(
        Q.where('behavior_id', behaviorId),
        Q.sortBy('occurred_at', Q.desc),
        Q.take(historyLimit),
      )
      .fetch();

    const latest = events[0];
    const [{ pressure: cuePressure, categories }, environmentPressure] =
      await Promise.all([computeCuePressure(events), computeEnvironmentPressure(at)]);

    const ctx: VulnerabilityContext = {
      localHour: at.getHours(),
      weekday: at.getDay(),
      minutesSinceLastEvent: latest
        ? Math.round((at.getTime() - latest.occurredAt.getTime()) / 60_000)
        : null,
      recentTriggerCategories: categories,
      movement: contextProvider?.getContext().movement ?? 'unknown',
    };

    const prior = clamp01(pack.vulnerabilityPrior?.(ctx) ?? 0);
    const hourAffinity = computeHourAffinity(events, at);
    const riskScore = clamp01(
      W_PRIOR * prior +
        W_TEMPORAL * hourAffinity +
        W_CUE * cuePressure +
        W_ENV * environmentPressure,
    );

    // Dispatch rules: threshold + machine is idle + cooldown respected.
    const isIdle = actor.getSnapshot().matches('idle');
    const cooledDown = at.getTime() - lastDispatchAt >= cooldownMs;
    const dispatched = riskScore >= riskThreshold && isIdle && cooledDown;

    if (dispatched) {
      lastDispatchAt = at.getTime();
      actor.send({ type: 'RISK_DETECTED', riskScore });
    }

    return {
      riskScore,
      prior,
      hourAffinity,
      cuePressure,
      environmentPressure,
      dispatched,
    };
  };

  const safeEvaluate = (): void => {
    if (evaluating) return;
    evaluating = true;
    evaluateNow()
      .catch((error) => console.warn('[BOS] Risk evaluation failed', error))
      .finally(() => {
        evaluating = false;
      });
  };

  return {
    start: () => {
      if (handle !== null) return; // already running
      handle = setInterval(safeEvaluate, intervalMs);
      // Event-driven path: a boundary crossing or movement change should not
      // wait up to a full interval — evaluate immediately. The cooldown and
      // the machine's guard still bound how often this can DISPATCH.
      unsubscribeContext =
        contextProvider?.subscribe(() => safeEvaluate()) ?? null;
    },
    stop: () => {
      if (handle !== null) {
        clearInterval(handle);
        handle = null;
      }
      unsubscribeContext?.();
      unsubscribeContext = null;
    },
    evaluateNow,
  };
}

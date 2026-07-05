/**
 * BOS Core — Prediction Scheduler (idle -> vulnerable feed)
 * ---------------------------------------------------------------------------
 * Periodically estimates the user's current vulnerability by blending:
 *
 *   riskScore = W_PRIOR    * pack.vulnerabilityPrior(ctx)   // domain knowledge
 *             + W_TEMPORAL * hourAffinity                    // learned rhythm
 *             + W_CUE      * cuePressure                     // learned twin edges
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
import type { BehaviorId, TriggerCategory, UnitInterval } from '../types';

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

export interface PredictionSchedulerOptions {
  database: Database;
  actor: ActorRefFrom<CravingMachine>;
  pack: DomainPack;
  behaviorId: BehaviorId;
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
  dispatched: boolean;
}

export interface PredictionScheduler {
  start: () => void;
  stop: () => void;
  /** Run one evaluation immediately (app foregrounded, tests). */
  evaluateNow: () => Promise<RiskEvaluation>;
}

// Blend weights: domain prior leads until the twin has enough data.
const W_PRIOR = 0.45;
const W_TEMPORAL = 0.3;
const W_CUE = 0.25;

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
    intervalMs = DEFAULT_INTERVAL_MS,
    riskThreshold = 0.5,
    cooldownMs = DEFAULT_COOLDOWN_MS,
    historyLimit = DEFAULT_HISTORY_LIMIT,
    now = () => new Date(),
  } = options;

  let handle: ReturnType<typeof setInterval> | null = null;
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
    const { pressure: cuePressure, categories } = await computeCuePressure(events);

    const ctx: VulnerabilityContext = {
      localHour: at.getHours(),
      weekday: at.getDay(),
      minutesSinceLastEvent: latest
        ? Math.round((at.getTime() - latest.occurredAt.getTime()) / 60_000)
        : null,
      recentTriggerCategories: categories,
    };

    const prior = clamp01(pack.vulnerabilityPrior?.(ctx) ?? 0);
    const hourAffinity = computeHourAffinity(events, at);
    const riskScore = clamp01(
      W_PRIOR * prior + W_TEMPORAL * hourAffinity + W_CUE * cuePressure,
    );

    // Dispatch rules: threshold + machine is idle + cooldown respected.
    const isIdle = actor.getSnapshot().matches('idle');
    const cooledDown = at.getTime() - lastDispatchAt >= cooldownMs;
    const dispatched = riskScore >= riskThreshold && isIdle && cooledDown;

    if (dispatched) {
      lastDispatchAt = at.getTime();
      actor.send({ type: 'RISK_DETECTED', riskScore });
    }

    return { riskScore, prior, hourAffinity, cuePressure, dispatched };
  };

  return {
    start: () => {
      if (handle !== null) return; // already running
      handle = setInterval(() => {
        if (evaluating) return;
        evaluating = true;
        evaluateNow()
          .catch((error) => console.warn('[BOS] Risk evaluation failed', error))
          .finally(() => {
            evaluating = false;
          });
      }, intervalMs);
    },
    stop: () => {
      if (handle !== null) {
        clearInterval(handle);
        handle = null;
      }
    },
    evaluateNow,
  };
}

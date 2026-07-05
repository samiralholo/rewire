/**
 * BOS Core — Digital Habit Twin Weight Updater (V1 heuristic, no ML)
 * ---------------------------------------------------------------------------
 * Every resolved CravingEvent is a learning signal. This module folds it
 * into the twin using an exponential-moving-average (EMA) step:
 *
 *     weight <- weight + LEARNING_RATE * (target - weight)
 *
 * Targets per outcome (zero-guilt: 'completed' is data, not failure):
 *   resisted   -> intervention/edge pulled toward 1.0, automaticity down
 *   delayed    -> pulled toward 0.7 ("delay is success"), automaticity down
 *   completed  -> pulled toward 0.0, automaticity nudged up
 *   abandoned  -> no learning signal (we know nothing about what worked)
 *
 * Trigger cue strength updates on OCCURRENCE, independent of outcome:
 * the cue fired regardless of whether the interruption worked.
 */

import { Q, type Database } from '@nozbe/watermelondb';
import { TableName } from '../db/schema';
import {
  BehaviorModel,
  CravingEventModel,
  HabitEdgeModel,
  InterventionModel,
  TriggerModel,
} from '../db/models';
import type { CravingOutcome, UnitInterval } from '../types';

// ---------------------------------------------------------------------------
// Tunables (V1)
// ---------------------------------------------------------------------------

const LEARNING_RATE = 0.15;
/** Cue confirmation is a weaker signal than an outcome. */
const CUE_LEARNING_RATE = 0.05;
/** Automaticity moves slowly: rewiring is gradual by design. */
const AUTOMATICITY_RATE = 0.03;

const OUTCOME_TARGET: Record<Exclude<CravingOutcome, 'abandoned'>, UnitInterval> = {
  resisted: 1.0,
  delayed: 0.7,
  completed: 0.0,
};

const clamp01 = (x: number): number => Math.min(1, Math.max(0, x));
const ema = (current: number, target: number, rate: number): number =>
  clamp01(current + rate * (target - current));

// ---------------------------------------------------------------------------
// Updater
// ---------------------------------------------------------------------------

export interface WeightUpdateReport {
  eventId: string;
  outcome: CravingOutcome;
  edgesUpdated: number;
  triggerUpdated: boolean;
  interventionUpdated: boolean;
  behaviorUpdated: boolean;
}

/**
 * Fold one RESOLVED craving event into the Habit Twin.
 * Call after the machine's `resolving` state persists the outcome
 * (fire-and-forget from the persistResolution actor is fine).
 */
export async function applyOutcomeToTwin(
  database: Database,
  event: CravingEventModel,
): Promise<WeightUpdateReport> {
  const outcome = event.outcome as CravingOutcome | null;
  if (outcome === null) {
    throw new Error(`CravingEvent ${event.id} is not resolved yet.`);
  }

  const report: WeightUpdateReport = {
    eventId: event.id,
    outcome,
    edgesUpdated: 0,
    triggerUpdated: false,
    interventionUpdated: false,
    behaviorUpdated: false,
  };

  // Abandoned flows carry no signal about cue strength or what worked.
  if (outcome === 'abandoned') return report;

  const target = OUTCOME_TARGET[outcome];
  const edges = database.get<HabitEdgeModel>(TableName.HABIT_EDGES);
  const now = Date.now();

  await database.write(async () => {
    const batch: Array<TriggerModel | InterventionModel | BehaviorModel | HabitEdgeModel> = [];

    // -- 1. Trigger: the cue fired -> confirm it (outcome-independent) ------
    if (event.triggerId) {
      const trigger = await database
        .get<TriggerModel>(TableName.TRIGGERS)
        .find(event.triggerId);
      batch.push(
        trigger.prepareUpdate((t) => {
          t.weight = ema(t.weight, 1, CUE_LEARNING_RATE);
          t.occurrenceCount += 1;
          t.updatedAt = new Date(now);
        }),
      );
      report.triggerUpdated = true;

      // cues edge (trigger -> behavior) strengthens with each confirmation.
      const cueEdges = await edges
        .query(
          Q.where('from_node_id', event.triggerId),
          Q.where('to_node_id', event.behaviorId),
          Q.where('kind', 'cues'),
        )
        .fetch();
      for (const edge of cueEdges) {
        batch.push(
          edge.prepareUpdate((e) => {
            e.weight = ema(e.weight, 1, CUE_LEARNING_RATE);
            e.observationCount += 1;
            e.updatedAt = new Date(now);
          }),
        );
        report.edgesUpdated += 1;
      }
    }

    // -- 2. Intervention: outcome-driven effectiveness learning -------------
    if (event.interventionId) {
      const intervention = await database
        .get<InterventionModel>(TableName.INTERVENTIONS)
        .find(event.interventionId);
      const wasSuccess = outcome === 'resisted' || outcome === 'delayed';
      batch.push(
        intervention.prepareUpdate((i) => {
          // Incremental mean keeps successRate an honest successes/attempts.
          const successes = i.successRate * i.attemptCount + (wasSuccess ? 1 : 0);
          i.attemptCount += 1;
          i.successRate = clamp01(successes / i.attemptCount);
        }),
      );
      report.interventionUpdated = true;

      // disrupts edge (intervention -> trigger): context-specific learning.
      if (event.triggerId) {
        const disruptEdges = await edges
          .query(
            Q.where('from_node_id', event.interventionId),
            Q.where('to_node_id', event.triggerId),
            Q.where('kind', 'disrupts'),
          )
          .fetch();
        for (const edge of disruptEdges) {
          batch.push(
            edge.prepareUpdate((e) => {
              e.weight = ema(e.weight, target, LEARNING_RATE);
              e.observationCount += 1;
              e.updatedAt = new Date(now);
            }),
          );
          report.edgesUpdated += 1;
        }
      }
    }

    // -- 3. Behavior: automaticity drifts with interception success ---------
    const behavior = await database
      .get<BehaviorModel>(TableName.BEHAVIORS)
      .find(event.behaviorId);
    // Successful interception = the loop ran consciously -> less automatic.
    const automaticityTarget = outcome === 'completed' ? 1 : 0;
    batch.push(
      behavior.prepareUpdate((b) => {
        b.automaticityScore = ema(b.automaticityScore, automaticityTarget, AUTOMATICITY_RATE);
        b.updatedAt = new Date(now);
      }),
    );
    report.behaviorUpdated = true;

    await database.batch(...batch);
  }, 'applyOutcomeToTwin');

  return report;
}

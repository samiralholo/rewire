/**
 * BOS Core — Daily Insights & Reflection Capture (V1: simple aggregates)
 * ---------------------------------------------------------------------------
 * Read-side helpers for the Dashboard and Reflection screens. All outputs
 * are labelKeys/numbers — translation happens in the presentation layer.
 */

import { Q, type Database } from '@nozbe/watermelondb';
import { TableName } from '../db/schema';
import {
  BehaviorModel,
  CravingEventModel,
  ReflectionModel,
  TriggerModel,
} from '../db/models';
import type { BehaviorId, UnitInterval } from '../types';
import { processReflection } from './reflectionProcessor';

const clamp01 = (x: number): number => Math.min(1, Math.max(0, x));

export const startOfToday = (now: Date = new Date()): Date =>
  new Date(now.getFullYear(), now.getMonth(), now.getDate());

// ---------------------------------------------------------------------------
// Awareness score — the dashboard headline number
// ---------------------------------------------------------------------------

/**
 * Awareness is the inverse of automaticity: the share of the loop the user
 * now owns consciously. This is the zero-guilt headline — it can only be
 * framed as growth, never as streaks or failures.
 */
export async function computeAwarenessScore(
  database: Database,
  behaviorId: BehaviorId,
): Promise<UnitInterval> {
  const behavior = await database
    .get<BehaviorModel>(TableName.BEHAVIORS)
    .find(behaviorId);
  return clamp01(1 - behavior.automaticityScore);
}

// ---------------------------------------------------------------------------
// Daily snapshot — today's raw material for insights & reflection
// ---------------------------------------------------------------------------

export interface DailySnapshot {
  eventCount: number;
  /** labelKey of today's most frequent cue; null when nothing stands out. */
  topTriggerLabelKey: string | null;
  interceptedCount: number; // resisted + delayed
  averageDelaySec: number | null;
}

export async function computeDailySnapshot(
  database: Database,
  behaviorId: BehaviorId,
  now: Date = new Date(),
): Promise<DailySnapshot> {
  const events = await database
    .get<CravingEventModel>(TableName.CRAVING_EVENTS)
    .query(
      Q.where('behavior_id', behaviorId),
      Q.where('occurred_at', Q.gte(startOfToday(now).getTime())),
    )
    .fetch();

  const counts = new Map<string, number>();
  for (const e of events) {
    if (e.triggerId) counts.set(e.triggerId, (counts.get(e.triggerId) ?? 0) + 1);
  }
  const topTriggerId =
    [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
  const topTrigger = topTriggerId
    ? await database.get<TriggerModel>(TableName.TRIGGERS).find(topTriggerId)
    : null;

  const delays = events
    .map((e) => e.latencyToOutcomeSec)
    .filter((v): v is number => v !== null);

  return {
    eventCount: events.length,
    topTriggerLabelKey: topTrigger?.labelKey ?? null,
    interceptedCount: events.filter(
      (e) => e.outcome === 'resisted' || e.outcome === 'delayed',
    ).length,
    averageDelaySec:
      delays.length > 0
        ? Math.round(delays.reduce((a, b) => a + b, 0) / delays.length)
        : null,
  };
}

// ---------------------------------------------------------------------------
// Reflection capture
// ---------------------------------------------------------------------------

export interface ReflectionInput {
  behaviorId: BehaviorId;
  controlRating: UnitInterval | null;
  note: string | null;
}

export async function saveReflection(
  database: Database,
  input: ReflectionInput,
): Promise<ReflectionModel> {
  const saved = await database.write(() =>
    database.get<ReflectionModel>(TableName.REFLECTIONS).create((r) => {
      r.behaviorId = input.behaviorId;
      r.controlRating = input.controlRating;
      r.note = input.note?.trim() || null;
      r.createdAt = new Date();
    }),
  );

  // Qualitative learning: never let a twin update failure lose the note.
  if (saved.note) {
    try {
      await processReflection(database, input.behaviorId, saved.note);
    } catch (error) {
      console.warn('[BOS] Reflection processing failed; note preserved', error);
    }
  }
  return saved;
}

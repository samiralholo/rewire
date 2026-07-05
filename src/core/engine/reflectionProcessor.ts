/**
 * BOS Core — Reflection Processor (qualitative -> quantitative, V1)
 * ---------------------------------------------------------------------------
 * Turns free-text evening reflections into small, bounded twin updates.
 * Mechanism: a locale-aware keyword matcher compares the note's tokens
 * against the localized vocabularies of the behavior's DomainPack (all
 * registered locales — users mix languages). A trigger mentioned in
 * "what made moments harder today?" is qualitative evidence that the cue
 * is live, so its weight and its `cues` edge get a SMALL bump.
 *
 * Domain-agnostic by construction: this module never contains vocabulary —
 * it only compares opaque strings supplied by the registry at runtime.
 *
 * Deliberate V1 bounds:
 * - Only TRIGGERS receive weight bumps. Intervention mentions are matched
 *   and reported (for future use) but not weighted: a mention in a
 *   "what was hard" note carries no clear positive/negative sign.
 * - REFLECTION_RATE << outcome learning rate: one sentence must never
 *   outweigh logged behavioral events.
 *
 * Arabic morphology (Sprint 7): tokens on BOTH sides of the comparison are
 * expanded with light stems (see stemmer.ts), so notes with attached
 * particles — بالتوتر, كالقهوة, وللعمل — match the bare vocabulary forms.
 * Expansion (raw + stem) rather than replacement keeps every match the
 * unstemmed pipeline made, so stemming can only add recall, never lose it.
 */

import { Q, type Database } from '@nozbe/watermelondb';
import { TableName } from '../db/schema';
import {
  BehaviorModel,
  HabitEdgeModel,
  InterventionModel,
  TriggerModel,
} from '../db/models';
import { DomainRegistry } from '../registry/DomainPack';
import { stemToken } from './stemmer';
import type { BehaviorId, DomainPackId } from '../types';

// ---------------------------------------------------------------------------
// Tunables
// ---------------------------------------------------------------------------

/** Qualitative evidence is a whisper, not a data point. */
const REFLECTION_RATE = 0.04;
const MIN_TOKEN_LENGTH = 2;

/**
 * Generic function words excluded from matching so labels like
 * "After a meal" match on "meal", never on "after". These are language
 * plumbing, not domain terms.
 */
const STOPWORDS: Readonly<Record<string, ReadonlySet<string>>> = {
  en: new Set([
    'a', 'an', 'the', 'of', 'my', 'me', 'i', 'to', 'in', 'on', 'at', 'and',
    'or', 'with', 'was', 'is', 'it', 'after', 'before', 'around', 'having',
    'feeling', 'keep', 'your', 'people',
  ]),
  ar: new Set([
    'في', 'من', 'مع', 'عن', 'على', 'الى', 'إلى', 'بعد', 'قبل', 'اثناء',
    'أثناء', 'كان', 'كانت', 'هذا', 'هذه', 'انا', 'أنا', 'او', 'أو', 'ثم',
  ]),
};

// ---------------------------------------------------------------------------
// Normalization & tokenization (unicode-aware, Arabic-friendly)
// ---------------------------------------------------------------------------

const AR_DIACRITICS = /[ً-ْٰـ]/g; // harakat + tatweel

export function normalizeToken(raw: string): string {
  return raw
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // latin accents
    .normalize('NFC')
    .replace(AR_DIACRITICS, '')
    .replace(/[أإآ]/g, 'ا') // alef variants
    .replace(/ى/g, 'ي')
    .replace(/ة/g, 'ه');
}

export function tokenize(text: string): Set<string> {
  const tokens = new Set<string>();
  for (const part of text.split(/[^\p{L}\p{N}]+/u)) {
    const token = normalizeToken(part);
    if (token.length < MIN_TOKEN_LENGTH) continue;
    tokens.add(token);
    // Symmetric stem expansion: Arabic-script tokens also contribute their
    // light stem, so prefix-attached forms meet bare vocabulary forms.
    const stem = stemToken(token);
    if (stem.length >= MIN_TOKEN_LENGTH) tokens.add(stem);
  }
  return tokens;
}

/**
 * Content tokens of a label in a given locale (stopwords removed).
 * Stopword filtering happens on RAW tokens; surviving tokens then expand
 * with their stems — so a stopword can never sneak back in via stemming,
 * and a stemmed content word (الطعام → طعام) is always available to match.
 */
const contentTokens = (label: string, locale: string): Set<string> => {
  const stop = STOPWORDS[locale] ?? new Set<string>();
  const result = new Set<string>();
  for (const part of label.split(/[^\p{L}\p{N}]+/u)) {
    const token = normalizeToken(part);
    if (token.length < MIN_TOKEN_LENGTH || stop.has(token)) continue;
    result.add(token);
    const stem = stemToken(token);
    if (stem.length >= MIN_TOKEN_LENGTH && !stop.has(stem)) result.add(stem);
  }
  return result;
};

// ---------------------------------------------------------------------------
// Matching
// ---------------------------------------------------------------------------

export interface LabeledEntity {
  id: string;
  labelKey: string;
}

/**
 * Pure matcher: which entities' localized labels share at least one
 * content token with the note? Exported for unit testing.
 */
export function extractMatches(
  note: string,
  entities: readonly LabeledEntity[],
  packId: DomainPackId,
): string[] {
  const noteTokens = tokenize(note);
  if (noteTokens.size === 0) return [];

  const pack = DomainRegistry.get(packId);
  const locales = Object.keys(pack.vocabulary);
  const matched: string[] = [];

  for (const entity of entities) {
    let hit = false;
    for (const locale of locales) {
      const label = pack.vocabulary[locale]?.[entity.labelKey];
      if (!label) continue;
      for (const token of contentTokens(label, locale)) {
        if (noteTokens.has(token)) {
          hit = true;
          break;
        }
      }
      if (hit) break;
    }
    if (hit) matched.push(entity.id);
  }
  return matched;
}

// ---------------------------------------------------------------------------
// Processor
// ---------------------------------------------------------------------------

export interface ReflectionProcessReport {
  matchedTriggerIds: readonly string[];
  /** Matched but intentionally not weighted in V1 (no reliable sign). */
  matchedInterventionIds: readonly string[];
  edgesUpdated: number;
}

const clamp01 = (x: number): number => Math.min(1, Math.max(0, x));
const bump = (weight: number): number =>
  clamp01(weight + REFLECTION_RATE * (1 - weight));

export async function processReflection(
  database: Database,
  behaviorId: BehaviorId,
  note: string,
): Promise<ReflectionProcessReport> {
  const empty: ReflectionProcessReport = {
    matchedTriggerIds: [],
    matchedInterventionIds: [],
    edgesUpdated: 0,
  };
  if (note.trim().length === 0) return empty;

  const behavior = await database
    .get<BehaviorModel>(TableName.BEHAVIORS)
    .find(behaviorId);
  const packId = behavior.domainPackId as DomainPackId;

  const [triggers, interventions] = await Promise.all([
    database
      .get<TriggerModel>(TableName.TRIGGERS)
      .query(Q.where('behavior_id', behaviorId))
      .fetch(),
    database
      .get<InterventionModel>(TableName.INTERVENTIONS)
      .query(Q.where('domain_pack_id', packId))
      .fetch(),
  ]);

  const matchedTriggerIds = extractMatches(note, triggers, packId);
  const matchedInterventionIds = extractMatches(note, interventions, packId);
  if (matchedTriggerIds.length === 0) {
    return { ...empty, matchedInterventionIds };
  }

  const edges = database.get<HabitEdgeModel>(TableName.HABIT_EDGES);
  const now = Date.now();
  let edgesUpdated = 0;

  await database.write(async () => {
    const batch: Array<TriggerModel | HabitEdgeModel> = [];

    const matchedTriggers = triggers.filter((t) => matchedTriggerIds.includes(t.id));
    for (const trigger of matchedTriggers) {
      batch.push(
        trigger.prepareUpdate((t) => {
          t.weight = bump(t.weight);
          t.updatedAt = new Date(now);
        }),
      );
    }

    const cueEdges = await edges
      .query(
        Q.where('kind', 'cues'),
        Q.where('from_node_id', Q.oneOf(matchedTriggerIds)),
        Q.where('to_node_id', behaviorId),
      )
      .fetch();
    for (const edge of cueEdges) {
      batch.push(
        edge.prepareUpdate((e) => {
          e.weight = bump(e.weight);
          // observationCount untouched: reflections aren't observations.
          e.updatedAt = new Date(now);
        }),
      );
      edgesUpdated += 1;
    }

    await database.batch(...batch);
  }, 'processReflection');

  return { matchedTriggerIds, matchedInterventionIds, edgesUpdated };
}

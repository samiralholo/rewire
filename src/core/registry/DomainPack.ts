/**
 * BOS Core — DomainPack Contract
 * ---------------------------------------------------------------------------
 * The ONLY doorway through which domain knowledge enters the system.
 * The core consumes this interface; packages implement it. The core never
 * imports from /src/packages/** — dependency direction is strictly inward.
 */

import type {
  Behavior,
  DomainPackId,
  Intervention,
  MovementState,
  SensorBinding,
  Trigger,
  TriggerCategory,
  UnitInterval,
} from '../types';

/** Seed shapes: identity fields are assigned by the core at install time. */
export type BehaviorSeed = Pick<Behavior, 'labelKey'> & {
  /** Prior automaticity before any user data exists (habits start unconscious). */
  initialAutomaticity: UnitInterval;
  estimatedDailyFrequency: number;
};

export type TriggerSeed = Pick<Trigger, 'category' | 'labelKey'> & {
  /** Prior weight before any user data exists. */
  initialWeight: UnitInterval;
  /**
   * Optional device-context hook (movement class or geofence place slot).
   * Persisted by the installer; consumed by the prediction scheduler.
   */
  sensorBinding?: SensorBinding;
};

export type InterventionSeed = Omit<
  Intervention,
  'id' | 'domainPackId' | 'successRate' | 'attemptCount' | 'isEnabled'
> & {
  /**
   * Pre-defined Seed Weight: scientifically backed prior success probability
   * for this intervention. Used as the initial weight of `disrupts` edges in
   * the Habit Twin the first time the installer creates them (cold-start).
   * Learned data then takes over via the weight updater; the installer never
   * overwrites an existing edge.
   */
  baselineWeight: UnitInterval;
};

/** BCP-47 language code ('en', 'ar', ...). */
export type LocaleCode = string;

/** Flat dictionary for one locale: labelKey -> display string. */
export type VocabularyDictionary = Readonly<Record<string, string>>;

/**
 * Per-locale vocabulary. 'en' is the required fallback locale; packs add
 * further locales freely. The core never inspects the strings — it only
 * shuttles them to the presentation i18n layer.
 */
export type Vocabulary = Readonly<Record<LocaleCode, VocabularyDictionary>>;

export interface DomainPack {
  id: DomainPackId;
  version: string;
  /** Human-readable pack name (shown in settings, not in the loop UI). */
  displayName: string;
  /** Resolves every labelKey/contentKey used by this pack's entities. */
  vocabulary: Vocabulary;
  /** The routine(s) this pack helps rewire, seeded on install. */
  behaviorSeeds: readonly BehaviorSeed[];
  /** Cues this domain is known to involve, seeded on install. */
  triggerSeeds: readonly TriggerSeed[];
  /** Interruption library for this domain, seeded on install. */
  interventionSeeds: readonly InterventionSeed[];
  /**
   * Optional domain heuristic: given local context, return a vulnerability
   * prior in [0,1]. The core combines it with learned graph weights.
   * Pure function — no side effects, fully offline.
   */
  vulnerabilityPrior?: (ctx: VulnerabilityContext) => UnitInterval;
}

export interface VulnerabilityContext {
  localHour: number;            // 0-23
  weekday: number;              // 0-6 (Sunday = 0)
  minutesSinceLastEvent: number | null;
  recentTriggerCategories: readonly TriggerCategory[];
  /** Live movement classification; 'unknown' when sensors are unavailable. */
  movement?: MovementState;
}

// ---------------------------------------------------------------------------
// Registry — the core's runtime index of installed packs
// ---------------------------------------------------------------------------

const packs = new Map<DomainPackId, DomainPack>();

export const DomainRegistry = {
  register(pack: DomainPack): void {
    if (packs.has(pack.id)) {
      throw new Error(`DomainPack '${pack.id}' is already registered.`);
    }
    packs.set(pack.id, pack);
  },

  has(id: DomainPackId): boolean {
    return packs.has(id);
  },

  get(id: DomainPackId): DomainPack {
    const pack = packs.get(id);
    if (!pack) throw new Error(`DomainPack '${id}' is not registered.`);
    return pack;
  },

  /** Resolve a vocabulary key; falls back locale -> 'en' -> key (never crashes UI). */
  resolveLabel(id: DomainPackId, key: string, locale: LocaleCode = 'en'): string {
    const vocab = packs.get(id)?.vocabulary;
    return vocab?.[locale]?.[key] ?? vocab?.['en']?.[key] ?? key;
  },

  all(): readonly DomainPack[] {
    return [...packs.values()];
  },

  /** Test-only escape hatch. */
  __clear(): void {
    packs.clear();
  },
} as const;

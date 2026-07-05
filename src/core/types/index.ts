/**
 * BOS Core — Domain-Agnostic Type Definitions
 * ---------------------------------------------------------------------------
 * THE AXIOM: This module knows NOTHING about any specific habit domain.
 * It models the universal habit loop: Cue (Trigger) -> Routine (Behavior)
 * -> Reward, and the interception lifecycle around it.
 *
 * Domain vocabulary (labels, icons, copy) is resolved at runtime via
 * i18n-style keys provided by a DomainPack (see core/registry/DomainPack.ts).
 */

// ---------------------------------------------------------------------------
// Primitives
// ---------------------------------------------------------------------------

/** Branded IDs prevent accidental cross-entity assignment in strict mode. */
export type EntityId<TBrand extends string> = string & { readonly __brand: TBrand };

export type BehaviorId = EntityId<'Behavior'>;
export type TriggerId = EntityId<'Trigger'>;
export type CravingEventId = EntityId<'CravingEvent'>;
export type InterventionId = EntityId<'Intervention'>;
export type DomainPackId = EntityId<'DomainPack'>;

/** Epoch milliseconds. WatermelonDB stores numbers, not Date objects. */
export type Timestamp = number;

/** Normalized scalar in [0, 1]. */
export type UnitInterval = number;

// ---------------------------------------------------------------------------
// Behavior — the routine being rewired
// ---------------------------------------------------------------------------

/**
 * A Behavior is any automatic routine the user wants to gain conscious
 * control over. The core never knows what the routine actually is —
 * only its measurable properties.
 */
export interface Behavior {
  id: BehaviorId;
  /** Which DomainPack owns the vocabulary for this behavior. */
  domainPackId: DomainPackId;
  /** Vocabulary key resolved by the owning DomainPack. Never raw text. */
  labelKey: string;
  /**
   * How automatic the loop currently is. 1 = fully unconscious.
   * Decreases as interceptions succeed. This is the core success metric:
   * "Delay is success. Breaking automaticity is the primary goal."
   */
  automaticityScore: UnitInterval;
  /** Baseline daily frequency estimated from logged events. */
  baselineDailyFrequency: number;
  createdAt: Timestamp;
  updatedAt: Timestamp;
  isArchived: boolean;
}

// ---------------------------------------------------------------------------
// Trigger — the cue that fires the loop
// ---------------------------------------------------------------------------

/** Universal, domain-neutral cue categories. */
export type TriggerCategory =
  | 'temporal'        // time of day, schedule anchors
  | 'environmental'   // location, physical context
  | 'emotional'       // internal affective state
  | 'social'          // presence/behavior of others
  | 'physiological'   // hunger, fatigue, withdrawal-like states
  | 'activity';       // preceding action (e.g. "after X")

export interface Trigger {
  id: TriggerId;
  behaviorId: BehaviorId;
  category: TriggerCategory;
  /** Vocabulary key resolved by the DomainPack (e.g. 'trigger.morning_ritual'). */
  labelKey: string;
  /**
   * Learned edge weight in the Habit Twin graph: how strongly this cue
   * predicts a craving. Updated after every resolved CravingEvent.
   */
  weight: UnitInterval;
  /** Rolling count of events attributed to this trigger. */
  occurrenceCount: number;
  /** Whether the system (vs. the user) discovered this trigger. */
  isSystemDetected: boolean;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

// ---------------------------------------------------------------------------
// Intervention — the interruption offered mid-loop
// ---------------------------------------------------------------------------

/** Mechanism families are universal; concrete content comes from the pack. */
export type InterventionMechanism =
  | 'delay'          // "can you wait N minutes?"
  | 'breathing'      // physiological down-regulation
  | 'distraction'    // attention redirection
  | 'reframe'        // cognitive restructuring prompt
  | 'substitution'   // replacement micro-routine
  | 'environment';   // change physical context

export interface Intervention {
  id: InterventionId;
  domainPackId: DomainPackId;
  mechanism: InterventionMechanism;
  labelKey: string;
  /** Guided-content key resolved by the pack (script, animation ref, etc.). */
  contentKey: string;
  estimatedDurationSec: number;
  /**
   * Per-user learned effectiveness (successes / attempts) — the V1
   * "highest-success-rate wins" heuristic input.
   */
  successRate: UnitInterval;
  attemptCount: number;
  /** Trigger categories this intervention is best suited for. */
  suitedCategories: readonly TriggerCategory[];
  /** Friction budget: taps required to start. Keep low for high-stress states. */
  activationCost: 1 | 2 | 3;
  isEnabled: boolean;
}

// ---------------------------------------------------------------------------
// CravingEvent — one traversal of the loop (the atomic unit of learning)
// ---------------------------------------------------------------------------

/**
 * Outcomes are deliberately non-judgmental. There is no "failure":
 * a completed routine is behavioral data, not a moral event.
 */
export type CravingOutcome =
  | 'resisted'    // loop fully interrupted
  | 'delayed'     // routine happened, but automaticity was broken first
  | 'completed'   // routine executed without effective interruption
  | 'abandoned';  // user exited the flow; no outcome recorded

export interface EmotionalSnapshot {
  /** Vocabulary key (e.g. 'emotion.stressed'). */
  labelKey: string;
  valence: UnitInterval;  // 0 negative — 1 positive
  arousal: UnitInterval;  // 0 calm — 1 activated
}

export interface CravingEvent {
  id: CravingEventId;
  behaviorId: BehaviorId;
  /** Primary attributed cue; null when the user couldn't identify one. */
  triggerId: TriggerId | null;
  /** Self-reported urge strength at capture time. */
  intensity: UnitInterval;
  emotionalState: EmotionalSnapshot | null;
  /** Coarse location context (geohash prefix); never precise coordinates. */
  locationHash: string | null;
  /** Intervention offered/used during this event, if any. */
  interventionId: InterventionId | null;
  outcome: CravingOutcome | null;
  /** Seconds between capture and outcome — the "delay is success" metric. */
  latencyToOutcomeSec: number | null;
  /** True when the machine entered from `vulnerable` (predicted) vs. user-initiated. */
  wasPredicted: boolean;
  occurredAt: Timestamp;
  resolvedAt: Timestamp | null;
}

// ---------------------------------------------------------------------------
// Habit Twin graph edge (nodes are the entities above)
// ---------------------------------------------------------------------------

export type TwinNodeType = 'behavior' | 'trigger' | 'intervention' | 'context';

export type TwinEdgeKind =
  | 'cues'         // trigger -> behavior
  | 'precedes'     // trigger -> trigger (cue chains)
  | 'disrupts'     // intervention -> trigger (learned effectiveness)
  | 'co_occurs';   // context <-> trigger

export interface HabitEdge {
  id: string;
  fromNodeId: string;
  fromNodeType: TwinNodeType;
  toNodeId: string;
  toNodeType: TwinNodeType;
  kind: TwinEdgeKind;
  weight: UnitInterval;
  observationCount: number;
  updatedAt: Timestamp;
}

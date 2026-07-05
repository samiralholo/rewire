/**
 * BOS Core — WatermelonDB Model Classes
 * ---------------------------------------------------------------------------
 * Thin, typed row mappers. Business logic lives in /src/core/engine,
 * never on models. Decorators require `experimentalDecorators` in tsconfig.
 */

import { Model, Q, type Query, type Relation } from '@nozbe/watermelondb';
import {
  children,
  date,
  field,
  immutableRelation,
  json,
  relation,
  text,
} from '@nozbe/watermelondb/decorators';
import { TableName } from '../schema';
import type { SensorBinding, TriggerCategory } from '../../types';

const sanitizeCategories = (raw: unknown): TriggerCategory[] =>
  Array.isArray(raw) ? (raw as TriggerCategory[]) : [];

const sanitizeSensorBinding = (raw: unknown): SensorBinding | null =>
  raw !== null && typeof raw === 'object' && 'kind' in (raw as object)
    ? (raw as SensorBinding)
    : null;

export class BehaviorModel extends Model {
  static table = TableName.BEHAVIORS;
  static associations = {
    [TableName.TRIGGERS]: { type: 'has_many', foreignKey: 'behavior_id' },
    [TableName.CRAVING_EVENTS]: { type: 'has_many', foreignKey: 'behavior_id' },
  } as const;

  @text('domain_pack_id') domainPackId!: string;
  @text('label_key') labelKey!: string;
  @field('automaticity_score') automaticityScore!: number;
  @field('baseline_daily_frequency') baselineDailyFrequency!: number;
  @field('is_archived') isArchived!: boolean;
  @date('created_at') createdAt!: Date;
  @date('updated_at') updatedAt!: Date;

  @children(TableName.TRIGGERS) triggers!: Query<TriggerModel>;
  @children(TableName.CRAVING_EVENTS) cravingEvents!: Query<CravingEventModel>;

  /** Recent events, newest first — the twin's short-term memory. */
  recentEvents(limit = 50): Query<CravingEventModel> {
    return this.cravingEvents.extend(Q.sortBy('occurred_at', Q.desc), Q.take(limit));
  }
}

export class TriggerModel extends Model {
  static table = TableName.TRIGGERS;
  static associations = {
    [TableName.BEHAVIORS]: { type: 'belongs_to', key: 'behavior_id' },
  } as const;

  @text('behavior_id') behaviorId!: string;
  @text('category') category!: TriggerCategory;
  @text('label_key') labelKey!: string;
  @field('weight') weight!: number;
  @field('occurrence_count') occurrenceCount!: number;
  @field('is_system_detected') isSystemDetected!: boolean;
  @json('sensor_binding', sanitizeSensorBinding)
  sensorBinding!: SensorBinding | null;
  @date('created_at') createdAt!: Date;
  @date('updated_at') updatedAt!: Date;

  @immutableRelation(TableName.BEHAVIORS, 'behavior_id')
  behavior!: Relation<BehaviorModel>;
}

export class CravingEventModel extends Model {
  static table = TableName.CRAVING_EVENTS;
  static associations = {
    [TableName.BEHAVIORS]: { type: 'belongs_to', key: 'behavior_id' },
    [TableName.TRIGGERS]: { type: 'belongs_to', key: 'trigger_id' },
  } as const;

  @text('behavior_id') behaviorId!: string;
  @text('trigger_id') triggerId!: string | null;
  @text('intervention_id') interventionId!: string | null;
  @field('intensity') intensity!: number;
  @text('emotion_label_key') emotionLabelKey!: string | null;
  @field('emotion_valence') emotionValence!: number | null;
  @field('emotion_arousal') emotionArousal!: number | null;
  @text('location_hash') locationHash!: string | null;
  @text('outcome') outcome!: string | null;
  @field('latency_to_outcome_sec') latencyToOutcomeSec!: number | null;
  @field('was_predicted') wasPredicted!: boolean;
  @date('occurred_at') occurredAt!: Date;
  @date('resolved_at') resolvedAt!: Date | null;

  @immutableRelation(TableName.BEHAVIORS, 'behavior_id')
  behavior!: Relation<BehaviorModel>;
  @relation(TableName.TRIGGERS, 'trigger_id')
  trigger!: Relation<TriggerModel>;
}

export class InterventionModel extends Model {
  static table = TableName.INTERVENTIONS;

  @text('domain_pack_id') domainPackId!: string;
  @text('mechanism') mechanism!: string;
  @text('label_key') labelKey!: string;
  @text('content_key') contentKey!: string;
  @field('estimated_duration_sec') estimatedDurationSec!: number;
  @field('success_rate') successRate!: number;
  @field('attempt_count') attemptCount!: number;
  @json('suited_categories', sanitizeCategories)
  suitedCategories!: TriggerCategory[];
  @field('activation_cost') activationCost!: number;
  @field('is_enabled') isEnabled!: boolean;
}

export class HabitEdgeModel extends Model {
  static table = TableName.HABIT_EDGES;

  @text('from_node_id') fromNodeId!: string;
  @text('from_node_type') fromNodeType!: string;
  @text('to_node_id') toNodeId!: string;
  @text('to_node_type') toNodeType!: string;
  @text('kind') kind!: string;
  @field('weight') weight!: number;
  @field('observation_count') observationCount!: number;
  @date('updated_at') updatedAt!: Date;
}

export class ReflectionModel extends Model {
  static table = TableName.REFLECTIONS;

  @text('behavior_id') behaviorId!: string;
  @field('control_rating') controlRating!: number | null;
  @text('note') note!: string | null;
  @date('created_at') createdAt!: Date;
}

export const coreModelClasses = [
  BehaviorModel,
  TriggerModel,
  CravingEventModel,
  InterventionModel,
  HabitEdgeModel,
  ReflectionModel,
];

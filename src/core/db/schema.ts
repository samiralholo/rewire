/**
 * BOS Core — WatermelonDB Schema ("Digital Habit Twin" storage)
 * ---------------------------------------------------------------------------
 * Offline-first mandate: this is the single source of truth and it never
 * leaves the device in V1. The twin is a property graph: entity tables are
 * nodes; `habit_edges` stores weighted relations for prediction.
 *
 * Conventions:
 * - Timestamps: epoch ms (number).
 * - Normalized scores: real in [0,1], enforced at the model layer.
 * - `*_key` columns hold DomainPack vocabulary keys, never display text.
 */

import { appSchema, tableSchema } from '@nozbe/watermelondb';

export const TableName = {
  BEHAVIORS: 'behaviors',
  TRIGGERS: 'triggers',
  CRAVING_EVENTS: 'craving_events',
  INTERVENTIONS: 'interventions',
  HABIT_EDGES: 'habit_edges',
  REFLECTIONS: 'reflections',
} as const;

export const schema = appSchema({
  version: 2,
  tables: [
    tableSchema({
      name: TableName.BEHAVIORS,
      columns: [
        { name: 'domain_pack_id', type: 'string', isIndexed: true },
        { name: 'label_key', type: 'string' },
        { name: 'automaticity_score', type: 'number' },
        { name: 'baseline_daily_frequency', type: 'number' },
        { name: 'is_archived', type: 'boolean' },
        { name: 'created_at', type: 'number' },
        { name: 'updated_at', type: 'number' },
      ],
    }),

    tableSchema({
      name: TableName.TRIGGERS,
      columns: [
        { name: 'behavior_id', type: 'string', isIndexed: true },
        { name: 'category', type: 'string', isIndexed: true },
        { name: 'label_key', type: 'string' },
        { name: 'weight', type: 'number' },
        { name: 'occurrence_count', type: 'number' },
        { name: 'is_system_detected', type: 'boolean' },
        { name: 'created_at', type: 'number' },
        { name: 'updated_at', type: 'number' },
      ],
    }),

    tableSchema({
      name: TableName.CRAVING_EVENTS,
      columns: [
        { name: 'behavior_id', type: 'string', isIndexed: true },
        { name: 'trigger_id', type: 'string', isOptional: true, isIndexed: true },
        { name: 'intervention_id', type: 'string', isOptional: true },
        { name: 'intensity', type: 'number' },
        // EmotionalSnapshot, flattened for queryability:
        { name: 'emotion_label_key', type: 'string', isOptional: true },
        { name: 'emotion_valence', type: 'number', isOptional: true },
        { name: 'emotion_arousal', type: 'number', isOptional: true },
        { name: 'location_hash', type: 'string', isOptional: true },
        { name: 'outcome', type: 'string', isOptional: true, isIndexed: true },
        { name: 'latency_to_outcome_sec', type: 'number', isOptional: true },
        { name: 'was_predicted', type: 'boolean' },
        { name: 'occurred_at', type: 'number', isIndexed: true },
        { name: 'resolved_at', type: 'number', isOptional: true },
      ],
    }),

    tableSchema({
      name: TableName.INTERVENTIONS,
      columns: [
        { name: 'domain_pack_id', type: 'string', isIndexed: true },
        { name: 'mechanism', type: 'string', isIndexed: true },
        { name: 'label_key', type: 'string' },
        { name: 'content_key', type: 'string' },
        { name: 'estimated_duration_sec', type: 'number' },
        { name: 'success_rate', type: 'number' },
        { name: 'attempt_count', type: 'number' },
        // JSON-encoded readonly TriggerCategory[] (small, read-mostly):
        { name: 'suited_categories', type: 'string' },
        { name: 'activation_cost', type: 'number' },
        { name: 'is_enabled', type: 'boolean' },
      ],
    }),

    // End-of-day self-reports: qualitative context the event stream can't
    // capture. Free text stays on-device like everything else.
    tableSchema({
      name: TableName.REFLECTIONS,
      columns: [
        { name: 'behavior_id', type: 'string', isIndexed: true },
        // Self-assessed sense of control for the day, normalized [0,1].
        { name: 'control_rating', type: 'number', isOptional: true },
        { name: 'note', type: 'string', isOptional: true },
        { name: 'created_at', type: 'number', isIndexed: true },
      ],
    }),

    // The twin's edge list. Nodes live in the tables above; `context`
    // nodes (e.g. a location hash) are addressed by their natural key.
    tableSchema({
      name: TableName.HABIT_EDGES,
      columns: [
        { name: 'from_node_id', type: 'string', isIndexed: true },
        { name: 'from_node_type', type: 'string' },
        { name: 'to_node_id', type: 'string', isIndexed: true },
        { name: 'to_node_type', type: 'string' },
        { name: 'kind', type: 'string', isIndexed: true },
        { name: 'weight', type: 'number' },
        { name: 'observation_count', type: 'number' },
        { name: 'updated_at', type: 'number' },
      ],
    }),
  ],
});

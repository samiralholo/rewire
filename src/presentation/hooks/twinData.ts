/**
 * Presentation — shared reactive reads from the local twin.
 * Extracted from InterceptorScreen so Dashboard/Reflection can reuse them.
 */

import { useEffect, useState } from 'react';
import { Q } from '@nozbe/watermelondb';
import { useTranslation } from 'react-i18next';
import { TableName } from '../../core/db/schema';
import {
  BehaviorModel,
  HabitEdgeModel,
  InterventionModel,
  TriggerModel,
} from '../../core/db/models';
import { useBoot } from '../BootContext';

export function useTriggerChips(): TriggerModel[] {
  const { database, boot } = useBoot();
  const [rows, setRows] = useState<TriggerModel[]>([]);
  useEffect(() => {
    const subscription = database
      .get<TriggerModel>(TableName.TRIGGERS)
      .query(
        Q.where('behavior_id', boot.behaviorId),
        Q.sortBy('weight', Q.desc), // most likely cues first: fewer scrolls
      )
      .observe()
      .subscribe(setRows);
    return () => subscription.unsubscribe();
  }, [database, boot.behaviorId]);
  return rows;
}

export function useInterventions(): InterventionModel[] {
  const { database, packId } = useBoot();
  const [rows, setRows] = useState<InterventionModel[]>([]);
  useEffect(() => {
    const subscription = database
      .get<InterventionModel>(TableName.INTERVENTIONS)
      .query(Q.where('domain_pack_id', packId), Q.where('is_enabled', true))
      .observe()
      .subscribe(setRows);
    return () => subscription.unsubscribe();
  }, [database, packId]);
  return rows;
}

/**
 * Resolve a DomainPack vocabulary key through the i18n 'domain' namespace
 * (fed by registerDomainVocabulary at boot). Falls back to the key itself.
 */
export function useDomainLabel(): (key: string) => string {
  const { t } = useTranslation('domain');
  return (key: string) => t(key, { defaultValue: key });
}

// ---------------------------------------------------------------------------
// Habit Twin graph data (Sprint 9)
// ---------------------------------------------------------------------------

export interface TwinGraphNode {
  /** Trigger row id (doubles as the edge's from_node_id). */
  id: string;
  labelKey: string;
  /** Weight of the `cues` edge trigger -> behavior, straight from habit_edges. */
  edgeWeight: number;
  observationCount: number;
}

export interface TwinGraphData {
  behaviorLabelKey: string | null;
  nodes: readonly TwinGraphNode[];
}

/**
 * Reactive read of the visualizable twin: the behavior node plus every
 * trigger that has a learned `cues` edge. Weights come from habit_edges —
 * the same numbers the prediction engine uses — so what the user sees IS
 * the model, not a decoration of it.
 */
export function useHabitGraph(): TwinGraphData {
  const { database, boot } = useBoot();
  const [behaviorLabelKey, setBehaviorLabelKey] = useState<string | null>(null);
  const [triggers, setTriggers] = useState<TriggerModel[]>([]);
  const [edges, setEdges] = useState<HabitEdgeModel[]>([]);

  useEffect(() => {
    void database
      .get<BehaviorModel>(TableName.BEHAVIORS)
      .find(boot.behaviorId)
      .then((b) => setBehaviorLabelKey(b.labelKey))
      .catch(() => setBehaviorLabelKey(null));

    const triggerSub = database
      .get<TriggerModel>(TableName.TRIGGERS)
      .query(Q.where('behavior_id', boot.behaviorId))
      .observe()
      .subscribe(setTriggers);

    const edgeSub = database
      .get<HabitEdgeModel>(TableName.HABIT_EDGES)
      .query(Q.where('kind', 'cues'), Q.where('to_node_id', boot.behaviorId))
      .observe()
      .subscribe(setEdges);

    return () => {
      triggerSub.unsubscribe();
      edgeSub.unsubscribe();
    };
  }, [database, boot.behaviorId]);

  const byTriggerId = new Map(edges.map((e) => [e.fromNodeId, e]));
  const nodes = triggers
    .map((t): TwinGraphNode | null => {
      const edge = byTriggerId.get(t.id);
      return edge
        ? {
            id: t.id,
            labelKey: t.labelKey,
            edgeWeight: edge.weight,
            observationCount: edge.observationCount,
          }
        : null;
    })
    .filter((n): n is TwinGraphNode => n !== null)
    .sort((a, b) => b.edgeWeight - a.edgeWeight);

  return { behaviorLabelKey, nodes };
}

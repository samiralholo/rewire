/**
 * BOS Core — DomainPack Installer
 * ---------------------------------------------------------------------------
 * Materializes a DomainPack's seeds into the local Habit Twin. Fully
 * domain-agnostic: it moves opaque keys, categories, and weights.
 *
 * Guarantees:
 * 1. IDEMPOTENT — natural keys are (domain_pack_id, label_key) for entities
 *    and (from, to, kind) for edges. Re-running install (app restart, pack
 *    version bump) creates nothing twice and NEVER overwrites learned state.
 * 2. COLD-START SOLVED — first-time `disrupts` edges are created with the
 *    pack's Pre-defined Seed Weight (`baselineWeight`), so the intervention
 *    selector has a scientifically backed prior before any user data exists.
 * 3. ATOMIC — all inserts happen in a single database.write batch.
 */

import { Q, type Database } from '@nozbe/watermelondb';
import { TableName } from '../db/schema';
import {
  BehaviorModel,
  HabitEdgeModel,
  InterventionModel,
  TriggerModel,
} from '../db/models';
import type { DomainPack } from './DomainPack';

export interface InstallReport {
  packId: string;
  behaviorsCreated: number;
  triggersCreated: number;
  interventionsCreated: number;
  edgesCreated: number;
  /** True when nothing needed to be created (pack was already installed). */
  alreadyInstalled: boolean;
}

export async function installDomainPack(
  database: Database,
  pack: DomainPack,
): Promise<InstallReport> {
  const behaviors = database.get<BehaviorModel>(TableName.BEHAVIORS);
  const triggers = database.get<TriggerModel>(TableName.TRIGGERS);
  const interventions = database.get<InterventionModel>(TableName.INTERVENTIONS);
  const edges = database.get<HabitEdgeModel>(TableName.HABIT_EDGES);

  return database.write(async () => {
    const now = Date.now();
    const batch: Array<BehaviorModel | TriggerModel | InterventionModel | HabitEdgeModel> = [];

    // -- Existing state (natural-key indexes for idempotency) ---------------
    const [existingBehaviors, existingInterventions] = await Promise.all([
      behaviors.query(Q.where('domain_pack_id', pack.id)).fetch(),
      interventions.query(Q.where('domain_pack_id', pack.id)).fetch(),
    ]);
    const behaviorByKey = new Map(existingBehaviors.map((b) => [b.labelKey, b]));
    const interventionByKey = new Map(existingInterventions.map((i) => [i.labelKey, i]));

    // -- 1. Behaviors --------------------------------------------------------
    let behaviorsCreated = 0;
    // id (existing or prepared) per labelKey, needed for trigger FKs below.
    const behaviorIdByKey = new Map<string, string>();

    for (const seed of pack.behaviorSeeds) {
      const existing = behaviorByKey.get(seed.labelKey);
      if (existing) {
        behaviorIdByKey.set(seed.labelKey, existing.id);
        continue;
      }
      const prepared = behaviors.prepareCreate((b) => {
        b.domainPackId = pack.id;
        b.labelKey = seed.labelKey;
        b.automaticityScore = seed.initialAutomaticity;
        b.baselineDailyFrequency = seed.estimatedDailyFrequency;
        b.isArchived = false;
        b.createdAt = new Date(now);
        b.updatedAt = new Date(now);
      });
      behaviorIdByKey.set(seed.labelKey, prepared.id);
      batch.push(prepared);
      behaviorsCreated += 1;
    }

    // V1: packs declare exactly one behavior; triggers attach to the first.
    const primaryBehaviorId = [...behaviorIdByKey.values()][0];
    if (primaryBehaviorId === undefined) {
      throw new Error(`DomainPack '${pack.id}' declares no behaviorSeeds.`);
    }

    // -- 2. Triggers ---------------------------------------------------------
    const existingTriggers = await triggers
      .query(Q.where('behavior_id', primaryBehaviorId))
      .fetch();
    const triggerByKey = new Map(existingTriggers.map((t) => [t.labelKey, t]));

    let triggersCreated = 0;
    const triggerIdByKey = new Map<string, string>();
    const triggerCategoryByKey = new Map<string, string>();

    for (const seed of pack.triggerSeeds) {
      triggerCategoryByKey.set(seed.labelKey, seed.category);
      const existing = triggerByKey.get(seed.labelKey);
      if (existing) {
        triggerIdByKey.set(seed.labelKey, existing.id);
        continue;
      }
      const prepared = triggers.prepareCreate((t) => {
        t.behaviorId = primaryBehaviorId;
        t.category = seed.category;
        t.labelKey = seed.labelKey;
        t.weight = seed.initialWeight;
        t.occurrenceCount = 0;
        t.isSystemDetected = false;
        t.sensorBinding = seed.sensorBinding ?? null;
        t.createdAt = new Date(now);
        t.updatedAt = new Date(now);
      });
      triggerIdByKey.set(seed.labelKey, prepared.id);
      batch.push(prepared);
      triggersCreated += 1;
    }

    // -- 3. Interventions ----------------------------------------------------
    let interventionsCreated = 0;
    // id + baselineWeight per labelKey, needed for `disrupts` edges below.
    const interventionInfoByKey = new Map<string, { id: string; baselineWeight: number }>();

    for (const seed of pack.interventionSeeds) {
      const existing = interventionByKey.get(seed.labelKey);
      if (existing) {
        interventionInfoByKey.set(seed.labelKey, {
          id: existing.id,
          baselineWeight: seed.baselineWeight,
        });
        continue;
      }
      const prepared = interventions.prepareCreate((i) => {
        i.domainPackId = pack.id;
        i.mechanism = seed.mechanism;
        i.labelKey = seed.labelKey;
        i.contentKey = seed.contentKey;
        i.estimatedDurationSec = seed.estimatedDurationSec;
        // successRate starts at the seed prior; learning refines it later.
        i.successRate = seed.baselineWeight;
        i.attemptCount = 0;
        i.suitedCategories = [...seed.suitedCategories];
        i.activationCost = seed.activationCost;
        i.isEnabled = true;
      });
      interventionInfoByKey.set(seed.labelKey, {
        id: prepared.id,
        baselineWeight: seed.baselineWeight,
      });
      batch.push(prepared);
      interventionsCreated += 1;
    }

    // -- 4. Habit Twin edges (Pre-defined Seed Weights) -----------------------
    const allNodeIds = [
      primaryBehaviorId,
      ...triggerIdByKey.values(),
      ...[...interventionInfoByKey.values()].map((i) => i.id),
    ];
    const existingEdges = await edges
      .query(Q.where('from_node_id', Q.oneOf(allNodeIds)))
      .fetch();
    const edgeKeys = new Set(
      existingEdges.map((e) => `${e.fromNodeId}|${e.toNodeId}|${e.kind}`),
    );

    let edgesCreated = 0;
    const createEdgeOnce = (
      fromNodeId: string,
      fromNodeType: string,
      toNodeId: string,
      toNodeType: string,
      kind: string,
      seedWeight: number,
    ): void => {
      const key = `${fromNodeId}|${toNodeId}|${kind}`;
      if (edgeKeys.has(key)) return; // NEVER overwrite a learned edge
      edgeKeys.add(key);
      batch.push(
        edges.prepareCreate((e) => {
          e.fromNodeId = fromNodeId;
          e.fromNodeType = fromNodeType;
          e.toNodeId = toNodeId;
          e.toNodeType = toNodeType;
          e.kind = kind;
          e.weight = seedWeight; // <-- Pre-defined Seed Weight (cold-start)
          e.observationCount = 0;
          e.updatedAt = new Date(now);
        }),
      );
      edgesCreated += 1;
    };

    // trigger --cues--> behavior (prior = trigger initialWeight)
    for (const seed of pack.triggerSeeds) {
      const triggerId = triggerIdByKey.get(seed.labelKey);
      if (!triggerId) continue;
      createEdgeOnce(triggerId, 'trigger', primaryBehaviorId, 'behavior', 'cues', seed.initialWeight);
    }

    // intervention --disrupts--> trigger (prior = intervention baselineWeight)
    for (const seed of pack.interventionSeeds) {
      const info = interventionInfoByKey.get(seed.labelKey);
      if (!info) continue;
      for (const [triggerKey, category] of triggerCategoryByKey) {
        if (!seed.suitedCategories.includes(category as never)) continue;
        const triggerId = triggerIdByKey.get(triggerKey);
        if (!triggerId) continue;
        createEdgeOnce(info.id, 'intervention', triggerId, 'trigger', 'disrupts', info.baselineWeight);
      }
    }

    if (batch.length > 0) await database.batch(...batch);

    return {
      packId: pack.id,
      behaviorsCreated,
      triggersCreated,
      interventionsCreated,
      edgesCreated,
      alreadyInstalled: batch.length === 0,
    };
  }, 'installDomainPack');
}

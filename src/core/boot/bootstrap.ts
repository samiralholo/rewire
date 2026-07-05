/**
 * BOS Core — Application Bootstrap
 * ---------------------------------------------------------------------------
 * The single initialization sequence for the engine:
 *
 *   1. Register the provided DomainPack(s)          (idempotent, Fast-Refresh safe)
 *   2. Materialize seeds into the Habit Twin        (packInstaller, idempotent)
 *   3. Build the machine's persistence adapters     (the IO the machine injects)
 *   4. Spawn + start the XState craving actor
 *   5. Bind the presentation layer                  (INJECTED — see note below)
 *   6. Start the prediction scheduler               (idle -> vulnerable feed)
 *
 * LAYERING NOTE: the core must not import `/src/state/uiStore` — that would
 * point a core dependency outward (and create a cycle: state already imports
 * core types). The RN root therefore passes `bindCravingActor` in as the
 * `bindUi` option. The core stays UI-free; the wiring stays one-directional.
 *
 * Consumption from the RN root:
 *
 *   const bootPromise = bootstrap({
 *     database,
 *     packs: [SomeDomainPack],        // app layer chooses the domain
 *     bindUi: bindCravingActor,          // app layer owns presentation
 *   });
 *   // <App/> awaits bootPromise (e.g. behind the Expo splash screen)
 */

import { Q, type Database } from '@nozbe/watermelondb';
import { createActor, type ActorRefFrom } from 'xstate';
import { TableName } from '../db/schema';
import { BehaviorModel, CravingEventModel } from '../db/models';
import { DomainRegistry, type DomainPack } from '../registry/DomainPack';
import { installDomainPack, type InstallReport } from '../registry/packInstaller';
import {
  createCravingMachine,
  type CravingMachine,
  type CravingMachineDeps,
} from '../machines/cravingMachine';
import { applyOutcomeToTwin } from '../engine/weightUpdater';
import {
  createPredictionScheduler,
  type PredictionScheduler,
  type PredictionSchedulerOptions,
} from '../engine/predictionScheduler';
import type { ContextProvider, GeofenceRegion } from '../sensors/contextProvider';
import { TriggerModel } from '../db/models';
import type { BehaviorId, CravingEventId } from '../types';

// ---------------------------------------------------------------------------
// Options & result
// ---------------------------------------------------------------------------

export interface BootstrapOptions {
  database: Database;
  /** Domain packs to activate. V1 ships with exactly one. */
  packs: readonly DomainPack[];
  /**
   * Presentation binder, injected by the app layer
   * (pass `bindCravingActor` from src/state/uiStore). Optional so the
   * engine can boot headless in tests.
   */
  bindUi?: (actor: ActorRefFrom<CravingMachine>) => () => void;
  /**
   * Optional device-context provider (createContextProvider()). Started
   * during boot; permission denial degrades gracefully to inert.
   */
  contextProvider?: ContextProvider;
  /** Scheduler tuning; sensible defaults applied. */
  scheduler?: Partial<PredictionSchedulerOptions>;
  /** Disable the scheduler (tests, storybook). Default: enabled. */
  enablePrediction?: boolean;
}

export interface BootResult {
  actor: ActorRefFrom<CravingMachine>;
  behaviorId: BehaviorId;
  installReports: readonly InstallReport[];
  scheduler: PredictionScheduler | null;
  /** Tear everything down in reverse order (unmount, tests, Fast Refresh). */
  shutdown: () => void;
}

// ---------------------------------------------------------------------------
// Persistence adapters — the only place machine IO touches the database
// ---------------------------------------------------------------------------

function buildMachineDeps(database: Database): CravingMachineDeps {
  const events = database.get<CravingEventModel>(TableName.CRAVING_EVENTS);

  return {
    async persistCapture(ctx) {
      const created = await database.write(() =>
        events.create((e) => {
          e.behaviorId = ctx.behaviorId;
          // Capture must never block on missing optional context.
          e.intensity = ctx.intensity ?? 0.5;
          e.wasPredicted = ctx.wasPredicted;
          e.triggerId = null;
          e.interventionId = null;
          e.outcome = null;
          e.occurredAt = new Date();
          e.resolvedAt = null;
        }),
      );
      return created.id as CravingEventId;
    },

    async persistResolution(ctx) {
      if (ctx.eventId === null) {
        // Capture persistence failed earlier; losing one row beats crashing
        // the flow. The machine already surfaced `lastError` to the UI.
        return;
      }
      const event = await events.find(ctx.eventId);
      const resolvedAt = Date.now();

      await database.write(() =>
        event.update((e) => {
          e.triggerId = ctx.triggerId;
          e.interventionId = ctx.interventionId;
          e.outcome = ctx.outcome;
          e.emotionLabelKey = ctx.emotionalState?.labelKey ?? null;
          e.emotionValence = ctx.emotionalState?.valence ?? null;
          e.emotionArousal = ctx.emotionalState?.arousal ?? null;
          e.latencyToOutcomeSec =
            ctx.capturedAt !== null
              ? Math.round((resolvedAt - ctx.capturedAt) / 1000)
              : null;
          e.resolvedAt = new Date(resolvedAt);
        }),
      );

      // Feed the Habit Twin. Learning failures must not break resolution.
      try {
        await applyOutcomeToTwin(database, event);
      } catch (error) {
        console.warn('[BOS] Twin update failed; event preserved for replay', error);
      }
    },
  };
}

// ---------------------------------------------------------------------------
// Bootstrap
// ---------------------------------------------------------------------------

export async function bootstrap(options: BootstrapOptions): Promise<BootResult> {
  const { database, packs, bindUi, enablePrediction = true } = options;
  if (packs.length === 0) {
    throw new Error('bootstrap requires at least one DomainPack.');
  }

  // 1. Register packs (skip already-registered: Fast Refresh / re-boot safe).
  for (const pack of packs) {
    if (!DomainRegistry.has(pack.id)) DomainRegistry.register(pack);
  }

  // 2. Materialize seeds (idempotent; second run is a cheap no-op).
  const installReports: InstallReport[] = [];
  for (const pack of packs) {
    installReports.push(await installDomainPack(database, pack));
  }

  // 3. Resolve the primary behavior (V1: single active behavior).
  const primaryPack = packs[0];
  if (primaryPack === undefined) throw new Error('unreachable: packs is non-empty');
  const behaviors = await database
    .get<BehaviorModel>(TableName.BEHAVIORS)
    .query(Q.where('domain_pack_id', primaryPack.id), Q.where('is_archived', false))
    .fetch();
  const behavior = behaviors[0];
  if (behavior === undefined) {
    throw new Error(`No behavior installed for pack '${primaryPack.id}'.`);
  }
  const behaviorId = behavior.id as BehaviorId;

  // 4. Spawn the craving actor with injected persistence.
  const machine = createCravingMachine(buildMachineDeps(database));
  const actor = createActor(machine, { input: { behaviorId } });
  actor.start();

  // 5. Bind presentation (if a UI is attached).
  const unbindUi = bindUi?.(actor) ?? null;

  // 6. Start sensors (optional, permission-graceful) and load any
  //    user-configured geofence bindings into the provider.
  const contextProvider = options.contextProvider ?? null;
  if (contextProvider) {
    try {
      await contextProvider.start();
      const boundTriggers = await database
        .get<TriggerModel>(TableName.TRIGGERS)
        .query(
          Q.where('behavior_id', behaviorId),
          Q.where('sensor_binding', Q.notEq(null)),
        )
        .fetch();
      const regions = boundTriggers
        .map((t): GeofenceRegion | null => {
          const b = t.sensorBinding;
          return b?.kind === 'geofence' &&
            b.latitude !== undefined &&
            b.longitude !== undefined
            ? {
                id: t.id,
                placeKey: b.placeKey,
                latitude: b.latitude,
                longitude: b.longitude,
                radiusM: b.radiusM,
              }
            : null;
        })
        .filter((r): r is GeofenceRegion => r !== null);
      contextProvider.setGeofences(regions);
    } catch (error) {
      console.warn('[BOS] Sensors unavailable; continuing without them', error);
    }
  }

  // 7. Start the prediction loop.
  let scheduler: PredictionScheduler | null = null;
  if (enablePrediction) {
    scheduler = createPredictionScheduler({
      database,
      actor,
      pack: primaryPack,
      behaviorId,
      ...(contextProvider ? { contextProvider } : {}),
      ...options.scheduler,
    });
    scheduler.start();
  }

  return {
    actor,
    behaviorId,
    installReports,
    scheduler,
    shutdown: () => {
      scheduler?.stop();
      contextProvider?.stop();
      unbindUi?.();
      actor.stop();
    },
  };
}

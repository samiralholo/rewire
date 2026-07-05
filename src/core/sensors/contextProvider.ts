/**
 * BOS Core — Environment Context Provider
 * ---------------------------------------------------------------------------
 * Abstracts raw device sensors into one standardized, domain-agnostic
 * EnvironmentContext: coarse movement classification + foreground geofence
 * membership. Consumers (the prediction scheduler) never touch expo APIs.
 *
 * Graceful degradation is a hard requirement:
 * - expo modules are loaded dynamically; environments without them (tests,
 *   headless) get a provider that reports 'unknown' and never throws.
 * - Permission denial is a normal, supported state: the provider keeps
 *   running with movement='unknown' and no geofences. The app behaves
 *   exactly as it did before Sprint 8.
 *
 * V1 scope notes (documented limits, not accidents):
 * - Movement is classified from foreground location speed with hysteresis
 *   (two consecutive agreeing samples) — no OS activity-recognition APIs.
 * - Geofencing is FOREGROUND-ONLY: membership is computed by haversine on
 *   each location update. Background geofencing (expo-task-manager) is a
 *   deliberate later sprint: it needs background-location consent UX.
 */

import type { MovementState, Timestamp } from '../types';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type PermissionState = 'granted' | 'denied' | 'undetermined';

export interface GeofenceRegion {
  /** Stable id — by convention the bound trigger's row id. */
  id: string;
  placeKey: string;
  latitude: number;
  longitude: number;
  radiusM: number;
}

export interface EnvironmentContext {
  movement: MovementState;
  /** When the current movement state began. */
  movementSince: Timestamp | null;
  /** Geofence region ids the user is currently inside. */
  activeGeofenceIds: readonly string[];
  /** Last movement change or geofence boundary crossing. */
  lastTransitionAt: Timestamp | null;
  locationPermission: PermissionState;
}

export type ContextTransition =
  | { type: 'movement'; previous: MovementState; current: MovementState }
  | { type: 'geofence'; entered: readonly string[]; exited: readonly string[] };

export interface SensorAvailability {
  location: boolean;
}

export interface ContextProvider {
  /** Requests permissions and starts sensors. Safe to call once at boot. */
  start: () => Promise<SensorAvailability>;
  stop: () => void;
  getContext: () => EnvironmentContext;
  /** Replace the monitored regions (e.g. after user configures a place). */
  setGeofences: (regions: readonly GeofenceRegion[]) => void;
  /** Fires on movement changes and geofence crossings. */
  subscribe: (listener: (transition: ContextTransition) => void) => () => void;
}

export interface ContextProviderOptions {
  /** Location update cadence. Default 30s / 50m. */
  timeIntervalMs?: number;
  distanceIntervalM?: number;
  now?: () => number;
}

// ---------------------------------------------------------------------------
// Movement classification (speed in m/s, with hysteresis)
// ---------------------------------------------------------------------------

const SPEED_STATIONARY_MAX = 0.4;
const SPEED_WALKING_MAX = 2.2;
const SPEED_RUNNING_MAX = 4.5;

const classifySpeed = (speed: number | null): MovementState => {
  if (speed === null || speed < 0 || Number.isNaN(speed)) return 'unknown';
  if (speed <= SPEED_STATIONARY_MAX) return 'stationary';
  if (speed <= SPEED_WALKING_MAX) return 'walking';
  if (speed <= SPEED_RUNNING_MAX) return 'running';
  return 'driving';
};

/** Haversine distance in meters. */
const distanceM = (
  lat1: number, lon1: number, lat2: number, lon2: number,
): number => {
  const R = 6371000;
  const toRad = (d: number): number => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
};

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

export function createContextProvider(
  options: ContextProviderOptions = {},
): ContextProvider {
  const {
    timeIntervalMs = 30_000,
    distanceIntervalM = 50,
    now = Date.now,
  } = options;

  let regions: readonly GeofenceRegion[] = [];
  let watcher: { remove: () => void } | null = null;
  const listeners = new Set<(t: ContextTransition) => void>();

  const context: {
    movement: MovementState;
    movementSince: Timestamp | null;
    activeGeofenceIds: string[];
    lastTransitionAt: Timestamp | null;
    locationPermission: PermissionState;
  } = {
    movement: 'unknown',
    movementSince: null,
    activeGeofenceIds: [],
    lastTransitionAt: null,
    locationPermission: 'undetermined',
  };

  /** Hysteresis: a movement switch needs two consecutive agreeing samples. */
  let pendingMovement: MovementState | null = null;

  const emit = (transition: ContextTransition): void => {
    for (const listener of listeners) {
      try {
        listener(transition);
      } catch (error) {
        console.warn('[BOS] Context listener failed', error);
      }
    }
  };

  const onMovementSample = (sample: MovementState): void => {
    if (sample === 'unknown' || sample === context.movement) {
      pendingMovement = null;
      return;
    }
    if (pendingMovement !== sample) {
      pendingMovement = sample; // first vote — wait for confirmation
      return;
    }
    const previous = context.movement;
    context.movement = sample;
    context.movementSince = now();
    context.lastTransitionAt = now();
    pendingMovement = null;
    emit({ type: 'movement', previous, current: sample });
  };

  const onPosition = (latitude: number, longitude: number): void => {
    const inside = regions
      .filter((r) => distanceM(latitude, longitude, r.latitude, r.longitude) <= r.radiusM)
      .map((r) => r.id);
    const before = new Set(context.activeGeofenceIds);
    const after = new Set(inside);
    const entered = inside.filter((id) => !before.has(id));
    const exited = context.activeGeofenceIds.filter((id) => !after.has(id));
    if (entered.length === 0 && exited.length === 0) return;
    context.activeGeofenceIds = inside;
    context.lastTransitionAt = now();
    emit({ type: 'geofence', entered, exited });
  };

  return {
    async start(): Promise<SensorAvailability> {
      try {
        const Location = await import('expo-location');
        const { status } = await Location.requestForegroundPermissionsAsync();
        context.locationPermission = status === 'granted' ? 'granted' : 'denied';
        if (status !== 'granted') {
          // Denial is a supported state, not an error.
          return { location: false };
        }
        watcher = await Location.watchPositionAsync(
          {
            accuracy: Location.Accuracy.Balanced,
            timeInterval: timeIntervalMs,
            distanceInterval: distanceIntervalM,
          },
          (position) => {
            onMovementSample(classifySpeed(position.coords.speed));
            onPosition(position.coords.latitude, position.coords.longitude);
          },
        );
        return { location: true };
      } catch (error) {
        // Module unavailable (tests/headless) or sensor failure: stay inert.
        console.warn('[BOS] Context provider degraded to inert mode', error);
        return { location: false };
      }
    },

    stop(): void {
      watcher?.remove();
      watcher = null;
      listeners.clear();
    },

    getContext(): EnvironmentContext {
      return {
        movement: context.movement,
        movementSince: context.movementSince,
        activeGeofenceIds: [...context.activeGeofenceIds],
        lastTransitionAt: context.lastTransitionAt,
        locationPermission: context.locationPermission,
      };
    },

    setGeofences(next: readonly GeofenceRegion[]): void {
      regions = next.filter((r) => Number.isFinite(r.latitude) && Number.isFinite(r.longitude));
    },

    subscribe(listener): () => void {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

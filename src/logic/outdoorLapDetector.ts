/**
 * GPS-based lap detector for OUTDOOR sessions.
 *
 * Mirrors the indoor reducer's state machine (idle → calibrating → armed
 * → away → approaching → finished) but uses geographic distance from a
 * calibrated start point instead of BLE+magnetic similarity.
 *
 * The reducer is pure: no `Date.now()`, no I/O. Tests can drive the
 * clock and feed synthetic GPS streams deterministically.
 */

export type GeoPoint = {
  /** Latitude in decimal degrees, WGS-84. */
  latitude: number;
  /** Longitude in decimal degrees, WGS-84. */
  longitude: number;
  /** Reported horizontal accuracy in meters (radius). */
  accuracy: number;
};

export type OutdoorPhase =
  | 'idle'
  | 'calibrating'
  | 'armed'
  | 'away'
  | 'approaching'
  | 'finished';

export type OutdoorDetectorConfig = {
  /** Target lap count. When `count >= targetLaps`, the detector finishes. */
  targetLaps: number;
  /** Calibration window (ms) — GPS samples are averaged into pointA. */
  calibrationMs: number;
  /** Distance (m) within which we consider the user "at" pointA. */
  nearRadiusM: number;
  /** Distance (m) beyond which we consider the user to have left pointA. */
  farRadiusM: number;
  /** Min ms between counted laps (debounce). */
  lapDebounceMs: number;
  /**
   * Reject GPS readings whose reported accuracy is worse (i.e. larger
   * radius) than this. Prevents tunnels / cold-start fixes from poisoning
   * the detector.
   */
  maxAcceptableAccuracyM: number;
  /** EMA weight when refining stored pointA each lap. 0 = no learning. */
  refinementAlpha: number;
};

export const DEFAULT_OUTDOOR_CONFIG: OutdoorDetectorConfig = {
  targetLaps: 10,
  calibrationMs: 8000,
  nearRadiusM: 15,
  farRadiusM: 40,
  lapDebounceMs: 15000,
  maxAcceptableAccuracyM: 25,
  refinementAlpha: 0.2,
};

export type OutdoorDetectorState = {
  phase: OutdoorPhase;
  count: number;
  config: OutdoorDetectorConfig;
  /** Calibrated start point. Null until calibration completes. */
  pointA: GeoPoint | null;
  calibrationStartedAt: number | null;
  calibrationSamples: GeoPoint[];
  lastLapAt: number | null;
  /** Most recent distance from pointA (m). */
  lastDistanceM: number;
  /** Most recent reported accuracy (m). */
  lastAccuracyM: number;
  /** Number of GPS readings rejected for poor accuracy this session. */
  rejectedCount: number;
};

export type OutdoorDetectorInput = {
  now: number;
  position: GeoPoint;
};

export type OutdoorDetectorAction =
  | { type: 'start'; config?: Partial<OutdoorDetectorConfig>; calibratedPointA?: GeoPoint }
  | { type: 'tick'; input: OutdoorDetectorInput }
  | { type: 'stop' }
  | { type: 'reset' };

export function createInitialOutdoorState(
  config: OutdoorDetectorConfig = DEFAULT_OUTDOOR_CONFIG
): OutdoorDetectorState {
  return {
    phase: 'idle',
    count: 0,
    config,
    pointA: null,
    calibrationStartedAt: null,
    calibrationSamples: [],
    lastLapAt: null,
    lastDistanceM: 0,
    lastAccuracyM: Number.POSITIVE_INFINITY,
    rejectedCount: 0,
  };
}

const EARTH_RADIUS_M = 6371000;

/**
 * Great-circle distance between two points in meters using the Haversine
 * formula. Accurate to within < 1 m for distances under a few km — far
 * better than GPS accuracy itself, so it's not the bottleneck.
 */
export function haversineDistance(a: GeoPoint, b: GeoPoint): number {
  const φ1 = (a.latitude * Math.PI) / 180;
  const φ2 = (b.latitude * Math.PI) / 180;
  const Δφ = ((b.latitude - a.latitude) * Math.PI) / 180;
  const Δλ = ((b.longitude - a.longitude) * Math.PI) / 180;
  const x =
    Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
    Math.cos(φ1) *
      Math.cos(φ2) *
      Math.sin(Δλ / 2) *
      Math.sin(Δλ / 2);
  const c = 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
  return EARTH_RADIUS_M * c;
}

/**
 * Average a list of GPS samples into a single calibrated point.
 *
 * Each sample is weighted by 1/accuracy² (kalman-flavored: tight fixes
 * count more than loose ones). This keeps a single noisy first fix from
 * dominating an otherwise good calibration.
 */
function averageGeoPoints(samples: GeoPoint[]): GeoPoint | null {
  if (samples.length === 0) return null;

  let totalWeight = 0;
  let weightedLat = 0;
  let weightedLon = 0;
  let bestAccuracy = Number.POSITIVE_INFINITY;
  for (const s of samples) {
    const acc = Math.max(s.accuracy, 1);
    const w = 1 / (acc * acc);
    totalWeight += w;
    weightedLat += s.latitude * w;
    weightedLon += s.longitude * w;
    if (acc < bestAccuracy) bestAccuracy = acc;
  }
  if (totalWeight === 0) return null;
  return {
    latitude: weightedLat / totalWeight,
    longitude: weightedLon / totalWeight,
    accuracy: bestAccuracy,
  };
}

/**
 * Refine pointA using a new "you're back at A" observation. EMA with
 * `alpha`. Bounded so the location can't drift more than 5 m per lap
 * (guards against a single erroneous fix from teleporting pointA).
 */
export function refinePointA(
  stored: GeoPoint,
  observation: GeoPoint,
  alpha: number
): GeoPoint {
  const dx = observation.latitude - stored.latitude;
  const dy = observation.longitude - stored.longitude;
  // Convert ~5m hard-cap into degrees: 1° lat ≈ 111_000 m.
  const cap = 5 / 111000;
  const blendedDx = Math.max(-cap, Math.min(cap, dx * alpha));
  const blendedDy = Math.max(-cap, Math.min(cap, dy * alpha));
  return {
    latitude: stored.latitude + blendedDx,
    longitude: stored.longitude + blendedDy,
    accuracy:
      stored.accuracy * (1 - alpha) + observation.accuracy * alpha,
  };
}

/**
 * Pure reducer for outdoor lap detection.
 */
export function outdoorReducer(
  state: OutdoorDetectorState,
  action: OutdoorDetectorAction
): OutdoorDetectorState {
  switch (action.type) {
    case 'start': {
      const config = { ...state.config, ...(action.config ?? {}) };
      if (action.calibratedPointA) {
        return {
          ...createInitialOutdoorState(config),
          phase: 'armed',
          pointA: action.calibratedPointA,
          calibrationStartedAt: null,
        };
      }
      return {
        ...createInitialOutdoorState(config),
        phase: 'calibrating',
        calibrationStartedAt: null,
      };
    }

    case 'stop':
    case 'reset':
      return createInitialOutdoorState(state.config);

    case 'tick': {
      const { now, position } = action.input;
      if (state.phase === 'idle' || state.phase === 'finished') {
        return state;
      }

      // Reject loose fixes outright.
      if (position.accuracy > state.config.maxAcceptableAccuracyM) {
        return {
          ...state,
          rejectedCount: state.rejectedCount + 1,
          lastAccuracyM: position.accuracy,
        };
      }

      if (state.phase === 'calibrating') {
        const startedAt = state.calibrationStartedAt ?? now;
        const samples = [...state.calibrationSamples, position];
        const elapsed = now - startedAt;
        if (elapsed >= state.config.calibrationMs && samples.length > 0) {
          const pointA = averageGeoPoints(samples) ?? position;
          return {
            ...state,
            phase: 'armed',
            pointA,
            calibrationStartedAt: startedAt,
            calibrationSamples: [],
            lastDistanceM: 0,
            lastAccuracyM: position.accuracy,
          };
        }
        return {
          ...state,
          calibrationStartedAt: startedAt,
          calibrationSamples: samples,
          lastAccuracyM: position.accuracy,
        };
      }

      // armed | away | approaching — pointA is guaranteed populated here.
      const a = state.pointA;
      if (!a) return state;
      const dist = haversineDistance(a, position);
      const baseUpdate: Partial<OutdoorDetectorState> = {
        lastDistanceM: dist,
        lastAccuracyM: position.accuracy,
      };
      const cfg = state.config;
      const sinceLap =
        state.lastLapAt == null ? Infinity : now - state.lastLapAt;
      const debounceOK = sinceLap >= cfg.lapDebounceMs;

      // Scale near radius dynamically based on current GPS accuracy.
      // If accuracy is high (e.g. 3m), shrink the radius (down to 8m floor) to avoid early triggers.
      // If accuracy is poor (e.g. 20m), expand it up to the configured limit.
      const adaptiveNearRadius = Math.max(8, Math.min(cfg.nearRadiusM, position.accuracy * 1.5));
      const isNear = dist <= adaptiveNearRadius;
      const isFar = dist >= cfg.farRadiusM;

      if (state.phase === 'armed') {
        if (isFar) return { ...state, ...baseUpdate, phase: 'away' };
        return { ...state, ...baseUpdate };
      }

      if (state.phase === 'away') {
        if (dist < cfg.farRadiusM) {
          return { ...state, ...baseUpdate, phase: 'approaching' };
        }
        return { ...state, ...baseUpdate };
      }

      // phase === 'approaching'
      if (isFar) return { ...state, ...baseUpdate, phase: 'away' };
      if (isNear && debounceOK) {
        const newCount = state.count + 1;
        const refined = refinePointA(a, position, cfg.refinementAlpha);
        const finished = newCount >= cfg.targetLaps;
        return {
          ...state,
          ...baseUpdate,
          count: newCount,
          pointA: refined,
          lastLapAt: now,
          phase: finished ? 'finished' : 'armed',
        };
      }
      return { ...state, ...baseUpdate };
    }

    default:
      return state;
  }
}

/** Human-readable status label for the UI. */
export function outdoorStatusLabel(state: OutdoorDetectorState): string {
  switch (state.phase) {
    case 'idle':
      return 'Tap Start';
    case 'calibrating':
      return 'Locking onto GPS — stand still…';
    case 'armed':
      return 'Walking lap…';
    case 'away':
      return 'Walking lap…';
    case 'approaching':
      return 'Approaching start point…';
    case 'finished':
      return 'All laps complete!';
  }
}

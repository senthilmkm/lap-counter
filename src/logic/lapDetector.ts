import {
  emptyFingerprint,
  Fingerprint,
  magneticDelta,
  refineFingerprint,
  similarity,
} from './fingerprint';

export type DetectorPhase =
  | 'idle'
  | 'calibrating'
  | 'armed'
  | 'away'
  | 'approaching'
  | 'finished';

/**
 * Tunable thresholds. Defaults are reasonable for a typical gym; surface
 * them in the debug UI so they can be adjusted on-site.
 */
export type DetectorConfig = {
  /** Target lap count. When `count >= targetLaps`, the detector finishes. */
  targetLaps: number;
  /** Calibration window in milliseconds. */
  calibrationMs: number;
  /** BLE+magnetic similarity threshold to consider "near" point A. */
  similarityNearThreshold: number;
  /** Similarity threshold below which we consider the user to have left A. */
  similarityFarThreshold: number;
  /** Max magnetic field delta (μT) to consider "near". */
  magneticDeltaThreshold: number;
  /** Max IMU displacement magnitude (m) to consider "near". */
  displacementThreshold: number;
  /** Min ms between counted laps (debounce). */
  lapDebounceMs: number;
  /** Moving-average weight when refining the stored fingerprint each lap. */
  refinementAlpha: number;
};

export const DEFAULT_CONFIG: DetectorConfig = {
  targetLaps: 10,
  calibrationMs: 5000,
  similarityNearThreshold: 0.75,
  similarityFarThreshold: 0.4,
  magneticDeltaThreshold: 5,
  displacementThreshold: 6,
  lapDebounceMs: 10000,
  refinementAlpha: 0.3,
};

export type DetectorState = {
  phase: DetectorPhase;
  count: number;
  config: DetectorConfig;
  /** Fingerprint of point A. Populated once calibration completes. */
  pointA: Fingerprint;
  /** When calibration began (ms). */
  calibrationStartedAt: number | null;
  /** Calibration accumulator (averaged when calibration completes). */
  calibrationSamples: Fingerprint[];
  /** ms timestamp of the most recently counted lap. */
  lastLapAt: number | null;
  /** Current observed similarity to point A (latest). */
  lastSimilarity: number;
  /** Current magnetic delta to A (latest). */
  lastMagneticDelta: number;
  /** Current displacement from A (latest). */
  lastDisplacementMagnitude: number;
  /** Raw Gyroscope Z-axis rotation rate. */
  lastGyroZRate?: number;
  /** Integrated Gyroscope yaw. */
  lastGyroYaw?: number;
  /** Whether the session is running in BLE-Free mode. */
  isBleFree?: boolean;
  /** Max displacement reached in the current lap (m) */
  maxDisplacement?: number;
  /** Current displacement threshold being used (m) */
  lastDisplacementThreshold?: number;
  /** Step count baseline at the start of the current lap */
  stepsAtLapStart?: number;
  /** Steps walked at the moment max displacement was reached in the current lap */
  maxDisplacementSteps?: number;
};

export type DetectorInput = {
  now: number;
  observation: Fingerprint;
  displacementMagnitude: number;
  gyroZRate?: number;
  gyroYaw?: number;
  steps?: number;
};

export type DetectorAction =
  | { type: 'start'; config?: Partial<DetectorConfig> }
  | { type: 'tick'; input: DetectorInput }
  | { type: 'stop' }
  | { type: 'reset' };

export function createInitialState(
  config: DetectorConfig = DEFAULT_CONFIG
): DetectorState {
  return {
    phase: 'idle',
    count: 0,
    config,
    pointA: emptyFingerprint(),
    calibrationStartedAt: null,
    calibrationSamples: [],
    lastLapAt: null,
    lastSimilarity: 0,
    lastMagneticDelta: 0,
    lastDisplacementMagnitude: 0,
    lastGyroZRate: 0,
    lastGyroYaw: 0,
    isBleFree: false,
    maxDisplacement: 0,
    lastDisplacementThreshold: 10,
    stepsAtLapStart: 0,
    maxDisplacementSteps: 0,
  };
}

/**
 * Average a list of fingerprint samples into a single calibrated fingerprint.
 * BLE: average RSSI across samples that observed the device, but only keep
 * devices seen in at least half of the samples (filters one-off noise).
 * Magnetic: simple mean.
 */
function averageSamples(samples: Fingerprint[]): Fingerprint {
  if (samples.length === 0) return emptyFingerprint();

  const counts = new Map<string, { sum: number; n: number }>();
  for (const s of samples) {
    for (const [id, rssi] of s.bleDevices) {
      const c = counts.get(id) ?? { sum: 0, n: 0 };
      c.sum += rssi;
      c.n += 1;
      counts.set(id, c);
    }
  }

  const minSeen = Math.max(1, Math.floor(samples.length / 2));
  const bleDevices = new Map<string, number>();
  for (const [id, { sum, n }] of counts) {
    if (n >= minSeen) bleDevices.set(id, sum / n);
  }

  const magneticMagnitude =
    samples.reduce((acc, s) => acc + s.magneticMagnitude, 0) / samples.length;

  return { bleDevices, magneticMagnitude };
}

/**
 * Pure reducer driving the lap-detection state machine. The owning hook
 * feeds it `tick` actions on every sensor cadence and reacts to state
 * transitions (lap counted, finished).
 */
export function reducer(state: DetectorState, action: DetectorAction): DetectorState {
  switch (action.type) {
    case 'start': {
      const config = { ...state.config, ...(action.config ?? {}) };
      // Leave calibrationStartedAt null; the first tick sets it from its
      // own `now`. This keeps the reducer pure (no Date.now()) and lets
      // tests drive the clock deterministically.
      return {
        ...createInitialState(config),
        phase: 'calibrating',
        calibrationStartedAt: null,
      };
    }

    case 'stop':
    case 'reset':
      return createInitialState(state.config);

    case 'tick': {
      const { now, observation, displacementMagnitude, gyroZRate, gyroYaw, steps } = action.input;

      if (state.phase === 'idle' || state.phase === 'finished') {
        return state;
      }

      if (state.phase === 'calibrating') {
        const startedAt = state.calibrationStartedAt ?? now;
        const samples = [...state.calibrationSamples, observation];
        const elapsed = now - startedAt;
        if (elapsed >= state.config.calibrationMs && samples.length > 0) {
          const pointA = averageSamples(samples);
          const isBleFree = pointA.bleDevices.size === 0;
          return {
            ...state,
            phase: 'armed',
            pointA,
            calibrationStartedAt: startedAt,
            calibrationSamples: [],
            lastSimilarity: 1,
            lastMagneticDelta: 0,
            lastDisplacementMagnitude: 0,
            lastGyroZRate: gyroZRate,
            lastGyroYaw: gyroYaw,
            isBleFree,
            stepsAtLapStart: steps ?? 0,
            maxDisplacement: 0,
            maxDisplacementSteps: 0,
          };
        }
        return {
          ...state,
          calibrationStartedAt: startedAt,
          calibrationSamples: samples,
          lastGyroZRate: gyroZRate,
          lastGyroYaw: gyroYaw,
        };
      }

      // armed | away | approaching
      const isBleFree = state.isBleFree ?? false;
      const sim = similarity(observation, state.pointA);
      const magDelta = magneticDelta(observation, state.pointA);

      const stepsSinceLastLap = steps ?? 0;
      let nextMaxDisplacement = state.maxDisplacement ?? 0;
      let nextMaxDisplacementSteps = state.maxDisplacementSteps ?? 0;
      if (displacementMagnitude > nextMaxDisplacement) {
        nextMaxDisplacement = displacementMagnitude;
        nextMaxDisplacementSteps = stepsSinceLastLap;
      }

      const cfg = state.config;
      const sinceLap =
        state.lastLapAt == null ? Infinity : now - state.lastLapAt;
      const debounceOK = sinceLap >= cfg.lapDebounceMs;

      // Adjust thresholds if running in BLE-free MIF mode
      const magThreshold = isBleFree ? 15.0 : cfg.magneticDeltaThreshold;

      // Calculate dynamic displacement return threshold to handle both short hallway walks
      // (where user walks 6-8m and return threshold should be tighter, e.g. 4m) and
      // long walks (where drift occurs and threshold should be looser, e.g. 8m).
      const displacementThreshold = isBleFree
        ? Math.max(4.0, Math.min(8.0, nextMaxDisplacement * 0.45))
        : cfg.displacementThreshold;

      const baseUpdate: Partial<DetectorState> = {
        lastSimilarity: sim,
        lastMagneticDelta: magDelta,
        lastDisplacementMagnitude: displacementMagnitude,
        lastGyroZRate: gyroZRate,
        lastGyroYaw: gyroYaw,
        maxDisplacement: nextMaxDisplacement,
        maxDisplacementSteps: nextMaxDisplacementSteps,
        lastDisplacementThreshold: displacementThreshold,
      };

      const minStepsRequired = Math.max(10, Math.floor(1.35 * nextMaxDisplacementSteps));
      const stepGateOk = !isBleFree || steps === undefined || stepsSinceLastLap >= minStepsRequired;

      const isNear =
        (isBleFree || sim >= cfg.similarityNearThreshold) &&
        magDelta <= magThreshold &&
        displacementMagnitude <= displacementThreshold &&
        stepGateOk;

      const isFar = isBleFree
        ? displacementMagnitude >= 4.0
        : sim <= cfg.similarityFarThreshold;

      if (state.phase === 'armed') {
        if (isFar) {
          return { ...state, ...baseUpdate, phase: 'away' };
        }
        return { ...state, ...baseUpdate };
      }

      if (state.phase === 'away') {
        const hasLeftAwayZone = isBleFree
          ? displacementMagnitude < 4.0
          : sim > cfg.similarityFarThreshold;
        if (hasLeftAwayZone) {
          return { ...state, ...baseUpdate, phase: 'approaching' };
        }
        return { ...state, ...baseUpdate };
      }

      // phase === 'approaching'
      if (isFar) {
        return { ...state, ...baseUpdate, phase: 'away' };
      }
      if (isNear && debounceOK) {
        const newCount = state.count + 1;
        const refinedA = refineFingerprint(
          state.pointA,
          observation,
          cfg.refinementAlpha
        );
        const finished = newCount >= cfg.targetLaps;
        return {
          ...state,
          ...baseUpdate,
          count: newCount,
          pointA: refinedA,
          lastLapAt: now,
          phase: finished ? 'finished' : 'armed',
          maxDisplacement: 0, // Reset for the next lap!
          maxDisplacementSteps: 0, // Reset for the next lap!
          stepsAtLapStart: 0, // Reset for the next lap!
        };
      }
      return { ...state, ...baseUpdate };
    }

    default:
      return state;
  }
}

/** Human-readable status label for the UI. */
export function statusLabel(state: DetectorState): string {
  switch (state.phase) {
    case 'idle':
      return 'Tap Start';
    case 'calibrating':
      return 'Calibrating point A — stand still…';
    case 'armed':
      return state.isBleFree ? 'Walking lap (BLE-Free)…' : 'Walking lap…';
    case 'away':
      return state.isBleFree ? 'Walking lap (BLE-Free)…' : 'Walking lap…';
    case 'approaching':
      return 'Approaching point A…';
    case 'finished':
      return 'All laps complete!';
  }
}

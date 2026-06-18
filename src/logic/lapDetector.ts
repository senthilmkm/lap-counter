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
  magneticDeltaThreshold: 8,
  displacementThreshold: 5,
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
  /** Fused yaw at the start of the current lap/leg */
  yawAtLapStart?: number;
  /** Whether the turn at Point B has been completed in the current lap */
  hasTurned?: boolean;
  /** Minimum displacement magnitude observed during the return leg */
  minDisplacementInLeg?: number;
  /** Calibrated step count per lap */
  lapSteps?: number;
  /** Displacement coordinates at the start of the current lap */
  displacementAtLapStart?: { x: number; y: number };
  /** Total cumulative steps since start of session */
  steps?: number;
};

export type DetectorInput = {
  now: number;
  observation: Fingerprint;
  displacementMagnitude: number;
  displacement?: { x: number; y: number };
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
    yawAtLapStart: 0,
    hasTurned: false,
    minDisplacementInLeg: Infinity,
    lapSteps: undefined,
    displacementAtLapStart: undefined,
    steps: 0,
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

function angleDiff(a: number, b: number): number {
  let diff = Math.abs(a - b) % (2 * Math.PI);
  if (diff > Math.PI) diff = 2 * Math.PI - diff;
  return diff;
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
      const { now, observation, displacementMagnitude, displacement, gyroZRate, gyroYaw, steps } = action.input;

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
            lastGyroYaw: 0,
            isBleFree,
            stepsAtLapStart: steps ?? 0,
            maxDisplacement: 0,
            maxDisplacementSteps: 0,
            yawAtLapStart: 0,
            hasTurned: false,
            minDisplacementInLeg: Infinity,
            displacementAtLapStart: { x: 0, y: 0 },
            steps: steps ?? state.steps,
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
      const cfg = state.config;
      const sinceLap =
        state.lastLapAt == null ? Infinity : now - state.lastLapAt;
      const debounceOK = sinceLap >= cfg.lapDebounceMs;

      if (isBleFree) {
        const currentYaw = gyroYaw ?? 0;
        const stepsCount = steps ?? 0;
        
        let nextStepsAtLapStart = state.stepsAtLapStart ?? 0;
        if (stepsCount < nextStepsAtLapStart) {
          nextStepsAtLapStart = 0;
        }
        const stepsSinceLastLap = stepsCount - nextStepsAtLapStart;
        
        // Calculate relative displacement magnitude from start of current lap
        let relDispMag = displacementMagnitude;
        if (displacement && state.displacementAtLapStart) {
          const dx = displacement.x - state.displacementAtLapStart.x;
          const dy = displacement.y - state.displacementAtLapStart.y;
          relDispMag = Math.sqrt(dx * dx + dy * dy);
        }
        
        const magDelta = magneticDelta(observation, state.pointA);
        const diffFromStart = angleDiff(currentYaw, state.yawAtLapStart ?? 0);
        
        let nextMaxDisplacement = state.maxDisplacement ?? 0;
        if (relDispMag > nextMaxDisplacement) {
          nextMaxDisplacement = relDispMag;
        }
        
        let reachedA = false;
        let nextLapSteps = state.lapSteps;
        let nextPhase = state.phase;
        
        // Phase transition logic
        if (nextPhase === 'armed') {
          if (relDispMag > 8.0 || stepsSinceLastLap >= 8) {
            nextPhase = 'away';
          }
        }
        if (nextPhase === 'away') {
          if (nextLapSteps !== undefined) {
            const approachingSteps = Math.max(12, Math.floor(0.90 * nextLapSteps));
            if (stepsSinceLastLap >= approachingSteps) {
              nextPhase = 'approaching';
            }
          }
        }
        if (nextPhase === 'approaching') {
          if (nextLapSteps !== undefined) {
            const approachingSteps = Math.max(12, Math.floor(0.85 * nextLapSteps));
            if (stepsSinceLastLap < approachingSteps) {
              nextPhase = 'away';
            }
          }
        }

        // Lap detection logic (triggers in approaching phase for Lap 2+, or away phase with steps >= 20 for Lap 1)
        const canTriggerSensor = nextLapSteps === undefined
          ? (nextPhase === 'away' && stepsSinceLastLap >= 20)
          : (nextPhase === 'approaching');

        if (canTriggerSensor) {
          const isSensorMatch = magDelta <= cfg.magneticDeltaThreshold &&
            relDispMag <= cfg.displacementThreshold &&
            diffFromStart < 0.8;
            
          if (nextLapSteps !== undefined) {
            const sensorStepGate = Math.max(12, Math.floor(0.98 * nextLapSteps));
            const isFallbackMatch = stepsSinceLastLap >= Math.floor(1.25 * nextLapSteps);
            if ((isSensorMatch && stepsSinceLastLap >= sensorStepGate) || isFallbackMatch) {
              reachedA = true;
              nextLapSteps = Math.round(0.8 * nextLapSteps + 0.2 * stepsSinceLastLap);
            }
          } else {
            const isFallbackMatch = stepsSinceLastLap >= 80;
            if (isSensorMatch || isFallbackMatch) {
              reachedA = true;
              nextLapSteps = stepsSinceLastLap;
            }
          }
        } else {
          // If we are not in the triggering phase, we can still trigger via absolute fallback
          // to prevent getting stuck if they walked way too many steps without triggering.
          if (nextLapSteps !== undefined) {
            const isFallbackMatch = stepsSinceLastLap >= Math.floor(1.25 * nextLapSteps);
            if (isFallbackMatch) {
              reachedA = true;
              nextLapSteps = Math.round(0.8 * nextLapSteps + 0.2 * stepsSinceLastLap);
            }
          } else {
            const isFallbackMatch = stepsSinceLastLap >= 80;
            if (isFallbackMatch) {
              reachedA = true;
              nextLapSteps = stepsSinceLastLap;
            }
          }
        }
        
        const baseUpdate: Partial<DetectorState> = {
          lastSimilarity: 1,
          lastMagneticDelta: magDelta,
          lastDisplacementMagnitude: relDispMag,
          lastGyroZRate: gyroZRate,
          lastGyroYaw: gyroYaw,
          maxDisplacement: nextMaxDisplacement,
          lapSteps: nextLapSteps,
          stepsAtLapStart: nextStepsAtLapStart,
          displacementAtLapStart: state.displacementAtLapStart ?? displacement ?? { x: 0, y: 0 },
          steps: steps ?? state.steps,
        };
        
        if (reachedA && debounceOK) {
          const newCount = state.count + 1;
          const finished = newCount >= cfg.targetLaps;
          return {
            ...state,
            ...baseUpdate,
            count: newCount,
            lastLapAt: now,
            phase: finished ? 'finished' : 'armed',
            maxDisplacement: 0,
            stepsAtLapStart: stepsCount,
            yawAtLapStart: currentYaw,
            displacementAtLapStart: displacement ?? { x: 0, y: 0 },
          };
        }
        
        return {
          ...state,
          ...baseUpdate,
          phase: nextPhase,
        };
      }

      // Standard BLE + magnetic + PDR state machine (isBleFree === false)
      const sim = similarity(observation, state.pointA);
      const magDelta = magneticDelta(observation, state.pointA);
      const stepsSinceLastLap = steps ?? 0;
      
      let nextMaxDisplacement = state.maxDisplacement ?? 0;
      let nextMaxDisplacementSteps = state.maxDisplacementSteps ?? 0;
      if (displacementMagnitude > nextMaxDisplacement) {
        nextMaxDisplacement = displacementMagnitude;
        nextMaxDisplacementSteps = stepsSinceLastLap;
      }
      
      const magThreshold = cfg.magneticDeltaThreshold;
      const displacementThreshold = cfg.displacementThreshold;
      
      const baseUpdate: Partial<DetectorState> = {
        lastSimilarity: sim,
        lastMagneticDelta: magDelta,
        lastDisplacementMagnitude: displacementMagnitude,
        lastGyroZRate: gyroZRate,
        lastGyroYaw: gyroYaw,
        maxDisplacement: nextMaxDisplacement,
        maxDisplacementSteps: nextMaxDisplacementSteps,
        lastDisplacementThreshold: displacementThreshold,
        steps: steps ?? state.steps,
      };

      const isNear =
        sim >= cfg.similarityNearThreshold &&
        magDelta <= magThreshold &&
        displacementMagnitude <= displacementThreshold;

      const isFar = sim <= cfg.similarityFarThreshold;

      if (state.phase === 'armed') {
        if (isFar) {
          return { ...state, ...baseUpdate, phase: 'away' };
        }
        return { ...state, ...baseUpdate };
      }

      if (state.phase === 'away') {
        const hasLeftAwayZone = sim > cfg.similarityFarThreshold;
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
          maxDisplacement: 0,
          maxDisplacementSteps: 0,
          stepsAtLapStart: 0,
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

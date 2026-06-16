import {
  createInitialState,
  DetectorConfig,
  DEFAULT_CONFIG,
  reducer,
  statusLabel,
} from '../src/logic/lapDetector';
import {
  Fingerprint,
  refineFingerprint,
} from '../src/logic/fingerprint';
import { fp } from './helpers/fixtures';

/**
 * Synthetic gym environment: 8 BLE devices that surround point A, plus
 * 4 "across the gym" devices visible only when the user is on the far
 * side of the loop. The magnetic field magnitude shifts by ~10 μT
 * between point A and the far side of the loop.
 */
const NEAR_A: Array<[string, number]> = [
  ['router-1', -55],
  ['airpods-2', -62],
  ['watch-3', -70],
  ['tv-4', -78],
  ['cardio-5', -82],
  ['phone-6', -65],
  ['speaker-7', -72],
  ['ipad-8', -80],
];
const FAR_SIDE: Array<[string, number]> = [
  ['far-treadmill-1', -68],
  ['far-tv-2', -75],
  ['far-router-3', -78],
  ['far-watch-4', -82],
];

const POINT_A_TRUE: Fingerprint = fp(NEAR_A, 50.0);
const FAR_FROM_A: Fingerprint = fp(FAR_SIDE, 60.0);

/**
 * Linearly interpolate two fingerprints by `t` in [0, 1] where t=0 means
 * fully at `a` and t=1 means fully at `b`. Devices fade out / in with
 * staggered thresholds so similarity changes monotonically as t moves
 * (no cliff-edge at the midpoint).
 */
function blend(a: Fingerprint, b: Fingerprint, t: number): Fingerprint {
  const merged = new Map<string, number>();
  const aIds = [...a.bleDevices.keys()];
  const bIds = [...b.bleDevices.keys()];

  aIds.forEach((id, idx) => {
    // Fade A-side devices out as t grows; staggered thresholds.
    const dropAt = (idx + 1) / (aIds.length + 1);
    if (t < dropAt) {
      const va = a.bleDevices.get(id)!;
      const vb = b.bleDevices.get(id);
      merged.set(id, vb != null ? va * (1 - t) + vb * t : va);
    }
  });
  bIds.forEach((id, idx) => {
    // Fade B-side devices in as t grows.
    const enterAt = 1 - (idx + 1) / (bIds.length + 1);
    if (t > enterAt) {
      const vb = b.bleDevices.get(id)!;
      const va = a.bleDevices.get(id);
      merged.set(id, va != null ? va * (1 - t) + vb * t : vb);
    }
  });

  return {
    bleDevices: merged,
    magneticMagnitude:
      a.magneticMagnitude * (1 - t) + b.magneticMagnitude * t,
  };
}

/**
 * Triangular blend factor: position 0 = at A, position 0.5 = far side,
 * position 1 = back at A.
 */
function lapBlendFactor(position: number): number {
  return 1 - Math.abs(2 * position - 1);
}

/**
 * Drive a synthetic walk: yields a sequence of (observation, displacement)
 * tuples representing a single lap around the loop and back to A.
 *
 * Lap shape (10 ticks per lap = 10s):
 *   t=0..2  : near A (just left)
 *   t=3..6  : far side of the loop
 *   t=7..9  : approaching A again
 *   t=10    : back at A → lap should count
 *
 * Returns timestamps in ms relative to lap start.
 */
function* simulateLapTicks(stepMs: number) {
  // `position` is 0 at A, 0.5 at the far side, 1 back at A.
  // `disp` is the IMU dead-reckoned distance from A in meters — peaks at
  // the far side, returns to ~0 at lap end.
  const profile = [
    { position: 0.0, disp: 0.5 },
    { position: 0.1, disp: 1.5 },
    { position: 0.2, disp: 3.0 },
    { position: 0.3, disp: 7.0 },
    { position: 0.4, disp: 12.0 },
    { position: 0.5, disp: 16.0 },
    { position: 0.6, disp: 12.0 },
    { position: 0.7, disp: 7.0 },
    { position: 0.8, disp: 3.0 },
    { position: 0.9, disp: 1.0 },
    { position: 1.0, disp: 0.5 },
  ];
  for (let i = 0; i < profile.length; i++) {
    const { position, disp } = profile[i];
    yield {
      offsetMs: i * stepMs,
      observation: blend(
        POINT_A_TRUE,
        FAR_FROM_A,
        lapBlendFactor(position)
      ),
      displacementMagnitude: disp,
    };
  }
}

/** Simulate the calibration window with stable point-A samples. */
function* simulateCalibration(stepMs: number, samples: number) {
  for (let i = 0; i < samples; i++) {
    yield {
      offsetMs: i * stepMs,
      observation: POINT_A_TRUE,
      displacementMagnitude: 0,
    };
  }
}

/**
 * Returns a hook the reducer can call to model the IMU baseline reset
 * that the production hook performs after each lap.
 */
function makeDisplacementResetWatcher() {
  let lastObservedLapAt: number | null = null;
  let displacementOffset = 0;
  return {
    /** Adjust the raw displacement by subtracting the offset reset by laps. */
    apply(rawDisplacement: number) {
      return Math.max(0, rawDisplacement - displacementOffset);
    },
    /** Call after each tick. Resets the offset when a lap is freshly counted. */
    afterTick(state: ReturnType<typeof createInitialState>, rawDisplacement: number) {
      if (state.lastLapAt != null && state.lastLapAt !== lastObservedLapAt) {
        lastObservedLapAt = state.lastLapAt;
        displacementOffset = rawDisplacement;
      }
    },
  };
}

describe('e2e: full multi-lap simulated session', () => {
  it('counts exactly N laps for a clean walking pattern, ending in finished phase', () => {
    const TARGET = 5;
    const STEP_MS = 1000;
    const config: DetectorConfig = {
      ...DEFAULT_CONFIG,
      targetLaps: TARGET,
      // Lap takes ~10s in the simulator; relax debounce so we can stress it.
      lapDebounceMs: 8000,
    };

    let state = reducer(createInitialState(config), { type: 'start' });
    let now = 1_000_000;
    const watcher = makeDisplacementResetWatcher();

    // Calibrate (5s + 1 transition tick).
    for (const tick of simulateCalibration(STEP_MS, 6)) {
      state = reducer(state, {
        type: 'tick',
        input: {
          now: now + tick.offsetMs,
          observation: tick.observation,
          displacementMagnitude: watcher.apply(tick.displacementMagnitude),
        },
      });
      watcher.afterTick(state, tick.displacementMagnitude);
    }
    expect(state.phase).toBe('armed');
    now += 6 * STEP_MS;

    // Walk N laps.
    for (let lap = 0; lap < TARGET; lap++) {
      let cumulativeDisplacement = 0;
      for (const tick of simulateLapTicks(STEP_MS)) {
        cumulativeDisplacement = tick.displacementMagnitude;
        state = reducer(state, {
          type: 'tick',
          input: {
            now: now + tick.offsetMs,
            observation: tick.observation,
            displacementMagnitude: watcher.apply(cumulativeDisplacement),
          },
        });
        watcher.afterTick(state, cumulativeDisplacement);
      }
      now += 11 * STEP_MS;
    }

    expect(state.count).toBe(TARGET);
    expect(state.phase).toBe('finished');
    expect(statusLabel(state)).toMatch(/complete/i);
  });

  it('does not over-count when the user lingers at point A between laps', () => {
    const config: DetectorConfig = {
      ...DEFAULT_CONFIG,
      targetLaps: 3,
      lapDebounceMs: 8000,
    };
    let state = reducer(createInitialState(config), { type: 'start' });
    let now = 0;
    const watcher = makeDisplacementResetWatcher();

    for (const tick of simulateCalibration(1000, 6)) {
      state = reducer(state, {
        type: 'tick',
        input: {
          now: now + tick.offsetMs,
          observation: tick.observation,
          displacementMagnitude: watcher.apply(tick.displacementMagnitude),
        },
      });
      watcher.afterTick(state, tick.displacementMagnitude);
    }
    now += 6000;

    // One real lap.
    for (const tick of simulateLapTicks(1000)) {
      state = reducer(state, {
        type: 'tick',
        input: {
          now: now + tick.offsetMs,
          observation: tick.observation,
          displacementMagnitude: watcher.apply(tick.displacementMagnitude),
        },
      });
      watcher.afterTick(state, tick.displacementMagnitude);
    }
    now += 11_000;
    expect(state.count).toBe(1);

    // Now stand at A for 2 minutes — should NOT increment further.
    for (let i = 0; i < 120; i++) {
      state = reducer(state, {
        type: 'tick',
        input: {
          now: now + i * 1000,
          observation: POINT_A_TRUE,
          displacementMagnitude: 0,
        },
      });
    }
    expect(state.count).toBe(1);
    expect(state.phase).toBe('armed');
  });

  it('does not count a lap when the user only goes part-way out and comes back', () => {
    const config: DetectorConfig = {
      ...DEFAULT_CONFIG,
      targetLaps: 3,
    };
    let state = reducer(createInitialState(config), { type: 'start' });
    let now = 0;
    const watcher = makeDisplacementResetWatcher();

    for (const tick of simulateCalibration(1000, 6)) {
      state = reducer(state, {
        type: 'tick',
        input: {
          now: now + tick.offsetMs,
          observation: tick.observation,
          displacementMagnitude: watcher.apply(tick.displacementMagnitude),
        },
      });
      watcher.afterTick(state, tick.displacementMagnitude);
    }
    now += 6000;

    // Wander only 20% of the way out (similarity stays well above the
    // far threshold) and come back. The detector should never enter
    // the "away" phase.
    for (let i = 0; i < 5; i++) {
      const obs = blend(POINT_A_TRUE, FAR_FROM_A, lapBlendFactor(0.1));
      state = reducer(state, {
        type: 'tick',
        input: {
          now: now + i * 1000,
          observation: obs,
          displacementMagnitude: 2,
        },
      });
    }
    for (let i = 0; i < 5; i++) {
      state = reducer(state, {
        type: 'tick',
        input: {
          now: now + (5 + i) * 1000,
          observation: POINT_A_TRUE,
          displacementMagnitude: 0,
        },
      });
    }
    expect(state.count).toBe(0);
    expect(state.phase).toBe('armed');
  });

  it('refines pointA over successive laps so it converges toward observed reality', () => {
    const config: DetectorConfig = {
      ...DEFAULT_CONFIG,
      targetLaps: 4,
      lapDebounceMs: 8000,
    };
    let state = reducer(createInitialState(config), { type: 'start' });
    let now = 0;
    const watcher = makeDisplacementResetWatcher();

    // Calibrate with the full A-side device set but offset RSSI / magnetic
    // values so refinement has room to move toward the true reading.
    const noisyA: Fingerprint = {
      bleDevices: new Map(
        NEAR_A.map(([id, rssi]) => [id, rssi + 5] as [string, number])
      ),
      magneticMagnitude: 53, // 3μT off from true 50
    };
    for (let i = 0; i < 6; i++) {
      state = reducer(state, {
        type: 'tick',
        input: {
          now: now + i * 1000,
          observation: noisyA,
          displacementMagnitude: 0,
        },
      });
    }
    now += 6000;
    const initialMagnitude = state.pointA.magneticMagnitude;

    // Walk laps where every "back at A" sample contains the TRUE A signature.
    for (let lap = 0; lap < 4; lap++) {
      for (const tick of simulateLapTicks(1000)) {
        state = reducer(state, {
          type: 'tick',
          input: {
            now: now + tick.offsetMs,
            observation: tick.observation,
            displacementMagnitude: watcher.apply(tick.displacementMagnitude),
          },
        });
        watcher.afterTick(state, tick.displacementMagnitude);
      }
      now += 11_000;
    }

    // Refined magnetic magnitude should have moved closer to the true 50.
    expect(Math.abs(state.pointA.magneticMagnitude - 50)).toBeLessThan(
      Math.abs(initialMagnitude - 50)
    );
    expect(state.count).toBe(4);
    expect(state.phase).toBe('finished');
  });

  it('survives deliberately noisy BLE — each lap may have one randomly-dropped device', () => {
    const config: DetectorConfig = {
      ...DEFAULT_CONFIG,
      targetLaps: 3,
      lapDebounceMs: 8000,
    };
    let state = reducer(createInitialState(config), { type: 'start' });
    let now = 0;
    const watcher = makeDisplacementResetWatcher();
    let prng = 1;
    const rand = () => {
      prng = (prng * 9301 + 49297) % 233280;
      return prng / 233280;
    };

    for (let i = 0; i < 6; i++) {
      state = reducer(state, {
        type: 'tick',
        input: {
          now: now + i * 1000,
          observation: POINT_A_TRUE,
          displacementMagnitude: 0,
        },
      });
    }
    now += 6000;

    for (let lap = 0; lap < 3; lap++) {
      for (const tick of simulateLapTicks(1000)) {
        // Drop a random device from the observation 30% of the time.
        const noisy = new Map(tick.observation.bleDevices);
        if (rand() < 0.3 && noisy.size > 0) {
          const ids = [...noisy.keys()];
          noisy.delete(ids[Math.floor(rand() * ids.length)]);
        }
        const noisyObs: Fingerprint = {
          bleDevices: noisy,
          magneticMagnitude:
            tick.observation.magneticMagnitude + (rand() - 0.5) * 2,
        };
        state = reducer(state, {
          type: 'tick',
          input: {
            now: now + tick.offsetMs,
            observation: noisyObs,
            displacementMagnitude: watcher.apply(tick.displacementMagnitude),
          },
        });
        watcher.afterTick(state, tick.displacementMagnitude);
      }
      now += 11_000;
    }

    expect(state.count).toBe(3);
    expect(state.phase).toBe('finished');
  });
});

describe('e2e: refineFingerprint convergence as a property', () => {
  it('repeated refinement against a fixed observation converges to that observation', () => {
    let state: Fingerprint = fp([['x', -100]], 0);
    const target = fp([['x', -55], ['y', -70]], 50);
    for (let i = 0; i < 100; i++) {
      state = refineFingerprint(state, target, 0.3);
    }
    expect(state.bleDevices.get('x')).toBeCloseTo(-55, 1);
    expect(state.bleDevices.get('y')).toBeCloseTo(-70, 1);
    expect(state.magneticMagnitude).toBeCloseTo(50, 1);
  });
});

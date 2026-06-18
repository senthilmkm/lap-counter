import {
  createInitialState,
  DEFAULT_CONFIG,
  reducer,
  statusLabel,
} from '../lapDetector';
import { Fingerprint } from '../fingerprint';
import { awayFrom, fp } from '../../../__tests__/helpers/fixtures';

const POINT_A = fp(
  [
    ['router-1', -55],
    ['airpods-2', -62],
    ['watch-3', -70],
    ['tv-4', -78],
    ['cardio-5', -82],
  ],
  50
);

const POINT_AWAY = awayFrom(POINT_A);

function tickWith(state: ReturnType<typeof createInitialState>, args: {
  now: number;
  observation: Fingerprint;
  displacementMagnitude?: number;
  displacement?: { x: number; y: number };
}) {
  return reducer(state, {
    type: 'tick',
    input: {
      now: args.now,
      observation: args.observation,
      displacementMagnitude: args.displacementMagnitude ?? 0,
      displacement: args.displacement,
    },
  });
}

function calibrateAt(point: Fingerprint, target = 10) {
  const startTs = 1_000_000;
  let s = reducer(createInitialState(), {
    type: 'start',
    config: { targetLaps: target },
  });
  expect(s.phase).toBe('calibrating');
  // 5 calibration ticks (one per second) using point-A samples. Calibration
  // start is anchored at the first tick's `now`.
  for (let i = 0; i < 5; i++) {
    s = tickWith(s, { now: startTs + i * 1000, observation: point });
  }
  // The 6th tick (5s after the first) crosses the calibrationMs boundary
  // and transitions to armed.
  s = tickWith(s, { now: startTs + 5000, observation: point });
  expect(s.phase).toBe('armed');
  return { state: s, baseTs: startTs + 5000 };
}

describe('lapDetector.reducer — initial state & lifecycle', () => {
  it('starts in idle with zero count', () => {
    const s = createInitialState();
    expect(s.phase).toBe('idle');
    expect(s.count).toBe(0);
    expect(s.config).toEqual(DEFAULT_CONFIG);
  });

  it('start action transitions idle → calibrating with overridden targetLaps', () => {
    const s = reducer(createInitialState(), {
      type: 'start',
      config: { targetLaps: 7 },
    });
    expect(s.phase).toBe('calibrating');
    expect(s.config.targetLaps).toBe(7);
    // Calibration anchor is null until the first tick — keeps reducer pure.
    expect(s.calibrationStartedAt).toBeNull();
  });

  it('first tick during calibration anchors calibrationStartedAt to its `now`', () => {
    let s = reducer(createInitialState(), { type: 'start' });
    expect(s.calibrationStartedAt).toBeNull();
    s = reducer(s, {
      type: 'tick',
      input: { now: 12345, observation: POINT_A, displacementMagnitude: 0 },
    });
    expect(s.calibrationStartedAt).toBe(12345);
  });

  it('stop action returns to idle and resets the count', () => {
    let s = reducer(createInitialState(), { type: 'start' });
    s = { ...s, count: 4 };
    s = reducer(s, { type: 'stop' });
    expect(s.phase).toBe('idle');
    expect(s.count).toBe(0);
  });

  it('reset action returns to idle and resets the count', () => {
    let s = reducer(createInitialState(), { type: 'start' });
    s = { ...s, count: 4, phase: 'finished' };
    s = reducer(s, { type: 'reset' });
    expect(s.phase).toBe('idle');
    expect(s.count).toBe(0);
  });

  it('tick is a no-op while idle', () => {
    const idle = createInitialState();
    const next = tickWith(idle, { now: 1, observation: POINT_A });
    expect(next).toBe(idle);
  });

  it('tick is a no-op while finished', () => {
    const finished = { ...createInitialState(), phase: 'finished' as const };
    const next = tickWith(finished, { now: 1, observation: POINT_A });
    expect(next).toBe(finished);
  });
});

describe('lapDetector.reducer — calibration', () => {
  it('accumulates calibration samples and averages them on transition', () => {
    let s = reducer(createInitialState(), { type: 'start' });
    s = tickWith(s, { now: 0, observation: fp([['x', -50]], 40) });
    s = tickWith(s, { now: 1000, observation: fp([['x', -60]], 50) });
    s = tickWith(s, { now: 2000, observation: fp([['x', -70]], 60) });
    expect(s.phase).toBe('calibrating');
    s = tickWith(s, { now: 6000, observation: fp([['x', -80]], 70) });
    expect(s.phase).toBe('armed');
    expect(s.pointA.bleDevices.get('x')).toBeCloseTo(-65, 1);
    expect(s.pointA.magneticMagnitude).toBeCloseTo(55, 1);
  });

  it('drops devices observed in fewer than half of calibration samples', () => {
    let s = reducer(createInitialState(), { type: 'start' });
    s = tickWith(s, { now: 0, observation: fp([['stable', -55], ['blip', -90]], 50) });
    s = tickWith(s, { now: 1000, observation: fp([['stable', -56]], 50) });
    s = tickWith(s, { now: 2000, observation: fp([['stable', -57]], 50) });
    s = tickWith(s, { now: 3000, observation: fp([['stable', -58]], 50) });
    s = tickWith(s, { now: 6000, observation: fp([['stable', -59]], 50) });

    expect(s.phase).toBe('armed');
    expect(s.pointA.bleDevices.has('stable')).toBe(true);
    expect(s.pointA.bleDevices.has('blip')).toBe(false);
  });
});

describe('lapDetector.reducer — armed → away → approaching → lap', () => {
  it('does not count a lap from "armed" without first leaving point A', () => {
    const { state, baseTs } = calibrateAt(POINT_A);
    const next = tickWith(state, {
      now: baseTs + 1000,
      observation: POINT_A,
      displacementMagnitude: 0,
    });
    expect(next.phase).toBe('armed');
    expect(next.count).toBe(0);
  });

  it('transitions armed → away when similarity drops below far threshold', () => {
    const { state, baseTs } = calibrateAt(POINT_A);
    const next = tickWith(state, {
      now: baseTs + 1000,
      observation: POINT_AWAY,
      displacementMagnitude: 12,
    });
    expect(next.phase).toBe('away');
    expect(next.count).toBe(0);
  });

  it('transitions away → approaching when similarity rises back above far threshold', () => {
    const { state, baseTs } = calibrateAt(POINT_A);
    let s = tickWith(state, {
      now: baseTs + 1000,
      observation: POINT_AWAY,
      displacementMagnitude: 12,
    });
    expect(s.phase).toBe('away');
    // 4 of 5 point-A devices visible — strong overlap, but displacement
    // is still 7m so we don't jump straight to a lap-count.
    s = tickWith(s, {
      now: baseTs + 2000,
      observation: fp(
        [
          ['router-1', -60],
          ['airpods-2', -65],
          ['watch-3', -72],
          ['tv-4', -80],
        ],
        52
      ),
      displacementMagnitude: 7,
    });
    expect(s.phase).toBe('approaching');
  });

  it('counts a lap when all 3 conditions are met after returning from away', () => {
    const { state, baseTs } = calibrateAt(POINT_A);
    let s = tickWith(state, {
      now: baseTs + 1000,
      observation: POINT_AWAY,
      displacementMagnitude: 15,
    });
    expect(s.phase).toBe('away');

    // Approach with high similarity but still too far → away→approaching,
    // no lap yet (one-tick rule: must be in approaching to count).
    s = tickWith(s, {
      now: baseTs + 12000,
      observation: POINT_A,
      displacementMagnitude: 9,
    });
    expect(s.phase).toBe('approaching');
    expect(s.count).toBe(0);

    // Now fully back at A on the next tick from approaching → lap counts.
    s = tickWith(s, {
      now: baseTs + 13000,
      observation: POINT_A,
      displacementMagnitude: 1,
    });
    expect(s.count).toBe(1);
    expect(s.phase).toBe('armed');
    expect(s.lastLapAt).toBe(baseTs + 13000);
  });

  it('does NOT count a lap if user never went away (anti-stationary)', () => {
    const { state, baseTs } = calibrateAt(POINT_A);
    const s = tickWith(state, {
      now: baseTs + 30000,
      observation: POINT_A,
      displacementMagnitude: 0,
    });
    expect(s.phase).toBe('armed');
    expect(s.count).toBe(0);
  });

  it('debounces: a second lap within lapDebounceMs is rejected', () => {
    const { state, baseTs } = calibrateAt(POINT_A);
    // Lap 1: away → approaching → near (3 ticks).
    let s = tickWith(state, {
      now: baseTs + 1000,
      observation: POINT_AWAY,
      displacementMagnitude: 15,
    });
    s = tickWith(s, {
      now: baseTs + 11000,
      observation: POINT_A,
      displacementMagnitude: 9,
    });
    s = tickWith(s, {
      now: baseTs + 12000,
      observation: POINT_A,
      displacementMagnitude: 1,
    });
    expect(s.count).toBe(1);

    // Try a second lap only 3s later (< 10s debounce). Even with a full
    // away → approaching → near cycle, debounce should suppress the count.
    s = tickWith(s, {
      now: baseTs + 13000,
      observation: POINT_AWAY,
      displacementMagnitude: 12,
    });
    s = tickWith(s, {
      now: baseTs + 14000,
      observation: POINT_A,
      displacementMagnitude: 9,
    });
    s = tickWith(s, {
      now: baseTs + 15000,
      observation: POINT_A,
      displacementMagnitude: 1,
    });
    expect(s.count).toBe(1);
  });

  it('approaching → away if similarity drops again before reaching A', () => {
    const { state, baseTs } = calibrateAt(POINT_A);
    let s = tickWith(state, {
      now: baseTs + 1000,
      observation: POINT_AWAY,
      displacementMagnitude: 15,
    });
    s = tickWith(s, {
      now: baseTs + 2000,
      observation: fp(
        [
          ['router-1', -65],
          ['airpods-2', -75],
          ['watch-3', -82],
          ['tv-4', -88],
        ],
        53
      ),
      displacementMagnitude: 7,
    });
    expect(s.phase).toBe('approaching');
    s = tickWith(s, {
      now: baseTs + 3000,
      observation: POINT_AWAY,
      displacementMagnitude: 14,
    });
    expect(s.phase).toBe('away');
    expect(s.count).toBe(0);
  });
});

describe('lapDetector.reducer — finished phase', () => {
  it('flips to finished and stops counting once count reaches targetLaps', () => {
    const { state, baseTs } = calibrateAt(POINT_A, 2);
    let s = state;
    let now = baseTs;

    function lap() {
      s = tickWith(s, { now: now + 1000, observation: POINT_AWAY, displacementMagnitude: 15 });
      s = tickWith(s, { now: now + 11000, observation: POINT_A, displacementMagnitude: 9 });
      s = tickWith(s, { now: now + 12000, observation: POINT_A, displacementMagnitude: 1 });
      now += 12000;
    }

    lap();
    expect(s.count).toBe(1);

    lap();
    expect(s.count).toBe(2);
    expect(s.phase).toBe('finished');

    // Further ticks must NOT mutate state.
    const frozen = s;
    s = tickWith(s, { now: now + 30000, observation: POINT_A, displacementMagnitude: 0 });
    expect(s).toBe(frozen);
  });
});

describe('lapDetector.statusLabel', () => {
  it('returns a human-readable label for every phase', () => {
    const phases: ReadonlyArray<ReturnType<typeof createInitialState>['phase']> = [
      'idle',
      'calibrating',
      'armed',
      'away',
      'approaching',
      'finished',
    ];
    for (const phase of phases) {
      const label = statusLabel({ ...createInitialState(), phase });
      expect(typeof label).toBe('string');
      expect(label.length).toBeGreaterThan(0);
    }
  });
});

describe('lapDetector.reducer — BLE-free MIF mode fallback', () => {
  it('calibrates with empty BLE and counts a lap using step calibration and magnetic window', () => {
    const emptyPoint = { bleDevices: new Map<string, number>(), magneticMagnitude: 45.0 };
    let s = reducer(createInitialState(), { type: 'start' });
    
    // 5 calibration ticks
    for (let i = 0; i < 5; i++) {
      s = reducer(s, {
        type: 'tick',
        input: { now: i * 1000, observation: emptyPoint, displacementMagnitude: 0, displacement: { x: 0, y: 0 }, steps: 0, gyroYaw: 0 }
      });
    }
    s = reducer(s, {
      type: 'tick',
      input: { now: 5000, observation: emptyPoint, displacementMagnitude: 0, displacement: { x: 0, y: 0 }, steps: 0, gyroYaw: 0 }
    });
    
    expect(s.phase).toBe('armed');
    expect(s.isBleFree).toBe(true);

    // Stays armed if steps are low
    s = reducer(s, {
      type: 'tick',
      input: { now: 6000, observation: emptyPoint, displacementMagnitude: 2.0, displacement: { x: 2.0, y: 0 }, steps: 4, gyroYaw: 0 }
    });
    expect(s.phase).toBe('armed');

    // Transitions to away once steps >= 8
    s = reducer(s, {
      type: 'tick',
      input: { now: 7000, observation: emptyPoint, displacementMagnitude: 6.0, displacement: { x: 6.0, y: 0 }, steps: 10, gyroYaw: 3.14 }
    });
    expect(s.phase).toBe('away');
    expect(s.lapSteps).toBeUndefined();

    // Still away
    s = reducer(s, {
      type: 'tick',
      input: { now: 8000, observation: emptyPoint, displacementMagnitude: 3.0, displacement: { x: 3.0, y: 0 }, steps: 18, gyroYaw: 3.14 }
    });
    expect(s.phase).toBe('away');

    // Counts a lap once displacement <= 6.0m and magnetic magnitude matches start
    s = reducer(s, {
      type: 'tick',
      input: { now: 18000, observation: emptyPoint, displacementMagnitude: 1.0, displacement: { x: 1.0, y: 0 }, steps: 22, gyroYaw: 0 }
    });
    
    expect(s.count).toBe(1);
    expect(s.phase).toBe('armed');
    expect(s.lapSteps).toBe(22);
  });

  it('BLE-free mode: gates lap counting using step count threshold and fallback', () => {
    const emptyPoint = { bleDevices: new Map<string, number>(), magneticMagnitude: 45.0 };
    const wrongPoint = { bleDevices: new Map<string, number>(), magneticMagnitude: 100.0 };
    let s = reducer(createInitialState(), { type: 'start' });
    
    // Calibrate with steps = 0
    for (let i = 0; i < 5; i++) {
      s = reducer(s, {
        type: 'tick',
        input: { now: i * 1000, observation: emptyPoint, displacementMagnitude: 0, displacement: { x: 0, y: 0 }, steps: 0, gyroYaw: 0 }
      });
    }
    s = reducer(s, {
      type: 'tick',
      input: { now: 5000, observation: emptyPoint, displacementMagnitude: 0, displacement: { x: 0, y: 0 }, steps: 0, gyroYaw: 0 }
    });
    
    expect(s.phase).toBe('armed');

    // Complete Lap 1 to calibrate lapSteps to 20 steps
    s = reducer(s, {
      type: 'tick',
      input: { now: 6000, observation: emptyPoint, displacementMagnitude: 1.0, displacement: { x: 1.0, y: 0 }, steps: 20, gyroYaw: 0 }
    });
    expect(s.count).toBe(1);
    expect(s.lapSteps).toBe(20);
    expect(s.stepsAtLapStart).toBe(20);

    // Walk out: stepsSinceLastLap = 8. Phase is away.
    // Raw displacement vector is continuous: { x: 6.0, y: 0 }. Relative is 5.0m.
    s = reducer(s, {
      type: 'tick',
      input: { now: 7000, observation: emptyPoint, displacementMagnitude: 5.0, displacement: { x: 6.0, y: 0 }, steps: 28, gyroYaw: 3.14 }
    });
    expect(s.phase).toBe('away');
    expect(s.count).toBe(1);

    // Enter step window: stepsSinceLastLap = 18 (0.90 * 20 = 18). Phase is approaching.
    // Raw displacement vector is continuous: { x: 5.0, y: 0 }. Relative is 4.0m.
    s = reducer(s, {
      type: 'tick',
      input: { now: 8000, observation: emptyPoint, displacementMagnitude: 4.0, displacement: { x: 5.0, y: 0 }, steps: 38, gyroYaw: 3.14 }
    });
    expect(s.phase).toBe('approaching');

    // No lap yet with wrong magnetic magnitude (100.0 -> delta 55 > 5)
    // Raw displacement relative to Lap 1 end is { x: 3.0, y: 0 } - { x: 1.0, y: 0 } = 2.0m.
    s = reducer(s, {
      type: 'tick',
      input: { now: 9000, observation: wrongPoint, displacementMagnitude: 2.0, displacement: { x: 3.0, y: 0 }, steps: 40, gyroYaw: 3.14 }
    });
    expect(s.count).toBe(1);
    expect(s.phase).toBe('approaching');

    // Next tick: user reaches 46 steps (stepsSinceLastLap = 26 >= 1.25 * 20 = 25).
    // Lap counts via step count fallback!
    s = reducer(s, {
      type: 'tick',
      input: { now: 20000, observation: wrongPoint, displacementMagnitude: 2.0, displacement: { x: 3.0, y: 0 }, steps: 46, gyroYaw: 3.14 }
    });
    expect(s.count).toBe(2);
    expect(s.phase).toBe('armed');
    // lapSteps is refined using moving average: 0.8 * 20 + 0.2 * 26 = 21.2 -> 21
    expect(s.lapSteps).toBe(21);
  });

  it('BLE-free mode: tracks multiple laps correctly with baseline resets', () => {
    const emptyPoint = { bleDevices: new Map<string, number>(), magneticMagnitude: 45.0 };
    let s = reducer(createInitialState(), { type: 'start' });
    
    // Calibrate
    for (let i = 0; i < 5; i++) {
      s = reducer(s, {
        type: 'tick',
        input: { now: i * 1000, observation: emptyPoint, displacementMagnitude: 0, displacement: { x: 0, y: 0 }, steps: 0, gyroYaw: 0 }
      });
    }
    s = reducer(s, {
      type: 'tick',
      input: { now: 5000, observation: emptyPoint, displacementMagnitude: 0, displacement: { x: 0, y: 0 }, steps: 0, gyroYaw: 0 }
    });
    expect(s.phase).toBe('armed');

    // === LAP 1 ===
    // Walk out to 22 steps, magnetic matches, lap counts
    s = reducer(s, {
      type: 'tick',
      input: { now: 18000, observation: emptyPoint, displacementMagnitude: 1.0, displacement: { x: 1.0, y: 0 }, steps: 22, gyroYaw: 0 }
    });
    expect(s.count).toBe(1);
    expect(s.phase).toBe('armed');
    expect(s.lapSteps).toBe(22);

    // === LAP 2 ===
    // Baseline is reset: steps and yaw are now relative to the new start point (0)
    // Walk out: steps = 4 (stays armed)
    s = reducer(s, {
      type: 'tick',
      input: { now: 19000, observation: emptyPoint, displacementMagnitude: 2.0, displacement: { x: 3.0, y: 0 }, steps: 4, gyroYaw: 0 }
    });
    expect(s.phase).toBe('armed');

    // Steps = 20 (inside window since 20 >= 0.90 * 22 = 20) -> phase is approaching
    s = reducer(s, {
      type: 'tick',
      input: { now: 20000, observation: emptyPoint, displacementMagnitude: 3.0, displacement: { x: 4.0, y: 0 }, steps: 20, gyroYaw: 3.14 }
    });
    expect(s.phase).toBe('approaching');

    // Steps = 22 (inside window, mag matches) -> lap counts!
    s = reducer(s, {
      type: 'tick',
      input: { now: 32000, observation: emptyPoint, displacementMagnitude: 1.0, displacement: { x: 2.0, y: 0 }, steps: 22, gyroYaw: 0 }
    });
    expect(s.count).toBe(2);
    expect(s.phase).toBe('armed');
  });
});

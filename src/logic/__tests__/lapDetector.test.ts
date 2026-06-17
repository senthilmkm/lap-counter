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
}) {
  return reducer(state, {
    type: 'tick',
    input: {
      now: args.now,
      observation: args.observation,
      displacementMagnitude: args.displacementMagnitude ?? 0,
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
  it('calibrates with empty BLE and counts a lap using only magnetic + displacement', () => {
    const emptyPoint = { bleDevices: new Map<string, number>(), magneticMagnitude: 45.0 };
    let s = reducer(createInitialState(), { type: 'start' });
    
    // 5 calibration ticks
    for (let i = 0; i < 5; i++) {
      s = reducer(s, {
        type: 'tick',
        input: { now: i * 1000, observation: emptyPoint, displacementMagnitude: 0 }
      });
    }
    // Transition to armed
    s = reducer(s, {
      type: 'tick',
      input: { now: 5000, observation: emptyPoint, displacementMagnitude: 0 }
    });
    
    expect(s.phase).toBe('armed');
    expect(s.isBleFree).toBe(true);

    // Stays armed if displacement remains small
    s = reducer(s, {
      type: 'tick',
      input: { now: 6000, observation: emptyPoint, displacementMagnitude: 2.0 }
    });
    expect(s.phase).toBe('armed');

    // Transitions to away once displacement is >= 5.0m
    s = reducer(s, {
      type: 'tick',
      input: { now: 7000, observation: emptyPoint, displacementMagnitude: 6.0 }
    });
    expect(s.phase).toBe('away');

    // Transitions to approaching once user walks back (displacement < 3.5m)
    s = reducer(s, {
      type: 'tick',
      input: { now: 8000, observation: emptyPoint, displacementMagnitude: 3.0 }
    });
    expect(s.phase).toBe('approaching');

    // Counts a lap once displacement <= 3.0m and magnetic magnitude matches Point A
    // (within 15.0 uT).
    const matchingPoint = { bleDevices: new Map<string, number>(), magneticMagnitude: 47.0 }; // delta = 2.0 uT <= 15.0 uT
    s = reducer(s, {
      type: 'tick',
      input: { now: 18000, observation: matchingPoint, displacementMagnitude: 1.0 } // 13s elapsed since start (passes 10s debounce)
    });
    
    expect(s.count).toBe(1);
    expect(s.phase).toBe('armed');
  });

  it('BLE-free MIF mode: gates lap counting using step count', () => {
    const emptyPoint = { bleDevices: new Map<string, number>(), magneticMagnitude: 45.0 };
    let s = reducer(createInitialState(), { type: 'start' });
    
    // Calibrate with steps = 0
    for (let i = 0; i < 5; i++) {
      s = reducer(s, {
        type: 'tick',
        input: { now: i * 1000, observation: emptyPoint, displacementMagnitude: 0, steps: 0 }
      });
    }
    s = reducer(s, {
      type: 'tick',
      input: { now: 5000, observation: emptyPoint, displacementMagnitude: 0, steps: 0 }
    });
    
    expect(s.phase).toBe('armed');
    expect(s.isBleFree).toBe(true);

    // Walk out to 8.0m, steps = 14 (14 steps out)
    s = reducer(s, {
      type: 'tick',
      input: { now: 6000, observation: emptyPoint, displacementMagnitude: 8.0, steps: 14 }
    });
    expect(s.phase).toBe('away');
    expect(s.maxDisplacement).toBe(8.0);
    expect(s.maxDisplacementSteps).toBe(14);

    // Walk back 1 step: displacement = 7.5m, steps = 15. Remains in away.
    s = reducer(s, {
      type: 'tick',
      input: { now: 7000, observation: emptyPoint, displacementMagnitude: 7.5, steps: 15 }
    });
    expect(s.phase).toBe('away');

    // Walk back halfway: displacement = 3.0m (which is < 4.0m), but steps = 15 (total 15 steps).
    // Minimum steps required = Math.max(10, Math.floor(1.35 * 14)) = Math.max(10, 18) = 18 steps.
    // Since 15 steps < 18, the step gate blocks it from counting a lap.
    s = reducer(s, {
      type: 'tick',
      input: { now: 8000, observation: emptyPoint, displacementMagnitude: 3.0, steps: 15 }
    });
    expect(s.phase).toBe('approaching'); // transitions to approaching because displacement < 4.0m
    expect(s.count).toBe(0); // but does NOT count a lap because steps (15) < 18!

    // Try to count: displacement = 1.0m, steps = 15. Still blocked by step gate.
    s = reducer(s, {
      type: 'tick',
      input: { now: 9000, observation: emptyPoint, displacementMagnitude: 1.0, steps: 15 }
    });
    expect(s.phase).toBe('approaching');
    expect(s.count).toBe(0);

    // Now steps = 19 (which is >= 18). Lap counts!
    s = reducer(s, {
      type: 'tick',
      input: { now: 19000, observation: emptyPoint, displacementMagnitude: 1.0, steps: 19 } // 13s elapsed since start (passes 10s debounce)
    });
    expect(s.count).toBe(1);
    expect(s.phase).toBe('armed');
  });
});

/**
 * End-to-end OUTDOOR simulation: drives the outdoor reducer through a
 * synthetic 5-lap session around a 100m loop with realistic GPS noise.
 *
 * Coordinates are around a fictional point (40.7128, -74.006). The lap
 * route is a 50m-radius circle (~314m loop, but we use 8 waypoints for
 * a ~100m closed shape).
 */

import {
  createInitialOutdoorState,
  DEFAULT_OUTDOOR_CONFIG,
  GeoPoint,
  haversineDistance,
  outdoorReducer,
} from '../src/logic/outdoorLapDetector';

const POINT_A = { latitude: 40.7128, longitude: -74.006 };

/**
 * Convert a meter-offset (north, east) into a small lat/lon delta.
 * 1 deg latitude ≈ 111_111 m globally; longitude scales by cos(lat).
 */
function offsetMeters(
  origin: { latitude: number; longitude: number },
  northM: number,
  eastM: number
): { latitude: number; longitude: number } {
  const dLat = northM / 111_111;
  const dLon = eastM / (111_111 * Math.cos((origin.latitude * Math.PI) / 180));
  return {
    latitude: origin.latitude + dLat,
    longitude: origin.longitude + dLon,
  };
}

/**
 * Generate a single 8-waypoint loop walked at ~1.5 m/s. Each waypoint
 * is a 1-second tick. The path is a ~50m-diameter circle returning to
 * point A.
 */
function* simulateLapWaypoints(
  noiseMeters: number,
  prng: () => number
): Generator<GeoPoint> {
  const radius = 25; // meters — 25m radius circle = ~157m loop
  // 16 waypoints around the loop = ~10m between waypoints.
  const N = 16;
  for (let i = 0; i <= N; i++) {
    const θ = (i / N) * 2 * Math.PI;
    const north = radius * Math.sin(θ);
    const east = radius * (1 - Math.cos(θ));
    const noisyN = north + (prng() - 0.5) * 2 * noiseMeters;
    const noisyE = east + (prng() - 0.5) * 2 * noiseMeters;
    const off = offsetMeters(POINT_A, noisyN, noisyE);
    yield { ...off, accuracy: 5 + prng() * 3 };
  }
}

function makePrng(seed: number) {
  let s = seed;
  return () => {
    s = (s * 9301 + 49297) % 233280;
    return s / 233280;
  };
}

describe('e2e: outdoor multi-lap GPS session', () => {
  it('counts exactly N laps for a clean 25m-radius circular walk', () => {
    const TARGET = 5;
    let state = outdoorReducer(
      createInitialOutdoorState({
        ...DEFAULT_OUTDOOR_CONFIG,
        targetLaps: TARGET,
        calibrationMs: 5000,
        lapDebounceMs: 10000,
        nearRadiusM: 12,
        farRadiusM: 30,
      }),
      { type: 'start' }
    );

    const prng = makePrng(42);
    let now = 1_000_000;

    // Calibration: 6 samples at A across 6 seconds.
    for (let i = 0; i < 6; i++) {
      state = outdoorReducer(state, {
        type: 'tick',
        input: {
          now: now + i * 1000,
          position: {
            ...offsetMeters(POINT_A, (prng() - 0.5) * 4, (prng() - 0.5) * 4),
            accuracy: 5,
          },
        },
      });
    }
    expect(state.phase).toBe('armed');
    now += 6000;

    // Walk TARGET laps.
    for (let lap = 0; lap < TARGET; lap++) {
      let i = 0;
      for (const wp of simulateLapWaypoints(2, prng)) {
        state = outdoorReducer(state, {
          type: 'tick',
          input: { now: now + i * 1000, position: wp },
        });
        i++;
      }
      now += 17_000;
    }

    expect(state.count).toBe(TARGET);
    expect(state.phase).toBe('finished');
  });

  it('tolerates moderate GPS noise (±5m) without losing laps', () => {
    const TARGET = 3;
    let state = outdoorReducer(
      createInitialOutdoorState({
        ...DEFAULT_OUTDOOR_CONFIG,
        targetLaps: TARGET,
        calibrationMs: 5000,
        lapDebounceMs: 8000,
        nearRadiusM: 18,
        farRadiusM: 35,
      }),
      { type: 'start' }
    );

    const prng = makePrng(7);
    let now = 0;
    for (let i = 0; i < 6; i++) {
      state = outdoorReducer(state, {
        type: 'tick',
        input: {
          now: now + i * 1000,
          position: {
            ...offsetMeters(POINT_A, (prng() - 0.5) * 6, (prng() - 0.5) * 6),
            accuracy: 8,
          },
        },
      });
    }
    now += 6000;

    for (let lap = 0; lap < TARGET; lap++) {
      let i = 0;
      for (const wp of simulateLapWaypoints(5, prng)) {
        state = outdoorReducer(state, {
          type: 'tick',
          input: { now: now + i * 1000, position: wp },
        });
        i++;
      }
      now += 17_000;
    }

    expect(state.count).toBe(TARGET);
    expect(state.phase).toBe('finished');
  });

  it('rejects fixes worse than maxAcceptableAccuracy (e.g. tunnel / cold start)', () => {
    let state = outdoorReducer(
      createInitialOutdoorState({
        ...DEFAULT_OUTDOOR_CONFIG,
        targetLaps: 1,
        calibrationMs: 0,
        lapDebounceMs: 0,
        maxAcceptableAccuracyM: 20,
      }),
      { type: 'start' }
    );

    // Stream of garbage fixes during "calibration" — all rejected.
    for (let i = 0; i < 5; i++) {
      state = outdoorReducer(state, {
        type: 'tick',
        input: {
          now: i * 1000,
          position: { latitude: 40, longitude: -74, accuracy: 100 },
        },
      });
    }
    expect(state.rejectedCount).toBe(5);
    expect(state.phase).toBe('calibrating');

    // First good fix completes calibration.
    state = outdoorReducer(state, {
      type: 'tick',
      input: {
        now: 6000,
        position: { latitude: 40, longitude: -74, accuracy: 5 },
      },
    });
    expect(state.phase).toBe('armed');
  });

  it('does not count a lap when the walker only goes part-way out', () => {
    let state = outdoorReducer(
      createInitialOutdoorState({
        ...DEFAULT_OUTDOOR_CONFIG,
        targetLaps: 3,
        calibrationMs: 0,
        nearRadiusM: 15,
        farRadiusM: 40,
      }),
      { type: 'start' }
    );

    state = outdoorReducer(state, {
      type: 'tick',
      input: { now: 0, position: { ...POINT_A, accuracy: 5 } },
    });

    // Wander 20m out (above near radius, below far radius) and come back.
    for (let i = 0; i < 5; i++) {
      const off = offsetMeters(POINT_A, 0, 20);
      state = outdoorReducer(state, {
        type: 'tick',
        input: { now: 1000 + i * 1000, position: { ...off, accuracy: 5 } },
      });
    }
    for (let i = 0; i < 5; i++) {
      state = outdoorReducer(state, {
        type: 'tick',
        input: {
          now: 6000 + i * 1000,
          position: { ...POINT_A, accuracy: 5 },
        },
      });
    }
    expect(state.count).toBe(0);
    expect(state.phase).toBe('armed');
  });
});

describe('e2e: real-world distance sanity', () => {
  it('a 25m radius loop yields ~157m perimeter (within tolerance)', () => {
    const prng = makePrng(1);
    const points = [...simulateLapWaypoints(0, prng)];
    let perimeter = 0;
    for (let i = 1; i < points.length; i++) {
      perimeter += haversineDistance(points[i - 1], points[i]);
    }
    expect(perimeter).toBeGreaterThan(140);
    expect(perimeter).toBeLessThan(170);
  });
});

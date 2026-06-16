import {
  createInitialOutdoorState,
  DEFAULT_OUTDOOR_CONFIG,
  GeoPoint,
  haversineDistance,
  outdoorReducer,
  outdoorStatusLabel,
  refinePointA,
} from '../outdoorLapDetector';

const NYC: GeoPoint = { latitude: 40.7128, longitude: -74.006, accuracy: 5 };
const LON: GeoPoint = { latitude: 51.5074, longitude: -0.1278, accuracy: 5 };

function pt(lat: number, lon: number, accuracy = 5): GeoPoint {
  return { latitude: lat, longitude: lon, accuracy };
}

describe('haversineDistance', () => {
  it('returns 0 for identical points', () => {
    expect(haversineDistance(NYC, { ...NYC })).toBe(0);
  });

  it('matches the known great-circle distance NYC ↔ London (~5570 km)', () => {
    const d = haversineDistance(NYC, LON);
    expect(d / 1000).toBeGreaterThan(5500);
    expect(d / 1000).toBeLessThan(5600);
  });

  it('is symmetric', () => {
    expect(haversineDistance(NYC, LON)).toBeCloseTo(
      haversineDistance(LON, NYC),
      3
    );
  });

  it('correctly measures small distances (≈ 1° lat ≈ 111 km)', () => {
    const a = pt(0, 0);
    const b = pt(1, 0);
    expect(haversineDistance(a, b)).toBeGreaterThan(110_000);
    expect(haversineDistance(a, b)).toBeLessThan(112_000);
  });

  it('measures sub-100m distances accurately', () => {
    // 0.0009° lat ≈ 100 m
    const a = pt(40.7128, -74.006);
    const b = pt(40.7128 + 0.0009, -74.006);
    expect(haversineDistance(a, b)).toBeGreaterThan(95);
    expect(haversineDistance(a, b)).toBeLessThan(105);
  });
});

describe('refinePointA', () => {
  it('moves stored toward the observation', () => {
    const stored = pt(40.0, -74.0);
    const obs = pt(40.0001, -74.0001);
    const refined = refinePointA(stored, obs, 0.5);
    expect(refined.latitude).toBeGreaterThan(stored.latitude);
    expect(refined.latitude).toBeLessThan(obs.latitude);
    expect(refined.longitude).toBeLessThan(stored.longitude);
    expect(refined.longitude).toBeGreaterThan(obs.longitude);
  });

  it('caps movement at 5m even with a wildly-off observation', () => {
    const stored = pt(40.0, -74.0);
    // 1° lat ≈ 111km — way more than 5m.
    const obs = pt(41.0, -74.0);
    const refined = refinePointA(stored, obs, 0.5);
    const moved = haversineDistance(stored, refined);
    expect(moved).toBeLessThan(6); // cap is 5m, allow tiny floating error
  });

  it('blends accuracy with the EMA', () => {
    const stored = pt(40.0, -74.0, 10);
    const obs = pt(40.0, -74.0, 4);
    const refined = refinePointA(stored, obs, 0.5);
    expect(refined.accuracy).toBeCloseTo(7, 1);
  });
});

describe('outdoorReducer — start / stop / reset', () => {
  it('start enters calibrating with calibrationStartedAt left null', () => {
    const init = createInitialOutdoorState();
    const next = outdoorReducer(init, { type: 'start' });
    expect(next.phase).toBe('calibrating');
    expect(next.calibrationStartedAt).toBeNull();
    expect(next.count).toBe(0);
  });

  it('start merges partial config overrides', () => {
    const init = createInitialOutdoorState();
    const next = outdoorReducer(init, {
      type: 'start',
      config: { targetLaps: 3, nearRadiusM: 8 },
    });
    expect(next.config.targetLaps).toBe(3);
    expect(next.config.nearRadiusM).toBe(8);
    expect(next.config.farRadiusM).toBe(DEFAULT_OUTDOOR_CONFIG.farRadiusM);
  });

  it('stop and reset both return to a fresh initial state, preserving config', () => {
    let s = outdoorReducer(createInitialOutdoorState(), {
      type: 'start',
      config: { targetLaps: 7 },
    });
    s = outdoorReducer(s, { type: 'stop' });
    expect(s.phase).toBe('idle');
    expect(s.count).toBe(0);
    expect(s.config.targetLaps).toBe(7);

    s = outdoorReducer(s, { type: 'reset' });
    expect(s.phase).toBe('idle');
  });
});

describe('outdoorReducer — calibration', () => {
  it('captures startedAt from the first tick and stays in calibrating', () => {
    const init = createInitialOutdoorState({
      ...DEFAULT_OUTDOOR_CONFIG,
      calibrationMs: 8000,
    });
    let s = outdoorReducer(init, { type: 'start' });
    s = outdoorReducer(s, {
      type: 'tick',
      input: { now: 1000, position: pt(40.0, -74.0) },
    });
    expect(s.phase).toBe('calibrating');
    expect(s.calibrationStartedAt).toBe(1000);
    expect(s.calibrationSamples.length).toBe(1);
  });

  it('transitions to armed once the calibration window elapses', () => {
    const init = createInitialOutdoorState({
      ...DEFAULT_OUTDOOR_CONFIG,
      calibrationMs: 5000,
    });
    let s = outdoorReducer(init, { type: 'start' });
    s = outdoorReducer(s, {
      type: 'tick',
      input: { now: 1000, position: pt(40.0, -74.0) },
    });
    s = outdoorReducer(s, {
      type: 'tick',
      input: { now: 7000, position: pt(40.00001, -74.00001) },
    });
    expect(s.phase).toBe('armed');
    expect(s.pointA).not.toBeNull();
    expect(s.pointA!.latitude).toBeCloseTo(40.0, 4);
    expect(s.pointA!.longitude).toBeCloseTo(-74.0, 4);
  });

  it('weights tighter fixes more than loose ones during calibration', () => {
    const init = createInitialOutdoorState({
      ...DEFAULT_OUTDOOR_CONFIG,
      calibrationMs: 5000,
      // Allow looser fixes so both samples enter calibration.
      maxAcceptableAccuracyM: 50,
    });
    let s = outdoorReducer(init, { type: 'start' });
    // Sample 1: looser accuracy at the "wrong" location
    s = outdoorReducer(s, {
      type: 'tick',
      input: { now: 0, position: pt(41.0, -75.0, 30) },
    });
    // Sample 2: tight accuracy at the "right" location
    s = outdoorReducer(s, {
      type: 'tick',
      input: { now: 6000, position: pt(40.0, -74.0, 2) },
    });
    expect(s.phase).toBe('armed');
    // Should be much closer to (40, -74) than (41, -75) thanks to 1/acc² weighting.
    // Weight ratio: (1/2²) / (1/30²) = 225 → averaged point is dominated by the tight fix.
    expect(Math.abs(s.pointA!.latitude - 40.0)).toBeLessThan(0.05);
    expect(Math.abs(s.pointA!.longitude - -74.0)).toBeLessThan(0.05);
  });

  it('rejects readings worse than maxAcceptableAccuracyM and counts them', () => {
    const init = createInitialOutdoorState({
      ...DEFAULT_OUTDOOR_CONFIG,
      calibrationMs: 5000,
      maxAcceptableAccuracyM: 20,
    });
    let s = outdoorReducer(init, { type: 'start' });
    s = outdoorReducer(s, {
      type: 'tick',
      input: { now: 1000, position: pt(40.0, -74.0, 100) },
    });
    expect(s.rejectedCount).toBe(1);
    expect(s.calibrationSamples.length).toBe(0);
    expect(s.phase).toBe('calibrating');
  });
});

describe('outdoorReducer — armed → away → approaching → near (lap)', () => {
  function calibratedAt(latlon: { lat: number; lon: number }) {
    const init = createInitialOutdoorState({
      ...DEFAULT_OUTDOOR_CONFIG,
      calibrationMs: 0,
      lapDebounceMs: 0,
    });
    let s = outdoorReducer(init, { type: 'start' });
    s = outdoorReducer(s, {
      type: 'tick',
      input: { now: 0, position: pt(latlon.lat, latlon.lon) },
    });
    return s;
  }

  it('armed → away when distance crosses farRadius', () => {
    let s = calibratedAt({ lat: 40.0, lon: -74.0 });
    expect(s.phase).toBe('armed');
    // 0.0005° lat ≈ 55 m — beyond the 40 m far radius.
    s = outdoorReducer(s, {
      type: 'tick',
      input: { now: 1000, position: pt(40.0005, -74.0) },
    });
    expect(s.phase).toBe('away');
  });

  it('stays armed when only briefly drifting within farRadius', () => {
    let s = calibratedAt({ lat: 40.0, lon: -74.0 });
    // 0.0001° lat ≈ 11 m — well within near radius.
    s = outdoorReducer(s, {
      type: 'tick',
      input: { now: 1000, position: pt(40.0001, -74.0) },
    });
    expect(s.phase).toBe('armed');
  });

  it('away → approaching when re-entering within farRadius', () => {
    let s = calibratedAt({ lat: 40.0, lon: -74.0 });
    s = outdoorReducer(s, {
      type: 'tick',
      input: { now: 1000, position: pt(40.0005, -74.0) },
    });
    expect(s.phase).toBe('away');
    // Move back to 0.0002° ≈ 22 m (between near 15 and far 40).
    s = outdoorReducer(s, {
      type: 'tick',
      input: { now: 2000, position: pt(40.0002, -74.0) },
    });
    expect(s.phase).toBe('approaching');
  });

  it('counts a lap when approaching crosses into nearRadius (debounced)', () => {
    const init = createInitialOutdoorState({
      ...DEFAULT_OUTDOOR_CONFIG,
      calibrationMs: 0,
      targetLaps: 1,
      lapDebounceMs: 0,
    });
    let s = outdoorReducer(init, { type: 'start' });
    s = outdoorReducer(s, {
      type: 'tick',
      input: { now: 0, position: pt(40.0, -74.0) },
    });
    // away
    s = outdoorReducer(s, {
      type: 'tick',
      input: { now: 1000, position: pt(40.0005, -74.0) },
    });
    // approaching
    s = outdoorReducer(s, {
      type: 'tick',
      input: { now: 2000, position: pt(40.0002, -74.0) },
    });
    // back near A → lap
    s = outdoorReducer(s, {
      type: 'tick',
      input: { now: 3000, position: pt(40.00005, -74.0) },
    });
    expect(s.count).toBe(1);
    expect(s.phase).toBe('finished');
    expect(s.lastLapAt).toBe(3000);
  });

  it('respects lapDebounceMs and does not double-count', () => {
    const init = createInitialOutdoorState({
      ...DEFAULT_OUTDOOR_CONFIG,
      calibrationMs: 0,
      targetLaps: 5,
      lapDebounceMs: 10000,
    });
    let s = outdoorReducer(init, { type: 'start' });
    s = outdoorReducer(s, {
      type: 'tick',
      input: { now: 0, position: pt(40.0, -74.0) },
    });
    s = outdoorReducer(s, {
      type: 'tick',
      input: { now: 1000, position: pt(40.0005, -74.0) },
    });
    s = outdoorReducer(s, {
      type: 'tick',
      input: { now: 2000, position: pt(40.0002, -74.0) },
    });
    s = outdoorReducer(s, {
      type: 'tick',
      input: { now: 3000, position: pt(40.0, -74.0) },
    });
    expect(s.count).toBe(1);
    // Within debounce window: doesn't count again even if we pass the
    // approaching → near transition.
    s = outdoorReducer(s, {
      type: 'tick',
      input: { now: 4000, position: pt(40.0002, -74.0) },
    });
    s = outdoorReducer(s, {
      type: 'tick',
      input: { now: 5000, position: pt(40.0, -74.0) },
    });
    expect(s.count).toBe(1);
  });

  it('refines pointA each lap, capped at the 5m budget', () => {
    const init = createInitialOutdoorState({
      ...DEFAULT_OUTDOOR_CONFIG,
      calibrationMs: 0,
      targetLaps: 5,
      lapDebounceMs: 0,
      refinementAlpha: 1.0,
    });
    let s = outdoorReducer(init, { type: 'start' });
    s = outdoorReducer(s, {
      type: 'tick',
      input: { now: 0, position: pt(40.0, -74.0) },
    });
    const initialPointA = s.pointA!;
    s = outdoorReducer(s, {
      type: 'tick',
      input: { now: 1000, position: pt(40.0005, -74.0) },
    });
    s = outdoorReducer(s, {
      type: 'tick',
      input: { now: 2000, position: pt(40.0002, -74.0) },
    });
    // Fake a slightly-off "back at A" reading.
    s = outdoorReducer(s, {
      type: 'tick',
      input: { now: 3000, position: pt(40.00003, -74.00003) },
    });
    expect(s.count).toBe(1);
    const moved = haversineDistance(initialPointA, s.pointA!);
    expect(moved).toBeGreaterThan(0);
    expect(moved).toBeLessThan(6);
  });
});

describe('outdoorStatusLabel', () => {
  it('returns a stable string for every phase', () => {
    const phases = [
      'idle',
      'calibrating',
      'armed',
      'away',
      'approaching',
      'finished',
    ] as const;
    for (const phase of phases) {
      const label = outdoorStatusLabel({
        ...createInitialOutdoorState(),
        phase,
      });
      expect(typeof label).toBe('string');
      expect(label.length).toBeGreaterThan(0);
    }
  });
});

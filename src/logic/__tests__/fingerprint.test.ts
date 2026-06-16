import {
  emptyFingerprint,
  magneticDelta,
  refineFingerprint,
  similarity,
} from '../fingerprint';
import { awayFrom, fp } from '../../../__tests__/helpers/fixtures';

describe('fingerprint.similarity', () => {
  it('returns 1 for identical fingerprints', () => {
    const a = fp([['x', -55], ['y', -70]]);
    expect(similarity(a, a)).toBeCloseTo(1, 5);
  });

  it('returns 0 for completely disjoint device sets', () => {
    const a = fp([['x', -55]]);
    const b = fp([['y', -55]]);
    expect(similarity(a, b)).toBe(0);
  });

  it('treats two empty fingerprints as similar by the jaccard convention', () => {
    // Jaccard of two empty sets is 1.0; cosine has no shared devices so
    // contributes 0; weighted result with cosine downweighted by jaccard
    // = (1 * 0.5 + 0 * 1 * 0.5) / 1 = 0.5.
    const e1 = emptyFingerprint();
    const e2 = emptyFingerprint();
    expect(similarity(e1, e2)).toBeCloseTo(0.5, 5);
  });

  it('is symmetric: sim(a,b) == sim(b,a)', () => {
    const a = fp([['x', -55], ['y', -70], ['z', -80]]);
    const b = fp([['y', -65], ['z', -82], ['w', -90]]);
    expect(similarity(a, b)).toBeCloseTo(similarity(b, a), 6);
  });

  it('produces a value in [0, 1] for partially overlapping sets', () => {
    const a = fp([['x', -55], ['y', -70], ['z', -80]]);
    const b = fp([['y', -65], ['z', -82], ['w', -90]]);
    const s = similarity(a, b);
    expect(s).toBeGreaterThan(0);
    expect(s).toBeLessThan(1);
  });

  it('rises monotonically as fingerprints become more similar', () => {
    const target = fp([['a', -55], ['b', -60], ['c', -70], ['d', -80]]);

    const farther = fp([['x', -55], ['y', -60]]);
    const closer = fp([['a', -55], ['b', -60], ['x', -90]]);
    const closest = fp([['a', -55], ['b', -60], ['c', -70], ['d', -80]]);

    const sFar = similarity(farther, target);
    const sClose = similarity(closer, target);
    const sClosest = similarity(closest, target);

    expect(sClose).toBeGreaterThan(sFar);
    expect(sClosest).toBeGreaterThan(sClose);
  });
});

describe('fingerprint.magneticDelta', () => {
  it('is the absolute difference of magnitudes', () => {
    const a = fp([], 47.2);
    const b = fp([], 51.0);
    expect(magneticDelta(a, b)).toBeCloseTo(3.8, 6);
    expect(magneticDelta(b, a)).toBeCloseTo(3.8, 6);
  });
});

describe('fingerprint.refineFingerprint', () => {
  it('moves stored RSSI values toward observed values via moving average', () => {
    const stored = fp([['x', -60]]);
    const observation = fp([['x', -40]]);
    const refined = refineFingerprint(stored, observation, 0.5);
    expect(refined.bleDevices.get('x')).toBeCloseTo(-50, 6);
  });

  it('absorbs new devices from observation', () => {
    const stored = fp([['x', -60]]);
    const observation = fp([['x', -55], ['y', -70]]);
    const refined = refineFingerprint(stored, observation, 0.3);
    expect(refined.bleDevices.has('y')).toBe(true);
    expect(refined.bleDevices.get('y')).toBeCloseTo(-70, 6);
  });

  it('fades devices that disappear from observation, eventually dropping them', () => {
    let f = fp([['ghost', -60]]);
    const observation = fp([['real', -55]]);
    for (let i = 0; i < 50; i++) {
      f = refineFingerprint(f, observation, 0.3);
    }
    expect(f.bleDevices.has('ghost')).toBe(false);
    expect(f.bleDevices.has('real')).toBe(true);
  });

  it('blends magnetic magnitude using the same alpha', () => {
    const stored = fp([], 40);
    const observation = fp([], 60);
    const refined = refineFingerprint(stored, observation, 0.25);
    expect(refined.magneticMagnitude).toBeCloseTo(45, 6);
  });

  it('makes a fingerprint less similar to a clearly "away" sample after refinement', () => {
    const a = fp([['a', -55], ['b', -60], ['c', -70]], 50);
    const away = awayFrom(a);
    const beforeSim = similarity(away, a);
    const refined = refineFingerprint(a, a, 0.3);
    const afterSim = similarity(away, refined);
    expect(afterSim).toBeLessThanOrEqual(beforeSim + 0.01);
  });
});

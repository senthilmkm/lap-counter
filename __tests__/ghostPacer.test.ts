import { calculateLapTarget, evaluateGhostPacer } from '../src/logic/ghostPacer';

describe('Ghost Pacer Logic & Gating', () => {
  it('returns manual target for manual_target mode', () => {
    const target = calculateLapTarget(3, {
      mode: 'manual_target',
      targetLapSeconds: 75,
      prLapSeconds: 60,
      negativeSplitFactor: 0.02,
    });
    expect(target).toBe(75);
  });

  it('returns prLapSeconds for pr_ghost mode', () => {
    const target = calculateLapTarget(2, {
      mode: 'pr_ghost',
      targetLapSeconds: 90,
      prLapSeconds: 58.5,
      negativeSplitFactor: 0.02,
    });
    expect(target).toBe(58.5);
  });

  it('calculates negative split progressively faster', () => {
    const targetLap1 = calculateLapTarget(1, {
      mode: 'negative_split',
      targetLapSeconds: 100,
      negativeSplitFactor: 0.05,
    });
    const targetLap2 = calculateLapTarget(2, {
      mode: 'negative_split',
      targetLapSeconds: 100,
      negativeSplitFactor: 0.05,
    });
    expect(targetLap1).toBe(100);
    expect(targetLap2).toBe(95); // 100 * (1 - 0.05 * 1)
  });

  it('evaluates ghost pacer when ahead of pace', () => {
    const res = evaluateGhostPacer({
      config: {
        mode: 'pr_ghost',
        targetLapSeconds: 90,
        prLapSeconds: 60,
        negativeSplitFactor: 0.02,
      },
      lapNumber: 2,
      lapElapsedSeconds: 55,
    });

    expect(res.splitDeltaSeconds).toBe(-5); // 5s faster than 60s
    expect(res.isAhead).toBe(true);
    expect(res.coachCue).toContain('5 seconds ahead of your PR');
  });

  it('evaluates ghost pacer when behind pace', () => {
    const res = evaluateGhostPacer({
      config: {
        mode: 'manual_target',
        targetLapSeconds: 60,
        negativeSplitFactor: 0.02,
      },
      lapNumber: 1,
      lapElapsedSeconds: 63.4,
    });

    expect(res.splitDeltaSeconds).toBeCloseTo(3.4);
    expect(res.isAhead).toBe(false);
    expect(res.coachCue).toContain('3 seconds behind target');
  });
});

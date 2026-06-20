import { act, renderHook } from '@testing-library/react-native';
import { useLapCounter } from '../src/state/useLapCounter';
import { useSubscription } from '../src/state/useSubscription';
import { generateGPX, generateCSV, ExporterPoint, ExporterLap } from '../src/services/exporter';

describe('E2E Premium and Subscription Features', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('restricts outdoor GPS mode for Free tier users when gpsModePremiumGated is enabled', async () => {
    const { result } = renderHook(() => useLapCounter());

    // Try starting Outdoor workout with isPremium = false and gpsModePremiumGated = true
    await act(async () => {
      await result.current.start({ mode: 'outdoor', isPremium: false, gpsModePremiumGated: true });
    });

    expect(result.current.error?.message).toMatch(/requires a Premium subscription/i);
    expect(result.current.state.phase).toBe('idle');
  });

  it('allows outdoor GPS mode for Free tier users (5-lap trial) when gpsModePremiumGated is disabled', async () => {
    const { result } = renderHook(() => useLapCounter());

    // Start Outdoor workout with isPremium = false and gpsModePremiumGated = false
    await act(async () => {
      await result.current.start({ mode: 'outdoor', isPremium: false, gpsModePremiumGated: false });
    });

    expect(result.current.error).toBeNull();
    expect(result.current.state.phase).not.toBe('idle');
    expect(result.current.state.config.targetLaps).toBe(5); // should be clamped from default 10 to 5

    // Teardown
    await act(async () => {
      await result.current.reset();
    });
  });

  it('allows outdoor GPS mode for Premium tier users', async () => {
    const { result } = renderHook(() => useLapCounter());

    // Start Outdoor workout with isPremium = true
    await act(async () => {
      await result.current.start({ mode: 'outdoor', isPremium: true });
    });

    expect(result.current.error).toBeNull();
    // It should proceed past idle phase (e.g. into calibrating or armed)
    expect(result.current.state.phase).not.toBe('idle');

    // Teardown
    await act(async () => {
      await result.current.reset();
    });
  });

  it('clamps target laps to 5 for Free tier users during indoor mode', async () => {
    const { result } = renderHook(() => useLapCounter());

    // Start indoor workout with 10 laps, isPremium = false
    await act(async () => {
      await result.current.start({ mode: 'indoor', targetLaps: 10, isPremium: false });
    });

    expect(result.current.state.config.targetLaps).toBe(5);

    // Teardown
    await act(async () => {
      await result.current.reset();
    });
  });

  it('allows unlimited target laps (e.g., 10) for Premium users during indoor mode', async () => {
    const { result } = renderHook(() => useLapCounter());

    // Start indoor workout with 10 laps, isPremium = true
    await act(async () => {
      await result.current.start({ mode: 'indoor', targetLaps: 10, isPremium: true });
    });

    expect(result.current.state.config.targetLaps).toBe(10);

    // Teardown
    await act(async () => {
      await result.current.reset();
    });
  });

  it('correctly enters paused and resumed states', async () => {
    const { result } = renderHook(() => useLapCounter());

    // Start indoor workout
    await act(async () => {
      await result.current.start({ mode: 'indoor', targetLaps: 3, isPremium: true });
    });

    expect(result.current.isPaused).toBe(false);

    // Pause workout
    act(() => {
      result.current.pause();
    });
    expect(result.current.isPaused).toBe(true);

    // Resume workout
    act(() => {
      result.current.resume();
    });
    expect(result.current.isPaused).toBe(false);

    // Teardown
    await act(async () => {
      await result.current.reset();
    });
  });

  it('generates valid GPX and CSV output format strings', () => {
    // 1. Check GPX formatting
    const pts: ExporterPoint[] = [
      { latitude: 37.7749, longitude: -122.4194, timestamp: 1718698000000 },
      { latitude: 37.7750, longitude: -122.4195, timestamp: 1718698010000 },
    ];
    const gpxOutput = generateGPX(pts, 1718698000000);
    expect(gpxOutput).toContain('<?xml version="1.0" encoding="UTF-8"?>');
    expect(gpxOutput).toContain('<trkpt lat="37.774900" lon="-122.419400">');
    expect(gpxOutput).toContain('<time>2024-06-18T08:06:40.000Z</time>');

    // 2. Check CSV formatting
    const laps: ExporterLap[] = [
      { lapNumber: 1, durationSeconds: 62.4, steps: 95, cadence: 91.3, yawDrift: 0.12 },
      { lapNumber: 2, durationSeconds: 58.1, steps: 92, cadence: 95.0, yawDrift: 0.24 },
    ];
    const csvOutput = generateCSV(laps);
    expect(csvOutput).toContain('Lap Number,Duration (s),Steps,Average Cadence (spm),Relative Drift (m)');
    expect(csvOutput).toContain('1,62.4,95,91,0.12');
    expect(csvOutput).toContain('2,58.1,92,95,0.24');
  });

  describe('Subscription Hook Transitions', () => {
    it('handles transition changes between free, monthly, and annual states', async () => {
      const { result } = renderHook(() => useSubscription());

      // 1. Initial State should be free
      expect(result.current.isPremium).toBe(false);
      expect(result.current.subTier).toBe('free');

      // 2. Transition to monthly simulation
      act(() => {
        result.current.setSubTier('monthly');
        result.current.setIsPremium(true);
      });
      expect(result.current.isPremium).toBe(true);
      expect(result.current.subTier).toBe('monthly');

      // 3. Transition to annual simulation
      act(() => {
        result.current.setSubTier('annual');
        result.current.setIsPremium(true);
      });
      expect(result.current.isPremium).toBe(true);
      expect(result.current.subTier).toBe('annual');

      // 4. Transition back to free
      act(() => {
        result.current.setSubTier('free');
        result.current.setIsPremium(false);
      });
      expect(result.current.isPremium).toBe(false);
      expect(result.current.subTier).toBe('free');
    });
  });
});


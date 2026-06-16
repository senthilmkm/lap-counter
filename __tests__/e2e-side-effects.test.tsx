/**
 * Side-effect e2e: drives a complete multi-lap session through the
 * useLapCounter hook with mocked native modules, and asserts the
 * haptic + notification + background-task lifecycle fires correctly
 * at every transition.
 *
 * This complements `e2e-session.test.ts` which exercises the pure
 * reducer with synthetic sensor streams. Together they cover both:
 *   - the math (pure reducer with realistic sensor noise)
 *   - the orchestration (hook side effects across a real run)
 */

import { act, renderHook, waitFor } from '@testing-library/react-native';

import * as expoSensorsRaw from 'expo-sensors';
import * as ble from 'react-native-ble-plx';
import * as Haptics from 'expo-haptics';
import * as Notifications from 'expo-notifications';
import * as BackgroundFetch from 'expo-background-fetch';
import * as TaskManager from 'expo-task-manager';

import { useLapCounter } from '../src/state/useLapCounter';
import { __resetForTests as __resetBleScanner } from '../src/sensors/bleScanner';
import { BACKGROUND_TASK_NAME } from '../src/services/backgroundTask';

type MockedSensor<T> = {
  setUpdateInterval: jest.Mock;
  addListener: jest.Mock;
  __emit: (value: T) => void;
  __reset: () => void;
};
type MockedPedometer = {
  isAvailableAsync: jest.Mock;
  watchStepCount: jest.Mock;
  __emitSteps: (steps: number) => void;
  __resetSteps?: () => void;
  __reset: () => void;
};
const expoSensors = expoSensorsRaw as unknown as {
  Magnetometer: MockedSensor<{ x: number; y: number; z: number }>;
  DeviceMotion: MockedSensor<{
    rotation?: { alpha: number; beta: number; gamma: number };
  }>;
  Pedometer: MockedPedometer;
  __resetAllSensors: () => void;
};
const { Magnetometer, __resetAllSensors } = expoSensors;

const blePlx = ble as unknown as typeof ble & {
  __getLastManager: () => {
    __emitDevice: (d: { id: string; rssi: number }) => void;
  };
  __resetManagers: () => void;
};

const HapticsMock = Haptics as unknown as typeof Haptics & {
  __getHapticCalls: () => ReadonlyArray<{ kind: string; arg?: string }>;
  __resetHaptics: () => void;
};
const NotificationsMock = Notifications as unknown as typeof Notifications & {
  __setPermission: (next: { granted?: boolean; status?: string; canAskAgain?: boolean }) => void;
  __getScheduledNotifications: () => ReadonlyArray<{ id: string; content: { body?: string } }>;
  __resetNotifications: () => void;
};
const BackgroundFetchMock = BackgroundFetch as unknown as typeof BackgroundFetch & {
  __getRegistrations: () => ReadonlyArray<{ name: string; opts: unknown }>;
  __resetBackgroundFetch: () => void;
};
const TaskManagerMock = TaskManager as unknown as typeof TaskManager & {
  __resetTaskRegistrations: () => void;
};

beforeEach(() => {
  jest.useFakeTimers({ doNotFake: ['performance', 'queueMicrotask'] });
  __resetAllSensors();
  blePlx.__resetManagers();
  __resetBleScanner();
  HapticsMock.__resetHaptics();
  NotificationsMock.__resetNotifications();
  BackgroundFetchMock.__resetBackgroundFetch();
  TaskManagerMock.__resetTaskRegistrations();
  NotificationsMock.__setPermission({
    granted: true,
    status: 'granted',
    canAskAgain: false,
  });
});

afterEach(() => {
  jest.useRealTimers();
});

const NEAR_A_DEVICES = [
  ['router-1', -55],
  ['airpods-2', -62],
  ['watch-3', -70],
  ['tv-4', -78],
  ['cardio-5', -82],
  ['phone-6', -65],
  ['speaker-7', -72],
  ['ipad-8', -80],
] as const;
const FAR_DEVICES = [
  ['far-1', -75],
  ['far-2', -80],
  ['far-3', -82],
  ['far-4', -78],
] as const;

function emitNearA(): void {
  const manager = blePlx.__getLastManager();
  Magnetometer.__emit({ x: 30, y: 30, z: 30 });
  for (const [id, rssi] of NEAR_A_DEVICES) {
    manager.__emitDevice({ id, rssi });
  }
}

function emitFar(): void {
  const manager = blePlx.__getLastManager();
  Magnetometer.__emit({ x: 70, y: 30, z: 30 });
  for (const [id, rssi] of FAR_DEVICES) {
    manager.__emitDevice({ id, rssi });
  }
}

async function tickOnce(): Promise<void> {
  await act(async () => {
    jest.advanceTimersByTime(1000);
  });
}

/**
 * Drive one full lap through the hook.
 *
 * The BLE aggregator uses a 5-second sliding window. Because every FAR
 * tick adds the *same* 4 device IDs, those IDs stay in the snapshot
 * until the LAST FAR observation ages out. So the walk-back must run
 * at least (window/tick) + 1 = 6 NEAR ticks before the FAR IDs drop
 * and Jaccard reaches 1. We use 7+7 to keep the test resilient to
 * minor timing wobbles.
 */
async function simulateOneLap(): Promise<void> {
  for (let i = 0; i < 7; i++) {
    emitFar();
    await tickOnce();
  }
  for (let i = 0; i < 7; i++) {
    emitNearA();
    await tickOnce();
  }
}

describe('e2e side effects: useLapCounter hook with mocked native modules', () => {
  it('fires lap haptic on each lap and posts a notification at target', async () => {
    const TARGET = 3;
    const { result } = renderHook(() => useLapCounter());

    await act(async () => {
      await result.current.start({
        targetLaps: TARGET,
        calibrationMs: 0,
        lapDebounceMs: 0,
      });
    });
    await waitFor(() => {
      expect(blePlx.__getLastManager()).toBeDefined();
    });

    // Calibration ticks (calibrationMs=0 → first tick completes calibration).
    emitNearA();
    await tickOnce();
    emitNearA();
    await tickOnce();

    // Drive TARGET laps through the hook.
    for (let lap = 0; lap < TARGET; lap++) {
      await simulateOneLap();
    }

    await waitFor(() => {
      expect(result.current.state.count).toBe(TARGET);
      expect(result.current.state.phase).toBe('finished');
    });

    const calls = HapticsMock.__getHapticCalls();
    const lapImpacts = calls.filter(
      (c) => c.kind === 'impact' && c.arg === Haptics.ImpactFeedbackStyle.Medium
    );
    const successHaptics = calls.filter(
      (c) =>
        c.kind === 'notification' &&
        c.arg === Haptics.NotificationFeedbackType.Success
    );

    // One lap haptic per lap.
    expect(lapImpacts.length).toBe(TARGET);
    // Exactly one success haptic when target is reached.
    expect(successHaptics.length).toBe(1);

    // Exactly one local notification scheduled, with both numbers in the body.
    const queue = NotificationsMock.__getScheduledNotifications();
    expect(queue.length).toBe(1);
    expect(queue[0].content.body).toContain(String(TARGET));
  });

  it('registers the background task on start, unregisters on finished', async () => {
    const { result } = renderHook(() => useLapCounter());

    await act(async () => {
      await result.current.start({
        targetLaps: 1,
        calibrationMs: 0,
        lapDebounceMs: 0,
      });
    });

    await waitFor(() => {
      const regs = BackgroundFetchMock.__getRegistrations();
      expect(regs.map((r) => r.name)).toContain(BACKGROUND_TASK_NAME);
    });

    emitNearA();
    await tickOnce();
    emitNearA();
    await tickOnce();
    await simulateOneLap();

    await waitFor(() => {
      expect(result.current.state.phase).toBe('finished');
    });
    expect(BackgroundFetch.unregisterTaskAsync).toHaveBeenCalledWith(
      BACKGROUND_TASK_NAME
    );
  });

  it('does not double-fire the success notification on subsequent finished re-renders', async () => {
    const { result, rerender } = renderHook(() => useLapCounter());

    await act(async () => {
      await result.current.start({
        targetLaps: 1,
        calibrationMs: 0,
        lapDebounceMs: 0,
      });
    });
    await waitFor(() => {
      expect(blePlx.__getLastManager()).toBeDefined();
    });

    emitNearA();
    await tickOnce();
    emitNearA();
    await tickOnce();
    await simulateOneLap();

    await waitFor(() => {
      expect(result.current.state.phase).toBe('finished');
    });

    // Force a few extra renders without changing the underlying state.
    rerender(undefined);
    rerender(undefined);
    rerender(undefined);

    expect(NotificationsMock.__getScheduledNotifications().length).toBe(1);
    const successHaptics = HapticsMock.__getHapticCalls().filter(
      (c) =>
        c.kind === 'notification' &&
        c.arg === Haptics.NotificationFeedbackType.Success
    );
    expect(successHaptics.length).toBe(1);
  });

  it('does not post a notification when permission is denied', async () => {
    NotificationsMock.__setPermission({
      granted: false,
      status: 'denied',
      canAskAgain: false,
    });
    const { result } = renderHook(() => useLapCounter());

    await act(async () => {
      await result.current.start({
        targetLaps: 1,
        calibrationMs: 0,
        lapDebounceMs: 0,
      });
    });
    await waitFor(() => {
      expect(blePlx.__getLastManager()).toBeDefined();
    });

    emitNearA();
    await tickOnce();
    emitNearA();
    await tickOnce();
    await simulateOneLap();

    await waitFor(() => {
      expect(result.current.state.phase).toBe('finished');
    });

    // Lap haptic still fires (haptics don't need permission), but no
    // notification gets scheduled.
    expect(NotificationsMock.__getScheduledNotifications().length).toBe(0);
  });
});

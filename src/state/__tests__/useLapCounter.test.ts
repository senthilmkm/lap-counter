import { act, renderHook, waitFor } from '@testing-library/react-native';

import * as expoSensorsRaw from 'expo-sensors';
import * as ble from 'react-native-ble-plx';
import * as keepAwake from 'expo-keep-awake';
import * as Haptics from 'expo-haptics';
import * as Notifications from 'expo-notifications';
import * as BackgroundFetch from 'expo-background-fetch';
import * as TaskManager from 'expo-task-manager';

import { useLapCounter } from '../useLapCounter';
import { __resetForTests as __resetBleScanner } from '../../sensors/bleScanner';
import { BACKGROUND_TASK_NAME } from '../../services/backgroundTask';
import type { DetectorState } from '../../logic/lapDetector';

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
  __setAvailable: (available: boolean) => void;
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
const { Magnetometer, DeviceMotion, Pedometer, __resetAllSensors } = expoSensors;

const blePlx = ble as unknown as typeof ble & {
  __getLastManager: () => {
    __emitDevice: (d: { id: string; rssi: number }) => void;
    startDeviceScan: jest.Mock;
    stopDeviceScan: jest.Mock;
  };
  __resetManagers: () => void;
};

const HapticsMock = Haptics as unknown as typeof Haptics & {
  __getHapticCalls: () => ReadonlyArray<{ kind: string; arg?: string }>;
  __resetHaptics: () => void;
};
const NotificationsMock = Notifications as unknown as typeof Notifications & {
  __setPermission: (next: { granted?: boolean; status?: string; canAskAgain?: boolean }) => void;
  __getScheduledNotifications: () => ReadonlyArray<{ id: string; content: { body?: string }; trigger: unknown }>;
  __resetNotifications: () => void;
};
const BackgroundFetchMock = BackgroundFetch as unknown as typeof BackgroundFetch & {
  __setStatus: (next: number) => void;
  __getRegistrations: () => ReadonlyArray<{ name: string; opts: unknown }>;
  __resetBackgroundFetch: () => void;
};
const TaskManagerMock = TaskManager as unknown as typeof TaskManager & {
  __resetTaskRegistrations: () => void;
  __getDefinedTaskNames: () => string[];
  __markRegistered: (name: string) => void;
  __markUnregistered: (name: string) => void;
};

beforeEach(() => {
  jest.useFakeTimers({ doNotFake: ['performance', 'queueMicrotask'] });
  __resetAllSensors();
  blePlx.__resetManagers();
  __resetBleScanner();
  HapticsMock.__resetHaptics();
  NotificationsMock.__resetNotifications();
  // Pre-grant notification permission so the hook's notify path completes
  // without an interactive prompt during tests.
  NotificationsMock.__setPermission({
    granted: true,
    status: 'granted',
    canAskAgain: false,
  });
  // Reset background-fetch state, but keep the task definition itself —
  // it was registered at module load time and shouldn't be wiped.
  BackgroundFetchMock.__resetBackgroundFetch();
  TaskManagerMock.__resetTaskRegistrations();
  (keepAwake.activateKeepAwakeAsync as jest.Mock).mockClear();
  (keepAwake.deactivateKeepAwake as jest.Mock).mockClear();
});

afterEach(() => {
  jest.useRealTimers();
});

describe('useLapCounter', () => {
  it('starts in idle and exposes a default config', () => {
    const { result } = renderHook(() => useLapCounter());
    expect(result.current.state.phase).toBe('idle');
    expect(result.current.state.count).toBe(0);
    expect(result.current.defaultConfig.targetLaps).toBe(10);
  });

  it('start() activates keep-awake, subscribes to sensors, and enters calibrating', async () => {
    const { result } = renderHook(() => useLapCounter());

    await act(async () => {
      await result.current.start({ targetLaps: 3 });
    });

    expect(keepAwake.activateKeepAwakeAsync).toHaveBeenCalledTimes(1);
    expect(Magnetometer.setUpdateInterval).toHaveBeenCalled();
    expect(DeviceMotion.setUpdateInterval).toHaveBeenCalled();
    expect(Pedometer.isAvailableAsync).toHaveBeenCalled();
    await waitFor(() => {
      const m = blePlx.__getLastManager();
      expect(m).toBeDefined();
      expect(m.startDeviceScan).toHaveBeenCalledTimes(1);
    });
    expect(result.current.state.phase).toBe('calibrating');
    expect(result.current.state.config.targetLaps).toBe(3);
  });

  it('stop() tears down BLE scan and deactivates keep-awake', async () => {
    const { result } = renderHook(() => useLapCounter());

    await act(async () => {
      await result.current.start();
    });

    await waitFor(() => {
      expect(blePlx.__getLastManager()).toBeDefined();
    });

    await act(async () => {
      await result.current.stop();
    });

    const manager = blePlx.__getLastManager();
    expect(manager.stopDeviceScan).toHaveBeenCalled();
    expect(keepAwake.deactivateKeepAwake).toHaveBeenCalled();
    expect(result.current.state.phase).toBe('idle');
    expect(BackgroundFetch.unregisterTaskAsync).toHaveBeenCalledWith(
      BACKGROUND_TASK_NAME
    );
  });

  it('registers the background task on start and unregisters on stop', async () => {
    const { result } = renderHook(() => useLapCounter());

    await act(async () => {
      await result.current.start({ targetLaps: 3 });
    });
    await waitFor(() => {
      const regs = BackgroundFetchMock.__getRegistrations();
      expect(regs.map((r) => r.name)).toContain(BACKGROUND_TASK_NAME);
    });

    await act(async () => {
      await result.current.stop();
    });
    expect(BackgroundFetch.unregisterTaskAsync).toHaveBeenCalledWith(
      BACKGROUND_TASK_NAME
    );
  });

  it('does not crash when background fetch is denied', async () => {
    BackgroundFetchMock.__setStatus(
      BackgroundFetch.BackgroundFetchStatus.Denied
    );
    const { result } = renderHook(() => useLapCounter());

    await act(async () => {
      await result.current.start({ targetLaps: 3 });
    });
    await waitFor(() => {
      expect(result.current.state.phase).toBe('calibrating');
    });
    expect(BackgroundFetch.registerTaskAsync).not.toHaveBeenCalled();
  });

  it('cancels pending notifications on stop and reset', async () => {
    const { result } = renderHook(() => useLapCounter());

    await act(async () => {
      await result.current.start({ targetLaps: 3 });
    });

    await act(async () => {
      await result.current.stop();
    });
    expect(
      Notifications.cancelAllScheduledNotificationsAsync
    ).toHaveBeenCalled();

    await act(async () => {
      await result.current.start({ targetLaps: 3 });
    });
    await act(async () => {
      await result.current.reset();
    });
    expect(
      Notifications.cancelAllScheduledNotificationsAsync
    ).toHaveBeenCalledTimes(2);
  });

  it('feeds aggregated BLE observations into the reducer on each tick', async () => {
    const { result } = renderHook(() => useLapCounter());

    await act(async () => {
      await result.current.start({ targetLaps: 5 });
    });
    await waitFor(() => {
      expect(blePlx.__getLastManager()).toBeDefined();
    });

    const manager = blePlx.__getLastManager();
    Magnetometer.__emit({ x: 30, y: 30, z: 30 });
    manager.__emitDevice({ id: 'router-1', rssi: -55 });
    manager.__emitDevice({ id: 'airpods-2', rssi: -62 });
    manager.__emitDevice({ id: 'tv-3', rssi: -78 });

    await act(async () => {
      jest.advanceTimersByTime(1000);
    });

    expect(['calibrating', 'armed']).toContain(result.current.state.phase);
  });

  it('fires lap haptic + finishes session + posts notification at target', async () => {
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
    const manager = blePlx.__getLastManager();

    const NEAR_IDS = [
      'router-1',
      'airpods-2',
      'watch-3',
      'tv-4',
      'cardio-5',
      'phone-6',
      'speaker-7',
      'ipad-8',
    ];
    const FAR_IDS = ['far-1', 'far-2', 'far-3', 'far-4'];

    function emitNearA() {
      Magnetometer.__emit({ x: 30, y: 30, z: 30 });
      for (const id of NEAR_IDS) manager.__emitDevice({ id, rssi: -60 });
    }
    function emitFar() {
      Magnetometer.__emit({ x: 70, y: 30, z: 30 });
      for (const id of FAR_IDS) manager.__emitDevice({ id, rssi: -75 });
    }
    async function tickOnce() {
      await act(async () => {
        jest.advanceTimersByTime(1000);
      });
    }

    // Calibration: 2 near ticks so pointA is solid.
    emitNearA();
    await tickOnce();
    emitNearA();
    await tickOnce();

    // Walk away — 7 FAR ticks so the aggregator is fully FAR.
    for (let i = 0; i < 7; i++) {
      emitFar();
      await tickOnce();
    }
    // Walk back — 7 NEAR ticks. The aggregator's 5s sliding window
    // means FAR IDs only fully drop ~6 NEAR ticks after the last
    // FAR emission, so we need >=6 NEAR ticks for sim to reach 1.
    for (let i = 0; i < 7; i++) {
      emitNearA();
      await tickOnce();
    }

    await waitFor(() => {
      expect(result.current.state.phase).toBe('finished');
      expect(result.current.state.count).toBe(1);
    });

    const hapticCalls = HapticsMock.__getHapticCalls();
    expect(
      hapticCalls.some(
        (c) => c.kind === 'impact' && c.arg === Haptics.ImpactFeedbackStyle.Medium
      )
    ).toBe(true);
    expect(
      hapticCalls.some(
        (c) =>
          c.kind === 'notification' &&
          c.arg === Haptics.NotificationFeedbackType.Success
      )
    ).toBe(true);

    const queue = NotificationsMock.__getScheduledNotifications();
    expect(queue.length).toBe(1);
    expect(queue[0].content.body).toMatch(/1.*1/);
  });

  it('completes calibration after ~5s and ends up armed with a populated pointA', async () => {
    const { result } = renderHook(() => useLapCounter());
    await act(async () => {
      await result.current.start({ targetLaps: 3 });
    });
    await waitFor(() => {
      expect(blePlx.__getLastManager()).toBeDefined();
    });

    const manager = blePlx.__getLastManager();
    Magnetometer.__emit({ x: 30, y: 30, z: 30 });
    for (const id of ['router-1', 'airpods-2', 'watch-3', 'tv-4', 'cardio-5']) {
      manager.__emitDevice({ id, rssi: -60 });
    }

    for (let i = 0; i < 7; i++) {
      Magnetometer.__emit({ x: 30, y: 30, z: 30 });
      manager.__emitDevice({ id: 'router-1', rssi: -55 });
      manager.__emitDevice({ id: 'airpods-2', rssi: -62 });
      manager.__emitDevice({ id: 'watch-3', rssi: -70 });
      manager.__emitDevice({ id: 'tv-4', rssi: -78 });
      manager.__emitDevice({ id: 'cardio-5', rssi: -82 });
      await act(async () => {
        jest.advanceTimersByTime(1000);
      });
    }

    expect(result.current.state.phase).toBe('armed');
    // Default mode is indoor — cast since the hook's state union isn't
    // narrowed by the mode discriminator at the type level.
    const indoor = result.current.state as DetectorState;
    expect(indoor.pointA.bleDevices.size).toBeGreaterThan(0);
  });
});

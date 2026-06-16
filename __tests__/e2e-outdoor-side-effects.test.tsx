/**
 * Hook-level e2e for OUTDOOR mode: drives a complete GPS session through
 * useLapCounter with mocked expo-location, expo-haptics, expo-notifications,
 * expo-task-manager, expo-background-fetch — verifying every side effect
 * fires correctly.
 */

import { act, renderHook, waitFor } from '@testing-library/react-native';

import * as Location from 'expo-location';
import * as Haptics from 'expo-haptics';
import * as Notifications from 'expo-notifications';
import * as BackgroundFetch from 'expo-background-fetch';
import * as TaskManager from 'expo-task-manager';

import { useLapCounter } from '../src/state/useLapCounter';
import { __resetForTests as __resetBleScanner } from '../src/sensors/bleScanner';
import * as expoSensorsRaw from 'expo-sensors';

const { __resetAllSensors } = expoSensorsRaw as unknown as {
  __resetAllSensors: () => void;
};

const LocationMock = Location as unknown as typeof Location & {
  __setForegroundPermission: (next: { granted?: boolean; status?: string; canAskAgain?: boolean }) => void;
  __setBackgroundPermission: (next: { granted?: boolean; status?: string; canAskAgain?: boolean }) => void;
  __setServicesEnabled: (enabled: boolean) => void;
  __emitPosition: (opts: { latitude: number; longitude: number; accuracy?: number }) => void;
  __getActiveWatchers: () => number;
  __resetLocation: () => void;
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

// Point A — fictional NYC coordinates.
const POINT_A = { latitude: 40.7128, longitude: -74.006 };

function offsetMeters(northM: number, eastM: number) {
  const dLat = northM / 111_111;
  const dLon = eastM / (111_111 * Math.cos((POINT_A.latitude * Math.PI) / 180));
  return {
    latitude: POINT_A.latitude + dLat,
    longitude: POINT_A.longitude + dLon,
  };
}

beforeEach(() => {
  jest.useFakeTimers({ doNotFake: ['performance', 'queueMicrotask'] });
  __resetAllSensors();
  __resetBleScanner();
  LocationMock.__resetLocation();
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

describe('useLapCounter — outdoor mode', () => {
  it('start({ mode: "outdoor" }) requests location permission and subscribes to GPS', async () => {
    const { result } = renderHook(() => useLapCounter());

    await act(async () => {
      await result.current.start({
        mode: 'outdoor',
        targetLaps: 3,
        calibrationMs: 0,
      });
    });

    expect(result.current.mode).toBe('outdoor');
    expect(Location.requestForegroundPermissionsAsync).toHaveBeenCalled();
    await waitFor(() => {
      expect(LocationMock.__getActiveWatchers()).toBe(1);
    });
    expect(result.current.state.phase).toBe('calibrating');
  });

  it('records an error and stays idle when foreground permission is denied', async () => {
    LocationMock.__setForegroundPermission({
      granted: false,
      status: 'denied',
      canAskAgain: false,
    });
    const { result } = renderHook(() => useLapCounter());

    await act(async () => {
      await result.current.start({
        mode: 'outdoor',
        targetLaps: 3,
        calibrationMs: 0,
      });
    });
    expect(result.current.error).not.toBeNull();
    expect(result.current.error?.message).toMatch(/permission/i);
    expect(result.current.state.phase).toBe('idle');
    expect(LocationMock.__getActiveWatchers()).toBe(0);
  });

  it('completes a 1-lap GPS session: counts lap, fires haptic, posts notification', async () => {
    const { result } = renderHook(() => useLapCounter());

    await act(async () => {
      await result.current.start({
        mode: 'outdoor',
        targetLaps: 1,
        calibrationMs: 0,
        lapDebounceMs: 0,
        nearRadiusM: 15,
        farRadiusM: 30,
      });
    });
    await waitFor(() => {
      expect(LocationMock.__getActiveWatchers()).toBe(1);
    });

    // Calibration: a single fix at A completes calibration (calibrationMs=0).
    await act(async () => {
      LocationMock.__emitPosition({ ...POINT_A, accuracy: 5 });
    });
    // Walk away ~50m east.
    await act(async () => {
      LocationMock.__emitPosition({ ...offsetMeters(0, 50), accuracy: 5 });
    });
    // Approaching ~22m east.
    await act(async () => {
      LocationMock.__emitPosition({ ...offsetMeters(0, 22), accuracy: 5 });
    });
    // Back at A → lap counted.
    await act(async () => {
      LocationMock.__emitPosition({ ...POINT_A, accuracy: 5 });
    });

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

  it('counts a 3-lap GPS session and fires the lap haptic for each lap', async () => {
    const { result } = renderHook(() => useLapCounter());

    await act(async () => {
      await result.current.start({
        mode: 'outdoor',
        targetLaps: 3,
        calibrationMs: 0,
        lapDebounceMs: 0,
        nearRadiusM: 15,
        farRadiusM: 30,
      });
    });
    await waitFor(() => {
      expect(LocationMock.__getActiveWatchers()).toBe(1);
    });

    // Calibration tick.
    await act(async () => {
      LocationMock.__emitPosition({ ...POINT_A, accuracy: 5 });
    });

    for (let lap = 0; lap < 3; lap++) {
      await act(async () => {
        LocationMock.__emitPosition({ ...offsetMeters(0, 50), accuracy: 5 });
      });
      await act(async () => {
        LocationMock.__emitPosition({ ...offsetMeters(0, 22), accuracy: 5 });
      });
      await act(async () => {
        LocationMock.__emitPosition({ ...POINT_A, accuracy: 5 });
      });
    }

    await waitFor(() => {
      expect(result.current.state.phase).toBe('finished');
      expect(result.current.state.count).toBe(3);
    });

    const lapImpacts = HapticsMock.__getHapticCalls().filter(
      (c) => c.kind === 'impact' && c.arg === Haptics.ImpactFeedbackStyle.Medium
    );
    expect(lapImpacts.length).toBe(3);
  });

  it('does not subscribe to BLE/motion sensors in outdoor mode', async () => {
    const { result } = renderHook(() => useLapCounter());

    await act(async () => {
      await result.current.start({ mode: 'outdoor', targetLaps: 2 });
    });
    await waitFor(() => {
      expect(LocationMock.__getActiveWatchers()).toBe(1);
    });
    // Only GPS is active; BLE / Magnetometer / DeviceMotion / Pedometer
    // listeners shouldn't have been wired up.
    const sensors = expoSensorsRaw as unknown as {
      Magnetometer: { addListener: jest.Mock };
      DeviceMotion: { addListener: jest.Mock };
      Pedometer: { isAvailableAsync: jest.Mock };
    };
    expect(sensors.Magnetometer.addListener).not.toHaveBeenCalled();
    expect(sensors.DeviceMotion.addListener).not.toHaveBeenCalled();
    expect(sensors.Pedometer.isAvailableAsync).not.toHaveBeenCalled();
  });

  it('stops the GPS watcher on stop() and reset()', async () => {
    const { result } = renderHook(() => useLapCounter());

    await act(async () => {
      await result.current.start({ mode: 'outdoor', targetLaps: 5 });
    });
    await waitFor(() => {
      expect(LocationMock.__getActiveWatchers()).toBe(1);
    });

    await act(async () => {
      await result.current.stop();
    });
    expect(LocationMock.__getActiveWatchers()).toBe(0);

    await act(async () => {
      await result.current.start({ mode: 'outdoor', targetLaps: 5 });
    });
    await waitFor(() => {
      expect(LocationMock.__getActiveWatchers()).toBe(1);
    });
    await act(async () => {
      await result.current.reset();
    });
    expect(LocationMock.__getActiveWatchers()).toBe(0);
  });

  it('switches mode while idle but not while running', async () => {
    const { result } = renderHook(() => useLapCounter());

    expect(result.current.mode).toBe('indoor');
    act(() => result.current.setMode('outdoor'));
    expect(result.current.mode).toBe('outdoor');
    act(() => result.current.setMode('indoor'));
    expect(result.current.mode).toBe('indoor');

    // Start a session (still indoor) then attempt to switch — should be refused.
    await act(async () => {
      await result.current.start({ mode: 'indoor', targetLaps: 5 });
    });
    act(() => result.current.setMode('outdoor'));
    expect(result.current.mode).toBe('indoor');

    await act(async () => {
      await result.current.reset();
    });
    act(() => result.current.setMode('outdoor'));
    expect(result.current.mode).toBe('outdoor');
  });
});

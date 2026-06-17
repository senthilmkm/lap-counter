import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import { useCallback, useEffect, useReducer, useRef, useState } from 'react';

import {
  BleAggregator,
  BleScannerHandle,
  startBleScan,
} from '../sensors/bleScanner';
import {
  MotionTrackerHandle,
  startMotionTracker,
} from '../sensors/motionTracker';
import {
  LocationTrackerHandle,
  ensureLocationPermission,
  startLocationTracking,
} from '../sensors/locationTracker';
import {
  createInitialState,
  DEFAULT_CONFIG,
  DetectorConfig,
  DetectorState,
  reducer,
  statusLabel,
} from '../logic/lapDetector';
import {
  createInitialOutdoorState,
  DEFAULT_OUTDOOR_CONFIG,
  OutdoorDetectorConfig,
  OutdoorDetectorState,
  outdoorReducer,
  outdoorStatusLabel,
} from '../logic/outdoorLapDetector';
import { lapHaptic, targetReachedHaptic } from '../services/haptics';
import {
  cancelAllNotifications,
  ensureNotificationPermission,
  installForegroundHandler,
  notifyTargetReached,
} from '../services/notifications';
import {
  registerBackgroundTask,
  unregisterBackgroundTask,
} from '../services/backgroundTask';

const KEEP_AWAKE_TAG = 'lap-counter-session';
const TICK_INTERVAL_MS = 1000;

export type SessionError = { message: string };

/**
 * Where the user is walking. `indoor` uses BLE+magnetic+IMU fingerprinting;
 * `outdoor` uses GPS positioning.
 */
export type LapMode = 'indoor' | 'outdoor';

export type ActiveDetectorState = DetectorState | OutdoorDetectorState;

/**
 * Combined config accepted by `start()`. The `mode` field is optional:
 * if omitted, the current mode (set via `setMode`) is used. Mode-specific
 * fields are forwarded to the matching reducer.
 */
export type StartConfig = {
  mode?: LapMode;
  disableBle?: boolean;
} & Partial<DetectorConfig> &
  Partial<OutdoorDetectorConfig>;

/**
 * React hook that owns the entire session lifecycle for either mode:
 *
 *   indoor  → BLE fingerprinting + magnetometer + IMU
 *   outdoor → GPS positioning (Haversine distance from start point)
 *
 * Both modes share the side-effect plumbing (haptics, notifications,
 * background-fetch task, keep-awake) so the user-facing UX is uniform
 * regardless of which sensors are active under the hood.
 */
export function useLapCounter() {
  const [mode, _setMode] = useState<LapMode>('indoor');
  const [indoorState, indoorDispatch] = useReducer(reducer, undefined, () =>
    createInitialState()
  );
  const [outdoorState, outdoorDispatch] = useReducer(
    outdoorReducer,
    undefined,
    () => createInitialOutdoorState()
  );

  const activeState: ActiveDetectorState =
    mode === 'indoor' ? indoorState : outdoorState;
  const activeStatus =
    mode === 'indoor'
      ? statusLabel(indoorState)
      : outdoorStatusLabel(outdoorState);

  const bleHandleRef = useRef<BleScannerHandle | null>(null);
  const motionHandleRef = useRef<MotionTrackerHandle | null>(null);
  const locationHandleRef = useRef<LocationTrackerHandle | null>(null);
  const aggregatorRef = useRef<BleAggregator>(new BleAggregator(5000));
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const errorRef = useRef<SessionError | null>(null);
  const startingRef = useRef(false);
  const lastHapticCount = useRef(0);
  const targetNotifiedRef = useRef(false);
  const disableBleRef = useRef(false);

  const [sessionStartTs, setSessionStartTs] = useState<number | null>(null);
  const [sessionEndTs, setSessionEndTs] = useState<number | null>(null);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);

  useEffect(() => {
    installForegroundHandler();
  }, []);

  const teardown = useCallback(async () => {
    if (tickRef.current) {
      clearInterval(tickRef.current);
      tickRef.current = null;
    }
    bleHandleRef.current?.stop();
    bleHandleRef.current = null;
    motionHandleRef.current?.stop();
    motionHandleRef.current = null;
    if (locationHandleRef.current) {
      try {
        await locationHandleRef.current.stop();
      } catch {
        // ignore — best-effort teardown
      }
      locationHandleRef.current = null;
    }
    aggregatorRef.current.reset();
    deactivateKeepAwake(KEEP_AWAKE_TAG);
    await unregisterBackgroundTask();
  }, []);

  /**
   * Switch between indoor and outdoor BEFORE a session starts. Switching
   * mid-session would mix detector states; callers must `reset()` first.
   */
  const setMode = useCallback(
    (next: LapMode) => {
      if (next === mode) return;
      if (indoorState.phase !== 'idle' || outdoorState.phase !== 'idle') {
        // Refuse silently — caller should stop / reset before switching.
        return;
      }
      _setMode(next);
    },
    [mode, indoorState.phase, outdoorState.phase]
  );

  const start = useCallback(
    async (config?: StartConfig) => {
      if (startingRef.current) return;
      startingRef.current = true;
      errorRef.current = null;
      lastHapticCount.current = 0;
      targetNotifiedRef.current = false;
      disableBleRef.current = config?.disableBle ?? false;
      setSessionStartTs(Date.now());
      setSessionEndTs(null);
      setElapsedSeconds(0);

      const requestedMode = config?.mode ?? mode;
      if (requestedMode !== mode) _setMode(requestedMode);

      try {
        await activateKeepAwakeAsync(KEEP_AWAKE_TAG);
        void ensureNotificationPermission();
        void registerBackgroundTask();

        if (requestedMode === 'indoor') {
          const motion = await startMotionTracker();
          motionHandleRef.current = motion;
          
          if (!disableBleRef.current) {
            try {
              const ble = await startBleScan(
                (obs) => aggregatorRef.current.add(obs),
                (err) => {
                  console.warn('BLE scanning error:', err.message);
                }
              );
              bleHandleRef.current = ble;
            } catch (bleError) {
              console.log('Bluetooth unavailable, running in BLE-Free MIF Mode:', bleError);
              bleHandleRef.current = null;
            }
          }

          indoorDispatch({
            type: 'start',
            config: config as Partial<DetectorConfig> | undefined,
          });

          tickRef.current = setInterval(() => {
            const motionSnap = motionHandleRef.current?.snapshot();
            if (!motionSnap) return;
            const bleSnap = disableBleRef.current ? new Map<string, number>() : aggregatorRef.current.snapshot();
            indoorDispatch({
              type: 'tick',
              input: {
                now: Date.now(),
                observation: {
                  bleDevices: bleSnap,
                  magneticMagnitude: motionSnap.magneticMagnitude,
                },
                displacementMagnitude: motionSnap.displacementMagnitude,
                gyroZRate: motionSnap.gyroZRate,
                gyroYaw: motionSnap.gyroYaw,
                steps: motionSnap.steps,
              },
            });
          }, TICK_INTERVAL_MS);
        } else {
          const perm = await ensureLocationPermission();
          if (!perm.foreground) {
            throw new Error(
              'Location permission denied. Outdoor mode needs GPS access.'
            );
          }
          outdoorDispatch({
            type: 'start',
            config: config as Partial<OutdoorDetectorConfig> | undefined,
          });

          const tracker = await startLocationTracking(
            (point) => {
              outdoorDispatch({
                type: 'tick',
                input: { now: Date.now(), position: point },
              });
            },
            (err) => {
              errorRef.current = { message: err.message };
            }
          );
          locationHandleRef.current = tracker;
        }
      } catch (err) {
        errorRef.current = {
          message: err instanceof Error ? err.message : String(err),
        };
        await teardown();
        indoorDispatch({ type: 'reset' });
        outdoorDispatch({ type: 'reset' });
        setSessionStartTs(null);
        setSessionEndTs(null);
      } finally {
        startingRef.current = false;
      }
    },
    [mode, teardown]
  );

  const stop = useCallback(async () => {
    const isRunning = activeState.phase !== 'idle' && activeState.phase !== 'finished';
    if (isRunning) {
      setSessionEndTs(Date.now());
    }
    await teardown();
    await cancelAllNotifications();
    indoorDispatch({ type: 'stop' });
    outdoorDispatch({ type: 'stop' });
  }, [teardown, activeState.phase]);

  const reset = useCallback(async () => {
    setSessionStartTs(null);
    setSessionEndTs(null);
    setElapsedSeconds(0);
    await teardown();
    await cancelAllNotifications();
    indoorDispatch({ type: 'reset' });
    outdoorDispatch({ type: 'reset' });
  }, [teardown]);

  // Keep a running clock while a session is walking
  useEffect(() => {
    let clockTimer: ReturnType<typeof setInterval> | null = null;
    const isRunning =
      activeState.phase !== 'idle' &&
      activeState.phase !== 'finished';

    if (isRunning && sessionStartTs) {
      clockTimer = setInterval(() => {
        setElapsedSeconds(Math.floor((Date.now() - sessionStartTs) / 1000));
      }, 1000);
    } else if (activeState.phase === 'idle') {
      setElapsedSeconds(0);
    }
    return () => {
      if (clockTimer) clearInterval(clockTimer);
    };
  }, [activeState.phase, sessionStartTs]);

  // After each counted lap (in either mode): zero motion baseline + haptic.
  // Triggered by `count` change rather than `lastLapAt` so the haptic
  // fires reliably even when consecutive laps share a `Date.now()` value
  // (which happens in tests using fake timers).
  useEffect(() => {
    if (activeState.count > lastHapticCount.current) {
      lastHapticCount.current = activeState.count;
      if (mode === 'indoor') motionHandleRef.current?.resetBaseline();
      void lapHaptic();
    }
  }, [activeState.count, mode]);

  // Target reached: stop sensors, fire success haptic + notification.
  useEffect(() => {
    if (activeState.phase === 'finished') {
      setSessionEndTs(Date.now());
      if (tickRef.current) {
        clearInterval(tickRef.current);
        tickRef.current = null;
      }
      bleHandleRef.current?.stop();
      bleHandleRef.current = null;
      motionHandleRef.current?.stop();
      motionHandleRef.current = null;
      if (locationHandleRef.current) {
        void locationHandleRef.current.stop();
        locationHandleRef.current = null;
      }
      aggregatorRef.current.reset();
      deactivateKeepAwake(KEEP_AWAKE_TAG);
      void unregisterBackgroundTask();

      if (!targetNotifiedRef.current) {
        targetNotifiedRef.current = true;
        void targetReachedHaptic();
        void notifyTargetReached(
          activeState.count,
          activeState.config.targetLaps
        );
      }
    }
  }, [activeState.phase, activeState.count, activeState.config.targetLaps]);

  useEffect(() => {
    return () => {
      void teardown();
    };
  }, [teardown]);

  return {
    mode,
    setMode,
    state: activeState,
    status: activeStatus,
    error: errorRef.current,
    start,
    stop,
    reset,
    defaultIndoorConfig: DEFAULT_CONFIG,
    defaultOutdoorConfig: DEFAULT_OUTDOOR_CONFIG,
    /** Backwards-compat alias for callers that don't care about mode. */
    defaultConfig: mode === 'indoor' ? DEFAULT_CONFIG : DEFAULT_OUTDOOR_CONFIG,
    sessionStartTs,
    sessionEndTs,
    elapsedSeconds,
  };
}

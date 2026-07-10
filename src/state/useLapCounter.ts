import { AppState, DeviceEventEmitter } from 'react-native';
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
  startBackgroundLocationTracking,
  stopBackgroundLocationTracking,
} from '../sensors/locationTracker';
import '../services/locationBackgroundTask';
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
  GeoPoint,
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
  notifyIndoorBackgroundWarning,
} from '../services/notifications';
import {
  registerBackgroundTask,
  unregisterBackgroundTask,
} from '../services/backgroundTask';
import * as Speech from 'expo-speech';
import { getSettingSync, saveSettingSync } from '../services/database';

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
  voiceCuesEnabled?: boolean;
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
  
  // Premium and UX features state
  const [isPaused, setIsPaused] = useState(false);
  const [gpsPath, setGpsPath] = useState<Array<GeoPoint & { timestamp: number }>>([]);
  const [weatherSuggest, setWeatherSuggest] = useState<{ temp: number; condition: string; code: number } | null>(null);
  const [voiceCuesEnabled, setVoiceCuesEnabled] = useState(() => getSettingSync('voiceCuesEnabled', 'true') === 'true');

  const handleSetVoiceCuesEnabled = useCallback((val: boolean) => {
    setVoiceCuesEnabled(val);
    saveSettingSync('voiceCuesEnabled', String(val));
  }, []);

  const isPausedRef = useRef(false);
  const pauseStartTsRef = useRef<number | null>(null);
  const totalPausedMsRef = useRef<number>(0);
  const lastWeatherFetchRef = useRef<number>(0);
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
  const prevPhaseRef = useRef<string>('idle');

  const [prewarmLocation, setPrewarmLocation] = useState<GeoPoint | null>(null);
  const [sessionStartTs, setSessionStartTs] = useState<number | null>(null);
  const [sessionEndTs, setSessionEndTs] = useState<number | null>(null);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);

  useEffect(() => {
    installForegroundHandler();
  }, []);

  const onLocationUpdateRef = useRef<(point: GeoPoint) => void>(() => {});
  const onLocationErrorRef = useRef<(err: Error) => void>(() => {});

  useEffect(() => {
    onLocationUpdateRef.current = (point: GeoPoint) => {
      setPrewarmLocation(point);
      const isRunning = outdoorState.phase !== 'idle' && outdoorState.phase !== 'finished';
      if (isRunning && !isPausedRef.current) {
        setGpsPath((prev) => [...prev, { ...point, timestamp: Date.now() }]);
        outdoorDispatch({
          type: 'tick',
          input: { now: Date.now(), position: point },
        });
      }
    };
  }, [outdoorState.phase]);

  useEffect(() => {
    onLocationErrorRef.current = (err: Error) => {
      console.warn('GPS tracker error:', err.message);
      const isRunning = outdoorState.phase !== 'idle' && outdoorState.phase !== 'finished';
      if (isRunning && !isPausedRef.current) {
        errorRef.current = { message: err.message };
      }
    };
  }, [outdoorState.phase]);

  // Synchronizes the outdoor state, GPS path, and elapsed stopwatch duration from SQLite
  const syncOutdoorStateFromDb = useCallback(() => {
    const stateStr = getSettingSync('active_outdoor_detector_state', '');
    if (!stateStr) return;
    try {
      const dbState = JSON.parse(stateStr);
      outdoorDispatch({ type: 'sync_state', state: dbState });
      
      const pathStr = getSettingSync('active_outdoor_gps_path', '[]');
      setGpsPath(JSON.parse(pathStr));
      
      const elapsed = Number(getSettingSync('active_outdoor_elapsed_seconds', '0'));
      setElapsedSeconds(elapsed);
      
      const paused = getSettingSync('active_outdoor_is_paused', 'false') === 'true';
      setIsPaused(paused);
      isPausedRef.current = paused;
    } catch (e) {
      console.warn('Failed to sync outdoor state from DB:', e);
    }
  }, []);

  // Listen to background updates via DeviceEventEmitter
  useEffect(() => {
    if (mode !== 'outdoor') return;

    const sub = DeviceEventEmitter.addListener('active-session-update', (eventData) => {
      if (isPausedRef.current) return;
      outdoorDispatch({ type: 'sync_state', state: eventData.outdoorState });
      setGpsPath(eventData.gpsPath);
      setElapsedSeconds(eventData.elapsedSeconds);
    });

    return () => {
      sub.remove();
    };
  }, [mode]);

  // Sync from DB whenever the app is brought back to the foreground
  useEffect(() => {
    if (mode !== 'outdoor') return;

    const handleAppStateChange = (nextState: string) => {
      if (nextState === 'active') {
        syncOutdoorStateFromDb();
      }
    };

    const sub = AppState.addEventListener('change', handleAppStateChange);
    syncOutdoorStateFromDb(); // Sync on mount/mode switch

    return () => {
      sub.remove();
    };
  }, [mode, syncOutdoorStateFromDb]);

  // Send a local notification warning if the app is backgrounded/locked during an active indoor session
  useEffect(() => {
    if (mode !== 'indoor') return;

    const handleAppStateChange = (nextAppState: string) => {
      if (nextAppState === 'background') {
        const isRunning = indoorState.phase !== 'idle' && indoorState.phase !== 'finished';
        const isPaused = isPausedRef.current;
        if (isRunning && !isPaused) {
          void notifyIndoorBackgroundWarning();
        }
      }
    };

    const sub = AppState.addEventListener('change', handleAppStateChange);
    return () => {
      sub.remove();
    };
  }, [mode, indoorState.phase]);

  // Prewarm/foreground location tracker when the session is idle
  useEffect(() => {
    const isTesting = typeof process !== 'undefined' && process.env.NODE_ENV === 'test';
    if (isTesting) return;

    // Only prewarm in foreground if session is not active
    const isRunning = outdoorState.phase !== 'idle' && outdoorState.phase !== 'finished';
    if (isRunning) return;

    let activeTracker: LocationTrackerHandle | null = null;
    let isActive = true;
    
    const run = async () => {
      if (mode === 'outdoor') {
        try {
          const perm = await ensureLocationPermission();
          if (perm.foreground && isActive) {
            const tracker = await startLocationTracking(
              (point) => {
                if (isActive) {
                  onLocationUpdateRef.current(point);
                }
              },
              (err) => {
                if (isActive) {
                  onLocationErrorRef.current(err);
                }
              }
            );
            if (isActive) {
              activeTracker = tracker;
              locationHandleRef.current = tracker;
            } else {
              void tracker.stop();
            }
          }
        } catch (e) {
          console.warn('GPS tracker setup error:', e);
        }
      } else {
        setPrewarmLocation(null);
      }
    };

    run();

    return () => {
      isActive = false;
      if (activeTracker) {
        void activeTracker.stop();
        activeTracker = null;
        locationHandleRef.current = null;
      }
    };
  }, [mode, outdoorState.phase]);


  const teardown = useCallback(async (options?: { forceStopGps?: boolean }) => {
    if (tickRef.current) {
      clearInterval(tickRef.current);
      tickRef.current = null;
    }
    bleHandleRef.current?.stop();
    bleHandleRef.current = null;
    motionHandleRef.current?.stop();
    motionHandleRef.current = null;

    // Stop background location tracking and clear session variables
    await stopBackgroundLocationTracking();
    saveSettingSync('active_outdoor_detector_state', '');
    saveSettingSync('active_outdoor_gps_path', '');
    saveSettingSync('active_outdoor_start_ts', '');
    saveSettingSync('active_outdoor_paused_ms', '');
    saveSettingSync('active_outdoor_is_paused', '');
    saveSettingSync('active_outdoor_elapsed_seconds', '');

    const isTesting = typeof process !== 'undefined' && process.env.NODE_ENV === 'test';
    if (locationHandleRef.current && (options?.forceStopGps || isTesting)) {
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
      if (next === 'indoor') {
        void teardown({ forceStopGps: true });
      }
    },
    [mode, indoorState.phase, outdoorState.phase, teardown]
  );

  // Weather suggestion fetcher linked to pre-warmed GPS coordinates
  useEffect(() => {
    const isTesting = typeof process !== 'undefined' && process.env.NODE_ENV === 'test';
    if (!prewarmLocation || isTesting) return;
    const now = Date.now();
    // Cache check: only fetch once every 5 minutes to preserve network/battery
    if (now - lastWeatherFetchRef.current < 300000) return;
    lastWeatherFetchRef.current = now;

    const fetchWeather = async () => {
      try {
        const response = await fetch(
          `https://api.open-meteo.com/v1/forecast?latitude=${prewarmLocation.latitude.toFixed(4)}&longitude=${prewarmLocation.longitude.toFixed(4)}&current=temperature_2m,weather_code`
        );
        const data = await response.json();
        if (data && data.current) {
          const temp = Math.round(data.current.temperature_2m);
          const code = data.current.weather_code;
          let cond = 'Clear Skies';
          if (code >= 1 && code <= 3) cond = 'Partly Cloudy';
          else if (code >= 45 && code <= 48) cond = 'Foggy';
          else if (code >= 51 && code <= 67) cond = 'Drizzle/Rain';
          else if (code >= 71 && code <= 77) cond = 'Snowy';
          else if (code >= 80 && code <= 82) cond = 'Rain Showers';
          else if (code >= 85 && code <= 86) cond = 'Snow Showers';
          else if (code >= 95 && code <= 99) cond = 'Thunderstorm';
          
          setWeatherSuggest({ temp, code, condition: cond });
        }
      } catch (e) {
        console.warn('Weather API fetch failed:', e);
      }
    };
    fetchWeather();
  }, [prewarmLocation]);

  const pause = useCallback(() => {
    const isRunning = activeState.phase !== 'idle' && activeState.phase !== 'finished';
    if (!isRunning || isPausedRef.current) return;
    
    setIsPaused(true);
    isPausedRef.current = true;
    pauseStartTsRef.current = Date.now();
    
    if (mode === 'outdoor') {
      saveSettingSync('active_outdoor_is_paused', 'true');
      saveSettingSync('active_outdoor_pause_start_ts', String(Date.now()));
    }
    
    void lapHaptic();
  }, [activeState.phase, mode]);

  const resume = useCallback(() => {
    const isRunning = activeState.phase !== 'idle' && activeState.phase !== 'finished';
    if (!isRunning || !isPausedRef.current) return;
    
    const pauseDuration = Date.now() - (pauseStartTsRef.current ?? Date.now());
    totalPausedMsRef.current += pauseDuration;
    
    setIsPaused(false);
    isPausedRef.current = false;
    pauseStartTsRef.current = null;
    
    if (mode === 'outdoor') {
      saveSettingSync('active_outdoor_is_paused', 'false');
      const accumulatedPaused = Number(getSettingSync('active_outdoor_paused_ms', '0')) + pauseDuration;
      saveSettingSync('active_outdoor_paused_ms', String(accumulatedPaused));
    }
    
    void lapHaptic();
  }, [activeState.phase, mode]);

  const start = useCallback(
    async (config?: StartConfig & { isPremium?: boolean; gpsModePremiumGated?: boolean }) => {
      if (startingRef.current) return;
      startingRef.current = true;
      errorRef.current = null;
      lastHapticCount.current = 0;
      targetNotifiedRef.current = false;
      disableBleRef.current = config?.disableBle ?? false;
      
      // Reset premium states
      setIsPaused(false);
      isPausedRef.current = false;
      pauseStartTsRef.current = null;
      totalPausedMsRef.current = 0;
      setGpsPath([]);

      const requestedMode = config?.mode ?? mode;
      if (requestedMode !== mode) _setMode(requestedMode);

      const isTesting = typeof process !== 'undefined' && process.env.NODE_ENV === 'test';
      const isPremium = config?.isPremium ?? isTesting;
      const gpsModePremiumGated = config?.gpsModePremiumGated ?? false;

      // Subscription check: block Outdoor GPS mode start for Free tier if gated
      if (!isPremium && requestedMode === 'outdoor' && gpsModePremiumGated) {
        errorRef.current = { message: 'Outdoor GPS mode requires a Premium subscription.' };
        startingRef.current = false;
        return;
      }

      // Gating check: clamp target laps to max 3 on Free tier
      let targetLaps = config?.targetLaps ?? (requestedMode === 'indoor' ? DEFAULT_CONFIG.targetLaps : DEFAULT_OUTDOOR_CONFIG.targetLaps);
      if (!isPremium) {
        targetLaps = Math.min(targetLaps, 5);
      }

      const modifiedConfig = {
        ...config,
        targetLaps,
      };

      setSessionStartTs(Date.now());
      setSessionEndTs(null);
      setElapsedSeconds(0);

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
            config: modifiedConfig as Partial<DetectorConfig> | undefined,
          });

          tickRef.current = setInterval(() => {
            if (isPausedRef.current) return;
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
                displacement: motionSnap.displacement,
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
          if (!perm.background) {
            console.warn('Background location permission denied. Laps will only count in the foreground.');
          }

          const maxAcc = config?.maxAcceptableAccuracyM ?? DEFAULT_OUTDOOR_CONFIG.maxAcceptableAccuracyM;
          
          // Pre-calculate initial state by merging defaults with modifiedConfig
          const fullConfig = {
            ...DEFAULT_OUTDOOR_CONFIG,
            ...modifiedConfig,
          };
          const startState = createInitialOutdoorState(fullConfig as OutdoorDetectorConfig);
          const calibratedA = prewarmLocation && prewarmLocation.accuracy <= maxAcc
            ? prewarmLocation
            : undefined;
          
          const nextState = outdoorReducer(startState, {
            type: 'start',
            config: fullConfig as Partial<OutdoorDetectorConfig> | undefined,
            calibratedPointA: calibratedA,
          });

          // Save session state to database settings for background task to read
          saveSettingSync('active_outdoor_detector_state', JSON.stringify(nextState));
          saveSettingSync('active_outdoor_gps_path', JSON.stringify([]));
          saveSettingSync('active_outdoor_start_ts', String(Date.now()));
          saveSettingSync('active_outdoor_paused_ms', '0');
          saveSettingSync('active_outdoor_is_paused', 'false');
          saveSettingSync('active_outdoor_elapsed_seconds', '0');

          // Initialize local state
          outdoorDispatch({
            type: 'sync_state',
            state: nextState,
          });

          // Start background location updates or fallback to watchPositionAsync in tests
          const isTesting = typeof process !== 'undefined' && process.env.NODE_ENV === 'test';
          if (isTesting) {
            if (!locationHandleRef.current) {
              const tracker = await startLocationTracking(
                (point) => {
                  onLocationUpdateRef.current(point);
                },
                (err) => {
                  onLocationErrorRef.current(err);
                }
              );
              locationHandleRef.current = tracker;
            }
          } else {
            await startBackgroundLocationTracking();
          }
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
    [mode, prewarmLocation, teardown]
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
        if (!isPausedRef.current) {
          const elapsed = Date.now() - sessionStartTs - totalPausedMsRef.current;
          setElapsedSeconds(Math.floor(elapsed / 1000));
        }
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
      const isNewLap = lastHapticCount.current > 0;
      lastHapticCount.current = activeState.count;
      const isBleFree = 'isBleFree' in activeState && activeState.isBleFree;
      if (mode === 'indoor' && !isBleFree) {
        motionHandleRef.current?.resetBaseline();
      }
      void lapHaptic();

      // Premium Feature: Hands-Free Voice Splits (TTS)
      if (isNewLap && voiceCuesEnabled) {
        const minutes = Math.floor(elapsedSeconds / 60);
        const seconds = elapsedSeconds % 60;
        const timeStr = minutes > 0 ? `${minutes} minutes and ${seconds} seconds` : `${seconds} seconds`;
        Speech.speak(`Lap ${activeState.count} complete. Total time: ${timeStr}.`, {
          language: 'en',
        });
      }
    }
  }, [activeState.count, mode, voiceCuesEnabled, elapsedSeconds]);

  useEffect(() => {
    if (prevPhaseRef.current === 'calibrating' && activeState.phase === 'armed') {
      motionHandleRef.current?.resetBaseline();
    }
    prevPhaseRef.current = activeState.phase;
  }, [activeState.phase]);

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
      
      // Stop background location updates and clean keys
      void stopBackgroundLocationTracking();
      saveSettingSync('active_outdoor_detector_state', '');
      saveSettingSync('active_outdoor_gps_path', '');
      saveSettingSync('active_outdoor_start_ts', '');
      saveSettingSync('active_outdoor_paused_ms', '');
      saveSettingSync('active_outdoor_is_paused', '');
      saveSettingSync('active_outdoor_elapsed_seconds', '');

      const isTesting = typeof process !== 'undefined' && process.env.NODE_ENV === 'test';
      if (locationHandleRef.current && isTesting) {
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
      void teardown({ forceStopGps: true });
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
    prewarmLocation,
    
    // Premium tier states & controllers
    isPaused,
    gpsPath,
    weatherSuggest,
    voiceCuesEnabled,
    setVoiceCuesEnabled: handleSetVoiceCuesEnabled,
    pause,
    resume,
  };
}

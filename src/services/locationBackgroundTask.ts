import * as TaskManager from 'expo-task-manager';
import { DeviceEventEmitter } from 'react-native';
import { getSettingSync, saveSettingSync } from './database';
import {
  outdoorReducer,
  OutdoorDetectorState,
  GeoPoint,
} from '../logic/outdoorLapDetector';
import { notifyLapCompleted, notifyTargetReached } from './notifications';

export const BACKGROUND_LOCATION_TASK_NAME = 'com.senth.lapcounter.background-location';

export interface LocationTaskUpdate {
  coords: {
    latitude: number;
    longitude: number;
    accuracy: number;
  };
  timestamp: number;
}

if (typeof TaskManager.defineTask === 'function') {
  TaskManager.defineTask(BACKGROUND_LOCATION_TASK_NAME, async ({ data, error }) => {
    if (error) {
      console.warn('Background location task error:', error.message);
      return;
    }
    if (!data) return;

    const { locations } = data as { locations: LocationTaskUpdate[] };
    if (!locations || locations.length === 0) return;

    // Load active session flags
    const stateStr = getSettingSync('active_outdoor_detector_state', '');
    if (!stateStr) {
      // No active outdoor session
      return;
    }

    let state: OutdoorDetectorState;
    try {
      state = JSON.parse(stateStr);
    } catch (e) {
      console.warn('Failed to parse active outdoor detector state in background:', e);
      return;
    }

    // If session is already finished or idle, ignore location updates
    if (state.phase === 'idle' || state.phase === 'finished') {
      return;
    }

    // Load path and timing settings
    const pathStr = getSettingSync('active_outdoor_gps_path', '[]');
    let gpsPath: Array<GeoPoint & { timestamp: number }> = [];
    try {
      gpsPath = JSON.parse(pathStr);
    } catch {
      gpsPath = [];
    }

    const sessionStartTs = Number(getSettingSync('active_outdoor_start_ts', '0'));
    const totalPausedMs = Number(getSettingSync('active_outdoor_paused_ms', '0'));
    const isPaused = getSettingSync('active_outdoor_is_paused', 'false') === 'true';

    // If session is paused, we don't process lap ticks (same behavior as foreground)
    if (isPaused) {
      return;
    }

    let stateChanged = false;
    let lapIncremented = false;
    const oldLapCount = state.count;

    for (const loc of locations) {
      const point: GeoPoint = {
        latitude: loc.coords.latitude,
        longitude: loc.coords.longitude,
        accuracy: loc.coords.accuracy,
      };

      // Append point to the GPS path
      gpsPath.push({
        ...point,
        timestamp: loc.timestamp || Date.now(),
      });

      // Update state machine via reducer
      const nextState = outdoorReducer(state, {
        type: 'tick',
        input: {
          now: loc.timestamp || Date.now(),
          position: point,
        },
      });

      state = nextState;
      stateChanged = true;

      if (state.count > oldLapCount) {
        lapIncremented = true;
      }

      // If finished, stop processing further points
      if (state.phase === 'finished') {
        break;
      }
    }

    if (stateChanged) {
      // Calculate elapsed time
      const elapsed = sessionStartTs > 0 ? Math.floor((Date.now() - sessionStartTs - totalPausedMs) / 1000) : 0;
      saveSettingSync('active_outdoor_elapsed_seconds', String(elapsed));

      // Persist the updated state and path back to SQLite key-value settings
      saveSettingSync('active_outdoor_detector_state', JSON.stringify(state));
      saveSettingSync('active_outdoor_gps_path', JSON.stringify(gpsPath));

      // Trigger notifications if lap count increased or finished
      if (lapIncremented) {
        const target = state.config.targetLaps;
        if (state.phase === 'finished') {
          void notifyTargetReached(state.count, target);
        } else {
          void notifyLapCompleted(state.count, target);
        }
      }

      // Broadcast update to foreground UI listeners
      DeviceEventEmitter.emit('active-session-update', {
        outdoorState: state,
        gpsPath,
        elapsedSeconds: elapsed,
      });
    }
  });
}

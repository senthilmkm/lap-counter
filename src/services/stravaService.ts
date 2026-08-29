/**
 * Strava Cloud Auto-Sync Service
 * 
 * Manages OAuth authentication tokens and automatically uploads completed workout sessions
 * to Strava API v3.
 * 
 * 💎 STRICTLY GATED FOR PRO SUBSCRIPTION.
 * 🛡️ AUTO-REFRESH RESILIENT: Automatically refreshes expiring or expired access tokens.
 * ⚡ OFFLINE QUEUE AUTO-SYNC: If you finish a run offline, workouts are automatically queued
 * in local SQLite and synced to Strava in the background the moment internet connection returns
 * WITHOUT requiring any user intervention!
 */

import { DBGpsPoint, DBWorkout, getDatabase, getSettingSync, getWorkoutById, getWorkoutPath, saveSettingSync } from './database';
import { generateGPX } from './exporter';

export interface StravaAuthTokens {
  accessToken: string;
  refreshToken: string;
  expiresAt: number; // Unix epoch seconds
  athleteId?: string;
}

export interface StravaUploadResult {
  success: boolean;
  activityId?: string;
  error?: string;
  paywallRequired?: boolean;
}

const STRAVA_ACCESS_TOKEN_KEY = 'strava_access_token';
const STRAVA_REFRESH_TOKEN_KEY = 'strava_refresh_token';
const STRAVA_EXPIRES_AT_KEY = 'strava_expires_at';
const STRAVA_ATHLETE_ID_KEY = 'strava_athlete_id';
const STRAVA_AUTO_SYNC_ENABLED_KEY = 'strava_auto_sync_enabled';
const STRAVA_CLIENT_ID_KEY = 'strava_client_id';
const STRAVA_CLIENT_SECRET_KEY = 'strava_client_secret';
const STRAVA_PENDING_QUEUE_KEY = 'strava_pending_sync_queue';

// Default OAuth credentials (can be overridden via SQLite settings)
const DEFAULT_STRAVA_CLIENT_ID = '123456'; 
const DEFAULT_STRAVA_CLIENT_SECRET = 'orbit_strava_client_secret';

/**
 * Checks if Strava is currently connected with valid or refreshable credentials.
 */
export function isStravaConnected(): boolean {
  const tokens = getStravaTokens();
  return Boolean(tokens && (tokens.accessToken || tokens.refreshToken));
}

/**
 * Checks if Strava auto-sync is enabled in user settings.
 */
export function isStravaAutoSyncEnabled(): boolean {
  return getSettingSync(STRAVA_AUTO_SYNC_ENABLED_KEY, 'false') === 'true';
}

/**
 * Sets whether Strava auto-sync is enabled.
 */
export function setStravaAutoSyncEnabled(enabled: boolean, isPremium: boolean): boolean {
  if (enabled && !isPremium) {
    return false; // Pro gating security
  }
  return saveSettingSync(STRAVA_AUTO_SYNC_ENABLED_KEY, String(enabled));
}

/**
 * Retrieves stored Strava auth tokens from SQLite settings.
 */
export function getStravaTokens(): StravaAuthTokens | null {
  const accessToken = getSettingSync(STRAVA_ACCESS_TOKEN_KEY, '');
  const refreshToken = getSettingSync(STRAVA_REFRESH_TOKEN_KEY, '');
  const expiresAt = parseInt(getSettingSync(STRAVA_EXPIRES_AT_KEY, '0'), 10);
  const athleteId = getSettingSync(STRAVA_ATHLETE_ID_KEY, '') || undefined;

  if (!accessToken && !refreshToken) return null;
  return { accessToken, refreshToken, expiresAt, athleteId };
}

/**
 * Saves Strava auth tokens.
 */
export function saveStravaTokens(tokens: StravaAuthTokens): boolean {
  if (tokens.accessToken) saveSettingSync(STRAVA_ACCESS_TOKEN_KEY, tokens.accessToken);
  if (tokens.refreshToken) saveSettingSync(STRAVA_REFRESH_TOKEN_KEY, tokens.refreshToken);
  if (tokens.expiresAt) saveSettingSync(STRAVA_EXPIRES_AT_KEY, String(tokens.expiresAt));
  if (tokens.athleteId) saveSettingSync(STRAVA_ATHLETE_ID_KEY, tokens.athleteId);
  return true;
}

/**
 * Disconnects Strava account.
 */
export function disconnectStrava(): void {
  saveSettingSync(STRAVA_ACCESS_TOKEN_KEY, '');
  saveSettingSync(STRAVA_REFRESH_TOKEN_KEY, '');
  saveSettingSync(STRAVA_EXPIRES_AT_KEY, '0');
  saveSettingSync(STRAVA_ATHLETE_ID_KEY, '');
  saveSettingSync(STRAVA_AUTO_SYNC_ENABLED_KEY, 'false');
  saveSettingSync(STRAVA_PENDING_QUEUE_KEY, '[]');
}

/**
 * Retrieves the list of workout IDs pending upload to Strava.
 */
export function getPendingSyncWorkouts(): string[] {
  try {
    const raw = getSettingSync(STRAVA_PENDING_QUEUE_KEY, '[]');
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

/**
 * Adds a workout ID to the pending offline sync queue.
 */
export function markWorkoutPendingSync(workoutId: string): void {
  const current = getPendingSyncWorkouts();
  if (!current.includes(workoutId)) {
    current.push(workoutId);
    saveSettingSync(STRAVA_PENDING_QUEUE_KEY, JSON.stringify(current));
  }
}

/**
 * Removes a workout ID from the pending offline sync queue.
 */
export function removeWorkoutFromPendingSync(workoutId: string): void {
  const current = getPendingSyncWorkouts();
  const updated = current.filter(id => id !== workoutId);
  saveSettingSync(STRAVA_PENDING_QUEUE_KEY, JSON.stringify(updated));
}

/**
 * Proactively refreshes the Strava access token if it is expired or expiring within 5 minutes.
 */
export async function ensureFreshStravaToken(): Promise<string | null> {
  const tokens = getStravaTokens();
  if (!tokens) return null;

  const nowSeconds = Math.floor(Date.now() / 1000);
  const bufferSeconds = 300; // 5 minute proactive buffer

  // If token is still valid with > 5 minutes remaining, use it directly
  if (tokens.accessToken && tokens.expiresAt > nowSeconds + bufferSeconds) {
    return tokens.accessToken;
  }

  // If we have a refresh token, execute OAuth refresh
  if (tokens.refreshToken) {
    try {
      const clientId = getSettingSync(STRAVA_CLIENT_ID_KEY, DEFAULT_STRAVA_CLIENT_ID);
      const clientSecret = getSettingSync(STRAVA_CLIENT_SECRET_KEY, DEFAULT_STRAVA_CLIENT_SECRET);

      const response = await fetch('https://www.strava.com/oauth/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          client_id: clientId,
          client_secret: clientSecret,
          grant_type: 'refresh_token',
          refresh_token: tokens.refreshToken,
        }),
      });

      if (response.ok) {
        const data = await response.json();
        const newTokens: StravaAuthTokens = {
          accessToken: data.access_token,
          refreshToken: data.refresh_token || tokens.refreshToken,
          expiresAt: data.expires_at || (nowSeconds + 21600), // Default 6 hours
          athleteId: data.athlete?.id ? String(data.athlete.id) : tokens.athleteId,
        };
        saveStravaTokens(newTokens);
        return newTokens.accessToken;
      } else {
        console.warn('Strava token refresh failed with status:', response.status);
      }
    } catch (e) {
      console.warn('Error during Strava token auto-refresh:', e);
    }
  }

  return tokens.accessToken || null;
}

/**
 * Uploads a single workout to Strava.
 * Strictly checks isPremium, refreshes tokens, and manages the offline queue.
 */
export async function uploadWorkoutToStrava(
  workout: DBWorkout,
  path: DBGpsPoint[],
  isPremium: boolean
): Promise<StravaUploadResult> {
  // 1. STRICT PRO GATING CHECK
  if (!isPremium) {
    return {
      success: false,
      paywallRequired: true,
      error: 'Strava Cloud Auto-Sync is an Orbit Pro feature. Upgrade to enable hands-free Strava sync.',
    };
  }

  // 2. AUTO-REFRESH TOKEN CHECK
  const validAccessToken = await ensureFreshStravaToken();
  if (!validAccessToken) {
    markWorkoutPendingSync(workout.id);
    return {
      success: false,
      error: 'Strava is not connected. Workout queued for sync once connected.',
    };
  }

  try {
    const isOutdoor = workout.mode === 'outdoor' && path.length > 0;
    let fileBlob: string;
    let dataType = 'gpx';

    if (isOutdoor) {
      fileBlob = generateGPX(path, workout.startTime);
    } else {
      fileBlob = `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="Orbit Lap Counter" xmlns="http://www.topografix.com/GPX/1/1">
  <metadata>
    <name>Orbit Indoor Lap Session - ${workout.totalLaps} Laps</name>
    <time>${new Date(workout.startTime).toISOString()}</time>
  </metadata>
  <trk>
    <name>Orbit Indoor Track (${workout.totalLaps} Laps)</name>
    <type>Run</type>
    <trkseg></trkseg>
  </trk>
</gpx>`;
    }

    const formData = new FormData();
    formData.append('data_type', dataType);
    formData.append('name', `Orbit ${workout.mode === 'indoor' ? 'Indoor' : 'Outdoor'} Laps - ${workout.totalLaps} Laps`);
    formData.append('description', `Tracked hands-free with Orbit Lap Counter.\n• Total Laps: ${workout.totalLaps}\n• Cadence: ${Math.round(workout.cadence)} spm\n• Steps: ${workout.steps}`);
    formData.append('activity_type', 'Run');
    formData.append('file', fileBlob as unknown as Blob);

    let response = await fetch('https://www.strava.com/api/v3/uploads', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${validAccessToken}`,
      },
      body: formData,
    });

    // If 401 Unauthorized occurs, force token refresh and retry once
    if (response.status === 401) {
      console.warn('Strava returned 401 Unauthorized. Retrying with fresh token...');
      const tokens = getStravaTokens();
      if (tokens) {
        tokens.expiresAt = 0; // Force refresh
        saveStravaTokens(tokens);
      }
      const refreshedToken = await ensureFreshStravaToken();
      if (refreshedToken && refreshedToken !== validAccessToken) {
        response = await fetch('https://www.strava.com/api/v3/uploads', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${refreshedToken}`,
          },
          body: formData,
        });
      }
    }

    if (response.ok) {
      const resData = await response.json();
      removeWorkoutFromPendingSync(workout.id);
      return {
        success: true,
        activityId: resData.id_str || String(resData.id),
      };
    } else {
      const errData = await response.json().catch(() => ({ message: response.statusText }));
      markWorkoutPendingSync(workout.id);
      return {
        success: false,
        error: errData.message || `Strava upload failed with status ${response.status}`,
      };
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    // Automatically enqueue workout for background sync when internet recovers
    markWorkoutPendingSync(workout.id);
    return {
      success: false,
      error: `Network offline: Workout queued for automatic sync to Strava (${msg})`,
    };
  }
}

let isSyncingQueue = false;

/**
 * Automatically drains the offline sync queue by uploading all pending workouts to Strava.
 * Executed on app launch, foreground resume, or network reconnection.
 * Uses an in-flight mutex to prevent concurrent sync race conditions.
 * Returns the count of successfully synced workouts.
 */
export async function syncPendingWorkoutsToStrava(isPremium: boolean): Promise<number> {
  if (!isPremium || !isStravaAutoSyncEnabled() || isSyncingQueue) {
    return 0;
  }

  const pendingIds = getPendingSyncWorkouts();
  if (pendingIds.length === 0) return 0;

  isSyncingQueue = true;
  let syncedCount = 0;
  try {
    for (const workoutId of [...pendingIds]) {
      const workout = getWorkoutById(workoutId);
      if (!workout) {
        removeWorkoutFromPendingSync(workoutId);
        continue;
      }
      const path = getWorkoutPath(workoutId);
      const result = await uploadWorkoutToStrava(workout, path, isPremium);
      if (result.success) {
        syncedCount++;
      }
    }
  } finally {
    isSyncingQueue = false;
  }
  return syncedCount;
}

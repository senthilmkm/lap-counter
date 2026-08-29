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

// Official Strava OAuth credentials for Orbit
export const DEFAULT_STRAVA_CLIENT_ID = '275440'; 
export const DEFAULT_STRAVA_CLIENT_SECRET = '01d7ce81ba6990f580a71c7efc4c43c0fa24dbcf';

/**
 * Generates the official Strava OAuth 2.0 authorization URL.
 */
export function getStravaAuthUrl(): string {
  const clientId = getSettingSync(STRAVA_CLIENT_ID_KEY, DEFAULT_STRAVA_CLIENT_ID);
  return `https://www.strava.com/oauth/authorize?client_id=${clientId}&response_type=code&redirect_uri=http://localhost/exchange_token&approval_prompt=auto&scope=read,activity:write,activity:read_all`;
}

/**
 * Formats Strava API error responses into crystal-clear, user-friendly error messages.
 */
function formatStravaError(status: number, data: any): string {
  if (!data) return `Strava API returned HTTP status ${status}`;

  if (data.errors && Array.isArray(data.errors) && data.errors.length > 0) {
    const details = data.errors
      .map((e: any) => (e.field ? `${e.field}: ${e.code || 'missing/invalid'}` : e.message || 'error'))
      .join(', ');
    if (data.message) {
      if (data.message.toLowerCase().includes('authorization error')) {
        return 'Authorization Error: Please reconnect with Strava to grant write permissions.';
      }
      return `${data.message} (${details})`;
    }
    return details;
  }

  if (data.message) {
    if (data.message.toLowerCase().includes('authorization error')) {
      return 'Authorization Error: Please reconnect with Strava to grant write permissions.';
    }
    return data.message;
  }

  if (status === 401 || status === 403) {
    return 'Strava authorization expired or missing write permissions. Please reconnect your account.';
  }
  if (status === 429) {
    return 'Strava upload rate limit reached. Your workout is queued and will sync automatically in a few minutes.';
  }
  return `Strava request failed with HTTP ${status}`;
}

/**
 * Exchanges an authorization code for real Strava access & refresh tokens.
 */
export async function exchangeStravaAuthCode(
  code: string,
  isPremium: boolean
): Promise<{ success: boolean; error?: string; athleteName?: string }> {
  try {
    const clientId = getSettingSync(STRAVA_CLIENT_ID_KEY, DEFAULT_STRAVA_CLIENT_ID);
    const clientSecret = getSettingSync(STRAVA_CLIENT_SECRET_KEY, DEFAULT_STRAVA_CLIENT_SECRET);

    const response = await fetch('https://www.strava.com/oauth/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_id: clientId,
        client_secret: clientSecret,
        code,
        grant_type: 'authorization_code',
      }),
    });

    const data = await response.json().catch(() => null);
    if (response.ok && data?.access_token) {
      const athleteName = `${data.athlete?.firstname || ''} ${data.athlete?.lastname || ''}`.trim() || 'Strava Athlete';
      const newTokens: StravaAuthTokens = {
        accessToken: data.access_token,
        refreshToken: data.refresh_token || '',
        expiresAt: data.expires_at || Math.floor(Date.now() / 1000) + 21600,
        athleteId: data.athlete?.id ? String(data.athlete.id) : undefined,
      };

      saveStravaTokens(newTokens);
      setStravaAutoSyncEnabled(true, isPremium);
      return { success: true, athleteName };
    } else {
      return {
        success: false,
        error: formatStravaError(response.status, data),
      };
    }
  } catch (e) {
    return {
      success: false,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

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

const STRAVA_SYNCED_IDS_KEY = 'strava_synced_workout_ids';

/**
 * Retrieves the list of workout IDs successfully synced to Strava.
 */
export function getSyncedWorkoutIds(): string[] {
  try {
    const raw = getSettingSync(STRAVA_SYNCED_IDS_KEY, '[]');
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

/**
 * Marks a workout ID as successfully synced to Strava.
 */
export function markWorkoutSyncedToStrava(workoutId: string): void {
  const current = getSyncedWorkoutIds();
  if (!current.includes(workoutId)) {
    current.push(workoutId);
    saveSettingSync(STRAVA_SYNCED_IDS_KEY, JSON.stringify(current));
  }
}

/**
 * Checks if a specific workout ID has been synced to Strava.
 */
export function isWorkoutSyncedToStrava(workoutId: string): boolean {
  const current = getSyncedWorkoutIds();
  return current.includes(workoutId);
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
 * Verifies current Strava credentials against Strava API v3 /athlete endpoint.
 * Returns the athlete details if valid, or an error message.
 */
export async function verifyStravaConnection(): Promise<{
  valid: boolean;
  athleteName?: string;
  athleteId?: string;
  error?: string;
}> {
  const token = await ensureFreshStravaToken();
  if (!token) {
    return { valid: false, error: 'No Strava access token found on device.' };
  }

  try {
    const res = await fetch('https://www.strava.com/api/v3/athlete', {
      headers: { Authorization: `Bearer ${token}` },
    });

    if (res.ok) {
      const data = await res.json();
      const athleteName = `${data.firstname || ''} ${data.lastname || ''}`.trim() || 'Strava Athlete';
      const athleteId = String(data.id || '');
      
      // Update stored athlete ID
      const tokens = getStravaTokens();
      if (tokens) {
        tokens.athleteId = athleteId;
        saveStravaTokens(tokens);
      }

      return { valid: true, athleteName, athleteId };
    } else {
      const err = await res.json().catch(() => null);
      return { valid: false, error: formatStravaError(res.status, err) };
    }
  } catch (e) {
    return { valid: false, error: e instanceof Error ? e.message : String(e) };
  }
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
    const durationSeconds = Math.max(1, Math.round((workout.endTime - workout.startTime) / 1000));
    
    // Calculate total distance in meters from GPS path, steps, or standard lap count
    let distanceMeters = 0;
    if (isOutdoor && path.length >= 2) {
      const R = 6371000; // Earth radius in meters
      for (let i = 1; i < path.length; i++) {
        const p1 = path[i - 1];
        const p2 = path[i];
        const dLat = ((p2.latitude - p1.latitude) * Math.PI) / 180;
        const dLon = ((p2.longitude - p1.longitude) * Math.PI) / 180;
        const a =
          Math.sin(dLat / 2) * Math.sin(dLat / 2) +
          Math.cos((p1.latitude * Math.PI) / 180) *
            Math.cos((p2.latitude * Math.PI) / 180) *
            Math.sin(dLon / 2) *
            Math.sin(dLon / 2);
        const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
        distanceMeters += R * c;
      }
    }
    if (distanceMeters <= 0) {
      if (workout.steps && workout.steps > 0) {
        const stride = workout.strideLength || 0.75;
        distanceMeters = workout.steps * stride;
      } else if (workout.totalLaps > 0) {
        distanceMeters = workout.totalLaps * 400; // Standard 400m track lap
      }
    }
    distanceMeters = Math.round(distanceMeters);

    const distanceMilesStr = (distanceMeters / 1609.34).toFixed(2);
    const title = `Orbit ${workout.mode === 'indoor' ? 'Indoor' : 'Outdoor'} Laps - ${workout.totalLaps} Laps (${distanceMilesStr} mi)`;
    const description = `Tracked hands-free with Orbit Lap Counter.\n• Total Laps: ${workout.totalLaps}\n• Distance: ${distanceMilesStr} miles (${(distanceMeters / 1000).toFixed(2)} km)\n• Cadence: ${Math.round(workout.cadence)} spm\n• Steps: ${workout.steps}`;

    // Attempt 1: If Outdoor with GPS points, try GPX upload
    if (isOutdoor) {
      const fileBlob = generateGPX(path, workout.startTime);
      const formData = new FormData();
      formData.append('data_type', 'gpx');
      formData.append('name', title);
      formData.append('description', description);
      formData.append('activity_type', 'Run');
      formData.append('file', fileBlob as unknown as Blob);

      const response = await fetch('https://www.strava.com/api/v3/uploads', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${validAccessToken}`,
        },
        body: formData,
      });

      if (response.ok) {
        const resData = await response.json();
        removeWorkoutFromPendingSync(workout.id);
        markWorkoutSyncedToStrava(workout.id);
        return {
          success: true,
          activityId: resData.id_str || String(resData.id),
        };
      }
    }

    // Attempt 2 / Direct Activity Fallback: POST /api/v3/activities
    const directRes = await fetch('https://www.strava.com/api/v3/activities', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${validAccessToken}`,
      },
      body: JSON.stringify({
        name: title,
        type: 'Run',
        sport_type: 'Run',
        start_date_local: new Date(workout.startTime).toISOString(),
        elapsed_time: durationSeconds,
        distance: distanceMeters,
        description: description,
      }),
    });

    if (directRes.ok) {
      const actData = await directRes.json();
      removeWorkoutFromPendingSync(workout.id);
      markWorkoutSyncedToStrava(workout.id);
      return {
        success: true,
        activityId: String(actData.id),
      };
    } else {
      const errData = await directRes.json().catch(() => null);
      markWorkoutPendingSync(workout.id);
      return {
        success: false,
        error: formatStravaError(directRes.status, errData),
      };
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    // Automatically enqueue workout for background sync when internet recovers
    markWorkoutPendingSync(workout.id);
    return {
      success: false,
      error: `Workout queued for automatic sync to Strava (${msg})`,
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

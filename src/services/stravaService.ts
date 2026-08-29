/**
 * Strava Cloud Auto-Sync Service
 * 
 * Manages OAuth authentication tokens and automatically uploads completed workout sessions
 * to Strava API v3.
 * 
 * 💎 STRICTLY GATED FOR PRO SUBSCRIPTION.
 */

import { DBGpsPoint, DBWorkout, getSettingSync, saveSettingSync } from './database';
import { generateGPX } from './exporter';

export interface StravaAuthTokens {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
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
const STRAVA_AUTO_SYNC_ENABLED_KEY = 'strava_auto_sync_enabled';

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

  if (!accessToken) return null;
  return { accessToken, refreshToken, expiresAt };
}

/**
 * Saves Strava auth tokens.
 */
export function saveStravaTokens(tokens: StravaAuthTokens): boolean {
  saveSettingSync(STRAVA_ACCESS_TOKEN_KEY, tokens.accessToken);
  saveSettingSync(STRAVA_REFRESH_TOKEN_KEY, tokens.refreshToken);
  saveSettingSync(STRAVA_EXPIRES_AT_KEY, String(tokens.expiresAt));
  return true;
}

/**
 * Disconnects Strava account.
 */
export function disconnectStrava(): void {
  saveSettingSync(STRAVA_ACCESS_TOKEN_KEY, '');
  saveSettingSync(STRAVA_REFRESH_TOKEN_KEY, '');
  saveSettingSync(STRAVA_EXPIRES_AT_KEY, '0');
  saveSettingSync(STRAVA_AUTO_SYNC_ENABLED_KEY, 'false');
}

/**
 * Uploads a workout to Strava.
 * Strictly checks isPremium before executing network requests.
 */
export async function uploadWorkoutToStrava(
  workout: DBWorkout,
  path: DBGpsPoint[],
  isPremium: boolean
): Promise<StravaUploadResult> {
  // STRICT PRO GATING CHECK
  if (!isPremium) {
    return {
      success: false,
      paywallRequired: true,
      error: 'Strava Cloud Auto-Sync is an Orbit Pro feature. Upgrade to enable hands-free Strava sync.',
    };
  }

  const tokens = getStravaTokens();
  if (!tokens || !tokens.accessToken) {
    return {
      success: false,
      error: 'Strava is not connected. Please link your Strava account in Settings.',
    };
  }

  try {
    const isOutdoor = workout.mode === 'outdoor' && path.length > 0;
    let fileBlob: string;
    let dataType = 'gpx';

    if (isOutdoor) {
      fileBlob = generateGPX(path, workout.startTime);
    } else {
      // For indoor workouts without GPS trail, generate a mock TCX/GPX header with elapsed time and lap count
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

    const response = await fetch('https://www.strava.com/api/v3/uploads', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${tokens.accessToken}`,
      },
      body: formData,
    });

    if (response.ok) {
      const resData = await response.json();
      return {
        success: true,
        activityId: resData.id_str || String(resData.id),
      };
    } else {
      const errData = await response.json().catch(() => ({ message: response.statusText }));
      return {
        success: false,
        error: errData.message || `Strava upload failed with status ${response.status}`,
      };
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return {
      success: false,
      error: `Network error syncing with Strava: ${msg}`,
    };
  }
}

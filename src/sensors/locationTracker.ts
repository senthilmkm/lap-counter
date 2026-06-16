import * as Location from 'expo-location';

import type { GeoPoint } from '../logic/outdoorLapDetector';

export type LocationTrackerHandle = {
  /** Latest known position, or null if no fix yet. */
  snapshot: () => GeoPoint | null;
  /** Tear down the location subscription. */
  stop: () => Promise<void>;
};

export type LocationStartOptions = {
  /** Min distance change (m) between updates. Default 2. */
  distanceIntervalM?: number;
  /** Min ms between updates. Default 1000. */
  timeIntervalMs?: number;
};

/**
 * Permission flow used before starting GPS. Foreground permission is
 * required; background is requested as a follow-up so the lap counter
 * can keep tracking when the screen sleeps.
 *
 * Returns whether the foreground permission was granted (background is
 * a nice-to-have — the app still works fine without it as long as the
 * screen stays on, which `expo-keep-awake` handles).
 */
export async function ensureLocationPermission(): Promise<{
  foreground: boolean;
  background: boolean;
}> {
  try {
    const fg = await Location.requestForegroundPermissionsAsync();
    if (!fg.granted) {
      return { foreground: false, background: false };
    }
    let background = false;
    try {
      const bg = await Location.requestBackgroundPermissionsAsync();
      background = bg.granted === true;
    } catch {
      // Background permission may not be configured (Android < 10, etc.) —
      // ignore, foreground tracking is still useful.
    }
    return { foreground: true, background };
  } catch {
    return { foreground: false, background: false };
  }
}

/**
 * Start streaming GPS positions. The callback receives a normalized
 * `GeoPoint` (lat/lon/accuracy) for every update; positions without a
 * usable accuracy reading are skipped.
 *
 * Throws if foreground permission isn't granted — caller should run
 * `ensureLocationPermission()` first.
 */
export async function startLocationTracking(
  onLocation: (point: GeoPoint) => void,
  onError?: (err: Error) => void,
  options: LocationStartOptions = {}
): Promise<LocationTrackerHandle> {
  let lastSnapshot: GeoPoint | null = null;

  const services = await Location.hasServicesEnabledAsync().catch(() => true);
  if (services === false) {
    throw new Error('Location services are disabled — enable them and retry.');
  }

  const sub = await Location.watchPositionAsync(
    {
      accuracy: Location.Accuracy.BestForNavigation,
      distanceInterval: options.distanceIntervalM ?? 2,
      timeInterval: options.timeIntervalMs ?? 1000,
      mayShowUserSettingsDialog: true,
    },
    (raw) => {
      try {
        const lat = raw?.coords?.latitude;
        const lon = raw?.coords?.longitude;
        const acc = raw?.coords?.accuracy;
        if (
          typeof lat !== 'number' ||
          typeof lon !== 'number' ||
          typeof acc !== 'number' ||
          !Number.isFinite(lat) ||
          !Number.isFinite(lon)
        ) {
          return;
        }
        const point: GeoPoint = {
          latitude: lat,
          longitude: lon,
          accuracy: Math.max(acc, 1),
        };
        lastSnapshot = point;
        onLocation(point);
      } catch (err) {
        onError?.(err instanceof Error ? err : new Error(String(err)));
      }
    }
  );

  return {
    snapshot: () => lastSnapshot,
    stop: async () => {
      try {
        await sub.remove();
      } catch {
        // ignore — already removed
      }
    },
  };
}

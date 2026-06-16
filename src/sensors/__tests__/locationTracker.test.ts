import * as Location from 'expo-location';

import {
  ensureLocationPermission,
  startLocationTracking,
} from '../locationTracker';
import type { GeoPoint } from '../../logic/outdoorLapDetector';

const LocationMock = Location as unknown as typeof Location & {
  __setForegroundPermission: (next: { granted?: boolean; status?: string; canAskAgain?: boolean }) => void;
  __setBackgroundPermission: (next: { granted?: boolean; status?: string; canAskAgain?: boolean }) => void;
  __setServicesEnabled: (enabled: boolean) => void;
  __emitPosition: (opts: { latitude: number; longitude: number; accuracy?: number }) => void;
  __getActiveWatchers: () => number;
  __resetLocation: () => void;
};

beforeEach(() => {
  LocationMock.__resetLocation();
});

describe('ensureLocationPermission', () => {
  it('returns granted=true,background=true when both granted', async () => {
    LocationMock.__setForegroundPermission({
      granted: true,
      status: 'granted',
      canAskAgain: false,
    });
    LocationMock.__setBackgroundPermission({
      granted: true,
      status: 'granted',
      canAskAgain: false,
    });
    const r = await ensureLocationPermission();
    expect(r.foreground).toBe(true);
    expect(r.background).toBe(true);
  });

  it('returns foreground=true,background=false when only foreground granted', async () => {
    LocationMock.__setForegroundPermission({
      granted: true,
      status: 'granted',
      canAskAgain: false,
    });
    LocationMock.__setBackgroundPermission({
      granted: false,
      status: 'denied',
      canAskAgain: false,
    });
    const r = await ensureLocationPermission();
    expect(r.foreground).toBe(true);
    expect(r.background).toBe(false);
  });

  it('skips background request when foreground is denied', async () => {
    LocationMock.__setForegroundPermission({
      granted: false,
      status: 'denied',
      canAskAgain: false,
    });
    const r = await ensureLocationPermission();
    expect(r.foreground).toBe(false);
    expect(r.background).toBe(false);
    expect(Location.requestBackgroundPermissionsAsync).not.toHaveBeenCalled();
  });

  it('does not throw if background permission API rejects', async () => {
    LocationMock.__setForegroundPermission({
      granted: true,
      status: 'granted',
      canAskAgain: false,
    });
    (Location.requestBackgroundPermissionsAsync as jest.Mock).mockRejectedValueOnce(
      new Error('not configured')
    );
    const r = await ensureLocationPermission();
    expect(r.foreground).toBe(true);
    expect(r.background).toBe(false);
  });

  it('returns false/false (does not throw) when the OS layer rejects', async () => {
    (Location.requestForegroundPermissionsAsync as jest.Mock).mockRejectedValueOnce(
      new Error('boom')
    );
    const r = await ensureLocationPermission();
    expect(r.foreground).toBe(false);
    expect(r.background).toBe(false);
  });
});

describe('startLocationTracking', () => {
  it('throws if location services are disabled', async () => {
    LocationMock.__setServicesEnabled(false);
    await expect(
      startLocationTracking(() => {})
    ).rejects.toThrow(/disabled/i);
  });

  it('forwards normalized GeoPoints to the callback', async () => {
    const received: GeoPoint[] = [];
    const handle = await startLocationTracking((p) => received.push(p));
    LocationMock.__emitPosition({
      latitude: 40.7128,
      longitude: -74.006,
      accuracy: 5,
    });
    expect(received.length).toBe(1);
    expect(received[0]).toEqual({
      latitude: 40.7128,
      longitude: -74.006,
      accuracy: 5,
    });
    await handle.stop();
  });

  it('skips invalid readings (NaN or missing coords)', async () => {
    const received: GeoPoint[] = [];
    const handle = await startLocationTracking((p) => received.push(p));
    // Manually inject a malformed reading via the mock callback path.
    LocationMock.__emitPosition({
      latitude: NaN,
      longitude: -74.006,
      accuracy: 5,
    });
    expect(received.length).toBe(0);
    await handle.stop();
  });

  it('floors reported accuracy at 1m so weighting does not divide by ~0', async () => {
    const received: GeoPoint[] = [];
    const handle = await startLocationTracking((p) => received.push(p));
    LocationMock.__emitPosition({
      latitude: 40.7,
      longitude: -74,
      accuracy: 0.1,
    });
    expect(received[0].accuracy).toBeGreaterThanOrEqual(1);
    await handle.stop();
  });

  it('snapshot() returns the most recent reading', async () => {
    const handle = await startLocationTracking(() => {});
    expect(handle.snapshot()).toBeNull();
    LocationMock.__emitPosition({
      latitude: 40.7,
      longitude: -74,
      accuracy: 5,
    });
    expect(handle.snapshot()).toMatchObject({ latitude: 40.7, longitude: -74 });
    LocationMock.__emitPosition({
      latitude: 40.8,
      longitude: -74.1,
      accuracy: 4,
    });
    expect(handle.snapshot()).toMatchObject({ latitude: 40.8 });
    await handle.stop();
  });

  it('stop() removes the active watcher', async () => {
    const handle = await startLocationTracking(() => {});
    expect(LocationMock.__getActiveWatchers()).toBe(1);
    await handle.stop();
    expect(LocationMock.__getActiveWatchers()).toBe(0);
  });
});

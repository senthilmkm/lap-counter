import { BleManager, State } from 'react-native-ble-plx';

export type BLEObservation = {
  id: string;
  rssi: number;
  timestamp: number;
};

export type BleScannerHandle = {
  stop: () => void;
};

let sharedManager: BleManager | null = null;

function getManager(): BleManager {
  if (!sharedManager) {
    sharedManager = new BleManager();
  }
  return sharedManager;
}

/**
 * Test-only: drop the cached manager so the next `startBleScan` allocates
 * a fresh one. Production code never calls this.
 */
export function __resetForTests(): void {
  if (sharedManager) {
    try {
      sharedManager.stopDeviceScan();
    } catch {
      // ignore — manager may already be stopped
    }
  }
  sharedManager = null;
}

/**
 * Wait for the BLE radio to be powered on. Resolves once the manager reports
 * PoweredOn (or rejects if the user denied permissions / the radio is off).
 */
async function waitForPoweredOn(manager: BleManager, timeoutMs = 8000): Promise<void> {
  const current = await manager.state();
  if (current === State.PoweredOn) return;

  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      sub.remove();
      reject(new Error(`BLE not powered on (state=${current}) within ${timeoutMs}ms`));
    }, timeoutMs);

    const sub = manager.onStateChange((state) => {
      if (state === State.PoweredOn) {
        clearTimeout(timeout);
        sub.remove();
        resolve();
      } else if (state === State.Unauthorized || state === State.Unsupported) {
        clearTimeout(timeout);
        sub.remove();
        reject(new Error(`BLE unavailable: ${state}`));
      }
    }, true);
  });
}

/**
 * Start an unfiltered continuous BLE scan. Every advertisement (with RSSI)
 * is forwarded to the supplied callback. Call the returned `stop()` to
 * tear down the scan.
 *
 * Note: iOS heavily throttles unfiltered background scans. Keep the app
 * foregrounded and the screen awake during a session.
 */
export async function startBleScan(
  onObservation: (obs: BLEObservation) => void,
  onError?: (err: Error) => void
): Promise<BleScannerHandle> {
  const manager = getManager();
  await waitForPoweredOn(manager);

  manager.startDeviceScan(
    null,
    { allowDuplicates: true },
    (error, device) => {
      if (error) {
        onError?.(error);
        return;
      }
      if (device && typeof device.rssi === 'number') {
        onObservation({
          id: device.id,
          rssi: device.rssi,
          timestamp: Date.now(),
        });
      }
    }
  );

  return {
    stop: () => {
      try {
        manager.stopDeviceScan();
      } catch {
        // ignore — manager may already be stopped
      }
    },
  };
}

/**
 * Aggregates a stream of raw BLE observations into a rolling per-device
 * RSSI map over a sliding time window. Devices not seen within the window
 * are dropped. This is the data structure consumed by the fingerprint
 * similarity function.
 */
export class BleAggregator {
  private readonly windowMs: number;
  private readonly samples = new Map<string, { rssi: number; timestamp: number }[]>();

  constructor(windowMs = 5000) {
    this.windowMs = windowMs;
  }

  add(obs: BLEObservation): void {
    const arr = this.samples.get(obs.id) ?? [];
    arr.push({ rssi: obs.rssi, timestamp: obs.timestamp });
    this.samples.set(obs.id, arr);
  }

  /**
   * Returns a snapshot Map<deviceId, averageRssi> using only samples
   * within the configured time window.
   */
  snapshot(now = Date.now()): Map<string, number> {
    const cutoff = now - this.windowMs;
    const out = new Map<string, number>();
    for (const [id, arr] of this.samples) {
      const fresh = arr.filter((s) => s.timestamp >= cutoff);
      if (fresh.length === 0) {
        this.samples.delete(id);
        continue;
      }
      this.samples.set(id, fresh);
      const avg = fresh.reduce((acc, s) => acc + s.rssi, 0) / fresh.length;
      out.set(id, avg);
    }
    return out;
  }

  reset(): void {
    this.samples.clear();
  }
}

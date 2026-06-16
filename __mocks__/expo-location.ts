/**
 * Manual mock for `expo-location`. Lets tests drive synthetic GPS
 * streams via `__emitPosition` and control permission outcomes.
 */

export const Accuracy = {
  Lowest: 1,
  Low: 2,
  Balanced: 3,
  High: 4,
  Highest: 5,
  BestForNavigation: 6,
};

type Permission = {
  granted: boolean;
  status: 'granted' | 'denied' | 'undetermined';
  canAskAgain: boolean;
};

let foregroundPermission: Permission = {
  granted: true,
  status: 'granted',
  canAskAgain: false,
};
let backgroundPermission: Permission = {
  granted: false,
  status: 'undetermined',
  canAskAgain: true,
};
let servicesEnabled = true;

type WatchCallback = (location: {
  coords: {
    latitude: number;
    longitude: number;
    accuracy: number | null;
    altitude?: number | null;
    heading?: number | null;
    speed?: number | null;
  };
  timestamp: number;
}) => void;

type Watcher = {
  callback: WatchCallback;
  remove: jest.Mock;
};

const watchers: Watcher[] = [];

export const requestForegroundPermissionsAsync = jest.fn(
  async () => foregroundPermission
);

export const requestBackgroundPermissionsAsync = jest.fn(
  async () => backgroundPermission
);

export const getForegroundPermissionsAsync = jest.fn(
  async () => foregroundPermission
);

export const getBackgroundPermissionsAsync = jest.fn(
  async () => backgroundPermission
);

export const hasServicesEnabledAsync = jest.fn(async () => servicesEnabled);

export const watchPositionAsync = jest.fn(
  async (_options: unknown, callback: WatchCallback) => {
    const watcher: Watcher = {
      callback,
      remove: jest.fn(() => {
        const idx = watchers.indexOf(watcher);
        if (idx >= 0) watchers.splice(idx, 1);
      }),
    };
    watchers.push(watcher);
    return { remove: watcher.remove };
  }
);

export function __emitPosition(opts: {
  latitude: number;
  longitude: number;
  accuracy?: number;
  timestamp?: number;
}): void {
  for (const w of [...watchers]) {
    w.callback({
      coords: {
        latitude: opts.latitude,
        longitude: opts.longitude,
        accuracy: opts.accuracy ?? 5,
      },
      timestamp: opts.timestamp ?? Date.now(),
    });
  }
}

export function __setForegroundPermission(next: Partial<Permission>): void {
  foregroundPermission = { ...foregroundPermission, ...next };
}

export function __setBackgroundPermission(next: Partial<Permission>): void {
  backgroundPermission = { ...backgroundPermission, ...next };
}

export function __setServicesEnabled(enabled: boolean): void {
  servicesEnabled = enabled;
}

export function __getActiveWatchers(): number {
  return watchers.length;
}

export function __resetLocation(): void {
  foregroundPermission = {
    granted: true,
    status: 'granted',
    canAskAgain: false,
  };
  backgroundPermission = {
    granted: false,
    status: 'undetermined',
    canAskAgain: true,
  };
  servicesEnabled = true;
  watchers.length = 0;
  requestForegroundPermissionsAsync.mockClear();
  requestBackgroundPermissionsAsync.mockClear();
  getForegroundPermissionsAsync.mockClear();
  getBackgroundPermissionsAsync.mockClear();
  hasServicesEnabledAsync.mockClear();
  watchPositionAsync.mockClear();
}

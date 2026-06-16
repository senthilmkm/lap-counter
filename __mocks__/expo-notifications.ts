/**
 * Manual mock for `expo-notifications`. Tracks scheduled notifications,
 * permission state, and channel setup so tests can assert lifecycle.
 */

export const AndroidImportance = {
  MIN: 1,
  LOW: 2,
  DEFAULT: 3,
  HIGH: 4,
  MAX: 5,
};

type Permission = {
  granted: boolean;
  status: 'granted' | 'denied' | 'undetermined';
  canAskAgain: boolean;
};

let permission: Permission = {
  granted: false,
  status: 'undetermined',
  canAskAgain: true,
};

let permissionPromptReturns: Permission = {
  granted: true,
  status: 'granted',
  canAskAgain: false,
};

const scheduled: Array<{ id: string; content: unknown; trigger: unknown }> = [];
const channels: Array<{ id: string; opts: unknown }> = [];
let nextId = 1;
let foregroundHandler: unknown = null;

export const setNotificationHandler = jest.fn((handler: unknown) => {
  foregroundHandler = handler;
});

export const setNotificationChannelAsync = jest.fn(
  async (id: string, opts: unknown) => {
    channels.push({ id, opts });
  }
);

export const getPermissionsAsync = jest.fn(async () => permission);

export const requestPermissionsAsync = jest.fn(async () => {
  permission = permissionPromptReturns;
  return permission;
});

export const scheduleNotificationAsync = jest.fn(
  async (req: { content: unknown; trigger: unknown }) => {
    const id = `mock-notification-${nextId++}`;
    scheduled.push({ id, ...req });
    return id;
  }
);

export const cancelAllScheduledNotificationsAsync = jest.fn(async () => {
  scheduled.length = 0;
});

export const dismissAllNotificationsAsync = jest.fn(async () => {
  // no-op (no presented store in mock)
});

export function __setPermission(next: Partial<Permission>): void {
  permission = { ...permission, ...next };
}

export function __setPermissionPromptResult(next: Partial<Permission>): void {
  permissionPromptReturns = { ...permissionPromptReturns, ...next };
}

export function __getScheduledNotifications(): ReadonlyArray<{
  id: string;
  content: unknown;
  trigger: unknown;
}> {
  return [...scheduled];
}

export function __getChannels(): ReadonlyArray<{ id: string; opts: unknown }> {
  return [...channels];
}

export function __getForegroundHandler(): unknown {
  return foregroundHandler;
}

export function __resetNotifications(): void {
  permission = { granted: false, status: 'undetermined', canAskAgain: true };
  permissionPromptReturns = {
    granted: true,
    status: 'granted',
    canAskAgain: false,
  };
  scheduled.length = 0;
  channels.length = 0;
  foregroundHandler = null;
  nextId = 1;
  setNotificationHandler.mockClear();
  setNotificationChannelAsync.mockClear();
  getPermissionsAsync.mockClear();
  requestPermissionsAsync.mockClear();
  scheduleNotificationAsync.mockClear();
  cancelAllScheduledNotificationsAsync.mockClear();
  dismissAllNotificationsAsync.mockClear();
}

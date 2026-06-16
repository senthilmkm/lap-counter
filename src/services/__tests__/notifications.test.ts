import { Platform } from 'react-native';

import {
  cancelAllNotifications,
  ensureNotificationPermission,
  installForegroundHandler,
  notifyTargetReached,
} from '../notifications';

import * as Notifications from 'expo-notifications';

const NotificationsMock = Notifications as unknown as typeof Notifications & {
  __setPermission: (next: { granted?: boolean; status?: string; canAskAgain?: boolean }) => void;
  __setPermissionPromptResult: (next: { granted?: boolean; status?: string; canAskAgain?: boolean }) => void;
  __getScheduledNotifications: () => ReadonlyArray<{ id: string; content: { title?: string; body?: string }; trigger: unknown }>;
  __getChannels: () => ReadonlyArray<{ id: string; opts: unknown }>;
  __getForegroundHandler: () => unknown;
  __resetNotifications: () => void;
};

beforeEach(() => {
  NotificationsMock.__resetNotifications();
});

describe('notifications.installForegroundHandler', () => {
  it('installs the handler exactly once across multiple calls', () => {
    installForegroundHandler();
    installForegroundHandler();
    installForegroundHandler();
    expect(Notifications.setNotificationHandler).toHaveBeenCalledTimes(1);
    expect(NotificationsMock.__getForegroundHandler()).not.toBeNull();
  });
});

describe('notifications.ensureNotificationPermission', () => {
  it('returns true when permission was already granted', async () => {
    NotificationsMock.__setPermission({
      granted: true,
      status: 'granted',
      canAskAgain: false,
    });
    const ok = await ensureNotificationPermission();
    expect(ok).toBe(true);
    expect(Notifications.requestPermissionsAsync).not.toHaveBeenCalled();
  });

  it('requests permission and returns true if user grants it', async () => {
    NotificationsMock.__setPermission({
      granted: false,
      status: 'undetermined',
      canAskAgain: true,
    });
    NotificationsMock.__setPermissionPromptResult({
      granted: true,
      status: 'granted',
      canAskAgain: false,
    });
    const ok = await ensureNotificationPermission();
    expect(ok).toBe(true);
    expect(Notifications.requestPermissionsAsync).toHaveBeenCalledTimes(1);
  });

  it('returns false if user denied & permission cannot be asked again', async () => {
    NotificationsMock.__setPermission({
      granted: false,
      status: 'denied',
      canAskAgain: false,
    });
    const ok = await ensureNotificationPermission();
    expect(ok).toBe(false);
    expect(Notifications.requestPermissionsAsync).not.toHaveBeenCalled();
  });

  it('returns false (does not throw) when the OS layer rejects', async () => {
    (Notifications.getPermissionsAsync as jest.Mock).mockRejectedValueOnce(
      new Error('boom')
    );
    const ok = await ensureNotificationPermission();
    expect(ok).toBe(false);
  });

  it('creates an Android channel exactly once on Android', async () => {
    const original = Platform.OS;
    Object.defineProperty(Platform, 'OS', { value: 'android', configurable: true });
    try {
      NotificationsMock.__setPermission({
        granted: true,
        status: 'granted',
        canAskAgain: false,
      });
      await ensureNotificationPermission();
      await ensureNotificationPermission();
      const channels = NotificationsMock.__getChannels();
      expect(channels.map((c) => c.id)).toEqual(['lap-counter']);
    } finally {
      Object.defineProperty(Platform, 'OS', {
        value: original,
        configurable: true,
      });
    }
  });
});

describe('notifications.notifyTargetReached', () => {
  beforeEach(() => {
    NotificationsMock.__setPermission({
      granted: true,
      status: 'granted',
      canAskAgain: false,
    });
  });

  it('schedules an immediate notification with target counts in the body', async () => {
    const id = await notifyTargetReached(10, 10);
    expect(id).toMatch(/^mock-notification-/);
    const queue = NotificationsMock.__getScheduledNotifications();
    expect(queue.length).toBe(1);
    expect(queue[0].content.body).toContain('10');
    expect(queue[0].trigger).toBeNull();
  });

  it('returns null when permission is denied', async () => {
    NotificationsMock.__setPermission({
      granted: false,
      status: 'denied',
      canAskAgain: false,
    });
    const id = await notifyTargetReached(10, 10);
    expect(id).toBeNull();
    expect(Notifications.scheduleNotificationAsync).not.toHaveBeenCalled();
  });

  it('returns null (does not throw) if scheduling fails', async () => {
    (
      Notifications.scheduleNotificationAsync as jest.Mock
    ).mockRejectedValueOnce(new Error('write failed'));
    const id = await notifyTargetReached(5, 5);
    expect(id).toBeNull();
  });
});

describe('notifications.cancelAllNotifications', () => {
  it('cancels scheduled and dismisses presented notifications', async () => {
    NotificationsMock.__setPermission({
      granted: true,
      status: 'granted',
      canAskAgain: false,
    });
    await notifyTargetReached(3, 3);
    expect(NotificationsMock.__getScheduledNotifications().length).toBe(1);

    await cancelAllNotifications();
    expect(
      Notifications.cancelAllScheduledNotificationsAsync
    ).toHaveBeenCalledTimes(1);
    expect(Notifications.dismissAllNotificationsAsync).toHaveBeenCalledTimes(1);
    expect(NotificationsMock.__getScheduledNotifications().length).toBe(0);
  });

  it('swallows errors from the OS layer', async () => {
    (
      Notifications.cancelAllScheduledNotificationsAsync as jest.Mock
    ).mockRejectedValueOnce(new Error('crash'));
    await expect(cancelAllNotifications()).resolves.toBeUndefined();
  });
});

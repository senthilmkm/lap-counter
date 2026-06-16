import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

/**
 * Local-notification helpers. All functions degrade gracefully when
 * permissions are denied or notifications are unavailable (web,
 * simulator restrictions, etc.) — they never throw into the caller.
 */

const ANDROID_CHANNEL_ID = 'lap-counter';
let foregroundHandlerInstalled = false;
let androidChannelEnsured = false;

/**
 * Configure how notifications behave when the app is foregrounded.
 * Idempotent — only runs the side effect on first call.
 */
export function installForegroundHandler(): void {
  if (foregroundHandlerInstalled) return;
  foregroundHandlerInstalled = true;
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: true,
      shouldSetBadge: false,
    }),
  });
}

async function ensureAndroidChannel(): Promise<void> {
  if (Platform.OS !== 'android' || androidChannelEnsured) return;
  androidChannelEnsured = true;
  try {
    await Notifications.setNotificationChannelAsync(ANDROID_CHANNEL_ID, {
      name: 'Lap Counter',
      importance: Notifications.AndroidImportance.HIGH,
      vibrationPattern: [0, 250, 250, 250],
      lightColor: '#10b981',
    });
  } catch {
    // ignore — channel creation is best-effort
  }
}

/**
 * Returns true if the app may post notifications. Requests permission
 * the first time. Safe to call repeatedly.
 */
export async function ensureNotificationPermission(): Promise<boolean> {
  try {
    installForegroundHandler();
    await ensureAndroidChannel();

    const settings = await Notifications.getPermissionsAsync();
    if (settings.granted) return true;
    if (
      settings.canAskAgain === false &&
      settings.status !== 'undetermined'
    ) {
      return false;
    }
    const requested = await Notifications.requestPermissionsAsync({
      ios: {
        allowAlert: true,
        allowBadge: false,
        allowSound: true,
      },
    });
    return requested.granted === true;
  } catch {
    return false;
  }
}

/**
 * Schedule a local "you hit your target!" notification. Returns the
 * notification id, or null if the notification couldn't be scheduled.
 */
export async function notifyTargetReached(
  count: number,
  target: number
): Promise<string | null> {
  try {
    const granted = await ensureNotificationPermission();
    if (!granted) return null;
    return await Notifications.scheduleNotificationAsync({
      content: {
        title: 'Lap Counter',
        body: `You completed all ${count} of ${target} laps. Nice work.`,
        data: { type: 'target-reached', count, target },
        sound: 'default',
      },
      trigger: null, // immediate
    });
  } catch {
    return null;
  }
}

/** Cancel every pending and presented notification scheduled by this app. */
export async function cancelAllNotifications(): Promise<void> {
  try {
    await Notifications.cancelAllScheduledNotificationsAsync();
    await Notifications.dismissAllNotificationsAsync();
  } catch {
    // ignore
  }
}

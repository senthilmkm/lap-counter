import * as BackgroundFetch from 'expo-background-fetch';
import * as TaskManager from 'expo-task-manager';

/**
 * Background scanning scaffold for the lap counter.
 *
 * iOS background BLE scanning is heavily throttled by the OS and only
 * works reliably for *filtered* scans (by service UUID). Our app does
 * unfiltered ambient scans, so background detection is a best-effort
 * fallback — the foreground path (with `expo-keep-awake` keeping the
 * screen on) is what actually delivers reliable lap counting.
 *
 * We still register a `BackgroundFetch` task so:
 *   1. The Info.plist background modes are exercised (preventing iOS
 *      from killing the app aggressively).
 *   2. We get a periodic wake-up where we can persist state, post
 *      notifications, etc., once we wire those side effects in.
 *
 * `TaskManager.defineTask` MUST run at module top level so the task is
 * available the moment iOS wakes the app. Importing this module from
 * the React tree is enough to install it.
 */

export const BACKGROUND_TASK_NAME = 'com.senth.lapcounter.background-scan';

let lastInvocation: { at: number; result: BackgroundFetch.BackgroundFetchResult } | null =
  null;

/**
 * Test hook: returns the most recent background-task invocation timestamp
 * and result. `null` if the task has never run in this process.
 */
export function getLastBackgroundInvocation(): typeof lastInvocation {
  return lastInvocation;
}

if (typeof TaskManager.defineTask === 'function') {
  TaskManager.defineTask(BACKGROUND_TASK_NAME, async () => {
    try {
      lastInvocation = {
        at: Date.now(),
        result: BackgroundFetch.BackgroundFetchResult.NoData,
      };
      // Real BLE work would happen here. Today this is a heartbeat that
      // confirms the background scheduler is wired up correctly.
      return BackgroundFetch.BackgroundFetchResult.NoData;
    } catch {
      lastInvocation = {
        at: Date.now(),
        result: BackgroundFetch.BackgroundFetchResult.Failed,
      };
      return BackgroundFetch.BackgroundFetchResult.Failed;
    }
  });
}

/**
 * Register the background-fetch task. iOS will wake the app at most every
 * ~15 minutes regardless of the requested interval; the field is treated
 * as a hint, not a guarantee.
 */
export async function registerBackgroundTask(): Promise<boolean> {
  try {
    const status = await BackgroundFetch.getStatusAsync();
    if (status === BackgroundFetch.BackgroundFetchStatus.Denied) {
      return false;
    }
    const isRegistered = await TaskManager.isTaskRegisteredAsync(
      BACKGROUND_TASK_NAME
    );
    if (isRegistered) return true;

    await BackgroundFetch.registerTaskAsync(BACKGROUND_TASK_NAME, {
      minimumInterval: 60, // seconds (iOS treats this as a hint)
      stopOnTerminate: false,
      startOnBoot: false,
    });
    return true;
  } catch {
    return false;
  }
}

/** Unregister the background task. Safe to call when not registered. */
export async function unregisterBackgroundTask(): Promise<void> {
  try {
    const isRegistered = await TaskManager.isTaskRegisteredAsync(
      BACKGROUND_TASK_NAME
    );
    if (isRegistered) {
      await BackgroundFetch.unregisterTaskAsync(BACKGROUND_TASK_NAME);
    }
  } catch {
    // ignore — best-effort teardown
  }
}

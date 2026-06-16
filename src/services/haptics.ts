import * as Haptics from 'expo-haptics';
import { Platform } from 'react-native';

/**
 * Haptic feedback wrappers used by the lap counter.
 *
 * All entry points are best-effort: they swallow errors so a missing or
 * disabled haptic engine (web, Android without vibrator, simulator) never
 * crashes the lap-counting pipeline.
 */

async function safe(action: () => Promise<unknown>): Promise<void> {
  if (Platform.OS === 'web') return;
  try {
    await action();
  } catch {
    // ignore — haptics are non-critical UX sugar
  }
}

/** Fired the moment a lap is counted. A medium impact is "tactile but not jarring". */
export async function lapHaptic(): Promise<void> {
  await safe(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium));
}

/**
 * Fired once when the user hits their target lap count. Uses the success
 * "notification" haptic which is a distinct three-tap pattern on iOS.
 */
export async function targetReachedHaptic(): Promise<void> {
  await safe(() =>
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)
  );
}

/** Used when the user taps Stop or Reset — light tap, "acknowledged". */
export async function controlHaptic(): Promise<void> {
  await safe(() => Haptics.selectionAsync());
}

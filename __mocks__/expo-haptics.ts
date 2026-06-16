/**
 * Manual mock for `expo-haptics`. Exposes spy-able async functions plus
 * test hooks to assert what's been triggered.
 */

export const ImpactFeedbackStyle = {
  Light: 'light',
  Medium: 'medium',
  Heavy: 'heavy',
  Soft: 'soft',
  Rigid: 'rigid',
};

export const NotificationFeedbackType = {
  Success: 'success',
  Warning: 'warning',
  Error: 'error',
};

const callLog: Array<{ kind: string; arg?: string }> = [];

export const impactAsync = jest.fn(async (style?: string) => {
  callLog.push({ kind: 'impact', arg: style });
});

export const notificationAsync = jest.fn(async (type?: string) => {
  callLog.push({ kind: 'notification', arg: type });
});

export const selectionAsync = jest.fn(async () => {
  callLog.push({ kind: 'selection' });
});

export function __getHapticCalls(): ReadonlyArray<{ kind: string; arg?: string }> {
  return [...callLog];
}

export function __resetHaptics(): void {
  callLog.length = 0;
  impactAsync.mockClear();
  notificationAsync.mockClear();
  selectionAsync.mockClear();
}

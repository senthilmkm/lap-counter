import { Platform } from 'react-native';

import {
  controlHaptic,
  lapHaptic,
  targetReachedHaptic,
} from '../haptics';

import * as Haptics from 'expo-haptics';

const HapticsMock = Haptics as unknown as typeof Haptics & {
  __getHapticCalls: () => ReadonlyArray<{ kind: string; arg?: string }>;
  __resetHaptics: () => void;
};

beforeEach(() => {
  HapticsMock.__resetHaptics();
});

describe('haptics service', () => {
  it('lapHaptic triggers a Double Heavy impact', async () => {
    await lapHaptic();
    expect(Haptics.impactAsync).toHaveBeenCalledTimes(2);
    expect(Haptics.impactAsync).toHaveBeenNthCalledWith(
      1,
      Haptics.ImpactFeedbackStyle.Heavy
    );
    expect(Haptics.impactAsync).toHaveBeenNthCalledWith(
      2,
      Haptics.ImpactFeedbackStyle.Heavy
    );
  });

  it('targetReachedHaptic triggers a Success notification haptic', async () => {
    await targetReachedHaptic();
    expect(Haptics.notificationAsync).toHaveBeenCalledTimes(1);
    expect(Haptics.notificationAsync).toHaveBeenCalledWith(
      Haptics.NotificationFeedbackType.Success
    );
  });

  it('controlHaptic triggers a selection haptic', async () => {
    await controlHaptic();
    expect(Haptics.selectionAsync).toHaveBeenCalledTimes(1);
  });

  it('swallows errors thrown by the haptic engine (does not propagate)', async () => {
    (Haptics.impactAsync as jest.Mock).mockRejectedValueOnce(
      new Error('no haptic engine')
    );
    await expect(lapHaptic()).resolves.toBeUndefined();
  });

  it('is a no-op on the web platform', async () => {
    const original = Platform.OS;
    Object.defineProperty(Platform, 'OS', { value: 'web', configurable: true });
    try {
      await lapHaptic();
      await targetReachedHaptic();
      await controlHaptic();
      expect(Haptics.impactAsync).not.toHaveBeenCalled();
      expect(Haptics.notificationAsync).not.toHaveBeenCalled();
      expect(Haptics.selectionAsync).not.toHaveBeenCalled();
    } finally {
      Object.defineProperty(Platform, 'OS', {
        value: original,
        configurable: true,
      });
    }
  });
});

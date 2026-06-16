import '@testing-library/react-native';

// expo-keep-awake is a small surface; provide stable jest.fn() mocks so
// tests can assert the screen-on lifecycle.
jest.mock('expo-keep-awake', () => ({
  __esModule: true,
  activateKeepAwakeAsync: jest.fn(async () => undefined),
  deactivateKeepAwake: jest.fn(),
}));

// react-native-safe-area-context's native module never reports insets
// inside the test renderer, leaving Provider's children un-rendered.
// Stub it with passthrough components and zeroed insets.
jest.mock('react-native-safe-area-context', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const React = require('react');
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { View } = require('react-native');
  const insets = { top: 0, right: 0, bottom: 0, left: 0 };
  const frame = { x: 0, y: 0, width: 0, height: 0 };
  const passthrough = ({ children, ...props }: { children?: React.ReactNode } & Record<string, unknown>) =>
    React.createElement(View, props, children);
  return {
    SafeAreaProvider: passthrough,
    SafeAreaView: passthrough,
    SafeAreaConsumer: ({ children }: { children: (i: typeof insets) => React.ReactNode }) =>
      children(insets),
    SafeAreaInsetsContext: React.createContext(insets),
    SafeAreaFrameContext: React.createContext(frame),
    useSafeAreaInsets: () => insets,
    useSafeAreaFrame: () => frame,
    initialWindowMetrics: { insets, frame },
  };
});

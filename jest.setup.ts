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

// Mock expo-speech
jest.mock('expo-speech', () => ({
  speak: jest.fn(),
  isSpeakingAsync: jest.fn(async () => false),
  stop: jest.fn(),
}));

// Mock expo-sqlite
jest.mock('expo-sqlite', () => ({
  openDatabaseSync: jest.fn(() => ({
    execSync: jest.fn(),
    runSync: jest.fn(() => ({ changes: 1, lastInsertRowId: 1 })),
    getFirstSync: jest.fn(() => null),
    getAllSync: jest.fn(() => []),
  })),
}));

// Mock expo-file-system
jest.mock('expo-file-system', () => ({
  writeAsStringAsync: jest.fn(async () => undefined),
  cacheDirectory: 'file://mock-cache/',
  EncodingType: { UTF8: 'utf8' },
}));

// Mock expo-sharing
jest.mock('expo-sharing', () => ({
  isAvailableAsync: jest.fn(async () => true),
  shareAsync: jest.fn(async () => undefined),
}));

// Mock react-native-purchases
jest.mock('react-native-purchases', () => ({
  __esModule: true,
  default: {
    configure: jest.fn(),
    setLogLevel: jest.fn(),
    getCustomerInfo: jest.fn(async () => ({
      entitlements: { active: {} },
    })),
    getOfferings: jest.fn(async () => ({
      current: { availablePackages: [] },
    })),
    purchasePackage: jest.fn(async () => ({
      customerInfo: { entitlements: { active: {} } },
    })),
    restorePurchases: jest.fn(async () => ({
      entitlements: { active: {} },
    })),
  },
  LOG_LEVEL: { DEBUG: 0 },
}));

// Mock react-native-maps
jest.mock('react-native-maps', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const React = require('react');
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { View } = require('react-native');
  const MockMapView = (props: any) => React.createElement(View, props, props.children);
  const MockMarker = (props: any) => React.createElement(View, props, props.children);
  const MockPolyline = (props: any) => React.createElement(View, props, props.children);
  return {
    __esModule: true,
    default: MockMapView,
    Marker: MockMarker,
    Polyline: MockPolyline,
  };
});

/**
 * Manual mock for `expo-sensors`. Exposes `__emit` test hooks per-sensor
 * so tests can drive sensor streams without needing a device.
 */

type RemovableSubscription = { remove: () => void };

type Listener<T> = (value: T) => void;

function createSensor<T>() {
  const listeners: Listener<T>[] = [];
  const setUpdateInterval = jest.fn();
  const addListener = jest.fn((listener: Listener<T>): RemovableSubscription => {
    listeners.push(listener);
    return {
      remove: jest.fn(() => {
        const idx = listeners.indexOf(listener);
        if (idx >= 0) listeners.splice(idx, 1);
      }),
    };
  });
  const __emit = (value: T) => {
    for (const l of [...listeners]) l(value);
  };
  const __reset = () => {
    listeners.length = 0;
    setUpdateInterval.mockClear();
    addListener.mockClear();
  };
  return { setUpdateInterval, addListener, __emit, __reset };
}

export const Magnetometer = createSensor<{ x: number; y: number; z: number }>();
export const DeviceMotion = createSensor<{
  rotation?: { alpha: number; beta: number; gamma: number };
}>();
export const Gyroscope = createSensor<{ x: number; y: number; z: number }>();

const pedListeners: Listener<{ steps: number }>[] = [];
let pedAvailable = true;

export const Pedometer = {
  isAvailableAsync: jest.fn(async () => pedAvailable),
  watchStepCount: jest.fn((listener: Listener<{ steps: number }>) => {
    pedListeners.push(listener);
    return {
      remove: jest.fn(() => {
        const idx = pedListeners.indexOf(listener);
        if (idx >= 0) pedListeners.splice(idx, 1);
      }),
    };
  }),
  __emitSteps: (steps: number) => {
    for (const l of [...pedListeners]) l({ steps });
  },
  __setAvailable: (available: boolean) => {
    pedAvailable = available;
  },
  __reset: () => {
    pedListeners.length = 0;
    pedAvailable = true;
    (Pedometer.isAvailableAsync as jest.Mock).mockClear();
    (Pedometer.watchStepCount as jest.Mock).mockClear();
  },
};

export function __resetAllSensors() {
  Magnetometer.__reset();
  DeviceMotion.__reset();
  Gyroscope.__reset();
  Pedometer.__reset();
}

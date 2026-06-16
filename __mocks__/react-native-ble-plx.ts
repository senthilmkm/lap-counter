/**
 * Manual mock for `react-native-ble-plx`. Provides a controllable
 * BleManager whose `startDeviceScan` callback can be triggered from
 * tests via the `__emitDevice` test hook.
 */

export const State = {
  Unknown: 'Unknown',
  Resetting: 'Resetting',
  Unsupported: 'Unsupported',
  Unauthorized: 'Unauthorized',
  PoweredOff: 'PoweredOff',
  PoweredOn: 'PoweredOn',
};

type ScanCallback = (
  error: Error | null,
  device: { id: string; rssi: number | null } | null
) => void;

type ManagerHandle = {
  startDeviceScan: jest.Mock;
  stopDeviceScan: jest.Mock;
  state: jest.Mock;
  onStateChange: jest.Mock;
  __emitDevice: (device: { id: string; rssi: number | null }) => void;
  __emitScanError: (error: Error) => void;
  __scanCallback: ScanCallback | null;
};

const createdManagers: ManagerHandle[] = [];

export class BleManager {
  startDeviceScan: jest.Mock;
  stopDeviceScan: jest.Mock;
  state: jest.Mock;
  onStateChange: jest.Mock;
  __scanCallback: ScanCallback | null = null;

  constructor() {
    const self = this as unknown as ManagerHandle;
    this.startDeviceScan = jest.fn(
      (
        _serviceUUIDs: string[] | null,
        _options: unknown,
        cb: ScanCallback
      ) => {
        self.__scanCallback = cb;
      }
    );
    this.stopDeviceScan = jest.fn(() => {
      self.__scanCallback = null;
    });
    this.state = jest.fn(async () => State.PoweredOn);
    this.onStateChange = jest.fn(
      (_listener: (s: string) => void, _emitCurrent?: boolean) => ({
        remove: jest.fn(),
      })
    );
    self.__emitDevice = (device) => {
      self.__scanCallback?.(null, device);
    };
    self.__emitScanError = (error) => {
      self.__scanCallback?.(error, null);
    };
    createdManagers.push(self);
  }
}

export function __getLastManager(): ManagerHandle | undefined {
  return createdManagers[createdManagers.length - 1];
}

export function __resetManagers() {
  createdManagers.length = 0;
}

export default { BleManager, State };

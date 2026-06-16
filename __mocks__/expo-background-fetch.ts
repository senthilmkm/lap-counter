/**
 * Manual mock for `expo-background-fetch`. Coordinates with the
 * `expo-task-manager` mock — `registerTaskAsync` flips the task into
 * the registered set, `unregisterTaskAsync` clears it.
 */

import {
  __markRegistered,
  __markUnregistered,
} from './expo-task-manager';

export const BackgroundFetchResult = {
  NoData: 1,
  NewData: 2,
  Failed: 3,
};

export const BackgroundFetchStatus = {
  Denied: 1,
  Restricted: 2,
  Available: 3,
};

let status: number = BackgroundFetchStatus.Available;
const registrations: Array<{ name: string; opts: unknown }> = [];

export const getStatusAsync = jest.fn(async () => status);

export const registerTaskAsync = jest.fn(
  async (name: string, opts?: unknown) => {
    __markRegistered(name);
    registrations.push({ name, opts });
  }
);

export const unregisterTaskAsync = jest.fn(async (name: string) => {
  __markUnregistered(name);
});

export const setMinimumIntervalAsync = jest.fn(async () => undefined);

export function __setStatus(next: number): void {
  status = next;
}

export function __getRegistrations(): ReadonlyArray<{
  name: string;
  opts: unknown;
}> {
  return [...registrations];
}

export function __resetBackgroundFetch(): void {
  status = BackgroundFetchStatus.Available;
  registrations.length = 0;
  getStatusAsync.mockClear();
  registerTaskAsync.mockClear();
  unregisterTaskAsync.mockClear();
  setMinimumIntervalAsync.mockClear();
}

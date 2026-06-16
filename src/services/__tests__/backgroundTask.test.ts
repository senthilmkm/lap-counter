import * as BackgroundFetch from 'expo-background-fetch';
import * as TaskManager from 'expo-task-manager';

import {
  BACKGROUND_TASK_NAME,
  getLastBackgroundInvocation,
  registerBackgroundTask,
  unregisterBackgroundTask,
} from '../backgroundTask';

const TaskManagerMock = TaskManager as unknown as typeof TaskManager & {
  __runTask: (name: string) => Promise<unknown>;
  __getDefinedTaskNames: () => string[];
  __resetTaskRegistrations: () => void;
};

const BackgroundFetchMock = BackgroundFetch as unknown as typeof BackgroundFetch & {
  __setStatus: (next: number) => void;
  __getRegistrations: () => ReadonlyArray<{ name: string; opts: unknown }>;
  __resetBackgroundFetch: () => void;
};

beforeEach(() => {
  // Soft reset only — keep the task DEFINITION installed by the
  // module-level `defineTask` call when this file first loaded.
  TaskManagerMock.__resetTaskRegistrations();
  BackgroundFetchMock.__resetBackgroundFetch();
});

describe('backgroundTask module load', () => {
  it('defines the background task at module-load time', () => {
    const names = TaskManagerMock.__getDefinedTaskNames();
    expect(names).toContain(BACKGROUND_TASK_NAME);
  });
});

describe('backgroundTask.registerBackgroundTask', () => {
  it('registers the task when background fetch is available', async () => {
    const ok = await registerBackgroundTask();
    expect(ok).toBe(true);
    const regs = BackgroundFetchMock.__getRegistrations();
    expect(regs.map((r) => r.name)).toContain(BACKGROUND_TASK_NAME);
  });

  it('is idempotent: calling twice does not double-register', async () => {
    await registerBackgroundTask();
    await registerBackgroundTask();
    const regs = BackgroundFetchMock.__getRegistrations();
    const matching = regs.filter((r) => r.name === BACKGROUND_TASK_NAME);
    expect(matching.length).toBe(1);
  });

  it('returns false when background fetch is denied (and skips registration)', async () => {
    BackgroundFetchMock.__setStatus(BackgroundFetch.BackgroundFetchStatus.Denied);
    const ok = await registerBackgroundTask();
    expect(ok).toBe(false);
    expect(BackgroundFetch.registerTaskAsync).not.toHaveBeenCalled();
  });

  it('returns false (and does not throw) when registration fails', async () => {
    (BackgroundFetch.registerTaskAsync as jest.Mock).mockRejectedValueOnce(
      new Error('boom')
    );
    const ok = await registerBackgroundTask();
    expect(ok).toBe(false);
  });
});

describe('backgroundTask.unregisterBackgroundTask', () => {
  it('unregisters a previously-registered task', async () => {
    await registerBackgroundTask();
    await unregisterBackgroundTask();
    expect(BackgroundFetch.unregisterTaskAsync).toHaveBeenCalledWith(
      BACKGROUND_TASK_NAME
    );
  });

  it('is a no-op when the task was never registered', async () => {
    await unregisterBackgroundTask();
    expect(BackgroundFetch.unregisterTaskAsync).not.toHaveBeenCalled();
  });

  it('swallows errors from the OS layer', async () => {
    await registerBackgroundTask();
    (BackgroundFetch.unregisterTaskAsync as jest.Mock).mockRejectedValueOnce(
      new Error('boom')
    );
    await expect(unregisterBackgroundTask()).resolves.toBeUndefined();
  });
});

describe('backgroundTask body', () => {
  it('records the most recent invocation and returns NoData on success', async () => {
    const result = await TaskManagerMock.__runTask(BACKGROUND_TASK_NAME);
    expect(result).toBe(BackgroundFetch.BackgroundFetchResult.NoData);
    const last = getLastBackgroundInvocation();
    expect(last).not.toBeNull();
    expect(last!.result).toBe(BackgroundFetch.BackgroundFetchResult.NoData);
    expect(typeof last!.at).toBe('number');
  });
});

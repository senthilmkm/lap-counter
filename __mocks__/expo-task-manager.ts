/**
 * Manual mock for `expo-task-manager`. Stores defined tasks in a map
 * so tests can trigger them on demand to validate task bodies.
 */

type TaskExecutor = (data: { data?: unknown; error?: unknown }) => unknown;

const tasks = new Map<string, TaskExecutor>();
const registered = new Set<string>();

export const defineTask = jest.fn((name: string, executor: TaskExecutor) => {
  tasks.set(name, executor);
});

export const isTaskRegisteredAsync = jest.fn(async (name: string) => {
  return registered.has(name);
});

export const isAvailableAsync = jest.fn(async () => true);

export const unregisterTaskAsync = jest.fn(async (name: string) => {
  registered.delete(name);
});

/**
 * Mark a task as registered without going through the BackgroundFetch
 * path — used by the BackgroundFetch mock under the hood.
 */
export function __markRegistered(name: string): void {
  registered.add(name);
}

export function __markUnregistered(name: string): void {
  registered.delete(name);
}

/** Invoke a defined task body and return whatever it returns. */
export async function __runTask(name: string): Promise<unknown> {
  const executor = tasks.get(name);
  if (!executor) {
    throw new Error(`Task "${name}" is not defined`);
  }
  return await executor({});
}

export function __getDefinedTaskNames(): string[] {
  return [...tasks.keys()];
}

/**
 * Soft reset between tests — keeps task DEFINITIONS (so module-level
 * `defineTask` calls survive) but clears the registered set and mock
 * call history. Use this in `beforeEach`.
 */
export function __resetTaskRegistrations(): void {
  registered.clear();
  isTaskRegisteredAsync.mockClear();
  isAvailableAsync.mockClear();
  unregisterTaskAsync.mockClear();
}

/** Hard reset including task definitions. Generally only useful at module unload. */
export function __resetTaskManager(): void {
  tasks.clear();
  registered.clear();
  defineTask.mockClear();
  isTaskRegisteredAsync.mockClear();
  isAvailableAsync.mockClear();
  unregisterTaskAsync.mockClear();
}

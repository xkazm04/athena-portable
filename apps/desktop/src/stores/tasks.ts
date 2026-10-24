/**
 * The delegated tasks, as both windows hold them - fleet-surfaces WP6. A mirror of `GET /tasks`
 * that follows `task.changed` on the bus. Stub until WP6 lands: the signatures are final.
 */
import { create } from "zustand";
import type { TaskView } from "@/lib/tasks";

export interface TasksState {
  tasks: TaskView[];
  cap: number;
  loaded: boolean;
  problem: string | null;
}

export const useTasks = create<TasksState>(() => ({ tasks: [], cap: 3, loaded: false, problem: null }));

/** Read the tasks and follow the bus until the returned stop is called. */
export function startTasks(): () => void {
  return () => {};
}

/** Kill a queued or running task, then read the list again. */
export async function stopTask(taskId: string): Promise<void> {
  void taskId;
}

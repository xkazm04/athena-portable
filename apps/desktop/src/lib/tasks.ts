/**
 * Delegated tasks, as the windows read them - fleet-surfaces, ADR 0141, `src/athena/daemon/tasks.py`.
 *
 * Athena hands a job to a background task with `core.delegate`; the daemon admits it (at most
 * {@link TASKS_RUNNING_CAP} running, {@link TASKS_QUEUED_CAP} queued) and her window runs it on a
 * tab of its own, in the conversation `conv_task_<hex>`. Rows are updated in place; the three
 * timestamps are each written once, when that event happened.
 *
 * The shapes are the Python's, field for field, with absent values `null` (never omitted).
 */

export type TaskStatus = "queued" | "running" | "done" | "failed" | "killed" | "interrupted";

export const TASKS_RUNNING_CAP = 3;
export const TASKS_QUEUED_CAP = 10;

export interface TaskView {
  id: string;
  parent_conversation: string;
  conversation_id: string;
  title: string;
  app_id: string | null;
  origin: string | null;
  status: TaskStatus;
  tab_id: number | null;
  /** 1-based place in the queue, only while `queued`. */
  position: number | null;
  result: string | null;
  error: string | null;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
}

/** `GET /tasks`. */
export interface TasksView {
  tasks: TaskView[];
  cap: number;
  running: number;
  queued: number;
}

/** Still holding a place: queued or running. */
export function isActive(task: Pick<TaskView, "status">): boolean {
  return task.status === "queued" || task.status === "running";
}

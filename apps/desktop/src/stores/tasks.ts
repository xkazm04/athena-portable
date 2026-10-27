/**
 * The delegated tasks, as both windows hold them - fleet-surfaces (ADR 0141, `daemon/tasks.py`).
 *
 * A mirror of `GET /tasks` and nothing more: the daemon admits, queues and ends every task, and her
 * window runs them (`stores/task-runner.ts`). This store only shows them. It is read by two
 * surfaces at once - the strip above her composer and the row under the bell on Main - so
 * {@link startTasks} is counted: the first caller reads the list and follows the bus, the last one
 * to stop ends the following. Each window runs its own copy against its own daemon endpoint
 * (`stores/daemon`).
 *
 * The bus is the fast path and the list is the truth. A `task.changed` frame carries the whole row,
 * so it is put in place by id ({@link upsertTask}) without a read; every (re)connect of the bus
 * reads the list again, because a frame published between two streams is missed. The daemon ends a
 * quiet stream every 15 s and a daemon with no bus refuses it at once, so a reconnect read is held
 * to one per {@link REREAD_MIN_MS}: the list then refreshes on that beat by itself, bus or no bus.
 *
 * A queued row's `position` is the daemon's, read with the list. A frame moves one row, and the
 * others' places move with it (a claim moves everyone up one), so after a frame the places are
 * counted again here the way the daemon counts them: oldest queued first ({@link withPositions}).
 *
 * `held` is the gate's sentence for why queued tasks wait (device-vitals, ADR 0143), kept from the
 * list and from each `vitals.changed`, which carries it; an older daemon sends none, which is `null`.
 *
 * It is the one mirror of the tasks in a window. The task runner in her window (`stores/task-runner.ts`)
 * holds it like a surface, handing {@link startTasks} an ear that hears what the mirror applies - each
 * frame, and each list a read answered - instead of following the bus and reading the list a second
 * time beside it.
 *
 * An older daemon has no `/tasks`: its 404 is "no tasks", not a problem, so neither surface shows
 * a line about a feature the daemon does not have. A daemon that is not up yet is not a problem
 * either - the bus follower waits for it and reads on connect.
 */
import { useEffect, useState } from "react";
import { create } from "zustand";

import { ApiError, DaemonApi } from "@/lib/api";
import { followBus } from "@/lib/fleet";
import { parseStamp } from "@/lib/time";
import { isActive, type TaskView } from "@/lib/tasks";
import { endpoint, useDaemon } from "@/stores/daemon";

export interface TasksState {
  tasks: TaskView[];
  /** Why queued tasks wait for room, a sentence for a person; `null` when nothing holds them. */
  held: string | null;
  problem: string | null;
}

/** The least time between two reads a bus (re)connect asks for. */
export const REREAD_MIN_MS = 5000;
/** How long a finished task stays on the strip and on Main. */
export const RECENT_MS = 10 * 60_000;

export interface TasksDeps {
  api: () => DaemonApi | null;
  now: () => number;
  /**
   * Follow the bus: `onTask` for each `task.changed`, `onConnected` on each (re)connect. Returns
   * what stops it. Absent in a test that drives the reads by hand.
   */
  follow?: (onTask: (task: TaskView) => void, onConnected: () => void) => () => void;
}

const liveApi = () => {
  const found = endpoint(useDaemon.getState());
  return found ? new DaemonApi(found) : null;
};

const LIVE: TasksDeps = {
  api: liveApi,
  now: Date.now,
  follow: (onTask, onConnected) =>
    followBus(
      liveApi,
      (event) => {
        if (event.kind === "task.changed") onTask(event.task);
        else if (event.kind === "vitals.changed") useTasks.setState({ held: event.held });
      },
      onConnected,
    ),
};

let deps: TasksDeps = LIVE;

export function setTasksDeps(next: TasksDeps): void {
  deps = next;
}

const EMPTY_TASKS: TasksState = { tasks: [], held: null, problem: null };

export const useTasks = create<TasksState>(() => ({ ...EMPTY_TASKS }));

// -- the pure part: what a frame does to the list, and what the surfaces show ----------------------

/** Oldest first by when it was created, the id breaking a tie - the queue's own order. */
function byAge(a: TaskView, b: TaskView): number {
  return a.created_at === b.created_at ? (a.id < b.id ? -1 : 1) : a.created_at < b.created_at ? -1 : 1;
}

/** Count the queue's places again: 1-based, oldest queued first; `null` on every other row. */
export function withPositions(tasks: readonly TaskView[]): TaskView[] {
  const order = new Map(
    tasks
      .filter((t) => t.status === "queued")
      .sort(byAge)
      .map((t, n) => [t.id, n + 1] as const),
  );
  return tasks.map((t) => {
    const position = order.get(t.id) ?? null;
    return t.position === position ? t : { ...t, position };
  });
}

/** One `task.changed`: the row replaced by id, or added; newest first; places counted again. */
export function upsertTask(tasks: readonly TaskView[], task: TaskView): TaskView[] {
  // Sorted again below, so the old row is dropped and the new one put anywhere.
  return withPositions([task, ...tasks.filter((t) => t.id !== task.id)].sort((a, b) => -byAge(a, b)));
}

/** When a row ended, in epoch ms; `null` while it is active or when the stamp cannot be read. */
function endedAt(task: TaskView): number | null {
  return isActive(task) ? null : (parseStamp(task.finished_at)?.getTime() ?? null);
}

/**
 * What the strip and Main show, in the order they show it: running, then the queue in its order,
 * then what ended in the last {@link RECENT_MS}, newest first. An ended row whose time cannot be
 * read is not shown: "recently" is a claim about a time.
 */
export function shownTasks(tasks: readonly TaskView[], now: number): TaskView[] {
  const running = tasks.filter((t) => t.status === "running").sort(byAge);
  const queued = tasks.filter((t) => t.status === "queued").sort((a, b) => (a.position ?? 0) - (b.position ?? 0) || byAge(a, b));
  const ended = tasks
    .filter((t) => {
      const at = endedAt(t);
      return at !== null && now - at <= RECENT_MS;
    })
    .sort((a, b) => (endedAt(b) ?? 0) - (endedAt(a) ?? 0));
  return [...running, ...queued, ...ended];
}

/** "2 running · 1 in line · 1 finished": the parts that are not zero, or "" when none is. */
export function summaryOf(shown: readonly TaskView[]): string {
  const running = shown.filter((t) => t.status === "running").length;
  const queued = shown.filter((t) => t.status === "queued").length;
  const ended = shown.length - running - queued;
  return [
    running ? `${running} running` : "",
    queued ? `${queued} in line` : "",
    ended ? `${ended} finished` : "",
  ]
    .filter(Boolean)
    .join(" · ");
}

/** What a person asks her about a task, the same words from both windows. */
export function askAbout(task: Pick<TaskView, "title">): string {
  return `How is ${task.title} going?`;
}

/**
 * The instant the rows are drawn at: every second while one is running, so its time moves, and
 * every half minute otherwise, so a finished row leaves after {@link RECENT_MS} on its own. Not
 * while the window is hidden, where nobody reads it: it catches up the moment it is shown.
 */
export function useTasksNow(running: boolean): number {
  const [now, setNow] = useState(deps.now);
  useEffect(() => {
    const tick = () => document.hidden || setNow(deps.now());
    const timer = setInterval(tick, running ? 1000 : 30_000);
    document.addEventListener("visibilitychange", tick);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", tick);
    };
  }, [running]);
  return now;
}

/** A failed read or kill in one plain sentence. */
function sentenceOf(doing: string, error: unknown): string {
  const why = error instanceof ApiError ? error.message || error.reason : error instanceof Error ? error.message : String(error);
  return `Could not ${doing}: ${why}`;
}

// -- who listens ---------------------------------------------------------------------------------

/** What hears the mirror: `ear(rows)` for each list a read answered, `ear(null, row)` after each frame. */
export type TasksEar = (list: TaskView[] | null, frame?: TaskView) => void;

/**
 * The one ear a window has (her window's task runner). A slot, not a list, and handed in through
 * {@link startTasks} rather than a function of its own, to keep the first frame lean.
 */
let ear: TasksEar | undefined;

// -- the reads -----------------------------------------------------------------------------------

/** A frame was applied since the read in flight began: that read is read once more. */
let framed = false;
let reading: Promise<void> | null = null;
let lastRead = Number.NEGATIVE_INFINITY;

async function readOnce(client: DaemonApi): Promise<void> {
  framed = false;
  try {
    const view = await client.tasks();
    useTasks.setState({ tasks: view.tasks, held: view.held ?? null, problem: null });
    ear?.(view.tasks);
  } catch (error) {
    // No `/tasks` on this daemon: it has no tasks to show, which is not a fault to tell anyone.
    useTasks.setState(
      error instanceof ApiError && error.status === 404
        ? { tasks: [], held: null, problem: null }
        : { problem: sentenceOf("read her tasks", error) },
    );
  }
}

/**
 * Read the list now. One read at a time: a call while one is in flight shares it. A frame that
 * arrived while the read was out may be older than the answer or newer, so the list is read once
 * more rather than guessed at.
 */
export async function loadTasks(): Promise<void> {
  if (reading) return reading;
  const client = deps.api();
  if (!client) return; // not up yet: the follower reads on connect
  lastRead = deps.now();
  reading = (async () => {
    await readOnce(client);
    if (framed) await readOnce(client);
  })().finally(() => {
    reading = null;
  });
  return reading;
}

/** One `task.changed`, applied in place. */
export function applyTask(task: TaskView): void {
  framed = true;
  useTasks.setState((s) => ({ tasks: upsertTask(s.tasks, task) }));
  ear?.(null, task);
}

/** A bus (re)connect: read again, at most once per {@link REREAD_MIN_MS}. */
function reconnected(): void {
  if (deps.now() - lastRead >= REREAD_MIN_MS) void loadTasks();
}

// -- the count of who is showing them -------------------------------------------------------------

let holders = 0;
let unfollow: (() => void) | null = null;

/**
 * Read the tasks and follow the bus until the returned stop is called. Counted: every caller gets
 * its own stop, each stop counts once, and the following ends with the last. Each new holder has
 * the list read for it (or joins the read that is out), so what it first sees was read after it came.
 *
 * A holder that brings an `ear` hears the mirror until its stop: the first list it hears is that read.
 */
export function startTasks(heard?: TasksEar): () => void {
  if (heard) ear = heard;
  void loadTasks();
  if (++holders === 1) unfollow = deps.follow?.(applyTask, reconnected) ?? null;
  let stopped = false;
  return () => {
    if (stopped) return;
    stopped = true;
    if (heard) ear = undefined;
    if (!--holders) {
      unfollow?.();
      unfollow = null;
    }
  };
}

/** Kill a queued or running task, then read the list again. A refusal becomes the problem line. */
export async function stopTask(taskId: string): Promise<void> {
  const client = deps.api();
  if (!client) {
    useTasks.setState({ problem: sentenceOf("kill the task", "Athena is not running here yet.") });
    return;
  }
  let refused: string | null = null;
  try {
    await client.stopTask(taskId);
  } catch (error) {
    refused = sentenceOf("kill the task", error);
  }
  // A read already out may have left before the kill: wait for it, then read what the kill did.
  // The read clears the problem line when it succeeds, so a refusal is said after it, not before.
  await reading;
  await loadTasks();
  if (refused) useTasks.setState({ problem: refused });
}

export function resetTasksForTests(): void {
  unfollow?.();
  unfollow = null;
  holders = 0;
  ear = undefined;
  reading = null;
  framed = false;
  lastRead = Number.NEGATIVE_INFINITY;
  deps = LIVE;
  useTasks.setState({ ...EMPTY_TASKS });
}

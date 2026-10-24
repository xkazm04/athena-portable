/** The tasks mirror against a fake daemon - fleet-surfaces, ADR 0141 (`src/athena/daemon/tasks.py`). */
import { beforeEach, describe, expect, it } from "vitest";

import { DaemonApi } from "@/lib/api";
import type { TaskView, TasksView } from "@/lib/tasks";

import {
  REREAD_MIN_MS,
  RECENT_MS,
  askAbout,
  loadTasks,
  resetTasksForTests,
  setTasksDeps,
  shownTasks,
  startTasks,
  stopTask,
  summaryOf,
  upsertTask,
  useTasks,
  withPositions,
} from "./tasks";

const T0 = Date.parse("2026-10-24T12:00:00Z");

function task(n: number, over: Partial<TaskView> = {}): TaskView {
  const hex = n.toString(16).padStart(12, "0");
  return {
    id: `task_${hex}`,
    parent_conversation: "conv_000000000001",
    conversation_id: `conv_task_${hex}`,
    title: `Task ${n}`,
    app_id: null,
    origin: null,
    status: "queued",
    tab_id: null,
    position: null,
    result: null,
    error: null,
    created_at: new Date(T0 + n * 1000).toISOString(),
    started_at: null,
    finished_at: null,
    ...over,
  };
}

function json(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), { status, headers: { "content-type": "application/json" } });
}

interface Seen {
  method: string;
  path: string;
}

/** A daemon whose `/tasks` answers `read()` each time, and whose other routes answer `routes`. */
function wire(read: () => Response, routes: (seen: Seen) => Response | undefined = () => undefined) {
  const seen: Seen[] = [];
  const fetchImpl = async (url: string, init: RequestInit = {}) => {
    const entry = { method: init.method ?? "GET", path: url.replace("http://daemon", "") };
    seen.push(entry);
    if (entry.method === "GET" && entry.path === "/tasks") return read();
    return routes(entry) ?? json({ ok: false, reason: "unknown_ref", detail: entry.path }, 404);
  };
  const api = new DaemonApi({ url: "http://daemon", token: "t" }, fetchImpl);
  const bus: { onTask: ((t: TaskView) => void) | null; onConnected: (() => void) | null; follows: number; stops: number } = {
    onTask: null,
    onConnected: null,
    follows: 0,
    stops: 0,
  };
  setTasksDeps({
    api: () => api,
    now: () => clock,
    follow: (onTask, onConnected) => {
      bus.follows += 1;
      bus.onTask = onTask;
      bus.onConnected = onConnected;
      return () => {
        bus.stops += 1;
      };
    },
  });
  return { seen, bus, reads: () => seen.filter((s) => s.path === "/tasks").length };
}

const page = (tasks: TaskView[]): TasksView => ({
  tasks,
  cap: 3,
  running: tasks.filter((t) => t.status === "running").length,
  queued: tasks.filter((t) => t.status === "queued").length,
});

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

let clock = T0;
beforeEach(() => {
  resetTasksForTests();
  clock = T0 + 60_000;
});

describe("the reducer", () => {
  it("counts the queue's places oldest first, and clears them on every other row", () => {
    const rows = withPositions([task(3), task(1), task(2, { status: "running", position: 9 })]);
    expect(rows.map((t) => [t.id.slice(-1), t.position])).toEqual([
      ["3", 2],
      ["1", 1],
      ["2", null],
    ]);
  });

  it("replaces a row by id in place, without adding one", () => {
    const before = [task(2, { position: 2 }), task(1, { position: 1 })];
    const after = upsertTask(before, task(1, { status: "running", started_at: "2026-10-24T12:00:30Z" }));
    expect(after).toHaveLength(2);
    expect(after.find((t) => t.id === task(1).id)?.status).toBe("running");
  });

  it("moves the queue up when its head is claimed", () => {
    const before = withPositions([task(3), task(2), task(1)]);
    const after = upsertTask(before, task(1, { status: "running" }));
    expect(after.map((t) => t.position)).toEqual([2, 1, null]);
  });

  it("adds a row it has not seen, newest first", () => {
    const after = upsertTask([task(1)], task(5));
    expect(after.map((t) => t.id)).toEqual([task(5).id, task(1).id]);
    expect(after.map((t) => t.position)).toEqual([2, 1]);
  });

  it("shows running, then the queue in order, then what ended in the last ten minutes, newest first", () => {
    const now = T0 + RECENT_MS + 5000;
    const rows = [
      task(1, { status: "done", finished_at: new Date(T0 + 1000).toISOString() }), // ended too long ago
      task(2, { status: "failed", finished_at: new Date(now - 60_000).toISOString() }),
      task(3, { status: "killed", finished_at: new Date(now - 1000).toISOString() }),
      task(4, { status: "queued", position: 2 }),
      task(5, { status: "running" }),
      task(6, { status: "queued", position: 1 }),
      task(7, { status: "interrupted", finished_at: null }), // no time to call recent
    ];
    expect(shownTasks(rows, now).map((t) => t.title)).toEqual(["Task 5", "Task 6", "Task 4", "Task 3", "Task 2"]);
  });

  it("sums the shown rows in one line, leaving out what is zero", () => {
    const rows = [task(1, { status: "running" }), task(2, { status: "running" }), task(3), task(4, { status: "done" })];
    expect(summaryOf(rows)).toBe("2 running · 1 in line · 1 finished");
    expect(summaryOf([task(3)])).toBe("1 in line");
    expect(summaryOf([])).toBe("");
  });

  it("asks about a task in the same words from both windows", () => {
    expect(askAbout({ title: "Invoices in Shadowrunr" })).toBe("How is Invoices in Shadowrunr going?");
  });
});

describe("the mirror", () => {
  it("reads the list, the cap, and marks it loaded", async () => {
    wire(() => json(page([task(1, { position: 1 })])));
    await loadTasks();
    const s = useTasks.getState();
    expect(s.loaded).toBe(true);
    expect(s.cap).toBe(3);
    expect(s.tasks.map((t) => t.id)).toEqual([task(1).id]);
    expect(s.problem).toBeNull();
  });

  it("keeps the gate's reason the queue waits, and an older daemon's silence as none (ADR 0142)", async () => {
    const held = "Waiting for room: memory is 94% used; tasks start again under 85%.";
    let answer: TasksView = { ...page([task(1, { position: 1 })]), slots: 0, held };
    wire(() => json(answer));
    expect(useTasks.getState().held).toBeNull();
    await loadTasks();
    expect(useTasks.getState().held).toBe(held);
    answer = page([task(1, { position: 1 })]); // no `slots`, no `held`: an older daemon
    await loadTasks();
    expect(useTasks.getState().held).toBeNull();
  });

  it("forgets the reason when the daemon turns out to have no /tasks", async () => {
    let gone = false;
    wire(() => (gone ? json({ ok: false, reason: "unknown_ref", detail: "/tasks" }, 404) : json({ ...page([task(1)]), held: "Waiting for room: on battery." })));
    await loadTasks();
    gone = true;
    await loadTasks();
    expect(useTasks.getState().held).toBeNull();
  });

  it("reads an older daemon's 404 as no tasks, not as a problem", async () => {
    wire(() => json({ ok: false, reason: "unknown_ref", detail: "/tasks" }, 404));
    await loadTasks();
    expect(useTasks.getState()).toMatchObject({ tasks: [], loaded: true, problem: null });
  });

  it("says a failed read in one plain sentence and keeps what it had", async () => {
    let fail = false;
    wire(() => (fail ? json({ ok: false, reason: "internal", detail: "the ledger is locked" }, 500) : json(page([task(1)]))));
    await loadTasks();
    fail = true;
    await loadTasks();
    const s = useTasks.getState();
    expect(s.problem).toBe("Could not read her tasks: the ledger is locked");
    expect(s.tasks).toHaveLength(1);
  });

  it("does nothing, and says nothing, before the daemon is up", async () => {
    setTasksDeps({ api: () => null, now: () => clock });
    await loadTasks();
    expect(useTasks.getState()).toMatchObject({ loaded: false, problem: null });
  });

  it("puts a task.changed row in place without a read, and reads again on a reconnect", async () => {
    const daemon = wire(() => json(page([task(1, { position: 1 })])));
    const stop = startTasks();
    await settle();
    expect(daemon.reads()).toBe(1);
    daemon.bus.onTask!(task(1, { status: "running" }));
    expect(useTasks.getState().tasks[0]).toMatchObject({ status: "running", position: null });
    expect(daemon.reads()).toBe(1);
    clock += REREAD_MIN_MS;
    daemon.bus.onConnected!();
    await settle();
    expect(daemon.reads()).toBe(2);
    stop();
  });

  it("holds the reads a reconnect asks for to one per beat", async () => {
    const daemon = wire(() => json(page([])));
    const stop = startTasks();
    await settle();
    daemon.bus.onConnected!();
    daemon.bus.onConnected!();
    await settle();
    expect(daemon.reads()).toBe(1);
    clock += REREAD_MIN_MS;
    daemon.bus.onConnected!();
    await settle();
    expect(daemon.reads()).toBe(2);
    stop();
  });

  it("reads once more when a frame arrived while a read was out", async () => {
    let release: () => void = () => {};
    let first = true;
    const daemon = wire(() => json(page([task(1)])));
    const original = daemon.bus;
    // Hold the first read until a frame has come in.
    setTasksDeps({
      api: () =>
        new DaemonApi({ url: "http://daemon", token: "t" }, async (url) => {
          if (first) {
            first = false;
            await new Promise<void>((resolve) => (release = resolve));
          }
          daemon.seen.push({ method: "GET", path: String(url).replace("http://daemon", "") });
          return json(page([task(1)]));
        }),
      now: () => clock,
      follow: (onTask) => {
        original.onTask = onTask;
        return () => {};
      },
    });
    const stop = startTasks();
    original.onTask!(task(2));
    release();
    await settle();
    await settle();
    expect(daemon.reads()).toBe(2);
    stop();
  });

  it("is counted: two holders follow once, and the bus stops with the last", async () => {
    const daemon = wire(() => json(page([])));
    const a = startTasks();
    const b = startTasks();
    await settle();
    expect(daemon.bus.follows).toBe(1);
    expect(daemon.reads()).toBe(1);
    a();
    a(); // a second stop of the same holder counts once
    expect(daemon.bus.stops).toBe(0);
    b();
    expect(daemon.bus.stops).toBe(1);
    const c = startTasks();
    expect(daemon.bus.follows).toBe(2);
    c();
  });

  it("kills by id, then reads the list again", async () => {
    let killed = false;
    const daemon = wire(
      () => json(page([task(1, { status: killed ? "killed" : "running", finished_at: killed ? "2026-10-24T12:01:00Z" : null })])),
      (s) => {
        if (s.method === "POST" && s.path === `/tasks/${task(1).id}/stop`) {
          killed = true;
          return json({ stopped: true });
        }
        return undefined;
      },
    );
    await loadTasks();
    await stopTask(task(1).id);
    expect(daemon.seen.map((s) => `${s.method} ${s.path}`)).toEqual([
      "GET /tasks",
      `POST /tasks/${task(1).id}/stop`,
      "GET /tasks",
    ]);
    expect(useTasks.getState().tasks[0]!.status).toBe("killed");
  });

  it("says a refused kill after the read, so the read does not wipe it", async () => {
    wire(
      () => json(page([task(1, { status: "running" })])),
      () => json({ ok: false, reason: "internal", detail: "the door would not close" }, 500),
    );
    await stopTask(task(1).id);
    expect(useTasks.getState().problem).toBe("Could not kill the task: the door would not close");
  });
});

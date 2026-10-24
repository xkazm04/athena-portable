/**
 * The task runner (fleet-surfaces WP5, ADR 0141): her window claims a delegated task, gives it a
 * tab of its own - never the focused one, never another task's - runs its turns with `task_id`,
 * executes its page calls on that tab, and finishes it; a kill aborts it at once.
 *
 * The real runner and the real run store against a fake daemon that answers `fetch` with the
 * daemon's own JSON and SSE frames, and a fake page per tab. No shell, no bus: frames a bus would
 * carry are handed to `taskChanged`, which is what the bus calls.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { DaemonApi } from "@/lib/api";
import type { Tab } from "@/lib/ipc";
import type { TaskView } from "@/lib/tasks";
import type { BusEvent } from "@/lib/fleet";
import type { TabTools } from "@/stores/tools";

import { resetRunForTests, setRunDeps, useRun } from "./run";
import {
  ORPHANED,
  TASK_OPENING,
  TASK_RESULT_CAP,
  addressOf,
  resetRunnerForTests,
  resultOf,
  setRunnerDeps,
  startTaskRunner,
  taskChanged,
  tickRunner,
  useTaskRunner,
  type RunnerDeps,
} from "./task-runner";

type Event = Record<string, unknown>;

const json = (payload: unknown, status = 200) =>
  new Response(JSON.stringify(payload), { status, headers: { "content-type": "application/json" } });

function frames(events: Event[], signal: AbortSignal | undefined, hang: boolean): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const event of events) controller.enqueue(encoder.encode(`event: ${String(event.kind)}\ndata: ${JSON.stringify(event)}\n\n`));
      if (!hang) controller.close();
      else signal?.addEventListener("abort", () => controller.error(new DOMException("aborted", "AbortError")));
    },
  });
}

function task(id: string, over: Partial<TaskView> = {}): TaskView {
  return {
    id,
    parent_conversation: "conv_0000000000aa",
    conversation_id: `conv_task_${id.slice(5)}`,
    title: "Chase March invoices",
    app_id: "ledgerbox",
    origin: "https://ledgerbox.local",
    status: "running",
    tab_id: null,
    position: null,
    result: null,
    error: null,
    created_at: "2026-10-24T10:00:00Z",
    started_at: "2026-10-24T10:00:01Z",
    finished_at: null,
    ...over,
  };
}

interface Script {
  /** What each `POST /tasks/claim` hands out, in order; then `null`. */
  claims?: TaskView[];
  /** `GET /tasks` rows. */
  rows?: TaskView[];
  /** `POST /run` answers per task id, in order: frames, or frames then held open. */
  runs?: Record<string, Array<Event[] | { hang: Event[] } | { refuse: string }>>;
  resolutions?: Record<string, unknown>;
}

function fakeDaemon(script: Script) {
  const seen: Array<{ path: string; body: Record<string, unknown> | null; signal?: AbortSignal }> = [];
  const claims = [...(script.claims ?? [])];
  const turns: Record<string, number> = {};
  const fetchImpl = async (url: string, init: RequestInit = {}): Promise<Response> => {
    const path = url.replace("http://daemon", "");
    const body = typeof init.body === "string" ? (JSON.parse(init.body) as Record<string, unknown>) : null;
    seen.push({ path, body, signal: init.signal ?? undefined });
    if (path === "/tasks") return json({ tasks: script.rows ?? [], cap: 3, running: 0, queued: 0 });
    if (path === "/tasks/claim") return json({ task: claims.shift() ?? null });
    if (/^\/tasks\/[^/]+\/finish$/.test(path)) return json({ task: null });
    if (path === "/manifest") return json({ ok: true });
    if (path === "/decisions") return json({ ok: true, pending: [], showing: 0, total: 0, footer: "" });
    if (path.startsWith("/decisions/")) {
      const answer = script.resolutions?.[decodeURIComponent(path.slice("/decisions/".length))];
      return answer ? json(answer) : json({ reason: "unknown_ref", detail: path }, 404);
    }
    if (path === "/run") {
      const id = String(body?.task_id);
      const n = turns[id] ?? 0;
      turns[id] = n + 1;
      const next = script.runs?.[id]?.[n];
      if (!next) return json({ reason: "unknown", detail: "the script ran out" }, 500);
      // The daemon's refusal shape (ADR 0141): the closed-vocabulary reason, the word beside it.
      if (!Array.isArray(next) && "refuse" in next) return json({ ok: false, reason: "validator_failed", detail: next.refuse, error: next.refuse }, 409);
      const hang = !Array.isArray(next);
      return new Response(frames(hang ? next.hang : next, init.signal ?? undefined, hang), {
        status: 200,
        headers: { "content-type": "text/event-stream" },
      });
    }
    return json({ reason: "unknown_ref", detail: path }, 404);
  };
  return {
    fetchImpl,
    seen,
    runs: (id?: string) => seen.filter((s) => s.path === "/run" && (id === undefined || s.body?.task_id === id)),
    finishes: () =>
      seen.filter((s) => s.path.endsWith("/finish")).map((s): Record<string, unknown> => ({ id: s.path.split("/")[2], ...s.body })),
    api: () => new DaemonApi({ url: "http://daemon", token: "t" }, fetchImpl),
  };
}

const tab = (id: number, url: string, focused = false): Tab => ({ id, label: `page-${id}`, url, title: `Tab ${id}`, focused, nav: 1 });

function tools(tabs: Tab[]): Record<number, TabTools> {
  const out: Record<number, TabTools> = {};
  for (const t of tabs) {
    out[t.id] = {
      tabId: t.id,
      url: t.url,
      tools: [
        {
          name: "list_overdue",
          title: null,
          description: "Overdue invoices",
          inputSchema: {},
          annotations: { readOnlyHint: true },
          athena: { reversible: true, side_effects: "none" },
        },
      ],
      transport: "webmcp-polyfill",
      appId: t.url.includes("ledgerbox") ? "ledgerbox" : null,
      appVersion: null,
      problem: null,
      asking: false,
    };
  }
  return out;
}

function wire(daemon: ReturnType<typeof fakeDaemon>, tabs: Tab[], over: Partial<RunnerDeps> = {}) {
  const calls: Array<{ tab: number; name: string }> = [];
  const deps: RunnerDeps = {
    api: daemon.api,
    tabs: () => tabs,
    tools: () => tools(tabs),
    lists: () => ({ disabledOrigins: [], gated: { gated_origins: [], gated_tools: [] } }),
    call: async (tabId, name) => {
      calls.push({ tab: tabId, name });
      return { ok: true, output: `${name} ran on ${tabId}` };
    },
    open: null,
    follow: null,
    every: () => () => {},
    wait: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    ...over,
  };
  setRunnerDeps(deps);
  // The card stack is the run store's: answers go through its route.
  setRunDeps({
    api: daemon.api,
    focused: () => ({ tabId: 1, origin: "https://ledgerbox.local", appId: "ledgerbox" }),
    tab: (id) => {
      const found = tabs.find((t) => t.id === id);
      return found ? { tabId: id, origin: new URL(found.url).origin, appId: "ledgerbox", nav: found.nav } : null;
    },
    hostState: () => ({}),
    call: async () => ({ ok: true, output: "" }),
  });
  return calls;
}

async function until(test: () => boolean, ms = 2000) {
  const end = Date.now() + ms;
  while (!test() && Date.now() < end) await new Promise((r) => setTimeout(r, 2));
  expect(test()).toBe(true);
}

const said = (text: string): Event => ({ kind: "text.delta", text });
const finished = (): Event => ({ kind: "turn.finished", text: "", tts: null });
const hostCall = (id: string, name: string): Event => ({ kind: "tool.call", call_id: id, name, params: {}, origin: "host:ledgerbox", tier: 1 });

const LEDGER = "https://ledgerbox.local/invoices";
const T1 = "task_0123456789ab";
const T2 = "task_0123456789ac";

beforeEach(() => {
  resetRunForTests();
  resetRunnerForTests();
});
afterEach(() => resetRunnerForTests());

describe("the task runner", () => {
  it("claims a task, binds a tab of its app that is not the focused one, runs it with task_id and finishes it", async () => {
    const daemon = fakeDaemon({
      claims: [task(T1)],
      runs: { [T1]: [[hostCall("c1", "host.ledgerbox.list_overdue"), finished()], [said("Three are overdue: INV-3, INV-7, INV-9."), finished()]] },
    });
    const calls = wire(daemon, [tab(1, LEDGER, true), tab(2, "https://crm.local/"), tab(3, LEDGER)]);

    await tickRunner();
    await until(() => daemon.finishes().length === 1);

    expect(calls).toEqual([{ tab: 3, name: "list_overdue" }]);
    const [first, second] = daemon.runs(T1);
    // The brief is the daemon's: the window's first message adds nothing to it.
    expect(first!.body).toMatchObject({ task_id: T1, tab_id: 3, origin: "https://ledgerbox.local", message: TASK_OPENING });
    expect(TASK_OPENING).toBe("");
    expect(second!.body!.tool_results).toEqual([expect.objectContaining({ call_id: "c1", ok: true, output: "list_overdue ran on 3" })]);
    expect(daemon.finishes()).toEqual([{ id: T1, status: "done", result: "Three are overdue: INV-3, INV-7, INV-9.", error: null }]);
    // The task's page was registered before its turns, as the main thread does.
    expect(daemon.seen.some((s) => s.path === "/manifest")).toBe(true);
    expect(useTaskRunner.getState().runs).toEqual({});
  });

  it("never takes the focused tab: with no other tab of the app and no way to open one, the task fails and says why", async () => {
    const daemon = fakeDaemon({ claims: [task(T1)] });
    wire(daemon, [tab(1, LEDGER, true)]);

    await tickRunner();
    await until(() => daemon.finishes().length === 1);

    expect(daemon.runs()).toEqual([]);
    const [done] = daemon.finishes();
    expect(done).toMatchObject({ id: T1, status: "failed", result: null });
    expect(String(done!.error)).toMatch(/^no_page: .*open ledgerbox in a second tab/);
  });

  it("opens a background tab when the focused tab is the app's only one, and works there", async () => {
    const daemon = fakeDaemon({ claims: [task(T1)], runs: { [T1]: [[said("Done."), finished()]] } });
    const tabs = [tab(1, LEDGER, true)];
    const opened: string[] = [];
    wire(daemon, tabs, {
      open: async (url) => {
        opened.push(url);
        tabs.push(tab(7, `${url}/`));
        return 7;
      },
    });

    await tickRunner();
    await until(() => daemon.finishes().length === 1);

    expect(opened).toEqual(["https://ledgerbox.local"]);
    expect(daemon.runs(T1)[0]!.body).toMatchObject({ tab_id: 7 });
    expect(tabs.find((t) => t.id === 1)!.focused).toBe(true);
    expect(daemon.finishes()[0]).toMatchObject({ status: "done", result: "Done." });
  });

  it("never puts two tasks on one tab", async () => {
    const daemon = fakeDaemon({
      claims: [task(T1), task(T2, { title: "Tidy contacts" })],
      runs: { [T1]: [{ hang: [] }], [T2]: [{ hang: [] }] },
    });
    wire(daemon, [tab(1, LEDGER, true), tab(2, LEDGER), tab(3, LEDGER)]);

    await tickRunner();
    await until(() => daemon.runs().length === 2);
    const bound = daemon.runs().map((r) => r.body!.tab_id);
    expect(new Set(bound)).toEqual(new Set([2, 3]));
    expect(Object.values(useTaskRunner.getState().runs).map((r) => r.tabId).sort()).toEqual([2, 3]);
  });

  it("a task with no app takes no tab: it runs in the focused page's session with that page's app switched off", async () => {
    const daemon = fakeDaemon({ claims: [task(T1, { app_id: null, origin: null })], runs: { [T1]: [[said("Summary written."), finished()]] } });
    wire(daemon, [tab(1, LEDGER, true)]);
    await tickRunner();
    await until(() => daemon.finishes().length === 1);
    const body = daemon.runs(T1)[0]!.body!;
    expect(body).toMatchObject({ task_id: T1, origin: "https://ledgerbox.local", host_state: {}, disabled_origins: ["host:ledgerbox"] });
    expect(body).not.toHaveProperty("tab_id");
    expect(daemon.finishes()[0]).toMatchObject({ status: "done", result: "Summary written." });
  });

  it("a task with no app and no page open fails, saying so", async () => {
    const daemon = fakeDaemon({ claims: [task(T1, { app_id: null, origin: null })] });
    wire(daemon, []);
    await tickRunner();
    await until(() => daemon.finishes().length === 1);
    expect(daemon.runs()).toEqual([]);
    expect(String(daemon.finishes()[0]!.error)).toMatch(/^no_page: /);
  });

  it("a kill aborts the task's request at once, and nothing is reported for it", async () => {
    const daemon = fakeDaemon({ claims: [task(T1)], runs: { [T1]: [{ hang: [said("Working on it")] }] } });
    wire(daemon, [tab(1, LEDGER, true), tab(2, LEDGER)]);

    await tickRunner();
    await until(() => daemon.runs(T1).length === 1);
    const signal = daemon.runs(T1)[0]!.signal!;
    const killedAt = Date.now();
    taskChanged(task(T1, { status: "killed", finished_at: "2026-10-24T10:01:00Z" }));
    await until(() => signal.aborted, 1000);
    expect(Date.now() - killedAt).toBeLessThan(1000);
    await until(() => Object.keys(useTaskRunner.getState().runs).length === 0);
    expect(daemon.finishes()).toEqual([]);
  });

  it("a task killed between two of its turns is refused task_not_running, and stops without a report", async () => {
    const daemon = fakeDaemon({
      claims: [task(T1)],
      runs: { [T1]: [[hostCall("c1", "host.ledgerbox.list_overdue"), finished()], { refuse: "task_not_running" }] },
    });
    wire(daemon, [tab(1, LEDGER, true), tab(2, LEDGER)]);
    await tickRunner();
    await until(() => daemon.runs(T1).length === 2);
    await until(() => Object.keys(useTaskRunner.getState().runs).length === 0);
    expect(daemon.finishes()).toEqual([]);
  });

  it("a kill heard on the bus does the same", async () => {
    const daemon = fakeDaemon({ claims: [task(T1)], runs: { [T1]: [{ hang: [] }] } });
    let bus: ((event: BusEvent) => void) | null = null;
    let connected: (() => void) | null = null;
    wire(daemon, [tab(1, LEDGER, true), tab(2, LEDGER)], {
      follow: (on, onConnect) => {
        bus = on;
        connected = onConnect;
        return () => {};
      },
    });
    startTaskRunner();
    connected!();
    await until(() => daemon.runs(T1).length === 1);
    bus!({ kind: "task.changed", task: task(T1, { status: "killed" }) });
    await until(() => daemon.runs(T1)[0]!.signal!.aborted, 1000);
    expect(daemon.finishes()).toEqual([]);
  });

  it("a card a task files sits in the one stack under its title; approved, it runs on the task's tab and the task carries on", async () => {
    const card = {
      kind: "decision.requested",
      id: "apr_0000000000t1",
      decision_kind: "approve",
      action: "host.ledgerbox.send_reminder",
      params: { invoice: "INV-7" },
      rationale: "Overdue by 40 days.",
      options: [
        { id: "approve", label: "approve" },
        { id: "decline", label: "decline" },
      ],
      expires_at: "",
      origin: "host:ledgerbox",
      surface: "panel",
      capture_id: null,
      tab_id: 2,
      tab_nav: 1,
    };
    const daemon = fakeDaemon({
      claims: [task(T1)],
      runs: { [T1]: [[card, said("Waiting on you for the reminder."), finished()], [said("Reminder sent."), finished()]] },
      resolutions: {
        [card.id]: {
          ok: true,
          id: card.id,
          status: "approved",
          choice: "approve",
          conversation_id: "conv_task_0123456789ab",
          execute: [{ call_id: "c7", name: "host.ledgerbox.send_reminder", params: { invoice: "INV-7" }, origin: "host:ledgerbox", tab_id: 2, tab_nav: 1 }],
          output: "",
          events: [],
        },
      },
    });
    const calls = wire(daemon, [tab(1, LEDGER, true), tab(2, LEDGER)]);

    await tickRunner();
    await until(() => useRun.getState().cards.length === 1);
    expect(useRun.getState().taskCards).toEqual({ [card.id]: "Chase March invoices" });
    await until(() => useTaskRunner.getState().runs[T1]?.phase === "waiting");
    expect(daemon.finishes()).toEqual([]);

    await useRun.getState().answer(card.id, "approve");
    await until(() => daemon.finishes().length === 1);
    expect(calls).toEqual([{ tab: 2, name: "send_reminder" }]);
    expect(daemon.runs(T1)[1]!.body!.tool_results).toEqual([expect.objectContaining({ call_id: "c7", ok: true })]);
    expect(daemon.finishes()[0]).toMatchObject({ status: "done", result: "Reminder sent." });
    expect(useRun.getState().cards).toEqual([]);
    // The main thread never ran a turn of its own for it.
    expect(daemon.runs().every((r) => r.body!.task_id === T1)).toBe(true);
  });

  it("a killed task's cards leave the stack and are declined at the daemon", async () => {
    const card = {
      kind: "decision.requested",
      id: "apr_0000000000t2",
      decision_kind: "approve",
      action: "host.ledgerbox.send_reminder",
      params: {},
      rationale: "",
      options: [],
      expires_at: "",
      origin: "host:ledgerbox",
      surface: "panel",
      capture_id: null,
      tab_id: 2,
      tab_nav: 1,
    };
    const daemon = fakeDaemon({ claims: [task(T1)], runs: { [T1]: [[card, finished()]] } });
    wire(daemon, [tab(1, LEDGER, true), tab(2, LEDGER)]);
    await tickRunner();
    await until(() => useTaskRunner.getState().runs[T1]?.phase === "waiting");
    taskChanged(task(T1, { status: "killed" }));
    await until(() => useRun.getState().cards.length === 0);
    await until(() => daemon.seen.some((s) => s.path === `/decisions/${card.id}`));
    expect(daemon.seen.find((s) => s.path === `/decisions/${card.id}`)!.body).toMatchObject({ choice: "decline" });
    expect(daemon.finishes()).toEqual([]);
  });

  it("a turn that fails reports the task failed with the reason", async () => {
    const daemon = fakeDaemon({ claims: [task(T1)], runs: { [T1]: [[{ kind: "turn.error", reason: "engine_error", detail: "the CLI stopped" }]] } });
    wire(daemon, [tab(1, LEDGER, true), tab(2, LEDGER)]);
    await tickRunner();
    await until(() => daemon.finishes().length === 1);
    expect(daemon.finishes()[0]).toEqual({ id: T1, status: "failed", result: null, error: "engine_error: the CLI stopped" });
  });

  it("when her window goes, a task in flight is aborted and reported failed, and nothing more is claimed", async () => {
    const daemon = fakeDaemon({ claims: [task(T1)], runs: { [T1]: [{ hang: [] }] } });
    let connected: (() => void) | null = null;
    wire(daemon, [tab(1, LEDGER, true), tab(2, LEDGER)], {
      follow: (_on, onConnect) => {
        connected = onConnect;
        return () => {};
      },
    });
    const stop = startTaskRunner();
    connected!();
    await until(() => daemon.runs(T1).length === 1);
    stop();
    await until(() => daemon.finishes().length === 1);
    expect(daemon.runs(T1)[0]!.signal!.aborted).toBe(true);
    expect(daemon.finishes()[0]).toEqual({ id: T1, status: "failed", result: null, error: ORPHANED });
    // Nothing is claimed after the window went, though the task's end would otherwise ask.
    const claimsBefore = daemon.seen.filter((s) => s.path === "/tasks/claim").length;
    await new Promise((r) => setTimeout(r, 20));
    expect(daemon.seen.filter((s) => s.path === "/tasks/claim").length).toBe(claimsBefore);
  });

  it("on start, a task the daemon says is running that no window runs is reported failed, then queued ones are claimed", async () => {
    const daemon = fakeDaemon({ rows: [task(T2, { title: "Orphan" })], claims: [] });
    wire(daemon, [tab(1, LEDGER, true)]);
    startTaskRunner();
    await until(() => daemon.finishes().length === 1);
    expect(daemon.finishes()[0]).toEqual({ id: T2, status: "failed", result: null, error: ORPHANED });
    await until(() => daemon.seen.some((s) => s.path === "/tasks/claim"));
  });
});

describe("the runner's small rules", () => {
  it("a result is her last words, cut to the cap", () => {
    expect(resultOf("  ")).toBeNull();
    expect(resultOf(" Done. ")).toBe("Done.");
    const long = resultOf("x".repeat(TASK_RESULT_CAP + 50))!;
    expect(long).toHaveLength(TASK_RESULT_CAP);
    expect(long.endsWith("…")).toBe(true);
  });

  it("a task's app is opened at its web origin, or at the host its derived id names", () => {
    expect(addressOf({ origin: "https://ledgerbox.local", app_id: "ledgerbox" })).toBe("https://ledgerbox.local");
    expect(addressOf({ origin: null, app_id: "web_https_sledger_dtest" })).toBe("https://ledger.test");
    expect(addressOf({ origin: "host:ledgerbox", app_id: "ledgerbox" })).toBeNull();
  });
});

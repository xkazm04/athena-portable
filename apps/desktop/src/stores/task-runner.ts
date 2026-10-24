/**
 * The task runner - fleet-surfaces WP5, ADR 0141. Her window is where delegated tasks run.
 *
 * Athena hands a job to a background task with `core.delegate`; the daemon admits it and keeps the
 * row, and that is all the daemon can do, because a task that works in an app works on a page, and
 * only a window has pages. So her window is the executor. While it lives this runner follows
 * `task.changed` on the bus (and reads `GET /tasks` slowly, in case a frame was missed), and while
 * fewer than {@link TASKS_RUNNING_CAP} tasks run here and one is queued, it claims it
 * (`POST /tasks/claim`).
 *
 * A claimed task gets a tab of its own:
 * - a task for an app reuses an open tab of that app that is neither the focused tab - the person
 *   is looking at that one, and the main thread works there - nor a tab another task holds;
 * - when there is none it opens one in the background, never taking focus. Her window cannot open
 *   tabs yet (`capabilities/athena.json` grants no `tabs_create`), so until the shell gives it a
 *   background open, such a task fails with a sentence saying what to do: open the app in a second
 *   tab and ask again;
 * - a task with no app gets no tab and runs on the daemon alone. The daemon still keys a turn by
 *   a session, so its requests name the focused page's (the one the main thread registers), with
 *   that page's app switched off for the task: no call on any page can run from it.
 *
 * Then it runs the same loop the main thread runs (`stores/run.ts`), in the task's conversation:
 * every request says `task_id`, the page's calls run on the task's tab after the turn ends, and
 * their answers ride the next request, at most {@link MAX_CONTINUATIONS} times in a row. A gated
 * call becomes a card in the one stack, labelled with the task's title, answered by the same route
 * as any card (`useRun.fileTaskCard`); the task rests until it is answered and then carries on.
 *
 * WHY A LOOP OF ITS OWN. The main thread's loop is a closure over a dozen pieces of one window's
 * state - the page results waiting, the calls held, the snapshot of the focused tab, the Stop
 * generation, the request in flight, the other tabs published, the remote exchange, the setup
 * conversation, the tainted origins - and the panel's phase and transcript. Turning that into an
 * object that several runs can each hold would touch every path its 3,600 lines of tests pin, for
 * a task that needs a subset: one tab, no remote, no setup, no other tabs, no capture. So this loop
 * is small and calls the same pure helpers (`settleHostCall`, `heldBefore`, `withUnsure`,
 * `bindingRefusal`, `resultRow`, the manifest and the gate's lists), and the card stack is shared.
 * Two things it refuses outright rather than half-support: `tabs_read` (a task reads its own tab,
 * so no taint bookkeeping is needed) and a call bound to any tab but its own.
 *
 * It finishes the task with `POST /tasks/<id>/finish`: `done` with her last words, cut to
 * {@link TASK_RESULT_CAP} characters, or `failed` with the reason. A task killed from either
 * window (`task.changed` with any status but `running`) has its request aborted at once, its cards
 * withdrawn and declined, and nothing reported: the daemon already wrote how it ended.
 */
import { create } from "zustand";

import { ApiError, DaemonApi, type ExecuteRow, type TurnBody } from "@/lib/api";
import type { BridgeTool } from "@/lib/bridge";
import { isTerminal } from "@/lib/events";
import { forgetUnsure, heldBefore, rememberUnsure, settleHostCall, withUnsure, type PageAnswer } from "@/lib/execute";
import { followBus, type BusEvent } from "@/lib/fleet";
import { TABS_READ, callOnPage } from "@/lib/hands";
import { hasShell, type Tab } from "@/lib/ipc";
import { catalogIdOf, hostOfDerivedId, manifestBodyOf } from "@/lib/manifest";
import { TASKS_RUNNING_CAP, type TaskView } from "@/lib/tasks";
import { originOf } from "@/modules/browser/model";
import { endpoint, useDaemon } from "@/stores/daemon";
import { useOrigins } from "@/stores/origins";
import {
  MAX_CONTINUATIONS,
  bareName,
  bindingRefusal,
  disabledOriginsOf,
  gatedListsOf,
  resultRow,
  stampOf,
  tabRefOf,
  useRun,
  type GatedLists,
  type TabRef,
} from "@/stores/run";
import { useTabs } from "@/stores/tabs";
import { useTools, type TabTools } from "@/stores/tools";

/** How often `GET /tasks` is read beside the bus: a frame missed between two streams is caught here. */
export const TASK_POLL_MS = 15_000;

/** How much of her last words a finished task reports, in characters. */
export const TASK_RESULT_CAP = 600;

/** How long a tab opened for a task may take to appear in the tab list before the task fails. */
export const TAB_OPEN_MS = 10_000;

/**
 * The first message of a task's conversation: nothing. The brief is the daemon's - `core.delegate`
 * wrote it into the task's row, and the task's first turn opens with it (ADR 0141) - so the window
 * adds no words of its own.
 */
export const TASK_OPENING = "";

/** What a continuation carries, as in the main thread: no new words from the person. */
const CONTINUE = "(the tools you called have answered; continue)";

/** Why a task she was running when her window last closed is reported failed when it opens again. */
export const ORPHANED = "her window closed while this task ran, so it stopped";

/** What the runner needs from the window. Swapped wholesale in tests. */
export interface RunnerDeps {
  api: () => DaemonApi | null;
  /** The open tabs, the focused one flagged. */
  tabs: () => readonly Tab[];
  /** What each tab's page registered (`stores/tools.ts`). */
  tools: () => Readonly<Record<number, TabTools>>;
  /** The switched-off apps and what the gate tightens, as the main thread sends them (ADR 0063). */
  lists: () => { disabledOrigins: string[]; gated: GatedLists };
  /** Run one of a page's tools (or a hand) on a tab, as the main thread does. */
  call: (tabId: number, name: string, input: Record<string, unknown>, tools?: readonly BridgeTool[]) => Promise<PageAnswer>;
  /** Open a tab at `url` without focusing it, answering its id; `null` when this window cannot. */
  open: ((url: string) => Promise<number>) | null;
  /** An approved call ran: its contract becomes the accepted one (ADR 0100). */
  accept?: (origin: string, tool: BridgeTool) => Promise<void>;
  /** Follow the bus: `on` for each frame, `connected` on each (re)connect. `null`: no bus here. */
  follow: ((on: (event: BusEvent) => void, connected: () => void) => () => void) | null;
  /** The slow poll's timer. */
  every: (ms: number, f: () => void) => () => void;
  wait: (ms: number) => Promise<void>;
  now?: () => Date;
}

const LIVE: RunnerDeps = {
  api: () => {
    const found = endpoint(useDaemon.getState());
    return found ? new DaemonApi(found) : null;
  },
  tabs: () => useTabs.getState().tabs,
  tools: () => useTools.getState().byTab,
  lists: () => {
    const tabs = useTabs.getState().tabs;
    const byTab = useTools.getState().byTab;
    const origins = useOrigins.getState();
    return { disabledOrigins: disabledOriginsOf(origins.records, tabs, byTab), gated: gatedListsOf(origins, tabs, byTab) };
  },
  call: (tabId, name, input, tools) => callOnPage(tabId, name, input, tools ?? useTools.getState().byTab[tabId]?.tools ?? []),
  // Her window is granted no tab command (capabilities/athena.json). See the module comment.
  open: null,
  accept: (origin, tool) => useOrigins.getState().acceptContracts(origin, [tool]),
  follow: hasShell() ? (on, connected) => followBus(() => deps.api(), on, connected) : null,
  every: (ms, f) => {
    const timer = setInterval(f, ms);
    return () => clearInterval(timer);
  },
  wait: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
};

let deps: RunnerDeps = LIVE;

/** Swap what the runner runs against. The test's entry point. */
export function setRunnerDeps(next: RunnerDeps): void {
  deps = next;
}

/** One task this window runs, as a view can read it. */
export interface RunnerRow {
  taskId: string;
  title: string;
  /** The tab it works on, `null` before it has one and for a task with no app. */
  tabId: number | null;
  /** `binding` finding its tab, `working` a turn or a page call, `waiting` a card is on the person. */
  phase: "binding" | "working" | "waiting";
}

export interface TaskRunnerState {
  runs: Record<string, RunnerRow>;
  /** Why the last claim failed, in one plain sentence, or `null`. */
  problem: string | null;
}

export const useTaskRunner = create<TaskRunnerState>(() => ({ runs: {}, problem: null }));

/** A task this window runs: its row, its tab, its abort, its page answers and its cards. */
interface Active {
  task: TaskView;
  controller: AbortController;
  tab: number | null;
  /**
   * The origin its requests send: its tab's web origin, or, for a task with no app, the focused
   * page's - the session the daemon keys the turn by - whose app is then switched off for it.
   */
  origin: string;
  /** For a task with no app: the catalog origins (`host:<app>`) its requests switch off. */
  off: string[];
  /** Page answers waiting to ride the next request. */
  outstanding: Array<Record<string, unknown>>;
  /** Its cards still on the person. */
  cards: Set<string>;
  /** Answers to its cards the daemon took, waiting for the loop: what to run, or a decline. */
  released: Array<{ approved: boolean; execute: ExecuteRow[]; action: string }>;
  /** Wakes the loop resting on a card. */
  wake: (() => void) | null;
  /** The finish is on its way: the `task.changed` it causes is no kill. */
  finishing: boolean;
  /** Her window is going away with the task in flight: it is reported failed with this. */
  abandoned: string | null;
}

const active = new Map<string, Active>();

/** A task ended in a failure worth reporting: the closed-vocabulary reason and a plain detail. */
class TaskFailure extends Error {
  constructor(
    readonly reason: string,
    detail: string,
  ) {
    super(detail);
  }
}

/** The task was killed, or its turn was stopped by the daemon: nothing to report. */
class Killed extends Error {}

const report = (what: string) => (error: unknown) => console.error(`[athena] task runner ${what}: ${String(error)}`);

// -- claiming ------------------------------------------------------------------------------------

let claiming: Promise<void> | null = null;
let again = false;
/** The runner was stopped (her window is going): a task that ends now claims nothing after it. */
let halted = false;

/**
 * Claim queued tasks while fewer than the cap run here. One claim loop at a time; a call while one
 * runs makes it go round once more, so a task queued meanwhile is not left waiting for the poll.
 */
export function tickRunner(): Promise<void> {
  if (halted) return Promise.resolve();
  if (claiming) {
    again = true;
    return claiming;
  }
  claiming = (async () => {
    try {
      do {
        again = false;
        while (active.size < TASKS_RUNNING_CAP) {
          const api = deps.api();
          if (!api) return;
          const { task } = await api.claimTask();
          if (!task || active.has(task.id)) break;
          launch(task);
        }
      } while (again);
      useTaskRunner.setState({ problem: null });
    } catch (error) {
      useTaskRunner.setState({ problem: `A delegated task could not be started: ${error instanceof Error ? error.message : String(error)}` });
    } finally {
      claiming = null;
    }
  })();
  return claiming;
}

/**
 * A `task.changed` frame. A task this window runs that is no longer `running` was killed (or ended
 * elsewhere): it stops now. A queued one may be claimable.
 */
export function taskChanged(task: TaskView): void {
  const run = active.get(task.id);
  if (run && task.status !== "running" && !run.finishing) kill(run);
  if (task.status === "queued" || (run && task.status !== "running")) void tickRunner();
}

/** Read `GET /tasks`: stop what is no longer running, and claim what is queued. */
async function reread(): Promise<void> {
  const api = deps.api();
  if (!api) return;
  let rows: TaskView[];
  try {
    rows = (await api.tasks()).tasks;
  } catch {
    return; // the bus or the next poll tries again
  }
  for (const row of rows) taskChanged(row);
  for (const run of [...active.values()]) {
    if (!rows.some((r) => r.id === run.task.id) && !run.finishing) kill(run);
  }
  await tickRunner();
}

/**
 * Tasks the daemon says are running that no window runs: her window closed (or reloaded) while they
 * ran, and the turns they were in went with it. They are reported failed so the cap they hold is
 * free again. Run once, before the first claim, so it can never mistake a task this window has just
 * claimed for one of them.
 */
async function sweepOrphans(): Promise<void> {
  const api = deps.api();
  if (!api) return;
  let rows: TaskView[];
  try {
    rows = (await api.tasks()).tasks;
  } catch {
    return;
  }
  for (const row of rows) {
    if (row.status !== "running" || active.has(row.id)) continue;
    await api.finishTask(row.id, "failed", null, ORPHANED).catch(report("orphan"));
  }
}

let stopRunner: (() => void) | null = null;

/**
 * Run delegated tasks while her window lives. Returns what stops it: every task this window runs
 * is aborted, as a window that closes would. Idempotent.
 */
export function startTaskRunner(): () => void {
  if (stopRunner) return stopRunner;
  halted = false;
  let alive = true;
  let swept = false;
  const begin = async () => {
    if (!swept) {
      swept = true;
      await sweepOrphans();
    }
    if (alive) await reread();
  };
  // The bus is followed from the start; the first (re)connect does the first read.
  const offBus = deps.follow?.(
    (event) => {
      if (event.kind === "task.changed") taskChanged(event.task);
    },
    () => void begin(),
  );
  if (!offBus) void begin();
  const offPoll = deps.every(TASK_POLL_MS, () => void (swept ? reread() : begin()));
  stopRunner = () => {
    alive = false;
    offBus?.();
    offPoll();
    halted = true;
    // The turns go with the window: each task in flight is reported failed, not left running.
    for (const run of [...active.values()]) {
      run.abandoned = ORPHANED;
      kill(run);
    }
    stopRunner = null;
  };
  return stopRunner;
}

export function resetRunnerForTests(): void {
  // Aborted quietly first: a test's leftover tasks report nothing to the next test's daemon.
  for (const run of active.values()) run.controller.abort();
  active.clear();
  stopRunner?.();
  claiming = null;
  again = false;
  halted = false;
  deps = LIVE;
  useTaskRunner.setState({ runs: {}, problem: null });
}

// -- one task ------------------------------------------------------------------------------------

function show(run: Active, phase: RunnerRow["phase"]): void {
  useTaskRunner.setState((s) => ({
    runs: { ...s.runs, [run.task.id]: { taskId: run.task.id, title: run.task.title, tabId: run.tab, phase } },
  }));
}

function launch(task: TaskView): void {
  const run: Active = {
    task,
    controller: new AbortController(),
    tab: null,
    origin: "",
    off: [],
    outstanding: [],
    cards: new Set(),
    released: [],
    wake: null,
    finishing: false,
    abandoned: null,
  };
  run.controller.signal.addEventListener("abort", () => run.wake?.());
  active.set(task.id, run);
  show(run, "binding");
  void (async () => {
    let outcome: { status: "done" | "failed"; result: string | null; error: string | null } | null = null;
    try {
      await bind(run);
      show(run, "working");
      const text = await drive(run);
      outcome = { status: "done", result: resultOf(text), error: null };
    } catch (error) {
      if (!(error instanceof Killed) && !run.controller.signal.aborted) {
        outcome = { status: "failed", result: null, error: failureOf(error) };
      }
    }
    if (run.abandoned) outcome = { status: "failed", result: null, error: run.abandoned };
    if (outcome && (!run.controller.signal.aborted || run.abandoned)) {
      run.finishing = true;
      await deps.api()?.finishTask(task.id, outcome.status, outcome.result, outcome.error).catch(report("finish"));
    }
    withdraw(run);
    active.delete(task.id);
    useTaskRunner.setState((s) => {
      const runs = { ...s.runs };
      delete runs[task.id];
      return { runs };
    });
    void tickRunner();
  })();
}

/** Stop a task now: its request is aborted and its loop wakes to find it so. */
function kill(run: Active): void {
  run.controller.abort();
}

/**
 * The task's cards that are still on the person leave the stack, and are declined at the daemon so
 * no other window answers them for a task that is gone.
 */
function withdraw(run: Active): void {
  const api = deps.api();
  for (const id of run.cards) {
    useRun.getState().withdrawTaskCard(id);
    void api?.resolve(id, "decline", run.origin).catch(() => undefined); // already answered, or expired
  }
  run.cards.clear();
}

/** The open tab `tabId` as the loop addresses it, read now, or `null` when it closed. */
function refOf(tabId: number): TabRef | null {
  const tab = deps.tabs().find((t) => t.id === tabId);
  return tab ? tabRefOf(tab, deps.tools()) : null;
}

/** Is this tab one of the task's app: its web origin, or the catalog id its page publishes? */
function isTaskTab(tab: Tab, task: TaskView, byTab: Readonly<Record<number, TabTools>>): boolean {
  const origin = originOf(tab.url);
  if (!origin) return false;
  if (task.origin && origin === task.origin) return true;
  const want = task.app_id?.replace(/^host:/, "") ?? null;
  return want !== null && catalogIdOf(origin, byTab[tab.id]?.appId ?? null) === want;
}

/** Where to open the task's app: its web origin, or the host a derived app id was minted from. */
export function addressOf(task: Pick<TaskView, "origin" | "app_id">): string | null {
  if (task.origin && /^https?:\/\//.test(task.origin)) return task.origin;
  const host = task.app_id ? hostOfDerivedId(task.app_id.replace(/^host:/, "")) : null;
  return host ? `https://${host}` : null;
}

/** How a task is named in a sentence about its app. */
function appName(task: TaskView): string {
  return task.app_id?.replace(/^host:/, "") ?? task.origin ?? "its app";
}

/**
 * Give the task its tab (the Director's rule, fleet-surfaces D3): an open tab of its app that is not
 * the focused one and not another task's; else a new one in the background; none for a task with
 * no app. The focused tab is never taken, even when it is the only tab of the app.
 */
async function bind(run: Active): Promise<void> {
  const { task } = run;
  if (!task.origin && !task.app_id) return;
  const tabs = deps.tabs();
  const byTab = deps.tools();
  // The main thread's tab: the one flagged focused, or the first, as `run.ts` reads it.
  const focused = tabs.find((t) => t.focused) ?? tabs[0];
  const held = new Set([...active.values()].filter((r) => r !== run && r.tab !== null).map((r) => r.tab));
  const free = tabs.find((t) => t.id !== focused?.id && !held.has(t.id) && isTaskTab(t, task, byTab));
  let tabId: number;
  if (free) tabId = free.id;
  else {
    const url = addressOf(task);
    if (!url) throw new TaskFailure("no_page", `there is no address to open ${appName(task)} at`);
    if (!deps.open) {
      throw new TaskFailure(
        "no_page",
        `${appName(task)} has no free tab here and her window cannot open one yet; open ${appName(task)} in a second tab and ask again`,
      );
    }
    tabId = await deps.open(url);
    const until = Date.now() + TAB_OPEN_MS;
    while (!deps.tabs().some((t) => t.id === tabId)) {
      if (run.controller.signal.aborted) throw new Killed();
      if (Date.now() > until) throw new TaskFailure("no_page", `the tab opened for ${appName(task)} never appeared`);
      await deps.wait(100);
    }
  }
  run.tab = tabId;
  const ref = refOf(tabId);
  if (ref) run.origin = ref.origin;
  show(run, "binding");
}

/**
 * The task's exchange: requests and page answers until a turn settles with nothing to carry and no
 * card waiting. A card rests it; the answer wakes it. Answers her last words.
 */
async function drive(run: Active): Promise<string> {
  let message = TASK_OPENING;
  let last = "";
  let continuations = 0;
  for (;;) {
    if (run.controller.signal.aborted) throw new Killed();
    await publish(run);
    const said = await request(run, message);
    if (said.trim()) last = said;
    if (run.outstanding.length > 0) {
      continuations += 1;
      if (continuations > MAX_CONTINUATIONS) {
        throw new TaskFailure("budget_exhausted", `the page answered ${MAX_CONTINUATIONS} times without the task settling`);
      }
      message = CONTINUE;
      continue;
    }
    if (run.cards.size === 0 && run.released.length === 0) return last;
    // A card is on the person: the task rests until it is answered.
    show(run, "waiting");
    message = await settleCards(run);
    show(run, "working");
    // A person was in the loop: the budget is for the page talking to itself, as in the main thread.
    continuations = 0;
  }
}

/** Wait for an answer to one of the task's cards, run what it released, and say what to continue with. */
async function settleCards(run: Active): Promise<string> {
  while (run.released.length === 0) {
    if (run.controller.signal.aborted) throw new Killed();
    await new Promise<void>((resolve) => {
      run.wake = resolve;
    });
    run.wake = null;
  }
  if (run.controller.signal.aborted) throw new Killed();
  const declined: string[] = [];
  for (const outcome of run.released.splice(0)) {
    forgetUnsure(outcome.action);
    if (!outcome.approved) declined.push(outcome.action);
    else for (const row of outcome.execute) await onTab(run, row, true);
  }
  return declined.length ? `(the person declined ${declined.join(", ")}; continue without it)` : CONTINUE;
}

/**
 * Register the task's page with the daemon before a request about it, as the main thread does. A
 * task with no app registers the focused page instead, only so its turn has a session to run in,
 * and switches that page's app off for itself.
 */
async function publish(run: Active): Promise<void> {
  const tabs = deps.tabs();
  const tab = run.tab === null ? (tabs.find((t) => t.focused) ?? tabs[0]) : tabs.find((t) => t.id === run.tab);
  if (!tab) {
    throw run.tab === null
      ? new TaskFailure("no_page", "even a task with no app runs from an open page here; open any app and ask again")
      : new TaskFailure("unknown_ref", "the task's tab was closed");
  }
  const found = deps.tools()[tab.id];
  if (run.tab === null) {
    run.origin = originOf(tab.url);
    const app = catalogIdOf(run.origin, found?.appId ?? null);
    run.off = app ? [`host:${app}`] : [];
  }
  const body = manifestBodyOf({
    origin: originOf(tab.url),
    appId: found?.appId ?? null,
    appVersion: found?.appVersion ?? null,
    transport: found?.transport ?? null,
    tools: found?.tools ?? [],
  });
  if (body === null) return;
  const api = deps.api();
  if (!api) throw new TaskFailure("not_ready", "the daemon is not ready");
  try {
    await api.manifest(body);
  } catch (error) {
    throw new TaskFailure(error instanceof ApiError ? error.reason : "unknown", error instanceof Error ? error.message : String(error));
  }
}

/** One request of the task's conversation, streamed. Answers what she said in it. */
async function request(run: Active, message: string): Promise<string> {
  const api = deps.api();
  if (!api) throw new TaskFailure("not_ready", "the daemon is not ready");
  const ref = run.tab === null ? null : refOf(run.tab);
  if (run.tab !== null && !ref) throw new TaskFailure("unknown_ref", "the task's tab was closed");
  const tab = ref ? deps.tabs().find((t) => t.id === ref.tabId) : undefined;
  const carried = run.outstanding;
  run.outstanding = [];
  const lists = deps.lists();
  const body: TurnBody = {
    origin: ref?.origin ?? run.origin,
    message,
    surface: "panel",
    // Its own tab and document: a card it files is bound to them (ADR 0103). Never the focused tab's.
    ...(ref ? { tab_id: ref.tabId, ...(ref.nav !== undefined ? { tab_nav: ref.nav } : {}) } : {}),
    host_state: tab ? { page_url: tab.url, page_title: tab.title } : {},
    tool_results: carried,
    disabled_origins: [...new Set([...lists.disabledOrigins, ...run.off])].sort(),
    ...withUnsure(lists.gated),
    task_id: run.task.id,
  };
  const proposed = new Map<string, ExecuteRow>();
  const parts: string[] = [];
  let failure: TaskFailure | null = null;
  try {
    for await (const event of api.run(body, run.controller.signal)) {
      switch (event.kind) {
        case "text.delta":
          parts.push(event.text);
          break;
        case "tool.call":
          // A host call is held until the turn ends; a result for its id means the daemon answered it.
          if (event.origin !== "core") proposed.set(event.call_id, event as ExecuteRow);
          break;
        case "tool.result":
          proposed.delete(event.call_id);
          break;
        case "decision.requested":
          // Into the one stack, labelled with the task's title; its answer comes back to this loop.
          run.cards.add(event.id);
          useRun.getState().fileTaskCard(event, run.task.title, ownerOf(run, event.id, event.action));
          break;
        case "turn.error":
          // The daemon stopped this turn: the task was killed, and the bus says so in a moment.
          if (event.reason === "cancelled") throw new Killed();
          failure = new TaskFailure(event.reason, event.detail);
          break;
        case "turn.finished":
          for (const call of proposed.values()) {
            if (run.controller.signal.aborted) break;
            await onTab(run, call, false);
          }
          break;
      }
      if (isTerminal(event)) break;
    }
  } catch (error) {
    if (error instanceof Killed || run.controller.signal.aborted) throw new Killed();
    // Killed between two of its turns: the daemon says so by name (`ApiError.word`).
    if (error instanceof ApiError && error.word === "task_not_running") throw new Killed();
    throw new TaskFailure(error instanceof ApiError ? error.reason : "unknown", error instanceof Error ? error.message : String(error));
  }
  if (failure) throw failure;
  return parts
    .map((p) => p.trim())
    .filter(Boolean)
    .join("\n\n");
}

/** Who carries on after the person answers one of the task's cards. */
function ownerOf(run: Active, id: string, action: string) {
  return {
    origin: run.origin,
    release: (outcome: { approved: boolean; execute: ExecuteRow[] }) => {
      run.cards.delete(id);
      run.released.push({ ...outcome, action });
      run.wake?.();
    },
  };
}

/**
 * Run one host call on the task's tab, or refuse it, and keep the answer for the next request.
 * The same rules as the main thread's `onPage`, on one tab: a call bound elsewhere, of another app,
 * held as unsure, or reading another tab, does not run.
 */
async function onTab(run: Active, row: ExecuteRow, approved: boolean): Promise<void> {
  const refuse = (why: string) => {
    run.outstanding.push(resultRow(row, false, "", why));
  };
  const ref = run.tab === null ? null : refOf(run.tab);
  if (!ref) return refuse(run.tab === null ? "unknown_ref: this task has no tab of its own" : "unknown_ref: the task's tab is closed");
  if (row.tab_id !== undefined && row.tab_id !== null) {
    const refused = bindingRefusal(row, ref);
    if (refused) return refuse(`${refused.reason}: ${refused.detail}`);
  }
  if (ref.appId && row.origin.startsWith("host:") && row.origin !== `host:${ref.appId}`) {
    return refuse(`foreign_origin: ${row.origin} is not the task's page`);
  }
  const held = heldBefore(row.name, approved);
  if (held) return refuse(held.error);
  if (bareName(row.name) === TABS_READ) return refuse("validator_failed: a task reads only its own tab; read it with page_read");
  const tools = deps.tools()[ref.tabId]?.tools ?? [];
  let answer: PageAnswer;
  try {
    answer = await deps.call(ref.tabId, bareName(row.name), row.params, tools);
  } catch (error) {
    answer = { ok: false, output: "", error: error instanceof Error ? error.message : String(error) };
  }
  const { timeout, error } = settleHostCall(row.name, answer, tools);
  if (timeout === "outcome_unknown") rememberUnsure({ origin: ref.origin, tool: row.name, at: stampOf(deps.now?.() ?? new Date()) });
  run.outstanding.push(resultRow(row, answer.ok, answer.output, error, answer.tier));
  if (approved && answer.ok && deps.accept) {
    const tool = tools.find((t) => t.name === bareName(row.name));
    if (tool) await deps.accept(ref.origin, tool).catch(report("contract"));
  }
}

/** Her last words, cut to {@link TASK_RESULT_CAP} characters; `null` when she said nothing. */
export function resultOf(text: string): string | null {
  const plain = text.trim();
  if (!plain) return null;
  return plain.length > TASK_RESULT_CAP ? `${plain.slice(0, TASK_RESULT_CAP - 1).trimEnd()}…` : plain;
}

/** A failure as the row's `error`: `reason: detail`. */
function failureOf(error: unknown): string {
  if (error instanceof TaskFailure) return `${error.reason}: ${error.message}`;
  if (error instanceof ApiError) return `${error.reason}: ${error.message}`;
  return `unknown: ${error instanceof Error ? error.message : String(error)}`;
}

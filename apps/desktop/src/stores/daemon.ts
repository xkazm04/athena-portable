/**
 * Where the daemon is, for as long as the window is open — README section 3.1 and 3.5.
 *
 * `startDaemon()` is called by the app root (`src/app.tsx`) and by nothing else. That is the
 * day-zero rule: the first build's tray count lived inside one page and froze the moment the user
 * navigated away from it. The daemon comes up seconds after the window does, goes away when the
 * engine is changed, and can die at any point in between — so the one thing that must not depend
 * on which module happens to be on screen is this.
 *
 * Nothing here is authoritative. Rust owns the process; every field arrives on `daemon:status`
 * and `restart` is a command. The store's own contribution is `lastError`: an event carries only
 * what is true *now*, and a daemon that failed and is being retried would otherwise flicker
 * through `starting` with nothing on screen explaining why it is restarting at all.
 */
import { create } from "zustand";

import {
  daemonRestart,
  daemonStatus,
  onDaemonStatus,
  type DaemonHealth,
  type DaemonSource,
  type DaemonStatus,
} from "@/lib/daemon";
import { hasShell } from "@/lib/ipc";

/** The reduced view. `DaemonStatus` plus what the store remembers across events. */
export interface DaemonView {
  url: string | null;
  token: string;
  engine: string;
  health: DaemonHealth;
  /**
   * The last thing that went wrong, kept until the daemon is ready again. An event's own `error`
   * is empty while it is starting, and "starting, after it failed" is a different thing to show
   * than "starting, for the first time".
   */
  lastError: string;
  source: DaemonSource;
  /** True once Rust has answered once. Before that "stopped" means "nobody asked yet". */
  loaded: boolean;
}

export const EMPTY_DAEMON: DaemonView = {
  url: null,
  token: "",
  engine: "claude_code",
  health: "stopped",
  lastError: "",
  source: "none",
  loaded: false,
};

/**
 * The one reducer. Pure, so `daemon.test.ts` drives it with the events Rust actually emits and
 * the store needs no Tauri to be checked.
 *
 * A `ready` event clears the error, because the daemon answering `/health` is the only evidence
 * that whatever went wrong is over. Every other event keeps the last one it was given.
 */
export function reduce(previous: DaemonView, status: DaemonStatus): DaemonView {
  return {
    url: status.url,
    token: status.token,
    engine: status.engine,
    health: status.health,
    lastError: status.health === "ready" ? "" : status.error || previous.lastError,
    source: status.source,
    loaded: true,
  };
}

/**
 * The daemon the panel may actually call, or `null`. c22's run loop asks this question and no
 * other: a URL without a 200 from `/health` is a port, not a daemon.
 */
export function endpoint(view: DaemonView): { url: string; token: string } | null {
  if (view.health !== "ready" || !view.url || !view.token) return null;
  return { url: view.url, token: view.token };
}

export interface DaemonState extends DaemonView {
  /** Restart on an engine. The answer arrives as events; this only reports a refused spawn. */
  restart: (engine: string) => Promise<void>;
  /**
   * Move the daemon onto an engine unless it is already there, after any restart in flight has
   * settled. Before the first status the store's engine is a placeholder, so it always restarts.
   */
  ensureEngine: (engine: string) => Promise<void>;
}

/** Restarts run one at a time, in the order asked, and a failure does not stop the next. */
let tail: Promise<unknown> = Promise.resolve();
let pending = 0;
/** Bumped by the test reset, so a restart left held by one case cannot touch the next. */
let epoch = 0;
/** The engine the store last asked Rust to start; `null` until it has asked for one. */
let asked: string | null = null;
/** The engine of the restart in flight, or `null` between restarts. */
let inflight: string | null = null;
/** The latest status that named the engine in flight; applied once the queue drains. */
let held: DaemonStatus | null = null;

/**
 * Take a status from Rust, or leave it. README 3.5, ADR 0085 (full r2, robustness-1).
 *
 * While a restart is queued or in flight an event describes the daemon before that restart, or
 * the restart itself half done, and a `ready` in it must not read as the engine the person
 * chose. Only an event naming the engine in flight is kept (the latest one), and it is applied
 * when the queue drains. Once the store has asked for an engine, an event naming another one is
 * stale: Rust changes the engine at launch and on a requested restart, and nowhere else.
 */
function observe(status: DaemonStatus): void {
  if (pending > 0) {
    if (inflight !== null && status.engine === inflight) held = status;
    return;
  }
  if (asked !== null && status.engine !== asked) return;
  useDaemon.setState((s) => reduce(s, status));
}

/** The queue is empty: the store reflects what Rust says now, not what it said on the way. */
function drained(): void {
  const mine = epoch;
  const fallback = held;
  held = null;
  const apply = (status: DaemonStatus, truth: boolean) => {
    if (mine !== epoch || pending > 0) return;
    if (!truth && status.engine !== asked) return;
    if (truth) asked = status.engine;
    useDaemon.setState((s) => reduce(s, status));
  };
  if (!hasShell()) {
    if (fallback) apply(fallback, false);
    return;
  }
  daemonStatus().then(
    (status) => apply(status, true),
    () => {
      if (fallback) apply(fallback, false);
    },
  );
}

function enqueue(job: () => Promise<void>): Promise<void> {
  pending += 1;
  const mine = epoch;
  const run = tail.then(job, job).finally(() => {
    if (mine !== epoch) return;
    pending -= 1;
    if (pending === 0) drained();
  });
  tail = run.catch(() => undefined);
  return run;
}

export const useDaemon = create<DaemonState>((set, get) => {
  /** Starting on the target until the command settles: never ready, never on the old engine. */
  const markStarting = (engine: string) =>
    set({ engine, health: "starting", url: null, token: "", loaded: true });

  const run = async (engine: string) => {
    inflight = engine;
    held = null;
    markStarting(engine);
    try {
      set(reduce(get(), await daemonRestart(engine)));
    } catch (error) {
      // Rust sets the same status before it returns the error; this is the local copy of it.
      set({
        engine,
        health: "failed",
        lastError: error instanceof Error ? error.message : String(error),
        url: null,
        token: "",
        loaded: true,
      });
      throw error;
    } finally {
      inflight = null;
    }
  };

  /** A daemon that failed or stopped on the engine is not on it: choosing it again restarts it. */
  const onEngine = (engine: string) => {
    const { loaded, engine: current, health } = get();
    return loaded && current === engine && health !== "failed" && health !== "stopped";
  };

  return {
    ...EMPTY_DAEMON,
    restart: (engine) => {
      asked = engine;
      markStarting(engine);
      return enqueue(() => run(engine));
    },
    ensureEngine: (engine) => {
      if (pending === 0 && onEngine(engine)) return Promise.resolve();
      asked = engine;
      return enqueue(async () => {
        if (!onEngine(engine)) await run(engine);
      });
    },
  };
});

let started = false;

export async function startDaemon(): Promise<void> {
  if (started || !hasShell()) return;
  started = true;
  // Subscribe before the first read. Rust spawns the daemon inside `setup`, so the ready line can
  // land between these two lines, and an event missed here is a panel that says "starting"
  // until something else happens to change.
  await onDaemonStatus(observe);
  observe(await daemonStatus());
}

/** For tests only: forget that the app root already started this store. */
export function resetDaemonForTests(): void {
  started = false;
  epoch += 1;
  tail = Promise.resolve();
  pending = 0;
  asked = null;
  inflight = null;
  held = null;
  useDaemon.setState({ ...EMPTY_DAEMON });
}

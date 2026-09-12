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
  type DaemonEngine,
  type DaemonHealth,
  type DaemonSource,
  type DaemonStatus,
} from "@/lib/daemon";
import type { EngineProbe, EngineState } from "@/lib/engines";
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
  /**
   * The daemon's engine probe, or `null` while it has not answered.
   *
   * It is the daemon's because the daemon is the process that knows: `GET /health` carries the
   * list, `daemon.rs` keeps asking for it after the first 200, and this store is where the two
   * surfaces that render it — Setup and Settings — read it from. `null` is not an empty list: one
   * is "nothing has been asked yet" and the other is "asked, and nothing is installed".
   */
  engines: DaemonEngine[] | null;
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
  engines: null,
  loaded: false,
};

/**
 * The one reducer. Pure, so `daemon.test.ts` drives it with the events Rust actually emits and
 * the store needs no Tauri to be checked.
 *
 * A `ready` event clears the error, because the daemon answering `/health` is the only evidence
 * that whatever went wrong is over. Every other event keeps the last one it was given.
 *
 * The probe is the one other thing the store remembers across events, and for the same reason:
 * Rust clears it on a respawn — a fresh daemon has made no claim about this machine's PATH yet —
 * and then fills it in a moment after the first 200, so a `null` arriving *after* an answer is
 * the new process asking again and not the old answer being withdrawn.
 */
export function reduce(previous: DaemonView, status: DaemonStatus): DaemonView {
  return {
    url: status.url,
    token: status.token,
    engine: status.engine,
    health: status.health,
    lastError: status.health === "ready" ? "" : status.error || previous.lastError,
    source: status.source,
    engines: status.engines ?? null,
    loaded: true,
  };
}

/**
 * The engine probe as the Setup wizard and the Settings module read it (`lib/engines.ts`).
 *
 * A `state` the daemon invented collapses to `unknown` here rather than reaching a switch that
 * has no case for it: "I do not know" is one of the four the surfaces already render, and it is
 * the honest reading of a word this build has never heard of.
 */
export function engineProbes(view: Pick<DaemonView, "engines">): EngineProbe[] | null {
  if (view.engines === null) return null;
  return view.engines.map((row) => ({
    id: row.id,
    state: isEngineState(row.state) ? row.state : "unknown",
    detail: row.detail,
  }));
}

const ENGINE_STATES: readonly string[] = ["found", "not_found", "not_logged_in", "unknown"];

function isEngineState(state: string): state is EngineState {
  return ENGINE_STATES.includes(state);
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
}

export const useDaemon = create<DaemonState>((set, get) => ({
  ...EMPTY_DAEMON,
  restart: async (engine) => {
    const status = await daemonRestart(engine);
    set(reduce(get(), status));
  },
}));

let started = false;

export async function startDaemon(): Promise<void> {
  if (started || !hasShell()) return;
  started = true;
  // Subscribe before the first read. Rust spawns the daemon inside `setup`, so the ready line can
  // land between these two lines, and an event missed here is a panel that says "starting"
  // until something else happens to change.
  await onDaemonStatus((status) => useDaemon.setState((s) => reduce(s, status)));
  const first = await daemonStatus();
  useDaemon.setState((s) => reduce(s, first));
}

/** For tests only: forget that the app root already started this store. */
export function resetDaemonForTests(): void {
  started = false;
  useDaemon.setState({ ...EMPTY_DAEMON });
}

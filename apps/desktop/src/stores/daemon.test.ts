/**
 * The daemon store reduces `daemon:status` — README section 3.5 (a store the app root starts).
 *
 * These are the events `src-tauri/src/daemon.rs` actually emits, in the order one spawn emits
 * them: `starting` at the spawn, `starting` again with a URL when the ready line lands, `ready`
 * when `/health` answers 200, `failed` when the process goes away. The reducer is pure, so the
 * whole life of a daemon is a list of objects here and needs no shell.
 */
import { beforeEach, expect, test } from "vitest";

import type { DaemonStatus } from "@/lib/daemon";
import {
  EMPTY_DAEMON,
  endpoint,
  reduce,
  resetDaemonForTests,
  useDaemon,
  type DaemonView,
} from "@/stores/daemon";

const TOKEN = "a".repeat(64);

function event(over: Partial<DaemonStatus> = {}): DaemonStatus {
  return {
    url: null,
    token: TOKEN,
    engine: "claude_code",
    health: "starting",
    error: "",
    source: "uv",
    brain: "/app/brain",
    ...over,
  };
}

/** Fold a whole spawn's worth of events, the way the listener does. */
function play(events: DaemonStatus[], from: DaemonView = EMPTY_DAEMON): DaemonView {
  return events.reduce(reduce, from);
}

beforeEach(() => {
  resetDaemonForTests();
});

test("an unstarted store says so, rather than saying the daemon is stopped", () => {
  expect(useDaemon.getState().loaded).toBe(false);
  expect(useDaemon.getState().health).toBe("stopped");
  expect(endpoint(useDaemon.getState())).toBeNull();
});

test("one spawn, from the command to the first 200", () => {
  const view = play([
    event({ health: "starting" }),
    event({ health: "starting", url: "http://127.0.0.1:51057" }),
    event({ health: "ready", url: "http://127.0.0.1:51057" }),
  ]);

  expect(view.loaded).toBe(true);
  expect(view.health).toBe("ready");
  expect(view.url).toBe("http://127.0.0.1:51057");
  expect(view.token).toBe(TOKEN);
  expect(view.engine).toBe("claude_code");
  expect(view.source).toBe("uv");
  expect(endpoint(view)).toEqual({ url: "http://127.0.0.1:51057", token: TOKEN });
});

test("a URL without a 200 is a port and not a daemon", () => {
  const view = play([event({ health: "starting", url: "http://127.0.0.1:51057" })]);
  expect(view.url).not.toBeNull();
  expect(endpoint(view)).toBeNull();
});

test("the last error survives the restart that follows it", () => {
  const failed = play([
    event({ health: "failed", error: "the daemon exited", url: null }),
  ]);
  expect(failed.lastError).toBe("the daemon exited");

  // The engine changes; Rust respawns and the next event carries no error of its own.
  const restarting = play([event({ health: "starting", engine: "codex", error: "" })], failed);
  expect(restarting.health).toBe("starting");
  expect(restarting.engine).toBe("codex");
  expect(restarting.lastError).toBe("the daemon exited");

  // Answering `/health` is the only evidence that whatever went wrong is over.
  const ready = play([
    event({ health: "ready", engine: "codex", url: "http://127.0.0.1:51058" }),
  ], restarting);
  expect(ready.lastError).toBe("");
});

test("a newer error replaces an older one", () => {
  const view = play([
    event({ health: "failed", error: "no ready line from the daemon within 20s" }),
    event({ health: "failed", error: "the daemon refused this shell's token" }),
  ]);
  expect(view.lastError).toBe("the daemon refused this shell's token");
});

test("an exit clears the URL, so nothing keeps calling a dead port", () => {
  const view = play([
    event({ health: "ready", url: "http://127.0.0.1:51057" }),
    event({ health: "failed", url: null, error: "the daemon exited" }),
  ]);
  expect(view.url).toBeNull();
  expect(endpoint(view)).toBeNull();
  expect(view.lastError).toBe("the daemon exited");
});

test("the store applies the same reduction the listener does", () => {
  useDaemon.setState((s) => reduce(s, event({ health: "ready", url: "http://127.0.0.1:1" })));
  expect(useDaemon.getState().health).toBe("ready");
  expect(endpoint(useDaemon.getState())).toEqual({ url: "http://127.0.0.1:1", token: TOKEN });
});

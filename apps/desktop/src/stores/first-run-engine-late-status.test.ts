/**
 * A `daemon:status` event or the first status read that lands while a restart is queued, and a
 * failed start that is chosen again (README 3.5, ADR 0085, first-run-setup full r2: robustness-1
 * and robustness-2).
 *
 * The seams are the ones `first-run-engine-inflight.test.ts` uses, plus the status channel: the
 * test holds the handler `startDaemon` subscribes, and `daemonStatus` answers with what Rust
 * would say now (`seams.truth`), or waits on `seams.gate`.
 */
import { beforeEach, expect, test, vi } from "vitest";

import type { DaemonStatus } from "@/lib/daemon";
import type { EngineProbe } from "@/lib/engines";
import { engineView } from "@/companion/model";
import { INERT_ACTIONS, selectSetup } from "@/modules/setup/model";
import { engineFact } from "@/modules/setup/readiness";

const seams = vi.hoisted(() => ({
  restarts: [] as string[],
  release: [] as (() => void)[],
  hold: false,
  fail: null as string | null,
  handler: null as null | ((s: unknown) => void),
  truth: null as unknown,
  gate: null as Promise<void> | null,
}));

vi.mock("@/lib/ipc", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/ipc")>()),
  hasShell: () => true,
}));

vi.mock("@/lib/store", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/store")>()),
  settingWrite: vi.fn(async () => {}),
}));

vi.mock("@/lib/daemon", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/daemon")>()),
  onDaemonStatus: vi.fn(async (handler: (s: unknown) => void) => {
    seams.handler = handler;
    return () => {};
  }),
  daemonStatus: vi.fn(async () => {
    if (seams.gate) await seams.gate;
    if (seams.truth === null) throw new Error("no answer");
    return seams.truth;
  }),
  daemonRestart: vi.fn(async (engine: string) => {
    seams.restarts.push(engine);
    if (seams.hold) await new Promise<void>((resolve) => seams.release.push(resolve));
    if (seams.fail !== null) throw new Error(seams.fail);
    return status(engine, "starting");
  }),
}));

import { endpoint, resetDaemonForTests, startDaemon, useDaemon } from "./daemon";
import { chooseFirstRunEngine, chooseSetupEngine, useSettings } from "./settings";

function status(engine: string, health: DaemonStatus["health"], error = ""): DaemonStatus {
  return {
    url: health === "ready" ? "http://127.0.0.1:1" : null,
    token: health === "ready" ? "t" : "",
    engine,
    health,
    error,
    source: "sidecar",
    brain: "",
    attempt: 0,
  };
}

const PROBES: EngineProbe[] = [
  { id: "claude_code", state: "found", detail: "2.1.268" },
  { id: "codex", state: "found", detail: "0.1" },
];

function standing() {
  const d = useDaemon.getState();
  const s = useSettings.getState();
  const fact = engineFact(
    selectSetup({
      onboarded: false,
      hydrated: true,
      engine: s.engine,
      engineIds: ["claude_code", "codex"],
      probes: PROBES,
      problem: null,
      theme: "system",
      brainPath: "",
      tabs: [],
      storePath: "athena.sqlite",
      daemonHealth: d.health,
      daemonEngine: d.engine,
      daemonLoaded: d.loaded,
      actions: INERT_ACTIONS,
    }),
  );
  const view = engineView(s.engine, PROBES, null, false, d.engine, d.health, d.loaded);
  return { fact, view };
}

const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));
const emit = (s: DaemonStatus) => seams.handler?.(s);
const release = async () => {
  seams.release.shift()?.();
  await tick();
};

function nothingReady() {
  expect(standing().fact.standing).not.toBe("done");
  expect(standing().view.state).not.toBe("ready");
  expect(endpoint(useDaemon.getState())).toBeNull();
}

beforeEach(() => {
  seams.restarts.length = 0;
  seams.release.length = 0;
  seams.hold = false;
  seams.fail = null;
  seams.handler = null;
  seams.truth = status("claude_code", "ready");
  seams.gate = null;
  resetDaemonForTests();
  useSettings.setState({ engine: "claude_code", onboarded: false });
});

test("S7: a late ready for the old engine, delivered while a restart is queued, reads as nothing ready", async () => {
  await startDaemon();
  expect(endpoint(useDaemon.getState())).not.toBeNull();
  seams.hold = true;
  const first = chooseFirstRunEngine("codex");
  await tick();
  const second = chooseFirstRunEngine("claude_code");
  await tick();
  emit(status("claude_code", "ready"));
  nothingReady();

  seams.truth = status("codex", "starting");
  await release();
  nothingReady();
  seams.truth = status("claude_code", "starting");
  await release();
  await Promise.all([first, second]);
  nothingReady();
  expect(seams.restarts).toEqual(["codex", "claude_code"]);
  expect(useDaemon.getState().engine).toBe("claude_code");

  emit(status("claude_code", "ready"));
  expect(endpoint(useDaemon.getState())).not.toBeNull();
});

test("S6: the first status read lands mid-queue, and nothing reads ready until the queue drains", async () => {
  let open!: () => void;
  seams.gate = new Promise<void>((resolve) => (open = resolve));
  const started = startDaemon();
  await tick();
  seams.hold = true;
  const first = chooseFirstRunEngine("codex");
  await tick();
  const second = chooseFirstRunEngine("claude_code");
  await tick();
  open();
  await started;
  nothingReady();

  seams.gate = null;
  seams.truth = status("codex", "starting");
  await release();
  nothingReady();
  seams.truth = status("claude_code", "starting");
  await release();
  await Promise.all([first, second]);
  nothingReady();
  expect(useDaemon.getState().engine).toBe("claude_code");
});

test("S8: a stale ready for the old engine after the restart returned is ignored, and choosing it again restarts", async () => {
  await startDaemon();
  seams.truth = status("codex", "starting");
  await chooseFirstRunEngine("codex");
  expect(useDaemon.getState().engine).toBe("codex");

  emit(status("claude_code", "ready"));
  expect(useDaemon.getState().engine).toBe("codex");
  nothingReady();

  seams.truth = status("claude_code", "starting");
  await chooseFirstRunEngine("claude_code");
  expect(seams.restarts).toEqual(["codex", "claude_code"]);
  expect(useDaemon.getState().engine).toBe("claude_code");
});

test("R: a ready for the engine being started, landing before its own restart's reply, is not lost", async () => {
  await startDaemon();
  seams.hold = true;
  const first = chooseFirstRunEngine("codex");
  await tick();
  emit(status("codex", "ready"));
  nothingReady();

  seams.truth = status("codex", "ready");
  await release();
  await first;
  await tick();
  expect(useDaemon.getState().health).toBe("ready");
  expect(useDaemon.getState().engine).toBe("codex");
  expect(standing().fact.standing).toBe("done");
  expect(standing().view.state).toBe("ready");
});

test("R: when the re-read gets no answer, the held ready for the engine started is applied", async () => {
  await startDaemon();
  seams.hold = true;
  const first = chooseFirstRunEngine("codex");
  await tick();
  emit(status("codex", "ready"));
  seams.truth = null;
  await release();
  await first;
  await tick();
  expect(useDaemon.getState().health).toBe("ready");
  expect(useDaemon.getState().engine).toBe("codex");
});

test("S3: a restart that rejected is restarted by choosing the same engine again", async () => {
  await startDaemon();
  seams.truth = status("codex", "failed", "cannot spawn");
  seams.fail = "cannot spawn";
  await expect(chooseFirstRunEngine("codex")).rejects.toThrow("cannot spawn");
  expect(useDaemon.getState().health).toBe("failed");

  seams.fail = null;
  seams.truth = status("codex", "starting");
  await chooseFirstRunEngine("codex");
  expect(seams.restarts).toEqual(["codex", "codex"]);
  expect(useDaemon.getState().health).toBe("starting");
});

test("S3: the same through chooseSetupEngine", async () => {
  await startDaemon();
  seams.truth = status("codex", "failed", "cannot spawn");
  seams.fail = "cannot spawn";
  await expect(chooseSetupEngine("codex")).rejects.toThrow("cannot spawn");

  seams.fail = null;
  seams.truth = status("codex", "starting");
  await chooseSetupEngine("codex");
  expect(seams.restarts).toEqual(["codex", "codex"]);
  expect(useDaemon.getState().health).toBe("starting");
});

test("a daemon that stopped on the chosen engine is restarted by choosing it again", async () => {
  await startDaemon();
  emit(status("claude_code", "stopped"));
  expect(useDaemon.getState().health).toBe("stopped");
  seams.truth = status("claude_code", "starting");
  await chooseFirstRunEngine("claude_code");
  expect(seams.restarts).toEqual(["claude_code"]);
});

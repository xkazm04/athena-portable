/**
 * A first-run engine choice while a restart is in flight, a restart that fails, and a choice made
 * before the daemon store has loaded (README 3.5, ADR 0085, first-run-setup full r1 robustness-1,
 * -2 and -4).
 *
 * The seams are the ones `first-run-engine.test.ts` uses: the settings row write and the restart
 * command, here held pending or rejected by the test.
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
}));

vi.mock("@/lib/store", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/store")>()),
  settingWrite: vi.fn(async () => {}),
}));

vi.mock("@/lib/daemon", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/daemon")>()),
  daemonRestart: vi.fn(async (engine: string) => {
    seams.restarts.push(engine);
    if (seams.hold) await new Promise<void>((resolve) => seams.release.push(resolve));
    if (seams.fail !== null) throw new Error(seams.fail);
    const status: DaemonStatus = {
      url: null,
      token: "",
      engine,
      health: "starting",
      error: "",
      source: "sidecar",
      brain: "",
    };
    return status;
  }),
}));

import { endpoint, resetDaemonForTests, useDaemon } from "./daemon";
import { chooseFirstRunEngine, chooseSetupEngine, useSettings } from "./settings";

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

beforeEach(() => {
  seams.restarts.length = 0;
  seams.release.length = 0;
  seams.hold = false;
  seams.fail = null;
  resetDaemonForTests();
  useSettings.setState({ engine: "claude_code", onboarded: false });
});

test("E: a second choice while the first restart is pending waits, then restarts, and nothing reads ready meanwhile", async () => {
  useDaemon.setState({ engine: "claude_code", health: "ready", loaded: true, url: "http://x", token: "t" });
  seams.hold = true;
  const first = chooseFirstRunEngine("codex");
  await tick();
  const second = chooseFirstRunEngine("claude_code");
  await tick();
  expect(seams.restarts).toEqual(["codex"]);
  expect(standing().fact.standing).not.toBe("done");
  expect(standing().view.state).not.toBe("ready");
  expect(endpoint(useDaemon.getState())).toBeNull();

  seams.release.shift()?.();
  await tick();
  seams.release.shift()?.();
  await Promise.all([first, second]);
  expect(seams.restarts).toEqual(["codex", "claude_code"]);
  expect(useSettings.getState().engine).toBe("claude_code");
  expect(useDaemon.getState().engine).toBe("claude_code");
});

test("B: a restart that rejects leaves the store failed on the attempted engine", async () => {
  useDaemon.setState({ engine: "claude_code", health: "ready", loaded: true, url: "http://x", token: "t" });
  seams.fail = "sidecar would not start";
  await expect(chooseFirstRunEngine("codex")).rejects.toThrow("sidecar would not start");
  const d = useDaemon.getState();
  expect(d.health).toBe("failed");
  expect(d.lastError).toContain("sidecar would not start");
  expect(d.url).toBeNull();
  expect(d.engine).toBe("codex");
  expect(endpoint(d)).toBeNull();
  expect(standing().fact.standing).toBe("missing");
  expect(standing().fact.summary).toContain("could not start");
  expect(standing().view.state).toBe("missing");
});

test("F: the same through chooseSetupEngine before onboarding", async () => {
  useDaemon.setState({ engine: "claude_code", health: "ready", loaded: true, url: "http://x", token: "t" });
  seams.fail = "no athena-daemon beside the app";
  await expect(chooseSetupEngine("codex")).rejects.toThrow("no athena-daemon");
  const d = useDaemon.getState();
  expect(d.health).toBe("failed");
  expect(d.lastError).toContain("no athena-daemon");
  expect(d.url).toBeNull();
  expect(d.engine).toBe("codex");
  expect(endpoint(d)).toBeNull();
  expect(standing().fact.standing).toBe("missing");
  expect(standing().view.state).toBe("missing");
});

test("C: not loaded, Rust launched on a stored codex, choosing claude_code ends on claude_code", async () => {
  expect(useDaemon.getState().loaded).toBe(false);
  await chooseFirstRunEngine("claude_code");
  expect(seams.restarts).toEqual(["claude_code"]);
  expect(useDaemon.getState().engine).toBe("claude_code");
});

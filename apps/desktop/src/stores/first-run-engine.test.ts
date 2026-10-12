/**
 * A first-run engine choice moves the running daemon; one made after the letter does not.
 *
 * The two calls are faked at the seams `chooseFirstRunEngine` crosses: the settings row write
 * and the daemon restart command. The daemon store's `engine` is set directly, as a
 * `daemon:status` event would set it.
 */
import { beforeEach, expect, test, vi } from "vitest";

const seams = vi.hoisted(() => ({
  writes: [] as { key: string; value: unknown }[],
  restarts: [] as string[],
}));

vi.mock("@/lib/store", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/store")>()),
  settingWrite: vi.fn(async (key: string, value: unknown) => {
    seams.writes.push({ key, value });
  }),
}));

vi.mock("@/lib/daemon", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/daemon")>()),
  daemonRestart: vi.fn(async (engine: string) => {
    seams.restarts.push(engine);
    return {
      url: null,
      token: "",
      engine,
      health: "starting",
      error: "",
      source: "sidecar",
    };
  }),
}));

import { SETTING_KEYS } from "@/lib/store";

import { resetDaemonForTests, useDaemon } from "./daemon";
import { chooseFirstRunEngine, useSettings } from "./settings";

beforeEach(() => {
  seams.writes.length = 0;
  seams.restarts.length = 0;
  resetDaemonForTests();
  useSettings.setState({ engine: "claude_code", onboarded: false });
});

test("first run, daemon on claude_code, choose codex: the row is written and the daemon restarts once", async () => {
  useDaemon.setState({ engine: "claude_code", health: "ready" });
  await chooseFirstRunEngine("codex");
  expect(seams.writes).toEqual([{ key: SETTING_KEYS.engine, value: "codex" }]);
  expect(seams.restarts).toEqual(["codex"]);
});

test("choosing the engine the daemon already runs writes the row and restarts nothing", async () => {
  useDaemon.setState({ engine: "codex", health: "ready" });
  await chooseFirstRunEngine("codex");
  expect(seams.writes).toEqual([{ key: SETTING_KEYS.engine, value: "codex" }]);
  expect(seams.restarts).toEqual([]);
});

test("once onboarded, setEngine alone writes the row and never restarts", async () => {
  useSettings.setState({ onboarded: true });
  useDaemon.setState({ engine: "claude_code", health: "ready" });
  await useSettings.getState().setEngine("codex");
  expect(seams.writes).toEqual([{ key: SETTING_KEYS.engine, value: "codex" }]);
  expect(seams.restarts).toEqual([]);
});

test("the daemon has not loaded: a choice that differs from its placeholder engine still restarts", async () => {
  expect(useDaemon.getState().loaded).toBe(false);
  await chooseFirstRunEngine("codex");
  expect(seams.writes).toEqual([{ key: SETTING_KEYS.engine, value: "codex" }]);
  expect(seams.restarts).toEqual(["codex"]);
});

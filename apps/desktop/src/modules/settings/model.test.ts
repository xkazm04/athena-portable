/**
 * The Settings module's selector and its one derived notice.
 *
 * What is asserted here is the difference between the three things this surface can know about
 * an engine — it answered, it refused, nobody asked — and the fact that a restart the shell
 * cannot perform yet is *said* rather than implied by a button that does nothing.
 */
import { expect, test, vi } from "vitest";

import type { EngineProbe } from "@/lib/engines";

import {
  INERT_ACTIONS,
  restartNotice,
  selectSettings,
  type SettingsSources,
} from "./model";

function sources(over: Partial<SettingsSources> = {}): SettingsSources {
  return {
    hydrated: true,
    engine: "claude_code",
    probes: [{ id: "claude_code", state: "found", detail: "2.1.268" }],
    theme: "system",
    storePath: "athena.sqlite",
    pendingEngine: null,
    restartWired: false,
    problem: null,
    engineIds: ["claude_code", "codex"],
    actions: INERT_ACTIONS,
    ...over,
  };
}

test("an engine the probe never mentioned is still offered, with nothing claimed about it", () => {
  const model = selectSettings(sources());
  expect(model.engines.map((e) => e.id)).toEqual(["claude_code", "codex"]);
  expect(model.engines[1].probe).toBeNull();
  expect(model.engines[1].disabledReason).toBeUndefined();
});

test("an engine that answered badly carries its remediation, and a found one carries none", () => {
  const probes: EngineProbe[] = [
    { id: "claude_code", state: "found", detail: "2.1.268" },
    { id: "codex", state: "not_found", detail: "`codex` is not on the PATH" },
  ];
  const model = selectSettings(sources({ probes }));
  expect(model.engines[0].disabledReason).toBeUndefined();
  expect(model.engines[1].disabledReason).toContain("Install it");
});

test("no probe at all is not the same fact as no engine installed", () => {
  const model = selectSettings(sources({ probes: null }));
  expect(model.engines).toHaveLength(2);
  for (const engine of model.engines) {
    expect(engine.probe).toBeNull();
    expect(engine.disabledReason).toBeUndefined();
  }
});

test("there is no notice until an engine change is pending", () => {
  expect(restartNotice(selectSettings(sources()))).toBeNull();
});

test("a pending change with nothing wired offers no action and says why", () => {
  const notice = restartNotice(selectSettings(sources({ pendingEngine: "codex" })));
  expect(notice?.actionLabel).toBeNull();
  expect(notice?.title).toContain("Codex");
  expect(notice?.detail).toContain("next time Athena starts");
});

test("a pending change with the sidecar wired offers the restart by name", () => {
  const notice = restartNotice(
    selectSettings(sources({ pendingEngine: "codex", restartWired: true })),
  );
  expect(notice?.actionLabel).toBe("Restart on Codex");
});

test("the actions are the view's only route out, and they are passed through untouched", () => {
  const actions = { ...INERT_ACTIONS, chooseEngine: vi.fn(), setTheme: vi.fn() };
  const model = selectSettings(sources({ actions }));
  model.actions.chooseEngine("codex");
  model.actions.setTheme("dark");
  expect(actions.chooseEngine).toHaveBeenCalledWith("codex");
  expect(actions.setTheme).toHaveBeenCalledWith("dark");
});

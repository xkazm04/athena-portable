/**
 * The Setup module's selector: the mode, the engine options, the pending restart, the tabs.
 *
 * What is asserted is the difference between the three things this surface can know about an
 * engine — it answered, it refused, nobody asked — and that "the daemon needs a restart" is a
 * derivation from two facts rather than a boolean anyone stores.
 */
import { expect, test, vi } from "vitest";

import type { EngineProbe } from "@/lib/engines";

import { INERT_ACTIONS, pendingEngineOf, selectSetup, type SetupSources } from "./model";

function sources(over: Partial<SetupSources> = {}): SetupSources {
  return {
    onboarded: true,
    hydrated: true,
    engine: "claude_code",
    engineIds: ["claude_code", "codex"],
    probes: [{ id: "claude_code", state: "found", detail: "2.1.268" }],
    problem: null,
    theme: "system",
    brainPath: "",
    tabs: [],
    storePath: "athena.sqlite",
    daemonHealth: "ready",
    daemonEngine: "claude_code",
    actions: INERT_ACTIONS,
    ...over,
  };
}

test("the mode is derived from whether the letter was read, and reopening overrides it once", () => {
  expect(selectSetup(sources({ onboarded: false })).mode).toBe("onboarding");
  expect(selectSetup(sources({ onboarded: true })).mode).toBe("settings");
  expect(selectSetup(sources({ onboarded: true, reopened: true })).mode).toBe("onboarding");
});

test("an engine the probe never mentioned is still offered, with nothing claimed about it", () => {
  const model = selectSetup(sources());
  expect(model.engines.map((e) => e.id)).toEqual(["claude_code", "codex"]);
  expect(model.engines[1].probe).toBeNull();
  expect(model.engines[1].disabledReason).toBeUndefined();
});

test("an engine that answered badly carries its remediation, and a found one carries none", () => {
  const probes: EngineProbe[] = [
    { id: "claude_code", state: "found", detail: "2.1.268" },
    { id: "codex", state: "not_found", detail: "`codex` is not on the PATH" },
  ];
  const model = selectSetup(sources({ probes }));
  expect(model.engines[0].disabledReason).toBeUndefined();
  expect(model.engines[1].disabledReason).toContain("Install it");
});

test("no probe at all is not the same fact as no engine installed", () => {
  const model = selectSetup(sources({ probes: null }));
  expect(model.engines).toHaveLength(2);
  for (const engine of model.engines) {
    expect(engine.probe).toBeNull();
    expect(engine.disabledReason).toBeUndefined();
  }
});

test("a pending engine is the stored one when a running daemon is on another", () => {
  expect(pendingEngineOf("codex", "claude_code", "ready")).toBe("codex");
  expect(pendingEngineOf("claude_code", "claude_code", "ready")).toBeNull();
  // A daemon that is not running has nothing to disagree with.
  expect(pendingEngineOf("codex", "claude_code", "starting")).toBeNull();
  expect(pendingEngineOf("codex", "", "stopped")).toBeNull();
  expect(selectSetup(sources({ engine: "codex" })).pendingEngine).toBe("codex");
});

test("a tab with no title is called by its address, and a non-URL is its own host", () => {
  const m = selectSetup(
    sources({
      tabs: [
        { id: 1, title: "", url: "https://invoicing.example.test/invoices" },
        { id: 2, title: "Blank", url: "about:blank" },
      ],
    }),
  );
  expect(m.tabs[0].title).toBe("https://invoicing.example.test/invoices");
  expect(m.tabs[0].host).toBe("invoicing.example.test");
  expect(m.tabs[1].host).toBe("about:blank");
});

test("the optional facts default to unknown rather than to a claim", () => {
  const m = selectSetup(sources());
  expect(m.mic).toBe("unknown");
  expect(m.voiceAvailable).toBe(false);
  expect(m.voiceReason).toBe("");
});

test("the actions are the view's only route out, and they are passed through untouched", () => {
  const actions = { ...INERT_ACTIONS, chooseEngine: vi.fn(), openPage: vi.fn(), setTheme: vi.fn() };
  const m = selectSetup(sources({ actions }));
  m.actions.chooseEngine("codex");
  m.actions.openPage("https://a.test/");
  m.actions.setTheme("dark");
  expect(actions.chooseEngine).toHaveBeenCalledWith("codex");
  expect(actions.openPage).toHaveBeenCalledWith("https://a.test/");
  expect(actions.setTheme).toHaveBeenCalledWith("dark");
});

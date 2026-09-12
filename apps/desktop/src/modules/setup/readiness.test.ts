/**
 * The Setup wizard's selector and its readiness derivation.
 *
 * The whole claim of this module is that **readiness is derived, never stored** — so the test
 * that matters is that the same model always produces the same standing, and that taking a fact
 * away takes the standing with it. There is nowhere for a stale `true` to hide, and these
 * assertions are what keeps it that way.
 */
import { expect, test, vi } from "vitest";

import type { EngineProbe } from "@/lib/engines";

import { INERT_ACTIONS, selectSetup, type SetupSources } from "./model";
import {
  engineLead,
  engineStation,
  inPlace,
  isReady,
  micStation,
  pageStation,
  stations,
} from "./readiness";

const FOUND: EngineProbe[] = [
  { id: "claude_code", state: "found", detail: "2.1.268" },
  { id: "codex", state: "not_found", detail: "`codex` is not on the PATH" },
];

function model(over: Partial<SetupSources> = {}) {
  return selectSetup({
    step: "engine",
    probes: FOUND,
    engine: "claude_code",
    engineIds: ["claude_code", "codex"],
    brainPath: "",
    tabs: [],
    onboarded: false,
    problem: null,
    actions: INERT_ACTIONS,
    ...over,
  });
}

test("a tab with no title is called by its address, and a non-URL is its own host", () => {
  const m = model({
    tabs: [
      { id: 1, title: "", url: "https://invoicing.example.test/invoices" },
      { id: 2, title: "Blank", url: "about:blank" },
    ],
  });
  expect(m.tabs[0].title).toBe("https://invoicing.example.test/invoices");
  expect(m.tabs[0].host).toBe("invoicing.example.test");
  // `new URL("about:blank").host` is the empty string, which would render as a tab open on
  // nothing at all.
  expect(m.tabs[1].host).toBe("about:blank");
});

test("an unanswered probe is `unknown`, which is not `missing`", () => {
  const station = engineStation(model({ probes: null }));
  expect(station.standing).toBe("unknown");
  expect(station.summary).toBe("the probe has not answered yet");
});

test("a probe that could not be read says so in the daemon's own words", () => {
  const station = engineStation(model({ probes: null, problem: "daemon_offline" }));
  expect(station.standing).toBe("unknown");
  expect(station.summary).toContain("daemon_offline");
});

test("the chosen engine is what the engine station is about", () => {
  expect(engineStation(model()).standing).toBe("done");
  // The same probe list, a different choice: one engine answering says nothing about the other.
  expect(engineStation(model({ engine: "codex" })).standing).toBe("todo");
  expect(engineStation(model({ engine: "codex" })).summary).toContain("another is chosen");
});

test("an installed engine that is signed out is missing, not done", () => {
  const probes: EngineProbe[] = [
    { id: "claude_code", state: "not_logged_in", detail: "no active session" },
  ];
  const station = engineStation(model({ probes }));
  expect(station.standing).toBe("missing");
  expect(station.summary).toContain("signed out");
});

test("an empty probe list is a different sentence from a probe that found nothing usable", () => {
  expect(engineStation(model({ probes: [] })).summary).toContain("no engines at all");
  const none: EngineProbe[] = [{ id: "claude_code", state: "not_found", detail: "absent" }];
  expect(engineStation(model({ probes: none })).summary).toContain("none of the 1");
});

test("a page station counts what is open and names the one host when there is one", () => {
  expect(pageStation(model()).standing).toBe("todo");
  const one = model({ tabs: [{ id: 1, title: "Invoices", url: "https://a.test/x" }] });
  expect(pageStation(one).summary).toBe("open on a.test");
  const two = model({
    tabs: [
      { id: 1, title: "A", url: "https://a.test/" },
      { id: 2, title: "B", url: "https://b.test/" },
    ],
  });
  expect(pageStation(two).summary).toBe("2 open");
});

test("the brain defaulting to the daemon's directory is a real answer, not a failure", () => {
  const [, brain] = stations(model());
  expect(brain.standing).toBe("todo");
  expect(brain.summary).toBe("the daemon's default directory");
  const [, chosen] = stations(model({ brainPath: "~/athena/brain" }));
  expect(chosen.standing).toBe("done");
});

test("readiness is derived: take the page away and it goes with it", () => {
  const ready = model({
    brainPath: "~/athena/brain",
    tabs: [{ id: 1, title: "Invoices", url: "https://a.test/x" }],
  });
  expect(isReady(ready)).toBe(true);
  expect(inPlace(ready)).toEqual({ done: 3, required: 3 });

  const noPage = model({ brainPath: "~/athena/brain" });
  expect(isReady(noPage)).toBe(false);
  expect(inPlace(noPage)).toEqual({ done: 2, required: 3 });

  // And a brain left at the default does not block a first turn, because it is a real directory.
  const noBrain = model({ tabs: [{ id: 1, title: "Invoices", url: "https://a.test/x" }] });
  expect(isReady(noBrain)).toBe(true);
  expect(inPlace(noBrain)).toEqual({ done: 2, required: 3 });
});

test("the four stations come back in the order the machine has to satisfy them", () => {
  expect(stations(model()).map((s) => s.key)).toEqual(["engine", "brain", "page", "mic", "done"]);
  expect(stations(model()).filter((s) => s.required)).toHaveLength(3);
});

test("the opening sentence agrees with its own numbers, and never claims more than a probe proves", () => {
  expect(engineLead(1, 2)).toBe("1 of the 2 answered its version flag.");
  expect(engineLead(2, 3)).toBe("2 of the 3 answered their version flags.");
  expect(engineLead(2, 2)).toBe("All 2 answered their version flags.");
  expect(engineLead(1, 1)).toBe("The one engine answered its version flag.");
  expect(engineLead(0, 2)).toBe("None of the 2 answered their version flags.");
  expect(engineLead(0, 0)).toBe("The probe answered and named no engines at all.");
  // Every one of them stops at the version flag: nothing here says an engine is signed in.
  for (const found of [0, 1, 2]) {
    expect(engineLead(found, 2)).not.toContain("ready");
    expect(engineLead(found, 2)).not.toContain("signed in");
  }
});

test("the actions are the view's only route out, and they are passed through untouched", () => {
  const actions = { ...INERT_ACTIONS, openPage: vi.fn(), goTo: vi.fn() };
  const m = model({ actions });
  m.actions.openPage("https://a.test/");
  m.actions.goTo("page");
  expect(actions.openPage).toHaveBeenCalledWith("https://a.test/");
  expect(actions.goTo).toHaveBeenCalledWith("page");
});

test("the microphone is never required, and `unknown` means it was not asked", () => {
  expect(micStation(model()).standing).toBe("unknown");
  expect(micStation(model()).required).toBe(false);
  expect(micStation(model({ mic: "granted", micDetail: "Headset" })).summary).toBe("Headset");
  expect(micStation(model({ mic: "denied", micDetail: "Permission denied" })).standing).toBe(
    "missing",
  );
  // Refusing the microphone changes nothing about readiness for a typed turn.
  expect(isReady(model({ mic: "denied", tabs: [{ id: 1, title: "t", url: "https://a.test" }] }))).toBe(
    true,
  );
});

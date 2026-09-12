/**
 * The Setup module's readiness derivation.
 *
 * The whole claim of this module is that **readiness is derived, never stored** — so the test
 * that matters is that the same model always produces the same standing, and that taking a fact
 * away takes the standing with it. There is nowhere for a stale `true` to hide.
 */
import { expect, test } from "vitest";

import type { EngineProbe } from "@/lib/engines";

import { INERT_ACTIONS, selectSetup, type SetupSources } from "./model";
import {
  brainFact,
  engineFact,
  engineLead,
  isReady,
  micFact,
  notReadyBecause,
  pageFact,
  restartNotice,
  voiceFact,
} from "./readiness";

const FOUND: EngineProbe[] = [
  { id: "claude_code", state: "found", detail: "2.1.268" },
  { id: "codex", state: "not_found", detail: "`codex` is not on the PATH" },
];

function model(over: Partial<SetupSources> = {}) {
  return selectSetup({
    onboarded: true,
    hydrated: true,
    engine: "claude_code",
    engineIds: ["claude_code", "codex"],
    probes: FOUND,
    problem: null,
    theme: "system",
    brainPath: "",
    tabs: [],
    storePath: "athena.sqlite",
    daemonHealth: "ready",
    daemonEngine: "claude_code",
    actions: INERT_ACTIONS,
    ...over,
  });
}

test("an unanswered probe is `unknown`, which is not `missing`", () => {
  const fact = engineFact(model({ probes: null }));
  expect(fact.standing).toBe("unknown");
  expect(fact.summary).toBe("the probe has not answered yet");
});

test("a probe that could not be read says so in the daemon's own words", () => {
  const fact = engineFact(model({ probes: null, problem: "daemon_offline" }));
  expect(fact.standing).toBe("unknown");
  expect(fact.summary).toContain("daemon_offline");
});

test("the chosen engine is what the engine fact is about", () => {
  expect(engineFact(model()).standing).toBe("done");
  expect(engineFact(model({ engine: "codex" })).standing).toBe("todo");
  expect(engineFact(model({ engine: "codex" })).summary).toContain("another is chosen");
});

test("an installed engine that is signed out is missing, not done", () => {
  const probes: EngineProbe[] = [
    { id: "claude_code", state: "not_logged_in", detail: "no active session" },
  ];
  const fact = engineFact(model({ probes }));
  expect(fact.standing).toBe("missing");
  expect(fact.summary).toContain("signed out");
});

test("an empty probe list is a different sentence from a probe that found nothing usable", () => {
  expect(engineFact(model({ probes: [] })).summary).toContain("no engines at all");
  const none: EngineProbe[] = [{ id: "claude_code", state: "not_found", detail: "absent" }];
  expect(engineFact(model({ probes: none })).summary).toContain("none of the 1");
});

test("a page fact counts what is open and names the one host when there is one", () => {
  expect(pageFact(model()).standing).toBe("todo");
  const one = model({ tabs: [{ id: 1, title: "Invoices", url: "https://a.test/x" }] });
  expect(pageFact(one).summary).toBe("open on a.test");
  const two = model({
    tabs: [
      { id: 1, title: "A", url: "https://a.test/" },
      { id: 2, title: "B", url: "https://b.test/" },
    ],
  });
  expect(pageFact(two).summary).toBe("2 open");
});

test("the brain defaulting to the daemon's directory is a real answer, not a failure", () => {
  expect(brainFact(model()).standing).toBe("todo");
  expect(brainFact(model()).summary).toBe("the daemon's default directory");
  expect(brainFact(model({ brainPath: "~/athena/brain" })).standing).toBe("done");
});

test("readiness is derived: take the page away and it goes with it", () => {
  const ready = model({ tabs: [{ id: 1, title: "Invoices", url: "https://a.test/x" }] });
  expect(isReady(ready)).toBe(true);
  expect(notReadyBecause(ready)).toBe("");

  const noPage = model();
  expect(isReady(noPage)).toBe(false);
  expect(notReadyBecause(noPage)).toContain("Open a page");

  const nothing = model({ probes: null });
  expect(notReadyBecause(nothing)).toContain("Choose an engine");
});

test("the microphone and the voice are never required", () => {
  expect(micFact(model()).standing).toBe("unknown");
  expect(micFact(model({ mic: "granted", micDetail: "Headset" })).summary).toBe("Headset");
  expect(micFact(model({ mic: "denied", micDetail: "Permission denied" })).standing).toBe("missing");
  const denied = model({ mic: "denied", tabs: [{ id: 1, title: "t", url: "https://a.test" }] });
  expect(isReady(denied)).toBe(true);

  expect(voiceFact(model({ voiceAvailable: true })).standing).toBe("done");
  expect(voiceFact(model({ voiceAvailable: false, voiceReason: "no backend" })).summary).toBe(
    "no backend",
  );
  // A daemon that is not up yet has not refused anything: the voice is unknown, not missing.
  expect(voiceFact(model({ voiceAvailable: false, daemonHealth: "starting" })).standing).toBe(
    "unknown",
  );
});

test("the opening sentence agrees with its own numbers, and never claims more than a probe proves", () => {
  expect(engineLead(1, 2)).toBe("1 of the 2 answered its version flag.");
  expect(engineLead(2, 3)).toBe("2 of the 3 answered their version flags.");
  expect(engineLead(2, 2)).toBe("All 2 answered their version flags.");
  expect(engineLead(1, 1)).toBe("The one engine answered its version flag.");
  expect(engineLead(0, 2)).toBe("None of the 2 answered their version flags.");
  expect(engineLead(0, 0)).toBe("The probe answered and named no engines at all.");
  for (const found of [0, 1, 2]) {
    expect(engineLead(found, 2)).not.toContain("ready");
    expect(engineLead(found, 2)).not.toContain("signed in");
  }
});

test("there is no restart notice until a running daemon disagrees with the stored row", () => {
  expect(restartNotice(model())).toBeNull();
  const notice = restartNotice(model({ engine: "codex" }));
  expect(notice?.actionLabel).toBe("Restart on Codex");
  expect(notice?.title).toContain("Claude Code");
});

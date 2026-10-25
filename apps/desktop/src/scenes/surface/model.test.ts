/** Tests for the surface's model — README section 3.1, ADR 0026, 0087 and 0225. */
import { describe, expect, it } from "vitest";

import { fixtures } from "./fixtures";
import { INERT_ACTIONS, selectSurface, type SurfaceSources } from "./model";

const typical = fixtures.typical!;

describe("the pose and the headline come from her mirror", () => {
  it("rests, works, hears and asks, and says what she is on", () => {
    expect(typical.pose).toBe("resting");
    expect(typical.headline).toBe("Athena is resting");
    expect(fixtures.working!.pose).toBe("working");
    expect(fixtures.working!.headline).toBe("Reading Invoices");
    expect(fixtures.hearing!.pose).toBe("hearing");
    expect(fixtures.asking!.pose).toBe("asking");
    expect(fixtures.asking!.waiting).toBe(2);
    expect(fixtures.asking!.headline).toBe("2 waiting");
  });
});

describe("the reach", () => {
  it("is one tendril per app and per account, lit when on or connected", () => {
    expect(typical.reach).toHaveLength(8);
    expect(typical.reach.filter((r) => r.lit)).toHaveLength(4); // 3 apps on, 1 account connected
    expect(typical.reach[0]).toEqual({ id: "app:ledgerbox", lit: true });
    expect(typical.reach.at(-1)).toEqual({ id: "account:calendar", lit: false });
  });

  it("is empty with nothing set up", () => {
    expect(fixtures.empty!.reach).toEqual([]);
  });
});

describe("the five lights", () => {
  it("are the five depths, in order, each with a stat and a hint", () => {
    expect(typical.lights.map((l) => l.root)).toEqual(["projects", "chores", "accounts", "voice", "mind"]);
    expect(typical.lights.map((l) => l.label)).toEqual(["Projects", "Chores", "Accounts", "Voice", "Mind"]);
    for (const l of typical.lights) {
      expect(l.stat.length).toBeGreaterThan(0);
      expect(l.hint.length).toBeGreaterThan(0);
    }
  });

  it("count what is live", () => {
    const by = Object.fromEntries(typical.lights.map((l) => [l.root, l]));
    expect(by.projects!.stat).toBe("3 projects · in Renovation");
    expect(by.apps).toBeUndefined();
    expect(by.chores!.stat).toBe("12 of 16 tested · $551 back found");
    expect(by.accounts!.stat).toBe("1 of 3 connected");
    expect(by.voice!.stat).toBe("ready to talk");
    expect(by.mind!.stat).toBe("Claude Code is ready");
  });

  it("flag what needs the person: an account to reconnect, an engine that is not ready", () => {
    const by = Object.fromEntries(typical.lights.map((l) => [l.root, l]));
    expect(by.accounts!.attention).toBe(true);
    expect(by.mind!.attention).toBe(false);
    const down = Object.fromEntries(fixtures.degraded!.lights.map((l) => [l.root, l]));
    expect(down.mind!.attention).toBe(true);
    expect(down.mind!.stat).toBe("Claude Code is not ready");
  });

  it("say so when a count is not known yet or there is nothing", () => {
    const by = Object.fromEntries(fixtures.empty!.lights.map((l) => [l.root, l]));
    expect(by.projects!.stat).toBe("none yet · no app yet");
    expect(by.accounts!.stat).toBe("none connected");
    expect(by.mind!.stat).toBe("checking the engine");
    expect(by.voice!.stat).toBe("not set up");
  });

  it("says it is counting the chores while the shipped playbooks are still being fetched", () => {
    const by = Object.fromEntries(fixtures.counting!.lights.map((l) => [l.root, l]));
    expect(by.chores!.stat).toBe("counting…");
  });

  it("count a page open before any app is registered, while there is no project", () => {
    const m = selectSurface({ ...src(), apps: [], openTabs: 2 });
    expect(m.lights[0]!.stat).toBe("none yet · 2 pages open");
    expect(selectSurface({ ...src(), apps: [], openTabs: 1 }).lights[0]!.stat).toBe("none yet · 1 page open");
    const apps = [
      { id: "a", host: "a.example.test", enabled: true },
      { id: "b", host: "b.example.test", enabled: false },
    ];
    expect(selectSurface({ ...src(), apps }).lights[0]!.stat).toBe("none yet · 1 of 2 apps on");
  });

  it("say where she works once there are projects, and when the list is not known", () => {
    const at = (projects: SurfaceSources["projects"]) => selectSurface({ ...src(), projects }).lights[0]!.stat;
    expect(at({ count: 1, loaded: true, failed: false, active: "" })).toBe("1 project · in core");
    expect(at({ count: 2, loaded: true, failed: false, active: "Taxes" })).toBe("2 projects · in Taxes");
    expect(at({ count: 0, loaded: false, failed: false, active: "" })).toBe("reading…");
    expect(at({ count: 0, loaded: false, failed: true, active: "" })).toBe("could not be read");
  });
});

describe("her window", () => {
  it("is said to be out exactly when her mirror says it is visible", () => {
    expect(typical.windowVisible).toBe(false);
    expect(fixtures["window out"]!.windowVisible).toBe(true);
    expect(selectSurface({ ...src(), windowVisible: true }).windowVisible).toBe(true);
  });

  it("is toggled through the actions it was given, untouched", () => {
    expect(selectSurface(src()).actions.toggle).toBe(INERT_ACTIONS.toggle);
    expect(INERT_ACTIONS.toggle()).toBeUndefined();
  });
});

describe("asking her", () => {
  it("is possible in the app and says why it is not in a plain browser", () => {
    expect(typical.canAsk).toBe(true);
    expect(typical.askReason).toBeNull();
    expect(fixtures.degraded!.canAsk).toBe(false);
    expect(fixtures.degraded!.askReason).toMatch(/only there in the app/);
  });
});

describe("what needs you is named, and one press from its item", () => {
  it("case 1: an account that let its grant go is a need that lands on that account", () => {
    expect(typical.needs).toEqual([
      {
        key: "account:gmail",
        label: "Gmail",
        word: "needs reconnecting",
        line: "Gmail let the grant go; connect again to continue.",
        to: { root: "accounts", item: "gmail" },
      },
    ]);
  });

  it("case 2: an engine that cannot run is a need on Mind > Engine, before any account", () => {
    const needs = fixtures.degraded!.needs;
    expect(needs[0]).toMatchObject({
      key: "engine",
      label: "Claude Code",
      word: "Claude Code is not ready",
      line: "Claude Code is installed but not signed in.",
      to: { root: "mind", item: "engine" },
    });
    expect(needs.map((n) => n.key)).toEqual(["engine", "account:gmail"]);
  });

  it("case 3: a restart that is pending is a need on Mind > Engine, and none without one", () => {
    const m = selectSurface({ ...src(), pendingRestart: { label: "Codex", running: "Claude Code" } });
    expect(m.needs).toHaveLength(1);
    expect(m.needs[0]!.line).toBe("Codex is chosen. Athena is still running on Claude Code.");
    expect(m.needs[0]!.to).toEqual({ root: "mind", item: "engine" });
    expect(selectSurface({ ...src(), pendingRestart: null }).needs).toEqual([]);
  });

  it("case 4: a light under attention dives to its first need, and the rest to their root as before", () => {
    const by = Object.fromEntries(typical.lights.map((l) => [l.root, l]));
    expect(by.accounts!.to).toEqual({ root: "accounts", item: "gmail" });
    expect(by.projects!.to).toEqual({ root: "projects" });
    expect(by.chores!.to).toEqual({ root: "chores" });
    expect(by.voice!.to).toEqual({ root: "voice" });
    expect(by.mind!.to).toEqual({ root: "mind" });
    const down = Object.fromEntries(fixtures.degraded!.lights.map((l) => [l.root, l]));
    expect(down.mind!.to).toEqual({ root: "mind", item: "engine" });
  });

  it("case 7 (guard): cards waiting are the summon, never a need", () => {
    const asking = selectSurface({ ...src(), athena: { state: "slip", cards: 2, line: "" } });
    expect(asking.waiting).toBe(2);
    expect(asking.needs).toEqual([]);
  });
});

describe("each light carries the facts its glyph draws", () => {
  it("case 7: accounts carry attention and the connected count, projects their count, chores not loaded draw no count", () => {
    const m = selectSurface({
      ...src(),
      apps: ["a", "b", "c", "d", "e"].map((id, i) => ({ id, host: `${id}.test`, enabled: i < 2 })),
      projects: { count: 2, loaded: true, failed: false, active: "" },
      accounts: [
        { id: "gmail", label: "Gmail", connected: true, attention: true, word: "wants reconnecting", line: "Its grant lapsed." },
        { id: "notion", label: "Notion", connected: true, attention: false, word: "connected", line: "" },
        { id: "calendar", label: "Calendar", connected: false, attention: false, word: "not connected", line: "" },
      ],
      chores: { total: 0, benched: 0, foundUsd: 0, loaded: false, failed: false },
    });
    const by = Object.fromEntries(m.lights.map((l) => [l.root, l]));
    expect(by.accounts!.art).toEqual({ attention: true, filled: 2, of: 3 });
    expect(by.projects!.art).toEqual({ attention: false, filled: 2, of: 2 });
    // The apps have no light of their own since Projects took theirs (ADR 0225).
    expect(by.apps).toBeUndefined();
    expect(by.chores!.art.of).toBeNull();
    expect(by.voice!.art).toEqual({ attention: false, filled: 0, of: 1 });
    expect(by.mind!.art).toEqual({ attention: false, filled: 1, of: 1 });
    const unknown = selectSurface({ ...src(), voiceKnown: false, engine: { label: "X", standing: "unknown", checkFailed: false, summary: "" } });
    const u = Object.fromEntries(unknown.lights.map((l) => [l.root, l]));
    expect(u.voice!.art.of).toBeNull();
    const reading = selectSurface({ ...src(), projects: { count: 0, loaded: false, failed: false, active: "" } });
    expect(reading.lights.find((l) => l.root === "projects")!.art.of).toBeNull();
    expect(u.mind!.art.of).toBeNull();
  });
});

function src(): SurfaceSources {
  return {
    athena: { state: "seal", cards: 0, line: "" },
    windowVisible: false,
    apps: [],
    openTabs: 0,
    projects: { count: 0, loaded: true, failed: false, active: "" },
    accounts: [],
    chores: { total: 0, benched: 0, foundUsd: 0, loaded: true, failed: false },
    voiceAvailable: false,
    voiceKnown: true,
    engine: { label: "Claude Code", standing: "done", checkFailed: false, summary: "Claude Code is ready" },
    pendingRestart: null,
    inShell: true,
    actions: INERT_ACTIONS,
  };
}

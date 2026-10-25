/**
 * The engine state union — ADR 0214.
 *
 * The claim is a class, not two patches: every engine state that is not ready carries the move
 * that gets the person out of it, no failed or stopped daemon is described as running or starting,
 * and the four things the surfaces read (readiness, the not-ready sentence, the restart notice,
 * the start failure) are projections of the one state. The table walks every combination of the
 * inputs that decide it.
 */
import { describe, expect, test } from "vitest";

import type { DaemonHealth } from "@/lib/daemon";
import type { EngineProbe } from "@/lib/engines";

import { engineStateOf } from "./engine-state";
import { fixtures } from "./fixtures";
import { INERT_ACTIONS, selectSetup, type SetupSources } from "./model";
import { engineFact, isReady, notReadyBecause, restartNotice } from "./readiness";

const BOTH_FOUND: EngineProbe[] = [
  { id: "claude_code", state: "found", detail: "2.1.268" },
  { id: "codex", state: "found", detail: "0.40" },
];

function sources(over: Partial<SetupSources> = {}): SetupSources {
  return {
    onboarded: true,
    hydrated: true,
    engine: "claude_code",
    engineIds: ["claude_code", "codex"],
    probes: BOTH_FOUND,
    problem: null,
    theme: "system",
    brainPath: "",
    tabs: [{ id: 1, title: "Invoices", url: "https://a.test/x" }],
    storePath: "athena.sqlite",
    daemonHealth: "ready",
    daemonEngine: "claude_code",
    daemonLoaded: true,
    actions: INERT_ACTIONS,
    ...over,
  };
}

const NOT_DONE_MOVES = ["check", "restart", "choose", "sign-in", "install"];
/** An affirmative claim that she runs or is starting; "is not running" is the honest negative. */
const CLAIMS_ALIVE = /(?<!not )running|starting/;

describe("acceptance", () => {
  test("case 0: Codex chosen, the Claude Code daemon failed - down on the other engine, with Start on Codex", () => {
    const over = { engine: "codex", daemonEngine: "claude_code", daemonHealth: "failed" as const };
    const model = selectSetup(sources({ ...over, daemonError: "spawn exited with code 1" }));
    expect(engineStateOf(model)).toMatchObject({ kind: "down-on-other", move: "restart" });
    expect(model.startFailure).toEqual({
      engine: "claude_code",
      title: "Athena stopped on Claude Code.",
      reason: "spawn exited with code 1",
      actionLabel: "Start on Codex",
    });
    expect(selectSetup(sources(over)).startFailure?.reason).toBe("No reason was given.");
    expect(engineFact(model).summary).not.toContain("still running");
  });

  test("case 1: the same with the daemon stopped - 'Athena is not running.', and never 'still running' off ready", () => {
    const model = selectSetup(sources({ engine: "codex", daemonEngine: "claude_code", daemonHealth: "stopped" }));
    expect(engineStateOf(model).kind).toBe("down-on-other");
    expect(model.startFailure?.title).toBe("Athena is not running.");
    expect(model.startFailure?.actionLabel).toBe("Start on Codex");
    for (const daemonHealth of ["starting", "failed", "stopped"] as const) {
      const m = selectSetup(sources({ engine: "codex", daemonEngine: "claude_code", daemonHealth }));
      expect(engineFact(m).summary, daemonHealth).not.toContain("still running");
    }
  });

  test("case 2: a daemon that failed before naming an engine failed, it is not starting up", () => {
    const model = selectSetup(sources({ daemonEngine: "", daemonHealth: "failed" }));
    expect(engineStateOf(model)).toMatchObject({ kind: "failed", move: "restart" });
    expect(engineFact(model).summary).toBe("Claude Code is chosen, but Athena could not start");
  });
});

/** Every combination of the inputs that decide the engine's standing: 960 rows. */
function table(): { label: string; over: Partial<SetupSources> }[] {
  const rows: { label: string; over: Partial<SetupSources> }[] = [];
  for (const engine of ["claude_code", "codex"]) {
    const other = engine === "codex" ? "claude_code" : "codex";
    const probeSets: Record<string, EngineProbe[] | null> = {
      null: null,
      empty: [],
      found: BOTH_FOUND,
      signedOut: [
        { id: engine, state: "not_logged_in", detail: "no session" },
        { id: other, state: "found", detail: "1" },
      ],
      notFoundOtherFound: [
        { id: engine, state: "not_found", detail: "absent" },
        { id: other, state: "found", detail: "1" },
      ],
    };
    for (const [probeName, probes] of Object.entries(probeSets))
      for (const checking of [true, false])
        for (const problem of [null, "boom"])
          for (const daemonLoaded of [true, false])
            for (const daemonEngine of [engine, other, ""])
              for (const daemonHealth of ["ready", "starting", "failed", "stopped"] as DaemonHealth[])
                rows.push({
                  label: JSON.stringify({ engine, probeName, checking, problem, daemonLoaded, daemonEngine, daemonHealth }),
                  over: { engine, probes, checking, problem, daemonLoaded, daemonEngine, daemonHealth },
                });
  }
  return rows;
}

test("case 3: every state that is not done carries a move, and no failed or stopped daemon reads as alive", () => {
  const rows = table();
  expect(rows).toHaveLength(960);
  for (const { label, over } of rows) {
    const model = selectSetup(sources(over));
    const state = engineStateOf(model);
    const fact = engineFact(model);
    if (fact.standing !== "done") {
      const waiting =
        state.move === "wait" && (model.checking || model.daemonHealth === "starting" || !model.loaded);
      expect(waiting || NOT_DONE_MOVES.includes(state.move ?? ""), label).toBe(true);
    }
    if (model.daemonHealth === "failed" || model.daemonHealth === "stopped") {
      expect(fact.summary, label).not.toMatch(CLAIMS_ALIVE);
    }
  }
});

test("case 4: readiness, the not-ready sentence, the restart notice and the start failure are projections of the state", () => {
  for (const { label, over } of table()) {
    const model = selectSetup(sources(over));
    const state = engineStateOf(model);
    expect(isReady(model), label).toBe(state.kind === "running");
    expect(notReadyBecause(model) === "", label).toBe(isReady(model));
    expect(restartNotice(model) !== null, label).toBe(state.kind === "pending-switch");
    const down = state.kind === "failed" || state.kind === "stopped" || state.kind === "down-on-other";
    expect(model.startFailure !== null, label).toBe(state.move === "restart" && down);
  }
});

test("guard case 6: before the first daemon reading there is no start failure, and the engine fact is unknown", () => {
  for (const probes of [null, BOTH_FOUND])
    for (const daemonHealth of ["ready", "starting", "failed", "stopped"] as DaemonHealth[])
      for (const daemonEngine of ["claude_code", "codex", ""]) {
        const model = selectSetup(sources({ probes, daemonHealth, daemonEngine, daemonLoaded: false }));
        const label = JSON.stringify({ probes: !!probes, daemonHealth, daemonEngine });
        expect(model.startFailure, label).toBeNull();
        expect(engineFact(model).standing, label).toBe("unknown");
      }
});

test("guard case 7: every fixture reads as it did before the union", () => {
  const read = Object.fromEntries(
    Object.entries(fixtures).map(([name, m]) => [
      name,
      [engineFact(m).standing, engineFact(m).summary, m.startFailure?.title ?? null, restartNotice(m)?.title ?? null],
    ]),
  );
  expect(read).toEqual({
    empty: ["unknown", "Athena has not heard back about the engine yet", null, null],
    typical: ["done", "Claude Code is ready", null, null],
    heavy: [
      "todo",
      "Codex is chosen, but Athena is still running on Claude Code",
      null,
      "Codex is chosen. Athena is still running on Claude Code.",
    ],
    degraded: ["unknown", "Athena could not check the engine (daemon_offline)", null, null],
    notFound: ["missing", "none of the 2 can be used yet", null, null],
    checking: ["unknown", "checking the engine…", null, null],
    onboarding: ["done", "Claude Code is ready", null, null],
    settings: ["done", "Claude Code is ready", null, null],
  });
});

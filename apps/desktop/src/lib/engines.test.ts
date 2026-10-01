/**
 * Engine copy: README section 3.1 (engine probes), UAT backlog B4. Plain words for a person who
 * has never opened a terminal, and the daemon's real answer in every state.
 */
import { expect, test } from "vitest";

import { engineLine, remedyFor, type EngineProbe } from "./engines";

const JARGON = /PATH|probe|version flag|daemon|terminal/i;

function p(state: EngineProbe["state"]): EngineProbe {
  return { id: "claude_code", state, detail: "raw reason" };
}

test("each remedy says what to do in plain words", () => {
  expect(remedyFor(p("not_found"))).toBe(
    "Athena could not find Claude Code on this computer. Install it from its website, then press Check again.",
  );
  expect(remedyFor(p("not_logged_in"))).toBe(
    "Claude Code is installed but not signed in. Open it once and sign in, then press Check again.",
  );
  for (const state of ["found", "not_found", "not_logged_in", "unknown"] as const) {
    expect(remedyFor(p(state))).not.toMatch(JARGON);
  }
});

test("the engine line names the standing, the remedy, or that it is still checking", () => {
  expect(engineLine("claude_code", [p("found")])).toBe("Engine: Claude Code, ready.");
  expect(engineLine("claude_code", [p("not_found")])).toContain("could not find Claude Code");
  expect(engineLine("claude_code", null, null, true)).toBe("Engine: checking Claude Code...");
  expect(engineLine("claude_code", null, "offline")).toContain("press Check again");
  expect(engineLine("codex", [p("found")])).toContain("Open Setup");
  for (const probes of [null, [p("found")], [p("not_found")], [p("not_logged_in")]]) {
    expect(engineLine("claude_code", probes, probes ? null : "x")).not.toMatch(JARGON);
  }
});

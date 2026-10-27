/**
 * Engine copy: README section 3.1 (engine probes), UAT backlog B4. Plain words for a person who
 * has never opened a terminal, and the daemon's real answer in every state.
 */
import { expect, test } from "vitest";

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { ENGINE_IDS, engineLine, remedyFor, usable, type EngineProbe } from "./engines";

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

test("the desktop's engine ids are the ones daemon.rs launches, in order", () => {
  const rust = readFileSync(resolve(__dirname, "../../src-tauri/src/daemon.rs"), "utf8");
  const found = /KNOWN_ENGINES:\s*\[&str;\s*\d+\]\s*=\s*\[([^\]]*)\]/.exec(rust);
  expect(found, "KNOWN_ENGINES not found in daemon.rs").not.toBeNull();
  const ids = [...(found?.[1] ?? "").matchAll(/"([^"]+)"/g)].map((m) => m[1]);
  expect(ids).toEqual([...ENGINE_IDS]);
});

test("an engine the daemon reports but this desktop cannot launch is never usable", () => {
  // The daemon's /engines answers every engine the Python harness offers (claude_code, codex,
  // nebius, muse_code); the shell launches only KNOWN_ENGINES. Setup counts usable() as the
  // choosable others, so a found muse_code must not read as "1 ready, but another is chosen".
  const probes: EngineProbe[] = [
    { id: "claude_code", state: "not_found", detail: "" },
    { id: "codex", state: "found", detail: "0.1" },
    { id: "nebius", state: "found", detail: "key set" },
    { id: "muse_code", state: "found", detail: "1.0" },
  ];
  expect(usable(probes).map((p) => p.id)).toEqual(["codex"]);
});

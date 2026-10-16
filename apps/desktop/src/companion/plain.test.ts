/**
 * Plain words for a refusal — UAT backlog B13.
 */
import { expect, test } from "vitest";

import { ApiError } from "@/lib/api";
// @ts-expect-error - gate.js is plain JavaScript with a .d.ts that does not cover this export.
import { REFUSAL_REASONS } from "@athena/bridge/gate";

import { plainFailure, plainReason, reasonOf, refusalSentence, switchedOffSentence } from "./plain";

const REASONS = [
  "user_denied",
  "expired",
  "pending_approval",
  "foreign_origin",
  "foreign_token",
  "unknown_ref",
  "validator_failed",
  "manifest_invalid",
  "approval_spent",
  "no_manifest",
  "disabled_origin",
  "budget_exhausted",
  "engine_error",
  "timeout",
  "outcome_unknown",
  "parse_error",
  "cancelled",
  "not_ready",
  "unreachable",
  "no_page",
  "origin_disabled",
  "unknown",
  "something_new",
];

/** The gate's closed vocabulary: `ERROR_REASONS` in Python, held to it by tests/test_refusal_parity.py. */
const GATE_REASONS = REFUSAL_REASONS as readonly string[];

const JARGON = /origin|manifest|session|engine_error|FileNotFoundError|daemon|PATH|probe|token/i;

test("the list above holds every reason the gate can refuse with", () => {
  expect(GATE_REASONS.length).toBeGreaterThan(10);
  expect(GATE_REASONS.filter((reason) => !REASONS.includes(reason))).toEqual([]);
});

test("every reason the gate can refuse with has a sentence of its own, not the catch-all", () => {
  const fallbackReason = plainReason("something_new");
  const fallbackFailure = plainFailure("something_new", "Claude Code");
  const bare = GATE_REASONS.filter(
    (reason) =>
      reason !== "unknown" &&
      plainReason(reason) === fallbackReason &&
      plainFailure(reason, "Claude Code") === fallbackFailure,
  );
  expect(bare).toEqual([]);
});

test("a spent approval says it was used once and did not run again (ADR 0038)", () => {
  expect(plainFailure("approval_spent", "Claude Code")).toBe(
    "That approval was already used once, so Athena did not run it again. Ask again if you want it done again.",
  );
  expect(refusalSentence("approval_spent")).toContain("already used once");
});

test("no refusal or failure sentence uses a word the user never chose", () => {
  for (const reason of REASONS) {
    expect(refusalSentence(reason), reason).not.toMatch(JARGON);
    expect(plainFailure(reason, "Claude Code"), reason).not.toMatch(JARGON);
  }
});

test("a refused answer is one sentence that says what to do", () => {
  expect(refusalSentence("foreign_origin")).toBe(
    "That answer was refused: this decision belongs to a different app than the one in front of you. Focus the app this decision is about and try again.",
  );
  expect(plainReason("anything else")).toBe("Athena could not carry it out");
});

test("the switched-off sentence says to switch the app back on and uses no forbidden word", () => {
  expect(switchedOffSentence()).not.toMatch(JARGON);
  expect(switchedOffSentence()).toContain("Switch it back on");
});

test("an engine failure says what to do, and the detail stays out of the sentence", () => {
  expect(plainFailure("engine_error", "Claude Code")).toBe(
    "Athena could not start Claude Code on this computer. Check Setup.",
  );
  expect(plainFailure("engine_error", "Codex")).toContain("Codex");
});

test("the reason code comes from the daemon's refusal, or is made up for one that never arrived", () => {
  expect(reasonOf(new ApiError(403, "foreign_origin", "x"))).toBe("foreign_origin");
  expect(reasonOf(new ApiError(0, "unknown", "no daemon"))).toBe("not_ready");
  expect(reasonOf(new ApiError(500, "unknown", "boom"))).toBe("unknown");
  expect(reasonOf(new TypeError("Failed to fetch"))).toBe("unreachable");
});

test("a switched-off app tells the person where the switch is now, in words Main still uses", () => {
  for (const reason of ["disabled_origin", "origin_disabled"]) {
    const sentence = plainFailure(reason, "Claude Code");
    expect(sentence).toContain("Switch it back on under Apps in Main");
    expect(sentence).not.toContain("Act here");
  }
});

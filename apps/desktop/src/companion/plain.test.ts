/**
 * Plain words for a refusal — UAT backlog B13.
 */
import { expect, test } from "vitest";

import { ApiError } from "@/lib/api";

import { plainFailure, plainReason, reasonOf, refusalSentence } from "./plain";

const REASONS = [
  "user_denied",
  "expired",
  "pending_approval",
  "foreign_origin",
  "foreign_token",
  "unknown_ref",
  "validator_failed",
  "manifest_invalid",
  "no_manifest",
  "disabled_origin",
  "budget_exhausted",
  "engine_error",
  "timeout",
  "parse_error",
  "cancelled",
  "not_ready",
  "unreachable",
  "no_page",
  "origin_disabled",
  "unknown",
  "something_new",
];

const JARGON = /origin|manifest|session|engine_error|FileNotFoundError|daemon|PATH|probe|token/i;

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

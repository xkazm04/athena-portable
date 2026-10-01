/**
 * The status pill's words — ADR 0026 ("Athena is resting" / "1 waiting" / the step she is on), and
 * UAT backlog B8: "working" comes from a running turn or a card, tape or hear form, nothing else.
 */
import { expect, test } from "vitest";

import { ATHENA_STATES } from "@/lib/companion";

import { isResting, pillText } from "./athena";

test("a waiting card outranks everything, then the step, then rest", () => {
  expect(pillText({ state: "rest", cards: 0, line: "" })).toBe("Athena is resting");
  expect(pillText({ state: "tape", cards: 0, line: "Reading Invoices" })).toBe("Reading Invoices");
  expect(pillText({ state: "tape", cards: 0, line: "" })).toBe("Athena is working");
  expect(pillText({ state: "tape", cards: 2, line: "Reading Invoices" })).toBe("2 waiting");
});

test("with nothing running, every named state rests except the tape, the held key and the slip", () => {
  const working = ATHENA_STATES.filter((state) => !isResting(state));
  expect(working).toEqual(["tape", "hear", "slip"]);
  for (const state of ["seal", "welcome", "ledger", "tab", "rest", "idle", ""]) {
    expect(isResting(state), state).toBe(true);
    expect(pillText({ state, cards: 0, line: "" }), state).toBe("Athena is resting");
  }
});

test("an idle ledger reads resting, and a ledger with a turn running reads as the step she is on", () => {
  expect(pillText({ state: "ledger", cards: 0, line: "" })).toBe("Athena is resting");
  expect(pillText({ state: "ledger", cards: 0, line: "ledgerbox: list overdue" })).toBe("ledgerbox: list overdue");
  expect(isResting("ledger", "Athena: thinking")).toBe(false);
  expect(isResting("tab", "Athena: thinking")).toBe(false);
});

/**
 * The status pill's words — ADR 0026 ("Athena is resting" / "1 waiting" / the step she is on).
 */
import { expect, test } from "vitest";

import { pillText } from "./athena";

test("a waiting card outranks everything, then the step, then rest", () => {
  expect(pillText({ state: "rest", cards: 0, line: "" })).toBe("Athena is resting");
  expect(pillText({ state: "work", cards: 0, line: "Reading Invoices" })).toBe("Reading Invoices");
  expect(pillText({ state: "work", cards: 0, line: "" })).toBe("Athena is working");
  expect(pillText({ state: "work", cards: 2, line: "Reading Invoices" })).toBe("2 waiting");
});

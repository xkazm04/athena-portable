/** Tests for the UI switch — README section 3.5, ADR 0087. */
import { expect, test } from "vitest";

import { isConsoleUi } from "./ui";

test("the console is opt-in, by the build flag or by a stored choice", () => {
  expect(isConsoleUi(undefined, null)).toBe(false);
  expect(isConsoleUi("console", null)).toBe(true);
  expect(isConsoleUi(undefined, "console")).toBe(true);
});

test("anything else leaves the module bar", () => {
  expect(isConsoleUi("bar", "modules")).toBe(false);
  expect(isConsoleUi("", "")).toBe(false);
});

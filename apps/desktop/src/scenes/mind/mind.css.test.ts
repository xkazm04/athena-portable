/** The Mind depth's stylesheet rules — README section 3.1, ADR 0087 and 0089. */
import { readFileSync } from "node:fs";
import { expect, test } from "vitest";

const css = readFileSync(new URL("./mind.css", import.meta.url), "utf8");

/** The declarations of the rule whose selector is exactly `selector`. */
function rule(selector: string): string {
  const head = "\n" + selector + " {";
  const at = css.indexOf(head);
  if (at === -1) throw new Error(`no rule ${selector}`);
  return css.slice(at, css.indexOf("\n}", at));
}

test("the eyebrow is set in the primary, which clears 4.5:1 in both themes, not the accent", () => {
  expect(rule(".mind__eyebrow")).toMatch(/color:\s*var\(--primary\)/);
  expect(rule(".mind__eyebrow")).not.toMatch(/--accent/);
});

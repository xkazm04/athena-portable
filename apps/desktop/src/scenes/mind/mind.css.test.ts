/** The Mind depth's stylesheet rules — README section 3.1, ADR 0087 and 0089. */
import { readFileSync } from "node:fs";
import { expect, test } from "vitest";

// Comments stripped first: a comment that names a selector is not a rule for it.
const css = readFileSync(new URL("./mind.css", import.meta.url), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");

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

test("the field's line, which changes on every hover, holds two lines like the surface's", () => {
  expect(rule(".mind--field .mind__line")).toMatch(/min-height:\s*3em/);
});

test("keeps no second restart notice: the field draws the engine section's, tokens and fade included", () => {
  expect(css).not.toMatch(/\.mind__notice/);
  expect(rule(".mind--field > .engines__notice")).toMatch(/max-width:\s*56rem/);
});

test("the text field eases its hover like the surface's ask field", () => {
  expect(rule(".mind__input")).toMatch(/transition:[^;]*var\(--duration-fast\)/);
  expect(rule(".mind__input:hover")).toMatch(/border-color:\s*var\(--/);
});

test("the online link's flow and the Done tick move by opacity and transform on the motion tokens, never by dash offset", () => {
  // A dash offset repaints the SVG every frame; the sheet's motion contract is transform and opacity.
  expect(css).not.toMatch(/stroke-dashoffset/);
  const flow = rule(".sky__link[data-state=\"online\"] .sky__flow");
  expect(flow).toMatch(/animation:[^;]*var\(--dur-[a-z]+\)/);
  expect(rule(".done__tick")).toMatch(/animation:[^;]*var\(--dur-settle\)[^;]*var\(--ease-settle\)/);
  // Calm still stops the flow outright.
  expect(css).toMatch(/:root\[data-motion="calm"\] \.sky__flow,/);
});

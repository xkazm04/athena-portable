/** The surface stylesheet's rules — README section 3.1, ADR 0087 and 0089. */
import { readFileSync } from "node:fs";
import { expect, test } from "vitest";

// Comments stripped first: a comment that names a selector is not a rule for it.
const css = readFileSync(new URL("./surface.css", import.meta.url), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");

/** The declarations of the rule whose selector is exactly `selector`. */
function rule(selector: string): string {
  const head = "\n" + selector + " {";
  const at = css.indexOf(head);
  if (at === -1) throw new Error(`no rule ${selector}`);
  return css.slice(at, css.indexOf("\n}", at));
}

test("the eyebrow is set in the primary, which clears 4.5:1 in both themes, not the accent", () => {
  expect(rule(".surface__eyebrow")).toMatch(/color:\s*var\(--primary\)/);
  expect(rule(".surface__eyebrow")).not.toMatch(/--accent/);
});

test("every control the pointer can press eases its hover on the fast duration, and has a hover", () => {
  const blocks = css.split("}").filter((b) => /cursor:\s*pointer/.test(b));
  expect(blocks.length).toBeGreaterThan(0);
  for (const b of blocks) expect(b, b.trim().split("{")[0]).toMatch(/transition:[^;]*var\(--duration-fast\)/);
  // A hover rule with a declaration in it, not the selector's name somewhere in the file.
  for (const sel of [".surface__bell:hover", ".surface__summon:hover", ".surface__send:hover:not(:disabled)", ".surface__input:hover:not(:disabled)"]) {
    expect(rule(sel), sel).toMatch(/(background|border-color|filter):\s*[^;]+;/);
  }
});

test("a refusal to hand the words over is told in the error colour, eased in", () => {
  expect(rule('.surface__ask-note[data-tone="error"]')).toMatch(/color:\s*var\(--status-error\)/);
  expect(rule(".surface__ask-note")).toMatch(/transition:[^;]*color var\(--duration-fast\)/);
});

test("her illustration lifts under the pointer, and under calm it brightens without moving", () => {
  expect(rule(".surface__bell:hover")).toMatch(/transform:\s*translateY\(-?\d+px\)/);
  expect(rule(".surface__bell")).toMatch(/transition:[^;]*transform var\(--duration-fast\) var\(--ease-fast\)/);
  expect(rule(':root[data-motion="calm"] .surface__bell:hover')).toMatch(/transform:\s*none/);
});

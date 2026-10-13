/** The Chores stylesheet's rules — README section 3.5, ADR 0087 and 0089. */
import { readFileSync } from "node:fs";
import { expect, test } from "vitest";

const css = readFileSync(new URL("./chores.css", import.meta.url), "utf8");

/** The declarations of the rule whose selector is exactly `selector`. */
function rule(selector: string): string {
  const head = "\n" + selector + " {";
  const at = css.indexOf(head);
  if (at === -1) throw new Error(`no rule ${selector}`);
  return css.slice(at, css.indexOf("\n}", at));
}

test("small text is set in the primary, which clears 4.5:1 in both themes, never in the accent", () => {
  expect(css).not.toMatch(/(^|[\s;{])color:\s*var\(--accent\)/);
  for (const sel of [".ch-eyebrow", ".ch-link", ".ch-map__zone", ".ch-facets__title", ".ch-turn__who"]) {
    expect(rule(sel), sel).toMatch(/color:\s*var\(--primary\)/);
  }
});

test("a card of the grid is not clipped by its own content-visibility box: it holds room for the lift and the focus ring", () => {
  const item = rule(".ch-grid__item");
  expect(item).toMatch(/content-visibility:\s*auto/);
  expect(item).toMatch(/padding:\s*4px/);
  expect(item).toMatch(/margin:\s*-4px/);
});

test("every control the pointer can press eases its hover on the fast duration", () => {
  const blocks = css.split("}").filter((b) => /cursor:\s*pointer/.test(b));
  expect(blocks.length).toBeGreaterThanOrEqual(6);
  for (const b of blocks) expect(b, b.trim().split("{")[0]).toMatch(/transition:[^;]*var\(--duration-fast\)/);
});

test("the map mark eases its fill with its lift, so the hot chore does not flash", () => {
  expect(rule(".ch-mark")).toMatch(/background var\(--duration-fast\)/);
});

test("a turn dot answers the pointer: it lifts to full strength and takes the wash", () => {
  expect(css).toMatch(/\.ch-dot:hover\s*\{[^}]*background:\s*var\(--wash\)/);
  expect(css).toMatch(/\.ch-dot:hover,[^{]*\{[^}]*opacity:\s*1/);
});

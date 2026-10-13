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

test("a part of the chore fades in on the depth clock when it is chosen, opacity only", () => {
  expect(rule(".ch-panel")).toMatch(/animation:\s*ch-panel-in var\(--dur-depth\) var\(--ease-depth\)/);
  const frames = css.slice(css.indexOf("@keyframes ch-panel-in"), css.indexOf("\n}\n", css.indexOf("@keyframes ch-panel-in")));
  expect(frames).toMatch(/opacity/);
  expect(frames).not.toMatch(/transform|height|width|margin/);
});

test("the line that says what a press did is reserved, so the words arriving move nothing", () => {
  expect(rule(".ch-said")).toMatch(/min-height:\s*1\.45em/);
  expect(rule(".ch-actions .ch-said")).toMatch(/flex:\s*1 0 100%/);
});

test("gaps and pads are the density tokens, not 14px one-offs between the 12 and the 16", () => {
  expect(css).not.toMatch(/(padding|gap|margin)[a-z-]*:[^;]*\b14px/);
  expect(rule(".ch-grid")).toMatch(/gap:\s*var\(--density-gap\)/);
  expect(rule(".ch-numbers")).toMatch(/gap:\s*var\(--density-gap\)/);
  expect(rule(".ch-card-tile")).toMatch(/padding:\s*var\(--density-pad-sm\)/);
});

test("the film's box has the shape of the committed stills before they load, so the text under it holds still", () => {
  expect(rule(".ch-film__media")).toMatch(/aspect-ratio:\s*960 \/ 710/);
  expect(rule(".ch-film__media")).toMatch(/object-fit:\s*contain/);
});

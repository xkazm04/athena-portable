/** The Chores stylesheet's rules — README section 3.5, ADR 0087, 0089 and 0096. */
import { readFileSync } from "node:fs";
import { expect, test } from "vitest";

import { LEDGER_WIDE } from "./model";

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
  expect(rule(".ch-centre")).toMatch(/gap:\s*var\(--density-gap\)/);
  expect(rule(".ch-pane__body")).toMatch(/padding:\s*var\(--density-pad\)/);
  expect(rule(".ch-band__side")).toMatch(/padding:\s*var\(--density-pad-sm\)/);
});

test("the film's box has the shape of the committed stills before they load, so the text under it holds still", () => {
  expect(rule(".ch-film__media")).toMatch(/aspect-ratio:\s*960 \/ 710/);
  expect(rule(".ch-film__media")).toMatch(/object-fit:\s*contain/);
});

test("the on-the-edge flag and the chip are the same pill: one padding, one size", () => {
  const pad = (sel: string) => /padding:\s*([^;]+);/.exec(rule(sel))?.[1];
  const size = (sel: string) => /font-size:\s*([^;]+);/.exec(rule(sel))?.[1];
  expect(pad(".ch-edge-flag")).toBe(pad(".ch-chip"));
  expect(size(".ch-edge-flag")).toBe(size(".ch-chip"));
});

test("the ledger is laid out by the field's own width: a container, three columns, each its own scroll", () => {
  expect(rule(".ch-field")).toMatch(/container:\s*ch-field \/ inline-size/);
  const led = rule(".ch-led");
  expect(led).toMatch(/grid-template-columns:\s*196px minmax\(0, 1fr\) clamp\(380px, 32%, 440px\)/);
  expect(rule(".ch-led > *")).toMatch(/overflow:\s*auto/);
});

test("the adopt row is held at the foot of the preview's own scroll", () => {
  const adopt = rule(".ch-adopt");
  expect(adopt).toMatch(/position:\s*sticky/);
  expect(adopt).toMatch(/bottom:\s*0/);
  expect(adopt).toMatch(/background:\s*var\(--card-bg\)/);
});

test("under the width the view names, the preview goes and the rail becomes a row", () => {
  const at = css.indexOf(`@container ch-field (max-width: ${LEDGER_WIDE - 0.02}px)`);
  expect(at, "the collapse spells LEDGER_WIDE").toBeGreaterThan(-1);
  const block = css.slice(at, css.indexOf("\n}\n", at));
  expect(block).toMatch(/\.ch-led > \.ch-pane \{\s*display:\s*none/);
  expect(block).toMatch(/\.ch-areas__list \{\s*display:\s*flex/);
  expect(block).toMatch(/grid-template-columns:\s*minmax\(0, 1fr\)/);
});

test("the picked area and the picked mark read without a colour of their own", () => {
  expect(rule(".ch-area[aria-current]")).toMatch(/box-shadow:\s*inset 2px 0 0 var\(--accent\)/);
  expect(rule('.ch-mark[aria-pressed="true"]')).toMatch(/0 0 0 5px var\(--foreground\)/);
});

test("a storyboard still holds its 16:10 box before it loads, so the band under it does not move", () => {
  expect(rule(".ch-story__still")).toMatch(/aspect-ratio:\s*16 \/ 10/);
  expect(rule(".ch-story__still")).toMatch(/object-fit:\s*contain/);
  expect(rule(".ch-row__thumb")).toMatch(/width:\s*64px/);
  expect(rule(".ch-row__thumb")).toMatch(/height:\s*40px/);
});

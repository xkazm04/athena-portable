/** The Chores stylesheet's rules — README section 3.5, ADR 0087, 0089 and 0096. */
import { readFileSync } from "node:fs";
import { expect, test } from "vitest";

const css = readFileSync(new URL("./chores.css", import.meta.url), "utf8");

/** The declarations of the rule whose selector is exactly `selector`. */
function rule(selector: string, within = css): string {
  const head = "\n" + selector + " {";
  const at = within.indexOf(head);
  if (at === -1) throw new Error(`no rule ${selector}`);
  return within.slice(at, within.indexOf("\n}", at));
}

/** An at-rule's block, from its head to the brace that closes it at the top level. */
function block(head: string): string {
  const at = css.indexOf(head);
  if (at === -1) throw new Error(`no block ${head}`);
  return css.slice(at, css.indexOf("\n}\n", at));
}

/** The replay's, the fit's and the not-found's part of the sheet: the `ch-` family. */
const chPart = css.slice(css.indexOf("/* ---- the replay, the fit and a place that is not there"));

test("small text is never set in the accent, which is 3.2:1 on the light theme; the accent's ink is", () => {
  expect(css).not.toMatch(/(^|[\s;{])color:\s*var\(--accent\)/);
  expect(rule('.pa-tab[aria-current="page"] .pa-tab__count')).toMatch(/color:\s*var\(--accent-text\)/);
  for (const sel of [".ch-eyebrow", ".ch-turn__who"]) expect(rule(sel), sel).toMatch(/color:\s*var\(--primary\)/);
});

test("every control the pointer can press eases its hover on the fast duration", () => {
  const blocks = css.split("}").filter((b) => /cursor:\s*pointer/.test(b));
  expect(blocks.length).toBeGreaterThanOrEqual(6);
  for (const b of blocks) expect(b, b.trim().split("{")[0]).toMatch(/transition:[^;]*var\(--duration-fast\)/);
});

test("nothing on the catalogue or the topic page eases under Calm", () => {
  const calm = css.slice(css.indexOf(':root[data-motion="calm"] .pa-page *'));
  expect(calm.slice(0, calm.indexOf("}"))).toMatch(/transition:\s*none !important/);
  expect(css).toMatch(/:root\[data-motion="calm"\] \.chores \*/);
});

test("each page is its own scroll and a size container, so it is laid out by the depth frame's width", () => {
  const page = rule(".pa-page");
  expect(page).toMatch(/height:\s*100%/);
  expect(page).toMatch(/overflow-y:\s*auto/);
  expect(page).toMatch(/container-type:\s*inline-size/);
  expect(rule(".pa-wrap")).toMatch(/max-width:\s*1240px/);
});

test("the catalogue's table gives up the portals, then the job, as the frame narrows", () => {
  expect(block("@container (max-width: 1060px)")).toMatch(/td:nth-child\(4\)\s*\{\s*display:\s*none/);
  expect(block("@container (max-width: 760px)")).toMatch(/td:nth-child\(3\)\s*\{\s*display:\s*none/);
  expect(rule(".pa-ledger .table")).toMatch(/table-layout:\s*fixed/);
});

test("a row's still holds its box before it loads, so the rows do not move", () => {
  const thumb = rule(".pa-thumb");
  expect(thumb).toMatch(/width:\s*128px/);
  expect(thumb).toMatch(/height:\s*80px/);
  expect(thumb).toMatch(/object-fit:\s*cover/);
});

test("the hero still and every gallery frame hold a 16:10 box, so the page under them holds still", () => {
  expect(rule(".pa-shot")).toMatch(/aspect-ratio:\s*16 \/ 10/);
  expect(rule(".pa-frame")).toMatch(/aspect-ratio:\s*16 \/ 10/);
  expect(rule(".pa-frame")).toMatch(/cursor:\s*zoom-in/);
});

test("the flow draws a gate as a diamond in the warning's hue and a measured result in the success hue", () => {
  const diamond = rule(".pa-gate__diamond::before");
  expect(diamond).toMatch(/transform:\s*rotate\(45deg\)/);
  expect(diamond).toMatch(/background:\s*var\(--status-warning\)/);
  expect(rule(".pa-result[data-measured]")).toMatch(/border:\s*2px solid var\(--status-success\)/);
  expect(rule(".pa-result")).toMatch(/border:\s*2px dashed/);
});

test("the topic stacks its hero and drops the flow's bus when the frame is narrow", () => {
  const narrow = block("@container (max-width: 820px)");
  expect(narrow).toMatch(/\.pa-hero \{\s*grid-template-columns:\s*minmax\(0, 1fr\)/);
  expect(narrow).toMatch(/\.pa-spine::before \{\s*display:\s*none/);
});

test("the lightbox covers everything, and the still is as large as fits, never cropped", () => {
  const box = rule(".lbx");
  expect(box).toMatch(/position:\s*fixed/);
  expect(box).toMatch(/inset:\s*0/);
  expect(box).toMatch(/background:\s*var\(--scrim\)/);
  expect(rule(".lbx__img")).toMatch(/object-fit:\s*contain/);
  expect(rule(".lbx__img")).toMatch(/max-height:\s*calc\(100vh - 140px\)/);
});

test("the brief's markdown is plain type: a list marker in the muted ink, bold at one weight", () => {
  expect(rule(".rich li::marker")).toMatch(/color:\s*var\(--muted\)/);
  expect(rule(".rich strong")).toMatch(/font-weight:\s*650/);
});

test("a turn dot answers the pointer: it lifts to full strength and takes the wash", () => {
  expect(css).toMatch(/\.ch-dot:hover\s*\{[^}]*background:\s*var\(--wash\)/);
  expect(css).toMatch(/\.ch-dot:hover,[^{]*\{[^}]*opacity:\s*1/);
});

test("the replay's part keeps its gaps and pads on the density tokens, not 14px one-offs", () => {
  expect(chPart).not.toMatch(/(padding|gap|margin)[a-z-]*:[^;]*\b14px/);
  expect(rule(".ch-gone", chPart)).toMatch(/gap:\s*var\(--density-gap\)/);
  expect(rule(".ch-fit", chPart)).toMatch(/padding-top:\s*var\(--density-pad-sm\)/);
});

test("the sheet holds no rule for the field, the map, the preview or the old chore it replaced", () => {
  for (const gone of ["ch-field", "ch-led", "ch-map", "ch-mark", "ch-pane", "ch-story", "ch-facets", "ch-panel", "proto-host"]) {
    expect(css, gone).not.toMatch(new RegExp(`\\.${gone}(?![a-z_-])`));
  }
});

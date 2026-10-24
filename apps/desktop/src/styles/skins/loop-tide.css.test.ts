/**
 * The Loop Tide skin is a layer, not a fork — README section 3.1, ADR 0142 (and 0023, 0089).
 *
 * A skin may recolour the app and add light to its water and her window; it may not move, resize
 * or reword anything, leak outside its attribute, spend the person's colour, or animate anything
 * but transform and opacity. These are held here so a later edit to the sheet cannot quietly turn
 * it into a second design.
 */
import { readFileSync } from "node:fs";
import { expect, test } from "vitest";

const css = readFileSync(new URL("./loop-tide.css", import.meta.url), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");

interface Rule {
  selector: string;
  body: string;
  media: string | null;
}

/** Every rule, with the at-rule it sits in. `@keyframes` blocks come back with their name as the selector. */
function rules(text: string, media: string | null = null): Rule[] {
  const out: Rule[] = [];
  let i = 0;
  while (i < text.length) {
    const open = text.indexOf("{", i);
    if (open === -1) break;
    const head = text.slice(i, open).trim();
    let depth = 1;
    let j = open + 1;
    while (j < text.length && depth > 0) {
      if (text[j] === "{") depth++;
      else if (text[j] === "}") depth--;
      j++;
    }
    const body = text.slice(open + 1, j - 1);
    if (head.startsWith("@media")) out.push(...rules(body, head));
    else out.push({ selector: head, body, media });
    i = j;
  }
  return out;
}

const all = rules(css);
const keyframes = all.filter((r) => r.selector.startsWith("@keyframes"));
const styled = all.filter((r) => !r.selector.startsWith("@keyframes"));
const selectors = (r: Rule) => r.selector.split(",").map((s) => s.trim());

test("every selector starts at the skin's attribute, so the product's own teal is untouched", () => {
  expect(styled.length).toBeGreaterThan(15);
  for (const r of styled) {
    for (const s of selectors(r)) expect(s, s).toMatch(/^:root(\[data-motion="calm"\])?\[data-skin="loop-tide"\]/);
  }
});

test("every reduced-motion rule has its Calm twin (lib/motion.ts)", () => {
  const reduced = styled.filter((r) => r.media?.includes("prefers-reduced-motion")).flatMap(selectors);
  expect(reduced.length).toBeGreaterThan(2);
  const calm = new Set(styled.flatMap(selectors));
  for (const s of reduced) {
    const twin = s.replace(':root[data-skin="loop-tide"]', ':root[data-motion="calm"][data-skin="loop-tide"]');
    expect(calm.has(twin), twin).toBe(true);
  }
});

test("a real element only takes tokens, opacity or isolation: no size, position or word changes", () => {
  for (const r of styled) {
    for (const s of selectors(r)) {
      // The pseudo-elements and the current's own canvas are the skin's layers, not the app's elements.
      if (/::(before|after)$/.test(s) || s.endsWith(".backdrop__current")) continue;
      for (const decl of r.body.split(";").map((d) => d.trim()).filter(Boolean)) {
        const prop = decl.slice(0, decl.indexOf(":")).trim();
        expect(prop.startsWith("--") || ["opacity", "isolation"].includes(prop), `${s} { ${decl} }`).toBe(true);
      }
    }
  }
});

test("every animation is transform and opacity (ADR 0089)", () => {
  expect(keyframes.length).toBe(3);
  for (const k of keyframes) {
    for (const prop of k.body.matchAll(/([a-z-]+)\s*:/g)) expect(["transform", "opacity"], `${k.selector}: ${prop[1]}`).toContain(prop[1]);
  }
});

test("the person's colour and the status colours are never re-declared", () => {
  expect(css).not.toMatch(/--role-human\s*:|--human(-wash|-glow)?\s*:|--on-human\s*:/);
  expect(css).not.toMatch(/--status-(success|warning|error)\s*:/);
});

function channel(v: number): number {
  const c = v / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}
function luminance(hex: string): number {
  const n = parseInt(hex.slice(1), 16);
  return 0.2126 * channel((n >> 16) & 255) + 0.7152 * channel((n >> 8) & 255) + 0.0722 * channel(n & 255);
}
function ratio(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi! + 0.05) / (lo! + 0.05);
}
function tokens(selector: string): Record<string, string> {
  const r = styled.find((x) => selectors(x)[0] === selector);
  if (!r) throw new Error(`no rule ${selector}`);
  const out: Record<string, string> = {};
  for (const m of r.body.matchAll(/(--[a-z-]+):\s*(#[0-9a-f]{6})\b/gi)) out[m[1]!] = m[2]!;
  return out;
}

test("the text the skin recolours reads at 4.5:1 or better in both themes (ADR 0023)", () => {
  const dark = tokens(':root[data-skin="loop-tide"]');
  const light = tokens(':root[data-skin="loop-tide"][data-theme="light"]');
  const pairs: [Record<string, string>, string, string][] = [
    [dark, "--foreground", "--background"],
    [dark, "--muted-foreground", "--card-bg"],
    [dark, "--muted", "--background"],
    [dark, "--accent", "--background"],
    [dark, "--primary-fg", "--primary"],
    [dark, "--on-primary", "--btn-primary"],
    [light, "--foreground", "--background"],
    [light, "--muted-foreground", "--card-bg"],
    [light, "--primary-fg", "--primary"],
    [light, "--on-primary", "--btn-primary"],
    [light, "--accent-text", "--background"],
    [light, "--accent-text", "--card-bg"],
    [light, "--accent-text", "--recessed"],
    [light, "--primary", "--recessed"],
  ];
  for (const [set, ink, ground] of pairs) {
    expect(ratio(set[ink]!, set[ground]!), `${ink} on ${ground}`).toBeGreaterThanOrEqual(4.5);
  }
});

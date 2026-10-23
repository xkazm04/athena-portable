/**
 * Her window's stylesheets - ADR 0026, README sections 3.1 and 3.5; the drawing is Bell with
 * Tideline's seal (athena-mini-window). `tokens.css` chooses; `companion.css` and `seal.css` read.
 */
import { readFileSync } from "node:fs";
import { expect, test } from "vitest";

const read = (f: string) => readFileSync(new URL(f, import.meta.url), "utf8");
const css = read("./companion.css");
const seal = read("./seal.css");
const tokens = read("./tokens.css");
const sheets = css + "\n" + seal;

/** The declarations of the rule whose selector is exactly `selector`. */
function rule(selector: string, sheet = css): string {
  const head = "\n" + selector + " {";
  const at = sheet.indexOf(head);
  if (at === -1) throw new Error(`no rule ${selector}`);
  return sheet.slice(at, sheet.indexOf("}", at));
}

test("nothing readable is set under 12px, at either sheet", () => {
  const sizes = [
    ...sheets.matchAll(/font-size:\s*(?:calc\()?(\d+(?:\.\d+)?)px/g),
    ...sheets.matchAll(/font:\s*[\w.]+\s+(?:calc\()?(\d+(?:\.\d+)?)px/g),
  ].map((m) => Number(m[1]));
  expect(sizes.length).toBeGreaterThan(30);
  for (const px of sizes) expect(px).toBeGreaterThanOrEqual(12);
});

test("the reading tiers follow the app's Text size; the display tiers do not", () => {
  expect(tokens).not.toContain("--aw-step");
  expect(rule(".aw")).toContain("--aw-step: calc(var(--type-step) - 2px)");
  expect(rule(".aw .sl-effect")).toContain("calc(14.5px + var(--aw-step))");
  expect(rule(".aw .sl-title")).not.toContain("--aw-step");
});

test("colours and beats are chosen once, in tokens.css: the window's sheets spell no hex, no rgba and no literal transition", () => {
  const live = sheets.replace(/\/\*[\s\S]*?\*\//g, "");
  expect(live).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
  expect(live).not.toMatch(/rgba?\(/);
  for (const m of live.matchAll(/transition:\s*([^;]*);/g)) expect(m[1], m[1]).not.toMatch(/\b\d+(\.\d+)?m?s\b/);
});

test("the human colour is spent on what waits on the person and nothing else", () => {
  const users = [...css.matchAll(/^(\.[^{\n]*)\{[^}]*var\(--human(?:-wash|-glow)?\)/gm)].map((m) => m[1]!.trim());
  expect(users.length).toBeGreaterThan(4);
  for (const selector of users) expect(selector, selector).toMatch(/approve|gate|sl-count|sheets|human|sl-sign-note|cls-gated|sh-tick|sketch|data-attn/);
});

test("every control eases the state it changes: a press, a hover, focus and the off state", () => {
  for (const selector of [".aw .aw-btn", ".aw .iconbtn", ".aw .step", ".aw .chip", ".aw .composer", ".aw .sendbtn", ".aw .aw-textbtn", ".aw .rise", ".aw .d-rawbtn", ".aw .sl-voice", ".aw .tape-stop"]) {
    expect(rule(selector), selector).toContain("transition:");
  }
});

test("every data attribute the sheets select on is written by a view, the theme's or Calm's one writer", () => {
  const sources = ["./views.tsx", "./slip.tsx", "./ledger.tsx", "./pages.tsx", "./welcome.tsx", "./seal.tsx", "./detail.tsx", "./preview.tsx", "../lib/motion.ts", "../stores/shell.ts", "../stores/settings.ts"]
    .map(read)
    .join("\n");
  const attrs = [...new Set([...sheets.matchAll(/\[(data-[a-z-]+)/g)].map((m) => m[1]!))];
  expect(attrs.length).toBeGreaterThan(8);
  // A view writes `data-x-y` as itself or as `dataset.xY`.
  const camel = (a: string) => "dataset." + a.slice(5).replace(/-([a-z])/g, (_, c: string) => c.toUpperCase());
  for (const attr of attrs) expect(sources.includes(attr) || sources.includes(camel(attr)), attr).toBe(true);
});

test("a parameter's key on the decision card breaks inside its column; it never runs over the value", () => {
  expect(rule(".aw .d-facts")).toContain("grid-template-columns: max-content minmax(0, 1fr)");
  expect(rule(".aw .d-facts dt")).toContain("overflow-wrap: anywhere");
  expect(rule(".aw .d-facts dd")).toContain("overflow-wrap: anywhere");
});

test("the engine line breaks inside a long word, since its reason is the daemon's own text", () => {
  expect(rule('.aw .wl-engine[data-engine="missing"]')).toContain("overflow-wrap: anywhere");
});

/** The selectors of every rule inside every `@media (prefers-reduced-motion: reduce)` block. */
function reducedSelectors(sheet: string): string[] {
  const out: string[] = [];
  for (const m of sheet.matchAll(/@media \(prefers-reduced-motion: reduce\) \{\n([\s\S]*?)\n\}/g)) {
    for (const head of m[1]!.matchAll(/^ {2}([^\s{}][^{}]*?)\s*\{/gm)) {
      out.push(...head[1]!.split(",").map((s) => s.trim()).filter(Boolean));
    }
  }
  return out;
}

test("Calm stills her as the OS's reduced motion does: every reduced-motion rule has a Calm twin (lib/motion.ts)", () => {
  for (const sheet of [css, seal, tokens]) {
    const reduced = reducedSelectors(sheet);
    expect(reduced.length).toBeGreaterThan(0);
    // `data-motion` is the person's choice resolved with the OS's (ADR 0089); the media query alone
    // misses a person who chose Calm on a machine that does not ask for less motion.
    const calm = sheet.replace(/\/\*[\s\S]*?\*\//g, "");
    for (const selector of reduced) expect(calm.includes(`:root[data-motion="calm"] ${selector}`), selector).toBe(true);
  }
});

test("the seal's sheet knows nothing about the window around it", () => {
  expect(seal).not.toMatch(/\.aw\b|\.panel|\.anchor|\.sec-/);
  expect(css).not.toMatch(/\.seal-(dome|orb|ring|mark|tent|cap|check|cross|sign|stop|hit)\b/);
});

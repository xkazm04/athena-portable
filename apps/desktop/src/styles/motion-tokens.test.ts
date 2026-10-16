/** The motion and depth tokens in app.css — README section 3.1, ADR 0087 and 0089. */
import { readFileSync } from "node:fs";
import { expect, test } from "vitest";

const css = readFileSync(new URL("./app.css", import.meta.url), "utf8");

/** The declarations of every rule whose selector is exactly `selector`, joined. */
function rule(selector: string): string {
  const head = "\n" + selector + " {";
  const out: string[] = [];
  for (let at = css.indexOf(head); at !== -1; at = css.indexOf(head, at + 1)) {
    out.push(css.slice(at, css.indexOf("\n}", at)));
  }
  if (out.length === 0) throw new Error(`no rule ${selector}`);
  return out.join("\n");
}

test("the depth move has a duration and an easing, and calm removes the duration", () => {
  const root = rule(":root");
  expect(root).toMatch(/--dur-depth:\s*360ms/);
  expect(root).toMatch(/--ease-depth:\s*cubic-bezier/);
  expect(rule(':root[data-motion="calm"]')).toMatch(/--dur-depth:\s*0ms/);
});

test("the depth colours are mixes of the palette, never a literal colour", () => {
  const root = rule(":root");
  for (const n of [0, 1, 2, 3]) {
    const line = new RegExp(`--depth-${n}:([^;]+);`).exec(root);
    expect(line, `--depth-${n}`).not.toBeNull();
    expect(line![1]).not.toMatch(/#[0-9a-f]{3,8}\b|rgb\(|hsl\(/i);
    expect(line![1]).toMatch(/var\(--/);
  }
});

test("the light theme steps the water paler, not darker, and still from the palette alone", () => {
  const light = rule(':root[data-theme="light"]');
  for (const n of [0, 1, 2, 3]) {
    const line = new RegExp(`--depth-${n}:([^;]+);`).exec(light);
    expect(line, `--depth-${n}`).not.toBeNull();
    expect(line![1]).not.toMatch(/#[0-9a-f]{3,8}|rgb\(|hsl\(|black/i);
  }
  expect(light).toMatch(/--vignette:/);
});

test("a reduced-motion machine plays every animation once, so an infinite loop cannot flicker", () => {
  const at = css.indexOf("@media (prefers-reduced-motion: reduce) {");
  expect(at).toBeGreaterThan(-1);
  const block = css.slice(at, css.indexOf("\n}\n", at));
  expect(block).toMatch(/animation-duration:\s*1ms\s*!important/);
  expect(block).toMatch(/animation-iteration-count:\s*1\s*!important/);
  expect(block).toMatch(/\*::before/);
  expect(block).toMatch(/\*::after/);
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
function token(block: string, name: string): string {
  const m = new RegExp(`${name}: *(#[0-9a-f]{6})`, "i").exec(block);
  if (!m) throw new Error(`no ${name}`);
  return m[1]!;
}

test("--accent-text is the accent as ink: 4.5:1 on all three light surfaces, and the dark theme keeps --accent", () => {
  const light = rule('[data-theme="light"]');
  const ink = token(light, "--accent-text");
  for (const surface of ["--background", "--card-bg", "--recessed"]) {
    expect(ratio(ink, token(light, surface)), surface).toBeGreaterThanOrEqual(4.5);
  }
  expect(rule(':root,\n[data-theme="dark"]').replace(/\s+/g, " ")).toMatch(/--accent-text:\s*var\(--accent\)/);
});

test("--duration-fast has its easing pair, and every use of it in the sheet names the pair", () => {
  expect(rule(":root")).toMatch(/--ease-fast:\s*cubic-bezier/);
  const uses = css.match(/var\(--duration-fast\)[^,;]*/g) ?? [];
  expect(uses.length).toBeGreaterThan(0);
  for (const use of uses) expect(use).toMatch(/var\(--ease-fast\)/);
});

test("a field's action row is a two-column grid stretched to the control, not a margin", () => {
  const row = rule(".field__row");
  expect(row).toMatch(/grid-template-columns:\s*minmax\(0, 1fr\) auto/);
  expect(row).toMatch(/align-items:\s*stretch/);
  expect(row).not.toMatch(/margin/);
  // The disabled-reason wrapper is a span: it must stretch and its button must fill it.
  expect(rule(".field__row > span")).toMatch(/display:\s*flex/);
  expect(rule(".field__row > span > .btn")).toMatch(/flex:\s*1/);
});

test("the controls ease every state they change: press, disabled, primary hover, input edge, row wash", () => {
  expect(rule(".btn")).toMatch(/transition:[^;]*transform var\(--duration-fast\)[^;]*opacity var\(--duration-fast\)|transition:[^;]*opacity var\(--duration-fast\)[^;]*transform var\(--duration-fast\)/);
  expect(rule(".btn--primary:hover:not(:disabled)")).toMatch(/background:\s*color-mix/);
  expect(rule(".input")).toMatch(/transition:\s*border-color var\(--duration-fast\)/);
  expect(rule(".input:hover:not(:disabled):not([aria-invalid=\"true\"])")).toMatch(/border-color:\s*var\(--border-emphasis\)/);
  expect(rule(".table td")).toMatch(/transition:\s*background var\(--duration-fast\)/);
  expect(css).not.toMatch(/transition:\s*all/);
});

test("every corner is a radius token, a pill (999px) or square (0): no one-off radius", () => {
  const radii = [...css.replace(/\/\*[\s\S]*?\*\//g, "").matchAll(/border-radius:\s*([^;]+);/g)].map((m) => m[1]!.trim());
  expect(radii.length).toBeGreaterThan(8);
  expect(radii.filter((r) => !/^var\(--radius-[\w-]+\)$|^999px$|^0$/.test(r))).toEqual([]);
});

test("the window chrome eases its hovers", () => {
  for (const sel of [".window-btn", ".tab-chip", ".tab-chip__close", ".close-confirm__btn"]) {
    expect(rule(sel), sel).toMatch(/transition:[^;]*var\(--duration-fast\) var\(--ease-fast\)/);
  }
  // The push-to-talk pill went with its last importer (components/catalog.test.ts holds the rule).
  expect(css).not.toMatch(/\.ptt\b/);
});

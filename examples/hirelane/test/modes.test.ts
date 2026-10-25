/**
 * The board under the two platform contrast modes: forced colours and `prefers-contrast: more`.
 *
 * The direction draws weight, score, evidence, the current candidate, the act class and Athena's
 * presence as BACKGROUND paint, and forced colours repaints every background to the theme's
 * Canvas. These cases read the sheets the way `sheets.test.ts` does (comments blanked, top-level
 * selector commas only), but keep each rule's enclosing at-rules, because "inside
 * `@media (forced-colors: active)`" is the whole question.
 *
 *   node --import ./test/register.mjs --test "test/**\/*.test.ts"
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const APP = fileURLToPath(new URL("../", import.meta.url));
const STYLE = join(APP, "components", "board", "style");

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) return files(path);
    return path.endsWith(".css") ? [path] : [];
  });
}

const blank = (css: string): string => css.replace(/\/\*[\s\S]*?\*\//g, "");

function splitList(list: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let current = "";
  for (const ch of list) {
    if (ch === "(") depth += 1;
    if (ch === ")") depth -= 1;
    if (ch === "," && depth === 0) {
      out.push(current);
      current = "";
    } else current += ch;
  }
  out.push(current);
  return out.map((s) => s.trim().replace(/\s+/g, " ")).filter(Boolean);
}

interface Rule {
  file: string;
  /** The enclosing at-rule preludes, outermost first, whitespace-normalised. */
  at: string[];
  selectors: string[];
  decls: Map<string, string>;
}

/** Every style rule in a sheet, with the at-rules it sits inside. */
function parse(file: string, css: string): Rule[] {
  const out: Rule[] = [];
  const stack: string[] = [];
  let buffer = "";
  for (let i = 0; i < css.length; i += 1) {
    const ch = css[i]!;
    if (ch === "{") {
      const prelude = buffer.trim().replace(/\s+/g, " ");
      buffer = "";
      if (prelude.startsWith("@")) {
        stack.push(prelude);
        continue;
      }
      const end = css.indexOf("}", i);
      const decls = new Map<string, string>();
      for (const part of css.slice(i + 1, end).split(";")) {
        const colon = part.indexOf(":");
        if (colon < 0) continue;
        decls.set(part.slice(0, colon).trim(), part.slice(colon + 1).trim().replace(/\s+/g, " "));
      }
      out.push({ file, at: [...stack], selectors: splitList(prelude), decls });
      i = end;
    } else if (ch === "}") {
      stack.pop();
      buffer = "";
    } else if (ch === ";" && buffer.trim().startsWith("@")) {
      buffer = "";
    } else buffer += ch;
  }
  return out;
}

const SHEETS = files(STYLE).map((file) => ({
  name: file.slice(STYLE.length + 1).replace(/\\/g, "/"),
  css: blank(readFileSync(file, "utf8")),
}));
const RULES: Rule[] = SHEETS.flatMap((s) => parse(s.name, s.css));

const FORCED = /^@media \(forced-colors: active\)$/;
const MORE = /^@media \(prefers-contrast: more\)$/;
const forced = RULES.filter((r) => r.at.some((a) => FORCED.test(a)));
const more = RULES.filter((r) => r.at.some((a) => MORE.test(a)));

const SYSTEM = new Set([
  "canvas",
  "canvastext",
  "highlight",
  "highlighttext",
  "buttonface",
  "buttontext",
  "graytext",
  "mark",
  "marktext",
  "linktext",
  "visitedtext",
  "activetext",
  "buttonborder",
  "field",
  "fieldtext",
  "selecteditem",
  "selecteditemtext",
  "accentcolor",
  "accentcolortext",
]);
const isSystem = (word: string): boolean => SYSTEM.has(word.toLowerCase());
const hasSystem = (value: string): boolean => value.split(/\s+/).some(isSystem);

/* --- The token block, read as check-contrast reads it: the first declaration wins. --- */

const TOKENS_CSS = blank(readFileSync(join(STYLE, "base", "tokens.css"), "utf8"));
const TOKENS = new Map<string, string>();
for (const [, name, value] of TOKENS_CSS.matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+);/g)) {
  if (!TOKENS.has(name!)) TOKENS.set(name!, value!.trim());
}

const COLOUR_VALUE = /^(?:#|rgba?\(|hsla?\(|hwb\(|lab\(|lch\(|oklab\(|oklch\(|color\(|color-mix\(|linear-gradient\()/i;

/** Whether a token resolves to a colour (a hue, a plane, a gradient), following var() chains. */
function isColourToken(name: string, seen = new Set<string>()): boolean {
  const value = TOKENS.get(name);
  if (!value || seen.has(name)) return false;
  seen.add(name);
  if (COLOUR_VALUE.test(value)) return true;
  const ref = /^var\((--[a-z0-9-]+)\)$/.exec(value);
  return ref ? isColourToken(ref[1]!, seen) : false;
}

/* --- Colour arithmetic, check-contrast's formula. --- */

const hex = (h: string): number[] => {
  const s = h.replace("#", "");
  const full = s.length === 3 ? [...s].map((c) => c + c).join("") : s;
  return [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16) / 255);
};
const lum = (rgb: number[]): number => {
  const [r, g, b] = rgb.map((c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)) as [
    number,
    number,
    number,
  ];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const ratio = (a: number[], b: number[]): number => {
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
};
function plane(name: string, on: number[]): number[] {
  const value = TOKENS.get(name)!;
  const m = /rgb\(\s*(\d+)\s+(\d+)\s+(\d+)\s*\/\s*([\d.]+)%\s*\)/.exec(value);
  assert.ok(m, `${name}: ${value} is not a plane`);
  const alpha = Number(m[4]) / 100;
  return [m[1], m[2], m[3]].map((n, i) => (Number(n) / 255) * alpha + on[i]! * (1 - alpha));
}

/** The room surfaces check-contrast scores the ink ladder against. */
function roomSurfaces(): number[][] {
  const ground = hex(TOKENS.get("--bd-ground")!);
  const voidRgb = hex(TOKENS.get("--bd-void")!);
  return [
    voidRgb,
    ground,
    hex(TOKENS.get("--bd-sheet")!),
    plane("--bd-glass", ground),
    plane("--bd-glass-2", ground),
    plane("--bd-slide-top", voidRgb),
  ];
}

const INKS = ["--bd-ink", "--bd-ink-2", "--bd-ink-3", "--bd-ink-4"];

/**
 * Resolve the custom properties on one element the way CSS does: the default block, then the
 * overrides, then every var() substituted against THIS element's values, `inherit` from `parent`.
 * Only the ladder and the hairlines are resolved; the rest of the block is not this case's.
 */
function resolveScope(overrides: Map<string, string>, parent?: Map<string, string>): Map<string, string> {
  const declared = new Map(TOKENS);
  for (const [k, v] of overrides) if (k.startsWith("--")) declared.set(k, v);
  const out = new Map<string, string>();
  const get = (name: string, depth = 0): string => {
    assert.ok(depth < 32, `${name}: a var() cycle`);
    const value = declared.get(name);
    assert.ok(value !== undefined, `${name} is not declared`);
    if (value === "inherit") {
      const up = parent?.get(name);
      assert.ok(up, `${name}: inherit with no parent value`);
      return up;
    }
    return value.replace(/var\((--[a-z0-9-]+)\)/g, (_, ref: string) => get(ref, depth + 1));
  };
  for (const name of [...INKS, "--bd-rule", "--bd-rule-2"]) out.set(name, get(name));
  return out;
}

const WRAPPER = '[data-variant="board"]';
const ROOT = ':root:has([data-variant="board"])';

function overridesFor(scope: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const r of more.filter((r) => r.selectors.includes(scope))) for (const [k, v] of r.decls) out.set(k, v);
  return out;
}

/* --- The cases. --- */

const MARKS = [
  ".bd-led-fill",
  ".bd-led-weight i",
  '.bd-pips i[data-on="true"]',
  '.bd-dot[aria-current="true"]',
  ".bd-class::before",
  '.bd-presence[data-on="true"]::before',
];

/** A rule body that draws something the forced-colours repaint does not erase. */
function carries(decls: Map<string, string>, opted: boolean): boolean {
  const fill = decls.get("background") ?? decls.get("background-color");
  if (opted && fill && isSystem(fill)) return true;
  return [...decls].some(([k, v]) => /^(?:border|outline)(?:-|$)/.test(k) && hasSystem(v));
}

test("forced colours: each of the six background-borne marks has a structural carrier", () => {
  const carried = MARKS.filter((mark) => {
    const rules = forced.filter((r) => r.selectors.includes(mark));
    const opted = rules.some((r) => r.decls.get("forced-color-adjust") === "none");
    return rules.some((r) => carries(r.decls, opted));
  });
  assert.deepEqual(carried, MARKS, `carried under forced colours: ${carried.length} of ${MARKS.length}`);
});

test("forced colours: the armed fire button is told apart from Cancel, and the GATED zone keeps its heavy edge", () => {
  const FIRE = '.bd-zone[data-class="GATED"] .bd-btn[data-fire="true"]';
  const fire = forced.filter((r) => r.selectors.includes(FIRE));
  assert.ok(fire.length > 0, "no forced-colours rule for the armed fire button");
  const decls = new Map(fire.flatMap((r) => [...r.decls]));
  const selection =
    decls.get("forced-color-adjust") === "none" &&
    /^highlight$/i.test(decls.get("background") ?? decls.get("background-color") ?? "") &&
    /^highlighttext$/i.test(decls.get("color") ?? "");
  const ruled = [...decls].some(([k, v]) => /^border/.test(k) && v.includes("var(--bd-rule-w3)") && hasSystem(v));
  assert.ok(selection || ruled, "the fire button has no structural carrier under forced colours");

  // The coral hover rule outranks the plain one; if the button opts out of the repaint, its hover
  // must be answered too or the coral survives the opt-out.
  if (decls.get("forced-color-adjust") === "none") {
    assert.ok(
      forced.some((r) => r.selectors.includes(`${FIRE}:hover:not(:disabled)`)),
      "the fire button opts out of forced colours but its coral hover rule is not answered",
    );
  }

  // Cancel is a plain .bd-btn in the zone: it must not take the selection colours.
  const cancel = forced.filter((r) => r.selectors.includes('.bd-zone[data-class="GATED"] .bd-btn'));
  assert.ok(
    !cancel.some((r) => /highlight/i.test(r.decls.get("background") ?? "")),
    "Cancel is painted with the selection colour too",
  );

  const zone = forced.filter((r) => r.selectors.includes('.bd-zone[data-class="GATED"]'));
  const edge = zone.some((r) =>
    [...r.decls].some(
      ([k, v]) => /^border-(?:inline-start|left)$/.test(k) && v.includes("var(--bd-rule-w3)") && hasSystem(v),
    ),
  );
  assert.ok(edge, "the GATED zone has no rule-w3 edge in a system colour under forced colours");
});

test("forced colours: every colour set is a system colour keyword - no token hue, no literal", () => {
  assert.ok(forced.length > 0, "the tree has no forced-colors rules at all");
  const bad: string[] = [];
  for (const r of forced) {
    for (const [prop, value] of r.decls) {
      const where = `${r.file} ${r.selectors.join(", ")} { ${prop}: ${value} }`;
      if (/#[0-9a-f]{3,8}\b|\b(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color|color-mix)\(/i.test(value)) {
        bad.push(`literal: ${where}`);
        continue;
      }
      for (const [, ref] of value.matchAll(/var\((--[a-z0-9-]+)\)/g)) {
        if (isColourToken(ref!)) bad.push(`token hue ${ref}: ${where}`);
      }
      const colourOnly = /^(?:color|background|background-color|fill|stroke)$|-color$/.test(prop);
      if (colourOnly && !isSystem(value)) bad.push(`not a system colour: ${where}`);
      if (/^(?:border|outline)(?:-(?:block|inline)(?:-(?:start|end))?|-(?:top|right|bottom|left))?$/.test(prop)) {
        const words = value.split(/\s+/).filter((w) => !/^var\(|^\d|^(?:solid|dashed|dotted|double|none)$/.test(w));
        if (words.some((w) => !isSystem(w))) bad.push(`shorthand colour not a system colour: ${where}`);
      }
    }
  }
  assert.deepEqual(bad, []);
});

test("prefers-contrast: more re-points the quiet rungs one up on both scopes and every ink clears 7:1", () => {
  assert.ok(more.some((r) => r.selectors.includes(WRAPPER)), `no prefers-contrast: more rule on ${WRAPPER}`);
  assert.ok(more.some((r) => r.selectors.includes(ROOT)), `no prefers-contrast: more rule on ${ROOT}`);

  const root = resolveScope(overridesFor(ROOT));
  const wrapper = resolveScope(overridesFor(WRAPPER), root);

  // Inside the board, every quiet rung takes the value of the rung above it - one step, not two.
  assert.equal(wrapper.get("--bd-ink-3"), TOKENS.get("--bd-ink-2"), "ink-3 does not take ink-2's value");
  assert.equal(wrapper.get("--bd-ink-4"), TOKENS.get("--bd-ink-3"), "ink-4 does not take ink-3's (default) value");
  assert.equal(wrapper.get("--bd-rule"), TOKENS.get("--bd-rule-2"), "the hairline does not take rule-2");
  assert.notEqual(wrapper.get("--bd-ink-3"), wrapper.get("--bd-ink-4"), "the quiet tier collapsed into ink-3");
  // At root the quietest rung and the hairline step up too.
  assert.equal(root.get("--bd-ink-4"), TOKENS.get("--bd-ink-3"), "root ink-4 does not take ink-3's value");
  assert.equal(root.get("--bd-rule"), TOKENS.get("--bd-rule-2"), "root hairline does not take rule-2");

  const surfaces = roomSurfaces();
  for (const [label, scope] of [
    ["wrapper", wrapper],
    ["root", root],
  ] as const) {
    for (const ink of INKS) {
      const value = scope.get(ink)!;
      const worst = Math.min(...surfaces.map((s) => ratio(hex(value), s)));
      assert.ok(worst >= 7.0, `${label} ${ink} ${value} is ${worst.toFixed(2)}:1 on the worst room surface`);
    }
  }
});

test("index.css imports base/contrast-modes.css last, after reduced-motion and the toast", () => {
  const imports = [...blank(readFileSync(join(STYLE, "index.css"), "utf8")).matchAll(/@import\s+"([^"]+)"/g)].map(
    (m) => m[1]!,
  );
  const at = (path: string): number => imports.indexOf(path);
  assert.equal(imports.at(-1), "./base/contrast-modes.css", `the last import is ${imports.at(-1)}`);
  assert.ok(at("./base/reduced-motion.css") >= 0 && at("./base/reduced-motion.css") < at("./base/contrast-modes.css"));
  assert.ok(at("./chrome/toast.css") >= 0 && at("./chrome/toast.css") < at("./base/contrast-modes.css"));
});

function run(script: string): { code: number | null; out: string } {
  const r = spawnSync(process.execPath, [join(APP, "design", script)], { encoding: "utf8" });
  return { code: r.status, out: `${r.stdout}${r.stderr}` };
}

test("guard: check-law exits 0 on the real tree", () => {
  const { code, out } = run("check-law.mjs");
  assert.equal(code, 0, out);
});

test("guard: check-contrast exits 0 with the default tier's ratios, and the modes sheet declares no token outside its tier", () => {
  const { code, out } = run("check-contrast.mjs");
  assert.equal(code, 0, out);
  // The default rungs, at the ratios tokens.css records for them.
  assert.match(out, /--bd-ink-3\s+#aeaeb9\s+7\.81:1/);
  assert.match(out, /--bd-ink-4\s+#9494a0\s+5\.73:1/);
  const strays = RULES.filter(
    (r) => r.file === "base/contrast-modes.css" && !r.at.some((a) => MORE.test(a)) && [...r.decls.keys()].some((k) => k.startsWith("--")),
  );
  assert.deepEqual(strays.map((r) => r.selectors.join(", ")), []);
});

test("guard: the room's focus-visible outline and the gated zone's ink ring are untouched", () => {
  const room = RULES.find((r) =>
    r.selectors.some((s) => s.startsWith(".bd-root :where(") && s.endsWith(":focus-visible")),
  );
  assert.ok(room, "the room's focus-visible rule is gone");
  assert.equal(room.file, "base/the-room.css");
  assert.equal(room.decls.get("outline"), "var(--bd-rule-w2) solid var(--bd-accent)");
  const gated = RULES.find((r) =>
    r.selectors.some((s) => s.startsWith('.bd-zone[data-class="GATED"] :where(') && s.endsWith(":focus-visible")),
  );
  assert.ok(gated, "the gated zone's focus-visible rule is gone");
  assert.equal(gated.decls.get("outline-color"), "var(--bd-gate-ink)");
  const modes = RULES.filter((r) => r.file === "base/contrast-modes.css");
  assert.ok(!modes.some((r) => r.selectors.some((s) => s.includes(":focus"))), "the modes sheet restyles a focus state");
  assert.ok(
    !modes.some((r) => /^(?:none|0)$/.test(r.decls.get("outline") ?? "") || r.decls.get("outline-style") === "none"),
    "the modes sheet removes an outline",
  );
});

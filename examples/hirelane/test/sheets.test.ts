/**
 * The board's stylesheets, read for the rules a person meets with a keyboard and a pointer.
 *
 * Each case derives its ground truth from the tree rather than from a list kept beside it: the tags
 * the board's components actually render, the tokens `base/tokens.css` actually declares. Comments
 * are blanked before anything is matched, so a sheet that explains a rule in prose is not read as
 * obeying it.
 *
 *   node --import ./test/register.mjs --test "test/**\/*.test.ts"
 */
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const BOARD = fileURLToPath(new URL("../components/board/", import.meta.url));
const STYLE = join(BOARD, "style");

function files(dir: string, ext: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) return files(path, ext);
    return path.endsWith(ext) ? [path] : [];
  });
}

const blank = (css: string): string => css.replace(/\/\*[\s\S]*?\*\//g, "");

interface Rule {
  file: string;
  selectors: string[];
  body: string;
}

/** A selector list split on its top-level commas only, so `:where(a, b)` stays one selector. */
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

/** Every rule in the direction, `@media` and `@container` bodies flattened in. */
const RULES: Rule[] = files(STYLE, ".css").flatMap((file) =>
  [...blank(readFileSync(file, "utf8")).matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => ({
    file: file.slice(STYLE.length + 1).replace(/\\/g, "/"),
    selectors: splitList(m[1]!),
    body: m[2]!,
  })),
);

const JSX = files(BOARD, ".tsx").map((file) => readFileSync(file, "utf8"));

/** The focus-visible rule for the room, and the elements its `:where()` list names. */
function roomFocusList(): string[] {
  const rule = RULES.find((r) => r.selectors.some((s) => s.startsWith(".bd-root :where(") && s.endsWith(":focus-visible")));
  assert.ok(rule, "the room has no `.bd-root :where(...):focus-visible` rule");
  const selector = rule.selectors.find((s) => s.startsWith(".bd-root :where("))!;
  return selector
    .slice(".bd-root :where(".length, selector.lastIndexOf(")"))
    .split(",")
    .map((s) => s.trim());
}

/* --- Colour, read from the token block the way design/check-contrast.mjs reads it. --- */

const TOKENS = new Map(
  [...blank(readFileSync(join(STYLE, "base", "tokens.css"), "utf8")).matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+);/g)].map(
    (m) => [m[1]!, m[2]!.trim()] as const,
  ),
);

const hex = (h: string): number[] => {
  const s = h.replace("#", "");
  const full = s.length === 3 ? [...s].map((c) => c + c).join("") : s;
  return [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16) / 255);
};
const lum = (rgb: number[]): number => {
  const [r, g, b] = rgb.map((c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const ratio = (a: number[], b: number[]): number => {
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
};
/** A token's colour: a hex, or a white/black plane at an alpha laid over `on`. */
function colour(name: string, on?: number[]): number[] {
  const value = TOKENS.get(name);
  assert.ok(value, `${name} is not declared in base/tokens.css`);
  if (value.startsWith("#")) return hex(value);
  const plane = /rgb\(\s*(\d+)\s+(\d+)\s+(\d+)\s*\/\s*([\d.]+)%\s*\)/.exec(value);
  assert.ok(plane && on, `${name}: ${value} is not a colour this test can read`);
  const alpha = Number(plane[4]) / 100;
  return [plane[1], plane[2], plane[3]].map((n, i) => (Number(n) / 255) * alpha + on[i]! * (1 - alpha));
}

/** The token a focus-visible rule draws its ring in, from `outline` or `outline-color`. */
function ringToken(rule: Rule): string | undefined {
  return /outline(?:-color)?\s*:[^;]*var\((--bd-[a-z0-9-]+)\)\s*(?:;|$)/.exec(rule.body.trim())?.[1];
}

test("a focus ring clears 3:1 on every ground the board draws one on", () => {
  // WCAG 1.4.11: a focus indicator is a UI component and owes 3:1 against what it sits on. The
  // room's ring is `--bd-accent`, light on dark. The gated zone is the one LIGHT surface in the
  // room, and the room's own sheet says accent measures 1.9:1 on it - so the ring on the
  // irreversible acts, of all controls, was the one a keyboard user could barely see.
  const room = RULES.find((r) => r.selectors.some((s) => s.startsWith(".bd-root :where(") && s.endsWith(":focus-visible")))!;
  const roomRing = ringToken(room);
  assert.ok(roomRing, "the room's focus rule names no ring token");
  const gated = RULES.find((r) =>
    r.selectors.some((s) => s.startsWith('.bd-zone[data-class="GATED"]') && s.endsWith(":focus-visible")),
  );
  const gatedRing = (gated && ringToken(gated)) ?? roomRing;

  const ground = colour("--bd-ground");
  const void_ = colour("--bd-void");
  const roomGrounds = {
    void: void_,
    ground,
    "glass on ground": colour("--bd-glass", ground),
    "glass-2 on ground": colour("--bd-glass-2", ground),
  };
  const sheet = TOKENS.get("--bd-gate-sheet") ?? "";
  const stops = [...sheet.matchAll(/#[0-9a-f]{3,8}\b/gi)].map((m) => m[0]);
  assert.ok(stops.length >= 2, `--bd-gate-sheet has no stops this test can read: ${sheet}`);

  const under: string[] = [];
  for (const [name, bg] of Object.entries(roomGrounds)) {
    const r = ratio(colour(roomRing), bg);
    if (r < 3) under.push(`room ring ${roomRing} on ${name}: ${r.toFixed(2)}:1`);
  }
  for (const stop of stops) {
    const r = ratio(colour(gatedRing), hex(stop));
    if (r < 3) under.push(`gated ring ${gatedRing} on ${stop}: ${r.toFixed(2)}:1`);
  }
  assert.deepEqual(under, []);
});

test("the room's focus ring names every focusable tag the board renders", () => {
  // The tags are read out of the components, not listed here: a disclosure added to a component
  // is a tag this list did not know about, which is how the foot's <summary> was missed.
  const FOCUSABLE = ["a", "button", "input", "select", "textarea", "summary"];
  const rendered = FOCUSABLE.filter((tag) => JSX.some((src) => new RegExp(`<${tag}[\\s>]`).test(src)));
  if (JSX.some((src) => /\btabIndex=/.test(src))) rendered.push("[tabindex]");
  assert.ok(rendered.includes("button") && rendered.includes("summary"), `read ${rendered.join(", ")}`);
  const named = roomFocusList();
  assert.deepEqual(
    rendered.filter((tag) => !named.includes(tag)),
    [],
    `the focus ring names ${named.join(", ")}`,
  );
});

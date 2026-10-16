/**
 * The Blocks' stylesheet, read the way a person with a contrast meter and a ruler would.
 *
 * `components/blocks/style/index.css` IS the sheet: its imports, in order, are the cascade. This
 * file concatenates them in that order with the comments stripped (a rule that only TALKS about
 * a value must not satisfy a check for it), splits the result into rules, and resolves every
 * `var(--bk-*)` against `base/tokens.css`, `color-mix(in srgb, ...)` included, so a ratio here is
 * the ratio the browser paints.
 *
 * The grounds are the sheet's own: `--bk-sheet` and `--bk-vellum` everywhere, and `--bk-graphite`
 * inside the title block, which is the one inverted region on the print.
 *
 *   node --experimental-transform-types --import ./test/register.mjs --test "test/**\/*.test.ts"
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const STYLE = "components/blocks/style";
const read = (path: string): string =>
  readFileSync(fileURLToPath(new URL(`../${path}`, import.meta.url)), "utf8");
const strip = (css: string): string => css.replace(/\/\*[\s\S]*?\*\//g, "");

/** The parts, in the order `index.css` imports them. */
const PARTS = [...strip(read(`${STYLE}/index.css`)).matchAll(/@import "\.\/([^"]+)";/g)].map(
  (m) => m[1]!,
);
const SHEET = PARTS.map((part) => strip(read(`${STYLE}/${part}`))).join("\n");

type Rule = { selector: string; decls: Map<string, string>; order: number; at: string };

/** Every style rule, flattened out of `@media` / `@container`, keyframes skipped. */
function rulesOf(css: string): Rule[] {
  const out: Rule[] = [];
  const walk = (text: string, at: string): void => {
    let i = 0;
    while (i < text.length) {
      const open = text.indexOf("{", i);
      if (open < 0) return;
      const prelude = text.slice(i, open).trim();
      let depth = 1;
      let j = open + 1;
      while (j < text.length && depth > 0) {
        if (text[j] === "{") depth += 1;
        else if (text[j] === "}") depth -= 1;
        j += 1;
      }
      const body = text.slice(open + 1, j - 1);
      if (prelude.startsWith("@keyframes")) {
        // a frame list, not a rule
      } else if (prelude.startsWith("@")) {
        walk(body, `${at} ${prelude}`.trim());
      } else {
        const decls = new Map<string, string>();
        for (const decl of body.split(";")) {
          const colon = decl.indexOf(":");
          if (colon < 0) continue;
          decls.set(decl.slice(0, colon).trim(), decl.slice(colon + 1).trim());
        }
        out.push({ selector: prelude.replace(/\s+/g, " "), decls, order: out.length, at });
      }
      i = j;
    }
  };
  walk(css, "");
  return out;
}

const RULES = rulesOf(SHEET);

/** Every `--bk-*` the token file declares, by name. */
const TOKENS = new Map(
  [...strip(read(`${STYLE}/base/tokens.css`)).matchAll(/(--bk-[a-z0-9-]+)\s*:\s*([^;]+);/g)].map(
    (m) => [m[1]!, m[2]!.trim()] as const,
  ),
);

/** A value with every `var(--bk-*)` replaced by what it resolves to. */
function resolve(value: string): string {
  let out = value;
  for (let n = 0; n < 10 && /var\(--bk-/.test(out); n += 1) {
    out = out.replace(/var\((--bk-[a-z0-9-]+)\)/g, (_, name: string) => {
      const token = TOKENS.get(name);
      assert.ok(token, `${name} is read and not declared in base/tokens.css`);
      return token;
    });
  }
  return out;
}

type Rgb = [number, number, number];

/** A colour value as sRGB: a hex, or `color-mix(in srgb, A p%, B)` of two hexes. */
function rgbOf(value: string): Rgb {
  const v = resolve(value).trim();
  const hex = /^#([0-9a-f]{6})$/i.exec(v);
  if (hex) {
    const h = hex[1]!;
    return [0, 2, 4].map((k) => parseInt(h.slice(k, k + 2), 16)) as Rgb;
  }
  const mix = /^color-mix\(in srgb,\s*(#[0-9a-f]{6})\s+([\d.]+)%,\s*(#[0-9a-f]{6})\s*\)$/i.exec(v);
  if (mix) {
    const a = rgbOf(mix[1]!);
    const b = rgbOf(mix[3]!);
    const p = Number(mix[2]) / 100;
    return a.map((x, k) => x * p + b[k]! * (1 - p)) as Rgb;
  }
  throw new Error(`not a colour this test can read: ${value} -> ${v}`);
}

function luminance([r, g, b]: Rgb): number {
  const lin = (c: number): number => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

/** The WCAG contrast ratio of two colour values. */
function ratio(a: string, b: string): number {
  const [x, y] = [luminance(rgbOf(a)), luminance(rgbOf(b))];
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

const SHEET_GROUNDS = ["var(--bk-sheet)", "var(--bk-vellum)"];
const INVERTED = "var(--bk-graphite)";

/** The colour an `outline` shorthand draws in: its last token, which is how this sheet writes it. */
const outlineColour = (outline: string): string => outline.split(/\s+(?![^(]*\))/).at(-1)!;

test("every focus ring clears 3:1 against the ground it is drawn on, the title block's included", () => {
  // The base ring is drawn on every control under `.bk-root`; the title block is the one region
  // that inverts the ground under it, and it holds the only irreversible acts on the card.
  const base = RULES.find((r) => r.selector.startsWith(".bk-root :where(") && /:focus-visible$/.test(r.selector));
  assert.ok(base, "the sheet declares no base focus ring");
  const baseInk = outlineColour(base.decls.get("outline")!);
  for (const ground of SHEET_GROUNDS) {
    assert.ok(ratio(baseInk, ground) >= 3, `the base ring is ${ratio(baseInk, ground).toFixed(2)}:1 on ${ground}`);
  }

  const inverted = RULES.filter(
    (r) => r.selector.startsWith(".bk-title-block ") && /:focus-visible$/.test(r.selector),
  );
  assert.ok(
    inverted.length > 0,
    `nothing redraws the ring inside the title block, so its controls take the base ring at ${ratio(baseInk, INVERTED).toFixed(2)}:1 on --bk-graphite`,
  );
  for (const rule of inverted) {
    const ink = rule.decls.get("outline-color") ?? outlineColour(rule.decls.get("outline") ?? "");
    assert.ok(
      ratio(ink, INVERTED) >= 3,
      `${rule.selector} draws its ring at ${ratio(ink, INVERTED).toFixed(2)}:1 on --bk-graphite`,
    );
    // It has to win: the same weight as the base ring and later in the cascade.
    assert.ok(rule.order > base.order, `${rule.selector} comes before the base ring it overrides`);
    assert.match(rule.selector, /^\.bk-title-block :where\([^)]*\):focus-visible$/);
  }
});

test("text set in a state's colour clears 4.5:1 on the sheet and on the vellum", () => {
  // The three hue tokens are SWATCHES first - a stripe, a dot, a rule - where 3:1 is the floor.
  // Where one becomes the colour of a word or a figure it is text, and the floor is 4.5:1 on both
  // grounds a figure stands on: the sheet, and the vellum of the dossier's head, the pair panel
  // and a hovered key. Rules that set their own background are measured on that instead.
  const tone = /var\(--bk-(redline|greenline|goldline)[a-z-]*\)/;
  const sites = RULES.filter((r) => tone.test(r.decls.get("color") ?? ""));
  assert.ok(sites.length >= 8, `only ${sites.length} rules set text in a state's colour`);
  const low: string[] = [];
  for (const rule of sites) {
    const own = rule.decls.get("background") ?? rule.decls.get("background-color");
    const grounds = own && own !== "none" ? [own] : SHEET_GROUNDS;
    for (const ground of grounds) {
      const r = ratio(rule.decls.get("color")!, ground);
      if (r < 4.5) low.push(`${rule.selector} on ${ground}: ${r.toFixed(2)}:1`);
    }
  }
  assert.deepEqual(low, [], `text in a state's colour under 4.5:1:\n  ${low.join("\n  ")}`);
});

/** A length in px, from a `--bk-*` rule width or a `calc(-1 * ...)` of one. */
function px(value: string): number {
  const v = resolve(value).replace(/\s+/g, " ").trim();
  const neg = /^calc\(-1 \* (\d+(?:\.\d+)?)px\)$/.exec(v);
  if (neg) return -Number(neg[1]);
  const plain = /^(-?\d+(?:\.\d+)?)px$/.exec(v);
  assert.ok(plain, `not a length this test can read: ${value} -> ${v}`);
  return Number(plain[1]);
}

test("the L1 card's focus ring is drawn inside the box that clips it", () => {
  // `.bk-cell` fills its projected wrapper (`.bk-cell-at`, 100% by 100%), and the wrapper clips
  // (`overflow: hidden`) so a short slab cuts its card rather than printing on the wall behind.
  // A ring drawn OUTSIDE the cell is therefore drawn outside the clip: none of it paints, and the
  // focused card looks exactly like a hovered one.
  const wrapper = RULES.find((r) => r.selector === ".bk-cell-at");
  assert.equal(wrapper?.decls.get("overflow"), "hidden", "the wrapper no longer clips; revisit this");
  const cell = RULES.find((r) => r.selector === ".bk-cell");
  assert.equal(cell?.decls.get("inline-size"), "100%");
  assert.equal(cell?.decls.get("block-size"), "100%");

  const ring = RULES.find((r) => r.selector === ".bk-cell:focus-visible");
  assert.ok(ring, "the card declares no focus ring of its own");
  const [width] = ring.decls.get("outline")!.split(" ");
  const reach = px(ring.decls.get("outline-offset") ?? "0px") + px(width!);
  assert.ok(reach <= 0, `the ring reaches ${reach}px outside a box clipped at its edge: 0 of ${px(width!)}px paints`);
});

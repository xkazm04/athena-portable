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
import { readdirSync, readFileSync } from "node:fs";
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

test("every chip that is a button is a 44px target with a drawn pressed state, in a spaced strip", () => {
  // `.bk-chip` is the box (chrome/rail-and-bar.css); a chip that can be pressed is also a TARGET,
  // and a pressed one has to look pressed. The rule for that used to name one chip class, so the
  // dossier's pair picker - the same chip in another file - got neither, and its strip no layout.
  const selectors = (r: Rule): string[] => r.selector.split(",").map((s) => s.trim());
  const files = ["components/blocks/field/Head.tsx", "components/blocks/dossier/Pair.tsx"];
  const found: string[] = [];
  const missing: string[] = [];
  for (const file of files) {
    const src = read(file);
    for (const m of src.matchAll(/<button\b[\s\S]*?className="([^"]*\bbk-chip\b[^"]*)"([\s\S]*?)>/g)) {
      const classes = m[1]!.split(/\s+/);
      const pressable = /aria-pressed=/.test(m[0]);
      const owns = (s: string): boolean =>
        classes.some((c) => s === `.${c}`) || s === ".bk-chip:where(button)";
      const ownsPressed = (s: string): boolean =>
        classes.some((c) => s === `.${c}[aria-pressed="true"]`) ||
        s === '.bk-chip:where(button)[aria-pressed="true"]';
      const label = `${file} <button class="${m[1]}">`;
      found.push(label);
      const floor = RULES.filter((r) => selectors(r).some(owns) && r.decls.has("min-block-size"));
      if (!floor.some((r) => px(r.decls.get("min-block-size")!) >= 44)) missing.push(`${label}: no 44px floor`);
      if (!RULES.some((r) => selectors(r).some(owns) && r.decls.get("cursor") === "pointer")) {
        missing.push(`${label}: no pointer cursor`);
      }
      if (pressable && !RULES.some((r) => selectors(r).some(ownsPressed))) {
        missing.push(`${label}: aria-pressed with no pressed state drawn`);
      }
    }
    for (const g of src.matchAll(/<div className="([^"]+)" role="group"/g)) {
      if (!RULES.some((r) => selectors(r).includes(`.${g[1]}`) && r.decls.has("gap"))) {
        missing.push(`${file} .${g[1]}: a strip of chips with no gap between them`);
      }
    }
  }
  assert.equal(found.length, 2, `expected the database jump and the pair picker, found ${found.length}`);
  assert.deepEqual(missing, []);
});

test("a legend key keeps its fault or quiet stripe while it is hovered, focused or opening", () => {
  // The key's inline-start edge is the database's verdict: redline in fault, greenline quiet
  // (`level0/l0.css`, pinned by `l0-fill.test.ts`). The hover / on rule has the same weight and
  // comes later, so any border declaration in it that reaches the inline-start edge repaints the
  // verdict graphite on exactly the key the reader is pointing at.
  const fill = RULES.filter((r) => /^\.bk-db-key\[data-fill="(fault|quiet)"\]$/.test(r.selector));
  assert.equal(fill.length, 2, "the two stripe rules moved; revisit this");
  const reaches = /^border(-color|-style|-width|-inline|-inline-start(-color)?|-left(-color)?)?$/;
  const offenders: string[] = [];
  for (const rule of RULES) {
    const parts = rule.selector.split(",").map((s) => s.trim());
    if (!parts.some((s) => /^\.bk-db-key(:hover|\[data-on="true"\])$/.test(s))) continue;
    if (rule.order < Math.min(...fill.map((r) => r.order))) continue;
    for (const prop of rule.decls.keys()) if (reaches.test(prop)) offenders.push(`${rule.selector} { ${prop} }`);
  }
  assert.deepEqual(offenders, [], "a later hover/on rule repaints the verdict stripe");
});

test("every class the sheet styles is one the app renders", () => {
  // A rule for a class nothing renders is a rule nobody can see, and in this sheet the dead ones
  // were not neutral: they kept a contrast exception (a disabled rung under the ink floor) and a
  // comment ("the breakdown under the bar") describing a level rail that no longer exists.
  const sources: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(fileURLToPath(new URL(`../${dir}`, import.meta.url)), { withFileTypes: true })) {
      const path = `${dir}/${entry.name}`;
      if (entry.isDirectory()) walk(path);
      else if (/\.(ts|tsx)$/.test(entry.name)) sources.push(read(path));
    }
  };
  for (const dir of ["app", "components", "lib"]) walk(dir);
  const code = sources.join("\n");
  const styled = new Set([...SHEET.matchAll(/\.(bk-[a-z0-9-]+)/g)].map((m) => m[1]!));
  const unrendered = [...styled].filter(
    (c) => !new RegExp(`(?<![a-z0-9-])${c}(?![a-z0-9-])`).test(code),
  );
  assert.ok(styled.size > 50, `only ${styled.size} classes read off the sheet`);
  assert.deepEqual(unrendered, [], "the sheet styles classes no component renders");
});

test("every word and figure the sheet sets clears 4.5:1 on its ground", () => {
  // base/tokens.css: "anything a reader reads stops at --bk-graphite-2". --bk-graphite-3 (3.8:1
  // on the sheet, 3.3:1 on the vellum) and --bk-graphite-4 are rule and mark tones. A disabled
  // control is the one exemption the floor allows.
  const low: string[] = [];
  for (const rule of RULES) {
    const colour = rule.decls.get("color");
    if (!colour || /currentColor|inherit/.test(colour) || /:disabled/.test(rule.selector)) continue;
    const own = rule.decls.get("background") ?? rule.decls.get("background-color");
    const grounds =
      own && own !== "none"
        ? [own]
        : rule.selector.startsWith(".bk-title-block")
          ? [INVERTED]
          : SHEET_GROUNDS;
    for (const ground of grounds) {
      const r = ratio(colour, ground);
      if (r < 4.5) low.push(`${rule.selector} on ${ground}: ${r.toFixed(2)}:1`);
    }
  }
  assert.deepEqual(low, [], `text under 4.5:1:\n  ${low.join("\n  ")}`);
});

test("the values the TypeScript restates from base/tokens.css agree with it", async () => {
  // A `three` material cannot read a custom property and a projector cannot measure one before it
  // writes, so two modules restate token values by hand: the scene's inks, and the width a label
  // is authored at. Each says so in its own comment; nothing held them to it. A palette edit in
  // the sheet left the cube's dots in the old gold with the suite green.
  const { INK } = await import("../components/blocks/l0/contract");
  const tokenFor: Record<string, string> = { rule: "--bk-rule-ink" };
  const drift: string[] = [];
  for (const [key, value] of Object.entries(INK)) {
    const name = tokenFor[key] ?? `--bk-${key}`;
    const declared = TOKENS.get(name);
    if (declared?.toLowerCase() !== String(value).toLowerCase()) {
      drift.push(`INK.${key} ${String(value)} vs ${name} ${declared ?? "(undeclared)"}`);
    }
  }
  const projector = strip(read("components/blocks/field/useProjector.ts"));
  const labelW = /export const LABEL_W = (\d+);/.exec(projector);
  assert.ok(labelW, "field/useProjector.ts no longer declares LABEL_W as a number");
  if (TOKENS.get("--bk-label-w") !== `${labelW[1]}px`) {
    drift.push(`LABEL_W ${labelW[1]} vs --bk-label-w ${TOKENS.get("--bk-label-w") ?? "(undeclared)"}`);
  }
  assert.ok(Object.keys(INK).length >= 7, "the scene's ink table shrank; revisit this");
  assert.deepEqual(drift, []);
});

test("every hover state eases, as its siblings do", () => {
  // Every control on the sheet that answers a pointer answers it over a motion token, except the
  // one that did not: a hover that cuts while its neighbours ease reads as a different control.
  const parts = RULES.flatMap((r) => r.selector.split(",").map((s) => s.trim()));
  const eased = (key: string): boolean =>
    RULES.some(
      (r) =>
        r.decls.has("transition") &&
        r.selector.split(",").some((s) => {
          const t = s.trim();
          return t === key || t.endsWith(` ${key}`);
        }),
    );
  const hovers = parts.filter((p) => /:hover/.test(p) && !/::-webkit/.test(p));
  assert.ok(hovers.length >= 8, `only ${hovers.length} hover states read off the sheet`);
  const cut: string[] = [];
  for (const p of hovers) {
    const [before, after] = p.split(/:hover(?::not\([^)]*\))?/);
    const key = after!.trim() || before!.split(" ").at(-1)!.replace(/\[[^\]]*\]/g, "");
    if (!eased(key)) cut.push(`${p} (nothing transitions ${key})`);
  }
  assert.deepEqual(cut, []);
});

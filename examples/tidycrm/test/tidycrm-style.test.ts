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

/** A rule that rebinds the colour roles for the subtree under it: the title block, wherever declared. */
const isScopeRule = (r: Rule): boolean =>
  /(^|\s)\.bk-title-block$/.test(r.selector) && [...r.decls.keys()].some((k) => k.startsWith("--bk-"));

/** Every `--bk-*` the token file declares on the stock sheet, by name (the title block's rebinding excluded). */
const TOKENS = new Map(
  rulesOf(strip(read(`${STYLE}/base/tokens.css`)))
    .filter((r) => !isScopeRule(r))
    .flatMap((r) => [...r.decls].filter(([k]) => k.startsWith("--bk-"))),
);

/** The inverted scope's rebindings: what the title block declares over the stock roles. */
const SCOPE_RULE = RULES.find(isScopeRule);
const INVERTED_BINDINGS = new Map(
  [...(SCOPE_RULE?.decls ?? new Map<string, string>())].filter(([k]) => k.startsWith("--bk-")),
);

type Scope = "stock" | "inverted";
const SCOPES: Scope[] = ["stock", "inverted"];

/** A value with every `var(--bk-*)` replaced by what it resolves to, in the scope it is read in. */
function resolve(value: string, scope: Scope = "stock"): string {
  const table = scope === "inverted" ? new Map([...TOKENS, ...INVERTED_BINDINGS]) : TOKENS;
  let out = value;
  for (let n = 0; n < 10 && /var\(--bk-/.test(out); n += 1) {
    out = out.replace(/var\((--bk-[a-z0-9-]+)\)/g, (_, name: string) => {
      const token = table.get(name);
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

/** The colour an `outline` shorthand draws in: its last token, which is how this sheet writes it. */
const outlineColour = (outline: string): string => outline.split(/\s+(?![^(]*\))/).at(-1)!;

/** A rule's selector list, split at its top-level commas only (`:where(a, b)` stays whole). */
const partsOf = (r: Rule): string[] => r.selector.split(/,(?![^(]*\))/).map((s) => s.trim());

/**
 * What one rule declares for a colour property, reading a shorthand where the longhand is absent:
 * `border-block-end-color` from `border-block-end`, `border-block-color`, `border-block`,
 * `border-color` or `border`; `outline-color` from `outline`; `background` from `background-color`.
 */
function declOf(rule: Rule, prop: string): string | undefined {
  if (prop === "background") return rule.decls.get("background") ?? rule.decls.get("background-color");
  const side = /^(border|outline)((?:-[a-z]+)*)-color$/.exec(prop);
  if (!side) return rule.decls.get(prop);
  const steps = side[2]!.split("-").filter(Boolean);
  for (let n = steps.length; n >= 0; n -= 1) {
    const stem = [side[1], ...steps.slice(0, n)].join("-");
    const longhand = rule.decls.get(`${stem}-color`);
    if (longhand) return longhand;
    const shorthand = rule.decls.get(stem);
    if (shorthand) return outlineColour(shorthand);
  }
  return undefined;
}

/**
 * The value a property resolves to on an element matching `key`, in a scope: the last top-level
 * rule, in cascade order, that names `key` (bare or under `.bk-root`) or - in the inverted scope -
 * names it under `.bk-title-block`, resolved against that scope's role bindings. This is the
 * paint a reader sees, whether it comes from an override rule or from a role.
 */
function paint(key: string, prop: string, scope: Scope): string {
  const names = new Set([key, `.bk-root ${key}`, ...(scope === "inverted" ? [`.bk-title-block ${key}`] : [])]);
  const hits = RULES.filter(
    (r) => r.at === "" && partsOf(r).some((s) => names.has(s)) && declOf(r, prop) !== undefined,
  );
  assert.ok(hits.length > 0, `nothing paints ${prop} on ${key}`);
  return resolve(declOf(hits.at(-1)!, prop)!, scope).toLowerCase();
}

/** A scope's grounds, read off the surfaces that paint them: the print and its board, or the title block. */
const groundsOf = (scope: Scope): string[] =>
  scope === "inverted"
    ? [paint(".bk-title-block", "background", "inverted")]
    : [paint(".bk-sheet", "background", "stock"), paint(".bk-root", "background", "stock")];

const FOCUS = ":where(button, select, input, a, [tabindex]):focus-visible";

test("every focus ring clears 3:1 against the ground it is drawn on, the title block's included", () => {
  // The base ring is drawn on every control under `.bk-root`; the title block is the one region
  // that inverts the ground under it, and it holds the only irreversible acts on the card. Its
  // ring is whatever the cascade resolves there: a role rebound by the scope, or an override.
  for (const scope of SCOPES) {
    const ink = paint(FOCUS, "outline-color", scope);
    for (const ground of groundsOf(scope)) {
      assert.ok(ratio(ink, ground) >= 3, `the ${scope} ring is ${ratio(ink, ground).toFixed(2)}:1 on ${ground}`);
    }
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
  //
  // A rule is measured in every scope it can paint in, on that scope's grounds: a rule that reads
  // only roles the title block rebinds is correct by construction in both, so it is measured in
  // both; a rule that reads a ramp step or a hue is pinned to the stock ground; a rule written
  // under `.bk-title-block` is in the inverted scope only. No selector spelling decides a ground.
  const low: string[] = [];
  for (const rule of RULES) {
    const colour = rule.decls.get("color");
    if (!colour || /currentColor|inherit/.test(colour) || /:disabled/.test(rule.selector)) continue;
    const own = rule.decls.get("background") ?? rule.decls.get("background-color");
    const painted = [colour, own ?? ""].join(" ");
    const reads = [...painted.matchAll(/var\((--bk-[a-z0-9-]+)\)/g)].map((m) => m[1]!);
    const portable = reads.length > 0 && reads.every((name) => INVERTED_BINDINGS.has(name));
    const scopes: Scope[] = rule.selector.startsWith(".bk-title-block")
      ? ["inverted"]
      : portable
        ? SCOPES
        : ["stock"];
    for (const scope of scopes) {
      const grounds = own && own !== "none" ? [resolve(own, scope)] : groundsOf(scope);
      for (const ground of grounds) {
        const r = ratio(resolve(colour, scope), ground);
        if (r < 4.5) low.push(`${rule.selector} (${scope}) on ${ground}: ${r.toFixed(2)}:1`);
      }
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

/* --- The colour roles, and the title block as a scope that rebinds them. ------------------- */

/** The wrapper rule every role is declared on. */
const WRAPPER = RULES.find((r) => r.selector === '[data-variant="blocks"]');

/** A `--bk-*` binding is a colour role when its value reads the ramp or a hue, or is a colour. */
const COLOUR_VALUE =
  /var\(--bk-(vellum|sheet|graphite(-[234])?|rule-ink|redline|greenline|goldline)\)|#[0-9a-f]{3,8}\b|color-mix\(/i;
const rolesOf = (rule: Rule | undefined): string[] =>
  [...(rule?.decls ?? new Map<string, string>())]
    .filter(([k, v]) => k.startsWith("--bk-") && COLOUR_VALUE.test(v))
    .map(([k]) => k)
    .sort();

const NAMED_ROLES = [
  "--bk-ground",
  "--bk-ground-raised",
  "--bk-ink",
  "--bk-ink-quiet",
  "--bk-ink-mark",
  "--bk-line",
  "--bk-line-strong",
  "--bk-focus",
  "--bk-label-ink",
  "--bk-goldline-ink",
];

test("role completeness: every colour role on the wrapper is rebound on the title block, and no other", () => {
  // A role bound in one scope only is a binding defined in one state: it inherits the stock value
  // into the inverted block. --bk-label-ink is computed at the wrapper from --bk-graphite-2, so
  // the block has to re-declare it, not inherit it.
  const stock = rolesOf(WRAPPER);
  for (const name of NAMED_ROLES) assert.ok(stock.includes(name), `the wrapper declares no ${name}`);
  assert.ok(SCOPE_RULE, "no rule rebinds the roles on .bk-title-block");
  assert.deepEqual(rolesOf(SCOPE_RULE), stock, "the title block rebinds a different set of roles from the wrapper's");
});

test("pairs with obligations: in each scope, text roles clear 4.5:1 and the focus and mark roles 3:1 on its grounds", () => {
  // Measured from the role table itself: the grounds are the scope's --bk-ground and
  // --bk-ground-raised, so a scope that rebinds its ground is measured on the ground it declares.
  const text = ["--bk-ink", "--bk-ink-quiet", "--bk-label-ink", "--bk-goldline-ink"];
  const marks = ["--bk-focus", "--bk-ink-mark"];
  const low: string[] = [];
  for (const scope of SCOPES) {
    const table = scope === "inverted" ? INVERTED_BINDINGS : TOKENS;
    for (const ground of ["--bk-ground", "--bk-ground-raised"]) {
      assert.ok(table.has(ground), `the ${scope} scope binds no ${ground}`);
      for (const [roles, floor] of [
        [text, 4.5],
        [marks, 3],
      ] as const) {
        for (const role of roles) {
          assert.ok(table.has(role), `the ${scope} scope binds no ${role}`);
          const r = ratio(resolve(`var(${role})`, scope), resolve(`var(${ground})`, scope));
          if (r < floor) low.push(`${scope} ${role} on ${ground}: ${r.toFixed(2)}:1 (floor ${floor})`);
        }
      }
    }
  }
  assert.deepEqual(low, []);
});

test("no component forks on the inverted ground: nothing under .bk-title-block repaints a colour", () => {
  // The block is a scope. A rule that reaches INTO it to repaint one component wins only by
  // cascade position, and the next control added to the gate needs one more of them.
  const colour = /^(color|background|background-color|border(-[a-z]+)*-color|outline-color|scrollbar-color)$/;
  const forks = RULES.filter(
    (r) =>
      partsOf(r).some((s) => s.startsWith(".bk-title-block ")) &&
      [...r.decls.keys()].some((k) => colour.test(k)),
  ).map((r) => r.selector);
  assert.deepEqual(forks, [], "rules repaint a component inside the title block");
});

test("ratchet: the migrated sheets read no ramp step, and no other part reads more than it did", () => {
  // Component sheets read roles; a ramp step means a different thing on each ground. The eight
  // migrated parts read none; six small parts keep their counts as a ceiling; the toast stack is
  // exempt by name because it mounts outside the wrapper the roles are declared on.
  const ramp = /var\(--bk-(graphite(-[234])?|sheet|vellum|rule-ink)\)/g;
  const ceiling: Record<string, number> = {
    "chrome/rail-and-bar.css": 3,
    "chrome/the-sheet-head.css": 4,
    "level1/l1-cells.css": 3,
    "level1/l1-dress.css": 2,
    "level2/body-2.css": 1,
    "level2/l2-dossier.css": 3,
  };
  const exempt = new Set(["base/tokens.css", "chrome/toast.css"]);
  const over: string[] = [];
  for (const part of PARTS) {
    if (exempt.has(part)) continue;
    const count = (strip(read(`${STYLE}/${part}`)).match(ramp) ?? []).length;
    const limit = ceiling[part] ?? 0;
    if (count > limit) over.push(`${part}: ${count} ramp reads, ceiling ${limit}`);
  }
  assert.ok(PARTS.includes("level2/foot.css") && PARTS.includes("level0/l0.css"), "the parts moved; revisit this");
  assert.deepEqual(over, []);
});

test("guard: the title block's paints do not move", () => {
  const inv = (key: string, prop: string): string => paint(key, prop, "inverted");
  const ground = inv(".bk-title-block", "background");
  assert.equal(ground, "#1d1c1a");
  assert.equal(inv(".bk-title-block", "color"), "#f4f1e9");
  // At rest the gate's button is drawn on the block's own ground: no fill, or a fill of exactly it.
  const rest = inv(".bk-btn", "background");
  assert.ok(rest === "none" || rest === ground, `the gate's button rests on ${rest}`);
  assert.equal(inv(".bk-btn", "color"), "#f4f1e9");
  assert.equal(inv(".bk-btn", "border-color"), "#7e7a72");
  assert.equal(inv(".bk-btn:hover:not(:disabled)", "background"), "#f4f1e9");
  assert.equal(inv(".bk-btn:hover:not(:disabled)", "color"), "#1d1c1a");
  assert.equal(inv(".bk-btn:hover:not(:disabled)", "border-color"), "#f4f1e9");
  assert.equal(inv('.bk-btn[data-fire="true"]', "background"), "#f4f1e9");
  assert.equal(inv('.bk-btn[data-fire="true"]', "color"), "#1d1c1a");
  assert.equal(inv('.bk-btn[data-fire="true"]:hover:not(:disabled)', "background"), "#b3261e");
  assert.equal(inv('.bk-btn[data-fire="true"]:hover:not(:disabled)', "color"), "#f4f1e9");
  assert.equal(inv(FOCUS, "outline-color"), "#f4f1e9");
  assert.equal(inv(".bk-band-note", "color"), "#a8a49a");
  assert.equal(inv(".bk-band-head", "border-block-end-color"), "#f4f1e9");
  assert.equal(inv(".bk-lettering", "color"), "#f4f1e9");
  assert.equal(inv('.bk-lettering[data-ink="1"]', "color"), "#f4f1e9");
  assert.equal(inv(".bk-arm", "border-color"), "#f4f1e9");
  assert.equal(inv(":where(*)", "scrollbar-color"), "#7e7a72 transparent");
});

test("guard: the stock sheet's paints do not move", () => {
  const stock = (key: string, prop: string): string => paint(key, prop, "stock");
  assert.equal(stock(FOCUS, "outline-color"), "#b3261e");
  assert.equal(stock('.bk-seg-option[aria-pressed="true"]', "background"), "#1d1c1a");
  assert.equal(stock('.bk-seg-option[aria-pressed="true"]', "color"), "#f4f1e9");
  assert.equal(stock('.bk-db-key[data-fill="fault"]', "border-inline-start-color"), "#b3261e");
  assert.equal(stock(".bk-btn", "background"), "#f4f1e9");
  assert.equal(stock(".bk-btn", "border-color"), "#1d1c1a");
  assert.equal(stock(".bk-btn", "color"), "#1d1c1a");
  assert.equal(stock(".bk-btn:hover:not(:disabled)", "background"), "#1d1c1a");
  assert.equal(stock(".bk-btn:hover:not(:disabled)", "color"), "#f4f1e9");
  assert.equal(stock('.bk-btn[data-auto="true"]', "border-inline-start-color"), "#2e6b40");
  assert.equal(stock(".bk-band-head", "border-block-end-color"), "#1d1c1a");
  assert.equal(stock(".bk-band-note", "color"), "#4f4d48");
  assert.equal(stock(".bk-lettering", "color"), "#4f4d48");
  assert.equal(stock(":where(*)", "scrollbar-color"), "#a8a49a transparent");
  assert.equal(stock(".bk-root", "background"), "#e7e2d6");
  assert.equal(stock(".bk-sheet", "background"), "#f4f1e9");
});

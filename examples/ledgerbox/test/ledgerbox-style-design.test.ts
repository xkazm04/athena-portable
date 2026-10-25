/**
 * The Lanes' stylesheet, held to its own tokens (scan-sweep stabilize, ledgerbox-style-design,
 * 2026-10-16).
 *
 * Every check here reads the stylesheet as it ships - `components/lanes/style/**` with its comments
 * stripped, so prose about a rule cannot pass for the rule - and takes its population from the
 * files themselves rather than from a list kept beside them. Each was seen red on the tree before
 * its fix.
 *
 *   node --import ./test/register.mjs --test "test/**\/*.test.ts"
 */
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const STYLE = fileURLToPath(new URL("../components/lanes/style/", import.meta.url));

const stripComments = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, "");

function cssFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? cssFiles(join(dir, e.name)) : e.name.endsWith(".css") ? [join(dir, e.name)] : [],
  );
}

/** Every part of the sheet, comments stripped, keyed by its path under `style/`. */
const SHEET = new Map(
  cssFiles(STYLE).map((f) => [f.slice(STYLE.length).replaceAll("\\", "/"), stripComments(readFileSync(f, "utf8"))]),
);
const part = (name: string) => {
  const css = SHEET.get(name);
  assert.ok(css !== undefined, `style/${name} is not in the sheet`);
  return css;
};

/** `selector { body }` pairs at any depth (an `@container` or `@media` body is walked into). */
function rules(css: string): { selector: string; body: string }[] {
  const out: { selector: string; body: string }[] = [];
  for (const m of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    out.push({ selector: m[1]!.trim().replace(/^@[^{]*$/, ""), body: m[2]! });
  }
  return out;
}

/* --------------------------------------------------------------- colour */

/** The token block's colours: `--ln-name: #rrggbb`. */
const TOKENS = new Map(
  [...part("base/tokens.css").matchAll(/(--ln-[a-z0-9-]+):\s*(#[0-9a-f]{6})\s*;/gi)].map((m) => [m[1]!, m[2]!]),
);

/** The grounds text is set on: the five steps of the ramp the token block calls Ground. */
const GROUNDS = ["--ln-void", "--ln-deep", "--ln-ground", "--ln-surface", "--ln-raise"];

type Rgb = [number, number, number];
const rgb = (hex: string): Rgb => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255) as Rgb;
const over = (fg: Rgb, bg: Rgb, alpha: number): Rgb => fg.map((v, i) => v * alpha + bg[i]! * (1 - alpha)) as Rgb;
const luminance = (c: Rgb) => {
  const [r, g, b] = c.map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
};
const contrast = (a: Rgb, b: Rgb) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi! + 0.05) / (lo! + 0.05);
};

function tokenHex(name: string): string {
  const hex = TOKENS.get(name);
  assert.ok(hex, `${name} is not a colour in the token block`);
  return hex;
}

/** Each `[data-heat]` block's two custom properties, read off `base/heat-in-one-place.css`. */
function heats(): Map<string, Record<string, string>> {
  const out = new Map<string, Record<string, string>>();
  for (const { selector, body } of rules(part("base/heat-in-one-place.css"))) {
    const heat = /^\[data-heat="([a-z]+)"\]$/.exec(selector)?.[1];
    if (!heat) continue;
    const props: Record<string, string> = {};
    for (const d of body.matchAll(/(--[a-z-]+):\s*var\((--ln-[a-z0-9-]+)\)/g)) props[d[1]!] = d[2]!;
    out.set(heat, props);
  }
  return out;
}

test("every state's text ink clears 4.5:1 on every ground, at the dimming the sheet gives it", () => {
  // `--tone` is the state's swatch: the bar, the rule, the border. Text set in it was the same value,
  // and `--ln-inert` (void and draft) is a swatch dark on purpose - 1.6 to 2.1:1 as text, on the
  // node's money and standing, the card's state word and its lead figure. And the settled card's
  // standing was dimmed to 0.75 whole, word and all: good at 0.75 on the deep ground is 3.8:1.
  const table = heats();
  assert.ok(table.size >= 5, `found ${table.size} heats in heat-in-one-place.css`);

  // The dimming the standing gets on settled and out-of-play cards, wherever a rule puts an
  // opacity on the element that holds the WORD (a rule aimed at the glyph alone does not count).
  const dims = new Map<string, number>();
  for (const css of SHEET.values()) {
    for (const { selector, body } of rules(css)) {
      const alpha = /(?:^|;)\s*opacity:\s*([0-9.]+)/.exec(body)?.[1];
      if (!alpha) continue;
      for (const one of selector.split(",")) {
        const heat = /\.ln-node\[data-heat="([a-z]+)"\] \.ln-node-status-mark\s*$/.exec(one.trim())?.[1];
        if (heat) dims.set(heat, Number(alpha));
      }
    }
  }

  const short: string[] = [];
  for (const [heat, props] of table) {
    const ink = props["--tone-ink"];
    assert.ok(ink, `[data-heat="${heat}"] declares no --tone-ink, so text in it reads the swatch`);
    for (const ground of GROUNDS) {
      const bg = rgb(tokenHex(ground));
      const ratio = contrast(over(rgb(tokenHex(ink)), bg, dims.get(heat) ?? 1), bg);
      if (ratio < 4.5) short.push(`${heat} (${ink}) on ${ground}: ${ratio.toFixed(2)}:1`);
    }
  }
  assert.deepEqual(short, [], "text below 4.5:1");
});

/* ---------------------------------------------------------------- toast */

test("the toast is painted from the token block, not from copies of it", () => {
  // `ToastProvider` mounts its stack beside the shell, outside `[data-variant="lanes"]`, so no
  // `--ln-*` reached it and toast.css painted it from the hex and px it carried as fallbacks - seven
  // hand copies of five tokens that a retuned token would leave behind.
  const block = rules(part("base/tokens.css")).find(({ body }) => /--ln-raise:/.test(body));
  assert.ok(block, "no rule in tokens.css declares --ln-raise");
  const selector = block.selector.replace(/\s+/g, " ");
  assert.ok(
    selector.split(",").some((s) => /\.dk-toasts\s*\)?$/.test(s.trim())),
    `the token block's selector (${selector}) does not reach the toast stack`,
  );
  // A `:has()` in a plain selector list makes the whole rule invalid where `:has()` is not
  // supported - every token on the sheet with it. Only `:where()`'s forgiving list is safe.
  if (selector.includes(":has(")) {
    assert.match(selector, /^:where\(.*\)$/, `the token block's :has() is outside a :where(): ${selector}`);
  }
  // A fallback that is a VALUE (a colour, a length) is a copy of the token; a generic family
  // behind the face token is not.
  const copies = [...part("chrome/toast.css").matchAll(/var\((--ln-[a-z0-9-]+),\s*([^)]+)\)/g)]
    .filter((m) => /#[0-9a-f]{3,8}|\d(px|rem|em|ms|s)|rgb|hsl/i.test(m[2]!))
    .map((m) => `${m[1]} -> ${m[2]}`);
  assert.deepEqual(copies, [], "toast.css carries its own copy of a token");
});

/* -------------------------------------------------------------- readers */

const APP = fileURLToPath(new URL("../", import.meta.url));

function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.name === "node_modules" || e.name.startsWith(".")
      ? []
      : e.isDirectory()
        ? sources(join(dir, e.name))
        : /\.(ts|tsx)$/.test(e.name)
          ? [join(dir, e.name)]
          : [],
  );
}

/** The TypeScript that renders the page, block and line comments stripped. */
const RENDERERS = ["components", "app", "lib"]
  .flatMap((d) => sources(join(APP, d)))
  .map((f) =>
    readFileSync(f, "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, ""),
  )
  .join("\n");

test("every class the sheet styles is drawn by some component", () => {
  // The toolbar (rail, chips, client select, view switch, picked count) left with the operator
  // chrome in 616762b and the AUTO/GATED bands with the decision dialog in a8200ae; their rules
  // stayed, shipped on every page load, and read as live design to whoever edited the sheet next.
  const styled = new Map<string, Set<string>>();
  for (const [name, css] of SHEET) {
    for (const m of css.matchAll(/\.(ln-[a-z0-9-]+)/g)) {
      if (!styled.has(m[1]!)) styled.set(m[1]!, new Set());
      styled.get(m[1]!)!.add(name);
    }
  }
  assert.ok(styled.size > 50, `read ${styled.size} classes - the sheet did not load`);
  const unread = [...styled]
    .filter(([cls]) => !new RegExp(`(^|[^a-z0-9-])${cls}([^a-z0-9-]|$)`).test(RENDERERS))
    .map(([cls, files]) => `.${cls} (${[...files].join(", ")})`);
  assert.deepEqual(unread, [], "styled, and drawn by nothing");
});

test("every --ln-* token the TypeScript names is declared in the sheet", () => {
  // motion.ts reads the level change's duration, easing and stagger back off the root through the
  // kit's cssMs/cssEase, which answer 0 (or the keyword) for a name nothing declares. A token
  // renamed in tokens.css therefore made every move instant with every gate green.
  const declared = new Set<string>();
  for (const css of SHEET.values()) for (const m of css.matchAll(/(--ln-[a-z0-9-]+)\s*:/g)) declared.add(m[1]!);
  const named = new Set([...RENDERERS.matchAll(/["'`](--ln-[a-z0-9-]+)["'`]/g)].map((m) => m[1]!));
  assert.ok(named.has("--ln-dur-move"), "the TypeScript no longer names --ln-dur-move - re-read motion.ts");
  assert.deepEqual(
    [...named].filter((name) => !declared.has(name)),
    [],
    "named in the TypeScript, declared nowhere in the sheet",
  );
});

/* -------------------------------------------------------------- targets */

/** The parts in cascade order, as `style/index.css` imports them. */
const ORDER = [...readFileSync(join(STYLE, "index.css"), "utf8").matchAll(/@import "\.\/([^"]+)"/g)].map((m) => m[1]!);

/** Rules in cascade order with the at-rule each sits in (`null` at the top level). */
function cascade(): { selector: string; body: string; at: string | null }[] {
  const out: { selector: string; body: string; at: string | null }[] = [];
  for (const name of ORDER) {
    const css = part(name);
    const stack: string[] = [];
    let start = 0;
    for (let i = 0; i < css.length; i++) {
      if (css[i] === "{") {
        stack.push(css.slice(start, i).trim());
        start = i + 1;
      } else if (css[i] === "}") {
        const prelude = stack.pop() ?? "";
        if (prelude && !prelude.startsWith("@")) {
          out.push({ selector: prelude, body: css.slice(start, i), at: stack.findLast((p) => p.startsWith("@")) ?? null });
        }
        start = i + 1;
      }
    }
  }
  return out;
}

test("at phone width every control a person presses is a 44px target", () => {
  // The legend's chips are 30px on a desktop footer and the narrow step gives them their 44px back,
  // which is the sheet's own argument. The ancestor crumb beside them stayed 30px on a phone, and
  // the card's and the decision dialog's close stayed 40px at every width, beside 44px twins.
  const buttons = new Set(
    [...RENDERERS.matchAll(/<(?:motion\.)?button\b[^>]*?className="([^"]+)"/g)].flatMap((m) => m[1]!.split(/\s+/)),
  );
  // Data, not chrome: a mark is the invoice drawn to scale and a node is a whole card.
  for (const data of ["ln-mark", "ln-node"]) buttons.delete(data);
  assert.ok(buttons.has("ln-close") && buttons.has("ln-back"), `read ${[...buttons].join(", ")}`);

  const narrow = cascade().filter(({ at }) => at === null || /ln-shell \(max-width: (42|58)rem\)/.test(at));
  const short: string[] = [];
  for (const cls of buttons) {
    let size: string | null = null;
    for (const { selector, body } of narrow) {
      if (!selector.split(",").some((s) => new RegExp(`\\.${cls}$`).test(s.trim()))) continue;
      size = /min-block-size:\s*([0-9.]+px)/.exec(body)?.[1] ?? size;
    }
    if (size !== null && parseFloat(size) < 44) short.push(`.${cls}: ${size}`);
  }
  assert.deepEqual(short, [], "under 44px at the narrow step");
});

test("text in the state's colour reads the ink, never the swatch", () => {
  const swatchText: string[] = [];
  for (const [name, css] of SHEET) {
    for (const { selector, body } of rules(css)) {
      if (/(?:^|[;\s])color:\s*var\(--tone[,)]/.test(body)) swatchText.push(`${name}: ${selector}`);
    }
  }
  assert.deepEqual(swatchText, [], "`color: var(--tone)` sets text in the swatch");
});

/* ------------------------------------------------- one colour authority */

/*
 * The token block is the only place on the sheet a colour is decided (scan-sweep --challenge,
 * ledgerbox-style-design/A, 2026-10-25). Before this, 52 literals in 13 other parts decided colour
 * on their own: hand copies of five tokens at an alpha, four unnamed white inks for one intent,
 * twelve `#fff` and an unnamed ladder of top-lights and shadows.
 */

/** `--ln-name: value` for every declaration in the token block (the rule that declares --ln-raise). */
function tokenBlock(): Map<string, string> {
  const block = rules(part("base/tokens.css")).find(({ body }) => /--ln-raise:/.test(body));
  assert.ok(block, "no rule in tokens.css declares --ln-raise");
  return new Map([...block.body.matchAll(/(--ln-[a-z0-9-]+)\s*:\s*([^;]+);/g)].map((m) => [m[1]!, m[2]!.trim()]));
}

/** A colour as 0-255 channels and a 0-1 alpha. */
type Rgba = { r: number; g: number; b: number; a: number };
const key = (c: Rgba) =>
  `rgb(${Math.round(c.r)} ${Math.round(c.g)} ${Math.round(c.b)} / ${Math.round(c.a * 1000) / 10}%)`;
const sameRgb = (x: Rgba, y: Rgba) => [x.r - y.r, x.g - y.g, x.b - y.b].every((d) => Math.abs(d) < 0.5);

const RAW_LITERALS = /#[0-9a-f]{3,8}\b|\b(?:rgba?|hsla?)\(/gi;
const hasRawLiteral = (s: string) => /#[0-9a-f]{3,8}\b|\b(?:rgba?|hsla?)\(/i.test(s);

/** The balanced `name(...)` starting at `at`, or null. */
function call(src: string, at: number): string | null {
  const open = src.indexOf("(", at);
  if (open < 0) return null;
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === "(") depth++;
    else if (src[i] === ")" && --depth === 0) return src.slice(at, i + 1);
  }
  return null;
}

/** A function's arguments, split on its top-level commas. */
function args(fn: string): string[] {
  const inner = fn.slice(fn.indexOf("(") + 1, -1);
  const out: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < inner.length; i++) {
    if (inner[i] === "(") depth++;
    else if (inner[i] === ")") depth--;
    else if (inner[i] === "," && depth === 0) {
      out.push(inner.slice(start, i).trim());
      start = i + 1;
    }
  }
  out.push(inner.slice(start).trim());
  return out;
}

/**
 * One colour expression resolved against a declaration table: a hex, `rgb()`, `transparent`,
 * `var(--x[, fallback])`, or `color-mix(in srgb, A [p%], B [q%])`, mixed premultiplied as the
 * engine mixes. Null for anything that is not a colour.
 */
function resolve(expr: string, decls: Map<string, string>, depth = 0): Rgba | null {
  const e = expr.trim();
  if (depth > 20) return null;
  if (e === "transparent") return { r: 0, g: 0, b: 0, a: 0 };
  let m = /^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i.exec(e);
  if (m) {
    const h = m[1]!.length === 3 ? [...m[1]!].map((c) => c + c).join("") : m[1]!;
    const n = (i: number) => parseInt(h.slice(i, i + 2), 16);
    return { r: n(0), g: n(2), b: n(4), a: h.length === 8 ? n(6) / 255 : 1 };
  }
  m = /^rgba?\(\s*([0-9.]+)[\s,]+([0-9.]+)[\s,]+([0-9.]+)\s*(?:[/,]\s*([0-9.]+)(%?))?\s*\)$/i.exec(e);
  if (m) {
    const a = m[4] === undefined ? 1 : Number(m[4]) / (m[5] ? 100 : 1);
    return { r: Number(m[1]), g: Number(m[2]), b: Number(m[3]), a };
  }
  if (/^var\(/.test(e)) {
    const [name, ...fallback] = args(e);
    const value = decls.get(name!);
    if (value !== undefined) return resolve(value, decls, depth + 1);
    return fallback.length ? resolve(fallback.join(","), decls, depth + 1) : null;
  }
  if (/^color-mix\(/.test(e)) {
    const [space, a, b] = args(e);
    if (space !== "in srgb" || !a || !b) return null;
    const stop = (s: string) => {
      const p = /\s([0-9.]+)%$/.exec(s);
      return { colour: resolve(p ? s.slice(0, p.index) : s, decls, depth + 1), p: p ? Number(p[1]) / 100 : null };
    };
    const x = stop(a);
    const y = stop(b);
    if (!x.colour || !y.colour) return null;
    const [cx, cy] = [x.colour, y.colour];
    const px = x.p ?? (y.p === null ? 0.5 : 1 - y.p);
    const py = y.p ?? 1 - px;
    const total = px + py;
    const [wx, wy] = [px / total, py / total];
    const alpha = cx.a * wx + cy.a * wy;
    const ch = (k: "r" | "g" | "b") => (alpha === 0 ? 0 : (cx[k] * cx.a * wx + cy[k] * cy.a * wy) / alpha);
    return { r: ch("r"), g: ch("g"), b: ch("b"), a: alpha * Math.min(total, 1) };
  }
  return null;
}

/** Every colour a declaration value paints, in order, walking into gradients and shadows. */
function coloursIn(value: string, decls: Map<string, string>): { expr: string; colour: Rgba }[] {
  const out: { expr: string; colour: Rgba }[] = [];
  for (let i = 0; i < value.length; ) {
    const rest = value.slice(i);
    const fn = /^(?:var|color-mix|rgba?|hsla?)\(/i.exec(rest);
    const hex = /^#[0-9a-f]{3,8}\b/i.exec(rest);
    const expr = fn ? call(value, i) : hex ? hex[0] : null;
    if (expr) {
      const colour = resolve(expr, decls);
      if (colour) out.push({ expr, colour });
      i += expr.length;
    } else i += 1;
  }
  return out;
}

type Declaration = { name: string; selector: string; prop: string; value: string; body: string };

/** Every declaration outside the token block. */
function declarations(): Declaration[] {
  const out: Declaration[] = [];
  for (const [name, css] of SHEET) {
    if (name === "base/tokens.css") continue;
    for (const { selector, body } of rules(css)) {
      for (const d of body.matchAll(/(?:^|;)\s*([a-z-]+)\s*:\s*([^;]+)/g)) {
        out.push({ name, selector, prop: d[1]!, value: d[2]!.trim(), body });
      }
    }
  }
  return out;
}

test("no part of the sheet but the token block writes a colour literal, and the ban names the role", () => {
  const decls = tokenBlock();
  // The role for a value is read off the token block, so the pointer can never name a stale role.
  const roleOf = new Map<string, string>();
  for (const name of decls.keys()) {
    const c = resolve(`var(${name})`, decls);
    if (c && !roleOf.has(key(c))) roleOf.set(key(c), name);
  }
  const hits: string[] = [];
  for (const name of SHEET.keys()) {
    if (name === "base/tokens.css") continue;
    // Comments blanked to their line breaks, so a hit's line number is the file's own.
    const css = readFileSync(join(STYLE, name), "utf8").replace(/\/\*[\s\S]*?\*\//g, (c) => c.replace(/[^\n]/g, ""));
    for (const m of css.matchAll(RAW_LITERALS)) {
      const expr = m[0].startsWith("#") ? m[0] : (call(css, m.index) ?? m[0]);
      const c = resolve(expr, decls);
      const role = c ? roleOf.get(key(c)) : undefined;
      const line = css.slice(0, m.index).split("\n").length;
      hits.push(`${name}:${line} ${expr} -> ${role ? `use var(${role})` : "no role holds this value yet"}`);
    }
  }
  assert.deepEqual(hits, [], "a colour decided outside the token block");
});

test("every --ln-* the sheet references is declared, and every colour role in the token block", () => {
  // A rule may derive its own geometry (`--ln-row-centre`, `--ln-flag-size`, the stage's zoom
  // origin) where it is used; a colour role has one home, the token block.
  const block = tokenBlock();
  const declared = new Set<string>();
  for (const css of SHEET.values()) for (const m of css.matchAll(/(--ln-[a-z0-9-]+)\s*:/g)) declared.add(m[1]!);
  const wrong = new Set<string>();
  for (const [name, css] of SHEET) {
    for (const m of css.matchAll(/var\((--ln-[a-z0-9-]+)/g)) {
      if (!declared.has(m[1]!)) wrong.add(`${m[1]} (${name}) is declared nowhere`);
    }
  }
  for (const { name, selector, prop, value } of declarations()) {
    if (prop.startsWith("--ln-") && (hasRawLiteral(value) || coloursIn(value, block).length > 0)) {
      wrong.add(`${prop} (${name}: ${selector}) is a colour declared outside the token block`);
    }
  }
  assert.deepEqual([...wrong], [], "a role referenced and not declared, or declared outside the token block");
});

test("every text colour on the sheet is a token and clears 4.5:1 on every ground, at its opacity", () => {
  const decls = tokenBlock();
  const table = heats();
  // The opacity the sheet puts on an element, wherever a rule with the same selector sets one.
  const opacity = new Map<string, number>();
  for (const css of SHEET.values()) {
    for (const { selector, body } of rules(css)) {
      const alpha = /(?:^|;)\s*opacity:\s*([0-9.]+)\s*(?:;|$)/.exec(body)?.[1];
      if (alpha) opacity.set(selector, Math.min(opacity.get(selector) ?? 1, Number(alpha)));
    }
  }
  const flat = (c: Rgba): Rgb => [c.r / 255, c.g / 255, c.b / 255];
  const short: string[] = [];
  let read = 0;
  for (const { name, selector, prop, value, body } of declarations()) {
    if (prop !== "color" || /^(inherit|currentcolor|transparent)$/i.test(value)) continue;
    // A one-glyph separator drawn by a pseudo-element is punctuation, not text a person reads.
    if (/::(before|after)$/.test(selector) && /content:\s*"[^\p{L}\p{N}]"/u.test(body)) continue;
    read++;
    const where = `${name}: ${selector} { color: ${value} }`;
    if (hasRawLiteral(value)) {
      short.push(`${where} is not a token`);
      continue;
    }
    // `--tone-ink` is the state's ink: one per heat, read off heat-in-one-place.css.
    const inks = value.includes("--tone-ink")
      ? [...[...table.values()].map((p) => `var(${p["--tone-ink"]})`), ...args(value).slice(1)]
      : [value];
    // Text on its own fill is read against that fill: solid, or laid over each ground when it is a
    // wash. Everything else is read against the grounds themselves.
    const fillExpr = /(?:^|;)\s*background(?:-color)?:\s*(var\(--ln-[a-z0-9-]+\))\s*(?:;|$)/.exec(body)?.[1];
    const fill = fillExpr ? resolve(fillExpr, decls) : null;
    const grounds: [string, Rgb][] = GROUNDS.map((g) => {
      const ground = flat(resolve(`var(${g})`, decls)!);
      return fill ? [`${fillExpr} over ${g}`, over(flat(fill), ground, fill.a)] : [`var(${g})`, ground];
    });
    if (fill && fill.a > 0.999) grounds.splice(0, grounds.length, [fillExpr!, flat(fill)]);
    for (const ink of inks) {
      const fg = resolve(ink, decls);
      if (!fg) {
        short.push(`${where}: ${ink} does not resolve to a token-block colour`);
        continue;
      }
      for (const [ground, bg] of grounds) {
        const ratio = contrast(over(flat(fg), bg, fg.a * (opacity.get(selector) ?? 1)), bg);
        if (ratio < 4.5) short.push(`${where}: ${ink} on ${ground} ${ratio.toFixed(2)}:1`);
      }
    }
  }
  assert.ok(read > 50, `read ${read} text colours - the sheet did not load`);
  assert.deepEqual(short, [], "text that is not a token or reads below 4.5:1");
});

test("an alpha copy of a token is derived from it, so a retuned token moves every copy", () => {
  const base = tokenBlock();
  const stale: string[] = [];
  for (const token of ["--ln-void", "--ln-ground", "--ln-faint", "--ln-auto", "--ln-gate"]) {
    const old = resolve(`var(${token})`, base);
    assert.ok(old, `${token} is not a colour in the token block`);
    const retuned = new Map(base).set(token, "#ff00ff");
    for (const { name, selector, prop, value } of declarations()) {
      for (const { expr, colour } of coloursIn(value, retuned)) {
        if (colour.a > 0 && sameRgb(colour, old)) {
          stale.push(`${token} retuned: ${name}: ${selector} { ${prop} } still paints ${expr} at the old value`);
        }
      }
    }
  }
  assert.deepEqual(stale, [], "a hand copy that a retune leaves behind");
});

test("the one light source is a closed ladder of named roles, none spent once without a reason", () => {
  const decls = tokenBlock();
  const white = (c: Rgba) => sameRgb(c, { r: 255, g: 255, b: 255, a: 1 });
  const black = (c: Rgba) => sameRgb(c, { r: 0, g: 0, b: 0, a: 1 });
  const loose: string[] = [];
  const used = new Map<string, number>();
  let read = 0;
  for (const { name, selector, prop, value } of declarations()) {
    if (prop === "color") continue;
    for (const { expr, colour } of coloursIn(value, decls)) {
      if (colour.a < 0.001 || colour.a > 0.999 || !(white(colour) || black(colour))) continue;
      read++;
      const role = /^var\((--ln-[a-z0-9-]+)\)$/.exec(expr)?.[1];
      if (!role) loose.push(`${name}: ${selector} { ${prop} } ${expr} is light or shade with no role`);
      else used.set(role, (used.get(role) ?? 0) + 1);
    }
  }
  // A role spent once says why, in a comment on its own line of the token block.
  const raw = readFileSync(join(STYLE, "base/tokens.css"), "utf8").split("\n");
  for (const [role, n] of used) {
    if (n >= 2) continue;
    const line = raw.find((l) => new RegExp(`^\\s*${role}\\s*:`).test(l)) ?? "";
    if (!/\/\*.*\bonce\b.*\*\//.test(line)) loose.push(`${role} is used once and its token line gives no reason`);
  }
  assert.ok(read >= 10, `read ${read} lights and shades - the sheet did not load`);
  assert.deepEqual(loose, [], "the light ladder is not closed");
});

test("each role behind a replaced literal paints exactly the literal it replaced", () => {
  // The values the sheet wrote by hand before the token block owned them, and the role each became.
  // Only the body inks at 78% and 82% move, onto the one at 80%: a 2% alpha consolidation.
  const replaced: [literal: string, role: string, slack: number][] = [
    ["#1d4a56", "--ln-bath-1", 0],
    ["#12303a", "--ln-bath-2", 0],
    ["#123c46", "--ln-bath-3", 0],
    ["#0d2029", "--ln-bath-4", 0],
    ["rgb(4 7 8 / 84%)", "--ln-scrim", 0],
    ["rgb(4 7 8 / 72%)", "--ln-scrim-vignette", 0],
    ["rgb(4 7 8 / 58%)", "--ln-scrim-light", 0],
    ["rgb(4 7 8 / 55%)", "--ln-scrim-foot", 0],
    ["rgb(9 16 18 / 96%)", "--ln-tip-ground", 0],
    ["rgb(155 178 185 / 14%)", "--ln-halo-faint", 0],
    ["rgb(69 211 162 / 22%)", "--ln-halo-auto", 0],
    ["rgb(255 143 77 / 6%)", "--ln-gate-tint", 0],
    ["#fff", "--ln-ink-max", 0],
    ["rgb(255 255 255 / 62%)", "--ln-ink-settled", 0],
    ["rgb(255 255 255 / 78%)", "--ln-ink-held", 0.02],
    ["rgb(255 255 255 / 80%)", "--ln-ink-held", 0],
    ["rgb(255 255 255 / 82%)", "--ln-ink-held", 0.02],
    ["rgb(255 255 255 / 2%)", "--ln-light-1", 0],
    ["rgb(255 255 255 / 3%)", "--ln-light-2", 0],
    ["rgb(255 255 255 / 5%)", "--ln-light-3", 0],
    ["rgb(255 255 255 / 7%)", "--ln-light-4", 0],
    ["rgb(255 255 255 / 8%)", "--ln-light-5", 0],
    ["rgb(255 255 255 / 11%)", "--ln-light-6", 0],
    ["rgb(255 255 255 / 30%)", "--ln-light-7", 0],
    ["rgb(255 255 255 / 45%)", "--ln-light-8", 0],
    ["rgb(0 0 0 / 45%)", "--ln-shadow-meter", 0],
    ["rgb(0 0 0 / 80%)", "--ln-shadow-lift", 0],
    ["rgb(0 0 0 / 90%)", "--ln-shadow-card", 0],
  ];
  const decls = tokenBlock();
  const off: string[] = [];
  for (const [literal, role, slack] of replaced) {
    const was = resolve(literal, decls)!;
    const now = resolve(`var(${role})`, decls);
    if (!now) off.push(`${role} (for ${literal}) is not a colour in the token block`);
    else if (!sameRgb(was, now) || Math.abs(was.a - now.a) > slack + 1e-9) {
      off.push(`${role} = ${key(now)}, was ${literal}`);
    }
  }
  assert.deepEqual(off, [], "a role that does not paint the value it replaced");
});

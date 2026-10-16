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

test("text in the state's colour reads the ink, never the swatch", () => {
  const swatchText: string[] = [];
  for (const [name, css] of SHEET) {
    for (const { selector, body } of rules(css)) {
      if (/(?:^|[;\s])color:\s*var\(--tone[,)]/.test(body)) swatchText.push(`${name}: ${selector}`);
    }
  }
  assert.deepEqual(swatchText, [], "`color: var(--tone)` sets text in the swatch");
});

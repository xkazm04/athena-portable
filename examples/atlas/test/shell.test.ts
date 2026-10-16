/**
 * THE SHELL — the tool surface, the mount and the stylesheets that every variant shares.
 *
 * `node --test` strips TypeScript and not JSX, so the shell's components cannot be rendered here.
 * What can be checked is what they publish (the tool schemas, which live in `tools/read.ts` and go
 * through the kit's own execute door) and their source with comments stripped, so prose that
 * mentions a rule cannot satisfy the check for it.
 */
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

import { CONCEPTS } from "../data";
import { CLEAR_LENS, SET_LENS_PARAMETERS } from "../components/atlas/tools/read";
import { validateArgs } from "../../demo-kit/src/webmcp/door";
import { parametersToJsonSchema } from "../../demo-kit/src/webmcp/types";

/* ------------------------------------------------------------------ the tool surface -- */

test("set_lens's schema accepts the word its description says clears the lens", () => {
  const schema = parametersToJsonSchema(SET_LENS_PARAMETERS);
  const described = SET_LENS_PARAMETERS[0]!.description ?? "";
  assert.ok(described.includes(`"${CLEAR_LENS}"`), "the description no longer names the clear word");
  assert.equal(validateArgs({ concept: CLEAR_LENS }, schema), null);
});

test("set_lens's schema accepts every concept id and nothing else", () => {
  const schema = parametersToJsonSchema(SET_LENS_PARAMETERS);
  for (const c of CONCEPTS) assert.equal(validateArgs({ concept: c.id }, schema), null, c.id);
  assert.equal(validateArgs({}, schema), null, "omitting the concept is the read");
  assert.notEqual(validateArgs({ concept: "inv-nope" }, schema), null);
});

/* --------------------------------------------------------------------- the mount -- */

/** A source file under components/atlas, with block and line comments removed. */
function source(path: string): string {
  return readFileSync(new URL(`../components/atlas/${path}`, import.meta.url), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\{\s*\}/g, "{}")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

test("the variant's loading fallback says it is loading, not that the variant is missing", () => {
  const shell = source("variants/Shell.tsx");
  const fallback = /<Suspense\s+fallback=\{(<Placeholder[^>]*\/>)\}/.exec(shell);
  assert.ok(fallback, "no <Suspense fallback={<Placeholder … />}> in Shell.tsx");
  assert.match(fallback[1]!, /state="loading"/, `the fallback is not the loading state: ${fallback[1]}`);
  assert.doesNotMatch(shell, /not built yet/, "a head that names an absence is still in the shell");
});

test("the boundary's card is the failed state, and it offers the retry", () => {
  const shell = source("variants/Shell.tsx");
  const boundary = /if \(this\.state\.failed\)[\s\S]*?(<Placeholder[\s\S]*?\/>)/.exec(shell);
  assert.ok(boundary, "no Placeholder under the boundary's failed branch");
  assert.match(boundary[1]!, /state="failed"/);
  assert.match(boundary[1]!, /retry=\{/);
});

/* --------------------------------------------------------------- the stylesheets -- */

const STYLE = new URL("../components/atlas/style/", import.meta.url);
const ATLAS = new URL("../components/atlas/", import.meta.url);

/** Every .css file under a folder, as [path relative to components/atlas, text]. */
function sheets(dir: URL): [string, string][] {
  const out: [string, string][] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true, recursive: true })) {
    if (!entry.isFile() || !entry.name.endsWith(".css")) continue;
    const full = join(entry.parentPath, entry.name);
    out.push([relative(fileURLToPath(ATLAS), full).replaceAll("\\", "/"), readFileSync(full, "utf8")]);
  }
  return out;
}

const uncomment = (css: string): string => css.replace(/\/\*[\s\S]*?\*\//g, "");

test("every @container query in the shell's stylesheets names a container the app declares", () => {
  const declared = new Set<string>();
  for (const [, css] of sheets(ATLAS)) {
    for (const m of uncomment(css).matchAll(/container(?:-name)?\s*:\s*([\w-]+)/g)) declared.add(m[1]!);
  }
  const dangling: string[] = [];
  for (const [path, css] of sheets(STYLE)) {
    for (const m of uncomment(css).matchAll(/@container\s+([\w-]+)\s*\(/g)) {
      if (!declared.has(m[1]!)) dangling.push(`${path}: @container ${m[1]}`);
    }
  }
  assert.deepEqual(dangling, [], "a query on a container nothing declares never matches");
});

/** Script source with its comments removed, so a class a comment mentions does not count as spent. */
const uncode = (ts: string): string =>
  ts.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

/** Every .ts/.tsx file of the app's source, joined: where a class name is spent. */
function markup(): string {
  const out: string[] = [];
  for (const dir of ["../app/", "../components/", "../lib/"]) {
    const root = new URL(dir, import.meta.url);
    for (const entry of readdirSync(root, { withFileTypes: true, recursive: true })) {
      if (entry.isFile() && /\.tsx?$/.test(entry.name)) {
        out.push(uncode(readFileSync(join(entry.parentPath, entry.name), "utf8")));
      }
    }
  }
  return out.join("\n");
}

test("every class the shell's stylesheets style is one some component renders", () => {
  const source = markup();
  const unused = new Set<string>();
  for (const [path, css] of sheets(STYLE)) {
    for (const m of uncomment(css).matchAll(/\.(at-[\w-]+)/g)) {
      const cls = m[1]!;
      if (!new RegExp(`(?<![\w-])${cls}(?![\w-])`).test(source)) unused.add(`${path}: .${cls}`);
    }
  }
  assert.deepEqual([...unused], [], "a rule for a class nothing renders is a rule nobody can see");
});

/**
 * Every token the token file declares outside its raw ramps is spent: read by a `var()` in some
 * stylesheet (the token file's own alias layer included), or by name from script (`useTokens`).
 * The ramps (spacing, type size) are a deliberate set whose unused steps are still the scale; the
 * breakpoints are spent by `design/check-tokens.mjs`, which a query condition has to match.
 */
test("every role the token file declares is spent somewhere", () => {
  const tokens = readFileSync(new URL("base/tokens.css", STYLE), "utf8");
  const declared = [...uncomment(tokens).matchAll(/^\s*(--at-[\w-]+)\s*:/gm)].map((m) => m[1]!);
  const ramp = /^--at-(space|text|bp)-/;
  const css = sheets(ATLAS).map(([, text]) => uncomment(text)).join("\n");
  const script = markup();
  const unspent = [...new Set(declared)].filter(
    (t) => !ramp.test(t) && !css.includes(`var(${t})`) && !script.includes(`"${t}"`),
  );
  assert.deepEqual(unspent, [], "a token nothing reads is a decision nobody is making");
});

/* ---------------------------------------------------------------- name, role, value -- */

/** Every `<button …>` opening tag in a source, read to its closing `>` at brace depth 0. */
function buttons(src: string): string[] {
  const out: string[] = [];
  let at = src.indexOf("<button");
  while (at !== -1) {
    let depth = 0;
    let i = at;
    for (; i < src.length; i += 1) {
      const ch = src[i];
      if (ch === "{") depth += 1;
      else if (ch === "}") depth -= 1;
      else if (ch === ">" && depth === 0) break;
    }
    out.push(src.slice(at, i + 1));
    at = src.indexOf("<button", i);
  }
  return out;
}

const buttonWithClass = (src: string, cls: string): string => {
  const hit = buttons(src).filter((b) => new RegExp(`className="${cls}"`).test(b));
  assert.equal(hit.length, 1, `expected one .${cls} button, found ${hit.length}`);
  return hit[0]!;
};

test("both controls that toggle the lens say whether it is on (WCAG 4.1.2)", () => {
  /* The claims rail and the pane's chips call the same toggling setLens with the same id. */
  const claim = buttonWithClass(source("chrome/Claims.tsx"), "at-claim");
  const chip = buttonWithClass(source("pane/Pane.tsx"), "at-chip");
  assert.match(claim, /aria-pressed=\{/);
  assert.match(chip, /aria-pressed=\{/, `the pane's chip shows the lens by colour only: ${chip}`);
});

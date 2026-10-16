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

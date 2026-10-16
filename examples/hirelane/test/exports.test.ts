/**
 * Every export in the domain lib, the board model and the board's tools has a reader.
 *
 * `lib/queries.ts` already tells this story once: half its exports served routes that were
 * reviewed out, and neither gate could see it - tsc never calls an export unused, and
 * eslint-config-next tracks no cross-module reachability. The same thing had happened again,
 * quietly: a head-to-head `diff()` the brief still credited with the comparison, a second
 * score-label function beside the one the dossier prints, three row types nothing builds. This
 * is the count neither gate takes.
 *
 * A reader is any mention outside comments, anywhere in the app's source or tests, other than the
 * declaration itself. A name used only inside its own file still has a reader.
 *
 *   node --import ./test/register.mjs --test "test/**\/*.test.ts"
 */
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../", import.meta.url));

/** The files whose exports this holds to account: hirelane-model-and-lib's TypeScript. */
const SCOPE = ["lib", "lib/board", "components/board/model", "components/board/tools"];
const SCOPE_FILES = ["components/board/model.ts", "components/board/useRun.ts"];

/**
 * Kept with no reader, on purpose, and why. `APP_VERSION` waits on a studio-wide call: whether the
 * example apps publish `athena:app` / `athena:app-version` (ledgerbox does) or drop the pair.
 */
const KEPT = new Set(["APP_VERSION"]);

const SKIP_DIRS = new Set(["node_modules", ".next", "data", "public"]);

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name)) continue;
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walk(path, out);
    else if (/\.(ts|tsx|mjs)$/.test(name)) out.push(path);
  }
  return out;
}

const strip = (text: string): string => text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");

const sources = walk(ROOT).map((path) => ({ path: relative(ROOT, path).replaceAll("\\", "/"), text: strip(readFileSync(path, "utf8")) }));

const inScope = sources.filter(
  (s) =>
    /\.tsx?$/.test(s.path) &&
    (SCOPE_FILES.includes(s.path) || SCOPE.some((dir) => s.path.slice(0, s.path.lastIndexOf("/")) === dir)),
);

const DECL = /^export\s+(?:async\s+)?(?:function|const|let|interface|type|class)\s+([A-Za-z_$][\w$]*)/gm;

function unread(): string[] {
  const dead: string[] = [];
  for (const file of inScope) {
    for (const match of file.text.matchAll(DECL)) {
      const name = match[1]!;
      if (KEPT.has(name)) continue;
      const word = new RegExp(`\\b${name}\\b`, "g");
      const uses = sources.reduce((n, s) => n + (s.text.match(word)?.length ?? 0), 0);
      if (uses <= 1) dead.push(`${file.path}: ${name}`);
    }
  }
  return dead;
}

test("the scan reaches the context's files, or this asserts nothing", () => {
  assert.ok(inScope.length >= 20, `scanned ${inScope.length} files`);
  assert.ok(inScope.some((s) => s.path === "lib/scoring.ts"));
  assert.ok(inScope.some((s) => s.path === "components/board/tools/read.ts"));
});

test("every export in scope has a reader besides its own declaration", () => {
  assert.deepEqual(unread(), []);
});

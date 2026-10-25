/**
 * The model against the tree it does NOT cite.
 *
 * `test/data.test.ts` asks whether every path the model cites is in the tree. That is membership:
 * a model that draws a third of `src/athena` and cites it correctly passes it. This file asks the
 * other question — coverage — by walking the tree: every module is drawn by a component or named
 * in `data/omissions.ts` with a reason, and an omission is held to the tree as hard as a
 * citation is. It also holds the layer blurbs to README §3.1's own words, since the blurbs claim
 * to be verbatim and the parts README §3.1 names are what a reader expects to find drawn.
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import {
  ADRS,
  COMPONENTS,
  COVERAGE,
  LAYERS,
  OMISSIONS,
  classifyModule,
  coverageOf,
  omissionFaults,
  type Omission,
} from "../data";

/** The repository root: this file is `examples/atlas/test/coverage.test.ts`. */
const REPO = fileURLToPath(new URL("../../../", import.meta.url));
const inTree = (path: string): boolean => existsSync(join(REPO, path));

/** Every git-tracked module under src/athena, `__init__` and `__main__` excepted. */
const MODULES: string[] = execFileSync("git", ["ls-files", "-z", "--", "src/athena"], {
  cwd: REPO,
  encoding: "utf8",
})
  .split("\0")
  .filter((p) => p.endsWith(".py") && !/(^|\/)__(init|main)__\.py$/.test(p))
  .sort();

test("every src/athena module is drawn by a component or declared in the omission ledger", () => {
  assert.ok(MODULES.length > 100, `only ${MODULES.length} modules found; is git on PATH?`);
  const uncovered = MODULES.filter((m) => classifyModule(m) === "uncovered");
  assert.deepEqual(
    uncovered,
    [],
    `${uncovered.length} of ${MODULES.length} modules are neither drawn nor omitted`,
  );
});

test("every omission is in the tree, says why and where from, and omits no drawn component", () => {
  assert.ok(OMISSIONS.length > 0, "the omission ledger is empty, so nothing is declared out of scope");
  assert.deepEqual(omissionFaults(OMISSIONS, COMPONENTS, inTree), []);
  /* Each entry's stated module count is the tree's, so COVERAGE cannot drift from it. */
  const miscounted = OMISSIONS.filter(
    (o) => MODULES.filter((m) => classifyModule(m, [], [o]) === "omitted").length !== o.modules,
  ).map((o) => o.path);
  assert.deepEqual(miscounted, [], "an omission's `modules` is not the tree's count");
});

test("a seeded omission of a drawn component, or of a deleted path, is a fault", () => {
  const seed = (path: string): Omission => ({ path, reason: "seeded", source: "test", modules: 1 });
  const drawn = omissionFaults([seed("src/athena/core/catalog.py")], COMPONENTS, inTree);
  assert.ok(
    drawn.some((f) => f.includes("omits a drawn component")),
    `catalog.py omitted, yet: ${JSON.stringify(drawn)}`,
  );
  const gone = omissionFaults([seed("src/athena/core/no_such_module.py")], COMPONENTS, inTree);
  assert.ok(gone.some((f) => f.includes("is not in the tree")), JSON.stringify(gone));
  const blank = omissionFaults(
    [{ path: "src/athena/peer/", reason: " ", source: "", modules: 1 }],
    COMPONENTS,
    inTree,
  );
  assert.ok(blank.some((f) => f.includes("has no reason")), JSON.stringify(blank));
  assert.ok(blank.some((f) => f.includes("cites no source")), JSON.stringify(blank));
});

/** README §3.1's stack diagram, row by row: the layer word, then its text with continuations. */
function readmeLayerRows(): Map<string, string> {
  const readme = readFileSync(join(REPO, "README.md"), "utf8").split(/\r?\n/);
  const start = readme.findIndex((l) => l.startsWith("### 3.1"));
  assert.ok(start >= 0, "README.md has no §3.1");
  const open = readme.findIndex((l, i) => i > start && l.startsWith("```"));
  const close = readme.findIndex((l, i) => i > open && l.startsWith("```"));
  const rows = new Map<string, string>();
  let current: string | null = null;
  for (const line of readme.slice(open + 1, close)) {
    const head = /^(\S+)\s+(.*)$/.exec(line);
    if (head?.[1] && head[2] !== undefined) {
      current = head[1].toLowerCase();
      rows.set(current, head[2]);
    } else if (current !== null && line.trim() !== "") {
      rows.set(current, `${rows.get(current) ?? ""} ${line.trim()}`);
    }
  }
  for (const [k, v] of rows) rows.set(k, v.replace(/\s+/g, " ").trim());
  return rows;
}

test("each layer blurb is README §3.1's row for that layer, word for word", () => {
  const rows = readmeLayerRows();
  const differ: string[] = [];
  for (const l of LAYERS) {
    const want = rows.get(l.id);
    if (want === undefined) differ.push(`${l.id}: no README §3.1 row`);
    else if (l.blurb.replace(/\s+/g, " ").trim() !== want) differ.push(`${l.id}: README says "${want}"`);
  }
  assert.deepEqual(differ, [], "a layer blurb has drifted from README §3.1");
  assert.equal(rows.size, LAYERS.length, "README §3.1 has a row the model has no layer for");
});

/** Parts README §3.1 names that are modules in the tree, and where the model must draw them. */
const PARTS_NAMED = [
  {
    phrase: "the halo (screen-edge light, ADR 0027)",
    layer: "surfaces",
    file: "apps/desktop/src-tauri/src/halo.rs",
    system: "sys-shell",
    adr: 27,
  },
  {
    phrase: "an API engine (`nebius`, Nemotron on Token Factory) behind the `ModelFn` port (ADR 0031)",
    layer: "harness",
    file: "src/athena/harness/api_harness.py",
    system: "sys-runner",
    adr: 31,
  },
] as const;

test("every part README §3.1 names that is in the tree is a component, citing its ADR", () => {
  const rows = readmeLayerRows();
  const listed = new Set(ADRS.map((a) => a.n));
  for (const p of PARTS_NAMED) {
    assert.ok(rows.get(p.layer)?.includes(p.phrase), `README §3.1 ${p.layer} no longer names "${p.phrase}"`);
    assert.ok(inTree(p.file), `${p.file} is named by README §3.1 but not in the tree`);
    const c = COMPONENTS.find((x) => x.file === p.file);
    assert.ok(c, `README §3.1 names ${p.file} and no component draws it`);
    assert.equal(c.system, p.system, `${c.id} sits in ${c.system}, not ${p.system}`);
    assert.ok(c.adrs.includes(p.adr), `${c.id} does not cite ADR ${p.adr}`);
    assert.ok(listed.has(p.adr), `ADR ${p.adr} is not in data/adrs.ts`);
  }
});

test("the coverage split is drawn / omitted / uncovered of the tree, and COVERAGE states it", (t) => {
  const split = coverageOf(MODULES);
  t.diagnostic(
    `src/athena: ${split.drawn} drawn, ${split.omitted} omitted, ${split.uncovered} uncovered, of ${split.total}`,
  );
  assert.equal(split.drawn + split.omitted + split.uncovered, split.total);
  assert.equal(split.uncovered, 0, `${split.uncovered} modules are unaccounted for`);
  assert.deepEqual(COVERAGE, split, "data/index.ts COVERAGE is not the tree's split");
});

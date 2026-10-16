/**
 * The model against the tree it cites.
 *
 * `test/model.test.ts` holds the model's SHAPE: endpoints exist, ids are unique, every concept
 * lights something. All of that reads the model's own lists, so a model that is internally
 * consistent and describes a repository that has since moved passes it. This file holds the
 * other half of `data/types.ts`'s one content rule — "every entry cites the file it came from" —
 * by reading the repository itself: a citation is only a citation if the thing it names is there.
 */
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { test } from "node:test";

import { ADRS, COMPONENTS, CONCEPTS, LAYERS, SYSTEMS } from "../data";

/** The repository root: this file is `examples/atlas/test/data.test.ts`. */
const REPO = fileURLToPath(new URL("../../../", import.meta.url));
const inTree = (path: string): boolean => existsSync(join(REPO, path));

test("every entry that says it is built cites a path in the tree", () => {
  const missing: string[] = [];
  for (const c of COMPONENTS) {
    if (c.status !== "planned" && !inTree(c.file)) missing.push(`${c.part} ${c.id} -> ${c.file}`);
  }
  for (const s of SYSTEMS) {
    if (!inTree(s.home)) missing.push(`${s.part} ${s.id} home -> ${s.home}`);
    if (s.status !== "planned" && !inTree(s.file)) missing.push(`${s.part} ${s.id} -> ${s.file}`);
  }
  for (const c of CONCEPTS) if (!inTree(c.file)) missing.push(`${c.part} ${c.id} -> ${c.file}`);
  for (const l of LAYERS) if (!inTree(l.file)) missing.push(`${l.part} ${l.id} -> ${l.file}`);
  assert.deepEqual(missing, [], "a citation names a path that is not in the tree");
});

test("a planned component names a file that is not in the tree yet", () => {
  /* `planned` is a claim about the tree (data/types.ts: "an atlas of a machine that silently omits
     the parts that were designed and not built is a sales brochure"). The day the file lands, the
     status is wrong in the other direction, and this is what says so. */
  for (const c of COMPONENTS) {
    if (c.status !== "planned") continue;
    assert.ok(!inTree(c.file), `${c.id} is marked planned but ${c.file} is in the tree`);
  }
});

test("every ADR the model lists is the file in docs/adr it names, under its own number and H1", () => {
  const ns = ADRS.map((a) => a.n);
  assert.equal(new Set(ns).size, ns.length, "an ADR number is listed twice");
  for (const a of ADRS) {
    const path = join(REPO, a.file);
    assert.ok(existsSync(path), `ADR ${a.n} cites ${a.file}, which is not in the tree`);
    const num = /^docs\/adr\/(\d{4})-[\w-]+\.md$/.exec(a.file);
    assert.ok(num, `ADR ${a.n} cites ${a.file}, which is not a docs/adr/NNNN-slug.md path`);
    assert.equal(Number(num[1]), a.n, `ADR ${a.n} cites the file of ADR ${Number(num[1])}`);
    /* "Titles are the ADRs' own H1s" (data/adrs.ts): the H1 is `# NNNN. <title>`. */
    const h1 = readFileSync(path, "utf8").split(/\r?\n/).find((l) => l.startsWith("# ")) ?? "";
    assert.equal(h1.replace(/^# \d{4}\.\s*/, ""), a.title, `ADR ${a.n}'s title is not its H1`);
  }
});

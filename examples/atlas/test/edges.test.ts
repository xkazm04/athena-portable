/**
 * The model's edges against the tree that is supposed to carry them.
 *
 * `test/model.test.ts` holds an edge's SHAPE (both ends exist, no duplicate) and
 * `test/data.test.ts` holds the FILES the model cites. Neither asks whether an arrow is true. An
 * edge is a claim — "this module reaches that one" — and `Edge.via` says which claim: an import,
 * a port the composition root binds, or a protocol hop. For the Python half of the model the
 * claim can be checked by reading the source (`test/source-imports.ts`, no Python run), so it is.
 * Everything the scraper cannot read is reported as skipped WITH its reason, never counted clean.
 */
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { COMPONENTS, EDGES, LAYER_ORDER, systemById, type Component, type Edge } from "../data";
import { checkEdges, importsOf, isPython, moduleOf } from "./source-imports";

/** The repository root: this file is `examples/atlas/test/edges.test.ts`. */
const REPO = fileURLToPath(new URL("../../../", import.meta.url));
const read = (path: string): string | null => {
  const at = join(REPO, path);
  return existsSync(at) && path.endsWith(".py") ? readFileSync(at, "utf8") : existsSync(at) ? "" : null;
};
const byId = new Map(COMPONENTS.map((c) => [c.id, c]));
const end = (id: string): Component => {
  const c = byId.get(id);
  assert.ok(c, `no component ${id}`);
  return c;
};
const builtPy = (c: Component): boolean => isPython(c.file) && c.status !== "planned";
const imports = (path: string): Set<string> => importsOf(read(path) ?? "");
const depth = (c: Component): number =>
  LAYER_ORDER.indexOf(systemById(c.system)?.layer ?? ("" as never));

test("every import edge between two src/athena modules is an import the from-file holds", () => {
  /* An arrow with no `via` is read the way a reader reads it: as an import. */
  const unbacked: string[] = [];
  let asked = 0;
  for (const e of EDGES) {
    if (e.via === "port" || e.via === "wire") continue;
    const from = end(e.from);
    const to = end(e.to);
    if (!builtPy(from) || !builtPy(to)) continue;
    asked += 1;
    const target = moduleOf(to.file);
    if (e.through) {
      /* One named hop: the from-file imports `through`, and `through` imports the to-file. */
      if (!imports(from.file).has(moduleOf(e.through)) || !imports(e.through).has(target)) {
        unbacked.push(`${e.from}->${e.to} (through ${e.through})`);
      }
    } else if (!imports(from.file).has(target)) {
      unbacked.push(`${e.from}->${e.to}`);
    }
  }
  assert.ok(asked > 30, `only ${asked} py->py import edges were asked`);
  assert.deepEqual(unbacked, [], `${unbacked.length} of ${asked} import edges have no import behind them`);
});

test("a port edge names its port, the from-file reaches it, and wiring.py binds the other end", () => {
  const ports = EDGES.filter((e) => e.via === "port");
  const hooks = ports.find((e) => e.from === "cmp-hooks" && e.to === "cmp-catalog");
  assert.ok(hooks, "cmp-hooks -> cmp-catalog is not declared as a port edge");
  assert.equal(hooks.through, "src/athena/harness/ports.py");
  for (const e of ports) assert.ok((e.through ?? "").trim() !== "", `${e.from}->${e.to} names no port`);

  const failed = checkEdges(ports, COMPONENTS, read).filter((v) => v.failure);
  assert.deepEqual(failed.map((v) => v.failure), []);

  /* A port the from-file never imports is not how it reaches the other end. */
  const seeded: Edge = { ...hooks, through: "src/athena/lane/ports.py" };
  const [verdict] = checkEdges([seeded], COMPONENTS, read);
  assert.match(verdict?.failure ?? "", /never imports its port/);
});

test("every import of a higher layer in the tree is a declared up edge with a note", () => {
  /* The model used to assert "no edge runs back up the stack" against its own list. The tree is
     the one that can say. */
  const py = COMPONENTS.filter(builtPy);
  const undeclared: string[] = [];
  let up = 0;
  for (const a of py) {
    const held = imports(a.file);
    for (const b of py) {
      if (a === b || depth(b) >= depth(a) || !held.has(moduleOf(b.file))) continue;
      up += 1;
      const e = EDGES.find((x) => x.from === a.id && x.to === b.id && x.up === true);
      if (!e || e.note.trim() === "") undeclared.push(`${a.file} imports ${moduleOf(b.file)} (${a.id} -> ${b.id})`);
    }
  }
  assert.ok(up >= 1, "the tree holds no up import; src/athena/daemon/server.py imports athena.wiring");
  assert.deepEqual(undeclared, [], "an import runs up the stack and the model does not say so");
});

test("the checker reports checked, failed and skipped-with-reason, and they add up to EDGES", () => {
  const missing = EDGES.filter((e) => !e.via).map((e) => `${e.from}->${e.to}`);
  assert.deepEqual(missing, [], "an edge does not say what carries it");

  const verdicts = checkEdges(EDGES, COMPONENTS, read);
  const checked = verdicts.filter((v) => v.state === "checked");
  const failed = checked.filter((v) => v.failure);
  const skipped = verdicts.filter((v) => v.state === "skipped");
  assert.equal(checked.length + skipped.length, EDGES.length);
  for (const v of skipped) {
    assert.ok((v.reason ?? "").trim() !== "", `${v.edge.from}->${v.edge.to} is skipped with no reason`);
  }
  assert.deepEqual(failed.map((v) => v.failure), []);
  assert.ok(checked.length > 30, `only ${checked.length} edges were asked of the tree`);
  /* A wire edge is skipped because of its protocol; one naming none is a fault, not a skip. */
  const wire = EDGES.filter((e) => e.via === "wire");
  assert.ok(wire.length > 0, "no edge is a protocol hop; POST /run is one");
  for (const e of wire) assert.ok((e.protocol ?? "").trim() !== "", `${e.from}->${e.to} names no protocol`);
  const [bare] = checkEdges([{ ...wire[0]!, protocol: "" }], COMPONENTS, read);
  assert.equal(bare?.state, "checked");
  assert.ok(bare?.failure);
  console.log(
    `edges: ${checked.length} checked (${failed.length} failed), ${skipped.length} skipped, of ${EDGES.length}`,
  );
});

test("source-imports: the scraper finds top-level, from, parenthesised and local imports, not comments", () => {
  const text = [
    '"""A docstring that shows ``from athena.docs import nothing``."""',
    "from athena.core import catalog",
    "from athena.core.prompt import BUDGETS",
    "from athena.harness.ports import (",
    "    ApprovalsPort,",
    "    CatalogPort,",
    ")",
    "",
    "def serve() -> None:",
    "    from athena.wiring import build_local",
    "    import athena.cli as cli",
    "",
  ].join("\n");
  const found = importsOf(text);
  for (const m of [
    "athena.core.catalog",
    "athena.core.prompt",
    "athena.harness.ports",
    "athena.wiring",
    "athena.cli",
  ]) {
    assert.ok(found.has(m), `${m} not found in ${JSON.stringify([...found])}`);
  }
  assert.ok(!found.has("athena.docs"), "an import shown in a docstring was read as one");
  assert.deepEqual([...importsOf("# from athena.x import y\nx = 1  # import athena.z\n")], []);
  assert.equal(moduleOf("src/athena/core/catalog.py"), "athena.core.catalog");
  assert.equal(moduleOf("src/athena/core/brain/__init__.py"), "athena.core.brain");
});

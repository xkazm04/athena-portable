/**
 * The model's integrity.
 *
 * Atlas has no database and no network, so the one thing that can be WRONG about it is the model
 * itself: a dangling edge, a component in no system, a concept that lights nothing, a part number
 * used twice. Those are exactly the defects a hand-extracted model acquires while it is being
 * edited, and none of them is visible on screen — a dangling edge simply does not draw.
 *
 * So they are pinned here. Every assertion below names the modelling rule it enforces.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import {
  ADRS,
  COMPONENTS,
  CONCEPTS,
  COUNTS,
  EDGES,
  LAYERS,
  LAYER_ORDER,
  SYSTEMS,
  SYSTEM_EDGES,
  componentById,
  componentsOf,
  componentsOfLayer,
  layerLinks,
  lensFor,
  litInLayer,
  systemById,
  systemsOf,
} from "../data";

test("every system belongs to a declared layer", () => {
  const layers = new Set(LAYERS.map((l) => l.id));
  for (const s of SYSTEMS) {
    assert.ok(layers.has(s.layer), `${s.id} names layer ${s.layer}, which does not exist`);
  }
});

test("every component belongs to exactly one declared system", () => {
  const systems = new Set(SYSTEMS.map((s) => s.id));
  for (const c of COMPONENTS) {
    assert.ok(systems.has(c.system), `${c.id} names system ${c.system}, which does not exist`);
  }
  /* "Exactly one" is a property of the shape (`system` is a single string), so what is actually
     at risk is a component appearing twice in the list under two systems. */
  const ids = COMPONENTS.map((c) => c.id);
  assert.equal(new Set(ids).size, ids.length, "a component id is used twice");
});

test("every layer has at least one system, and every system at least one component", () => {
  for (const l of LAYERS) {
    assert.ok(systemsOf(l.id).length > 0, `layer ${l.id} has no systems`);
  }
  for (const s of SYSTEMS) {
    assert.ok(componentsOf(s.id).length > 0, `system ${s.id} has no components`);
  }
});

test("every edge endpoint exists, and nothing points at itself", () => {
  for (const e of EDGES) {
    assert.ok(componentById(e.from), `edge from ${e.from} — no such component`);
    assert.ok(componentById(e.to), `edge to ${e.to} — no such component`);
    assert.notEqual(e.from, e.to, `edge ${e.from} points at itself`);
  }
});

test("no edge is declared twice with the same kind", () => {
  const seen = new Set<string>();
  for (const e of EDGES) {
    const key = `${e.from}->${e.to}:${e.kind}`;
    assert.ok(!seen.has(key), `duplicate edge ${key}`);
    seen.add(key);
  }
});

test("every edge carries a note, and every entry carries a citation", () => {
  for (const e of EDGES) assert.ok(e.note.trim().length > 0, `edge ${e.from}->${e.to} has no note`);
  for (const c of COMPONENTS) assert.ok(c.file.trim().length > 0, `${c.id} cites no file`);
  for (const s of SYSTEMS) assert.ok(s.home.trim().length > 0, `${s.id} cites no home`);
  for (const c of CONCEPTS) assert.ok(c.source.trim().length > 0, `${c.id} cites no source`);
});

test("every concept lights at least one component", () => {
  /* A concept that lights nothing is a row in a table, not a lens — `data/concepts.ts` says so in
     its header, and this is where that promise is kept. */
  for (const c of CONCEPTS) {
    const lens = lensFor(c.id);
    assert.ok(lens.components.size > 0, `${c.part} ${c.name} lights nothing`);
    assert.ok(lens.systems.size > 0, `${c.part} reaches no system`);
    assert.ok(lens.layers.size > 0, `${c.part} reaches no layer`);
  }
});

test("every concept a component claims exists", () => {
  const known = new Set(CONCEPTS.map((c) => c.id));
  for (const c of COMPONENTS) {
    for (const id of c.concepts) {
      assert.ok(known.has(id), `${c.id} carries concept ${id}, which does not exist`);
    }
  }
});

test("every ADR a component cites exists in docs/adr", () => {
  const known = new Set(ADRS.map((a) => a.n));
  for (const c of COMPONENTS) {
    for (const n of c.adrs) assert.ok(known.has(n), `${c.id} cites ADR ${n}, which is not listed`);
  }
});

test("part numbers are unique across the whole model", () => {
  const parts = [
    ...CONCEPTS.map((c) => c.part),
    ...LAYERS.map((l) => l.part),
    ...SYSTEMS.map((s) => s.part),
    ...COMPONENTS.map((c) => c.part),
  ];
  assert.equal(new Set(parts).size, parts.length, "a part number is used twice");
});

test("the layer order is README §3.1's order, surfaces first and contracts last", () => {
  assert.deepEqual([...LAYER_ORDER], [
    "surfaces",
    "channels",
    "lane",
    "harness",
    "core",
    "contracts",
  ]);
});

test("contracts reaches nothing below it — ADR 0002, the contracts import nothing", () => {
  const links = layerLinks("contracts");
  assert.deepEqual(links.down, [], "the bottom layer has a dependency below it");
});

test("the edges that run back up the stack are exactly the declared up edges", () => {
  /* An up edge is a finding, so it is declared (`up: true`) rather than discovered on the margin
     rail. Whether the tree holds an up import the model does not declare is test/edges.test.ts's
     question; this one holds the model to its own flag in both directions. */
  const depth = (id: string): number => {
    const layer = systemById(componentById(id)?.system ?? null)?.layer;
    return LAYER_ORDER.indexOf(layer as (typeof LAYER_ORDER)[number]);
  };
  for (const e of EDGES) {
    const runsUp = depth(e.to) < depth(e.from);
    assert.equal(e.up === true, runsUp, `${e.from}->${e.to}: up is ${e.up}, the layers say ${runsUp}`);
  }
  for (const l of LAYERS) {
    const declared = EDGES.filter(
      (e) => e.up && systemById(componentById(e.from)?.system ?? null)?.layer === l.id,
    ).length;
    const drawn = layerLinks(l.id).up.reduce((n, link) => n + link.weight, 0);
    assert.equal(drawn, declared, `${l.id}'s rail draws ${drawn} up, the model declares ${declared}`);
  }
});

test("derived system edges never leave a system and arrive in the same one", () => {
  for (const e of SYSTEM_EDGES) {
    assert.notEqual(e.from, e.to);
    assert.ok(systemById(e.from) && systemById(e.to));
    assert.ok(e.weight >= 1);
  }
});

test("a layer's lit count never exceeds its component count", () => {
  for (const c of CONCEPTS) {
    const lens = lensFor(c.id);
    for (const l of LAYERS) {
      assert.ok(litInLayer(lens, l.id) <= componentsOfLayer(l.id).length);
    }
  }
});

test("the counts the mast prints are the model's own", () => {
  assert.equal(COUNTS.concepts, CONCEPTS.length);
  assert.equal(COUNTS.systems, SYSTEMS.length);
  assert.equal(COUNTS.components, COMPONENTS.length);
  assert.equal(COUNTS.edges, EDGES.length);
  assert.equal(COUNTS.layers, 6);
  /* The model is allowed to contain things that are designed and not built, and says how many. */
  assert.ok(COUNTS.planned >= 1, "nothing is marked planned — check src/athena/channels/mcp.py");
});

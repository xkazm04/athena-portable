/**
 * THE KIND MAPPING, THE STORY AND THE PROBE — the three places this variant makes a CLAIM about the
 * model rather than a decision about pixels, and therefore the three that can be wrong in a way a
 * screenshot would not show.
 *
 *   1. The closed enum is closed and total: every system has a kind, every kind is used, and every
 *      named exception points at a component the model actually has.
 *   2. The trust boundary's membership is authored and real.
 *   3. The twelve stops name real modules, touch all six layers, and the authored/derived split the
 *      Story Trail draws is the split the edge list actually has.
 *   4. The probe walks the model and nothing else: it finds the route README asserts, refuses one
 *      the model does not carry, and gives the same answer twice.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import { COMPONENTS, COMPONENT_BY_ID, LAYER_ORDER, SYSTEMS } from "../data";
import {
  COMPONENT_KIND,
  KINDS,
  KIND_COUNTS,
  KIND_RULE,
  SYSTEM_KIND,
  TRUST_SYSTEMS,
  kindOfComponent,
  kindOfSystem,
} from "../components/atlas/variants/archify/kinds";
import { BEATS, CHAPTERS, HOPS, TRAIL_COUNTS, beatState, chapterOf, deltaOf } from "../components/atlas/variants/archify/story";
import { COMPONENT_GRAPH, SYSTEM_GRAPH, probe, receiptOf } from "../components/atlas/variants/archify/path";

test("the kind mapping is total: every system has one, and it is a member of the closed set", () => {
  for (const s of SYSTEMS) {
    const kind = SYSTEM_KIND[s.id];
    assert.ok(kind, `${s.id} (${s.name}) has no kind — add it to SYSTEM_KIND with its reason`);
    assert.ok(KINDS.includes(kind), `${s.id} has a kind outside the closed set`);
  }
  assert.equal(
    Object.keys(SYSTEM_KIND).length,
    SYSTEMS.length,
    "SYSTEM_KIND names something that is not a system",
  );
});

test("all seven kinds are used, and each has a rule written down", () => {
  const used = new Set(SYSTEMS.map((s) => kindOfSystem(s.id)));
  for (const kind of KINDS) {
    assert.ok(used.has(kind), `${kind} is declared and never used — a legend entry with no members`);
    assert.ok(KIND_RULE[kind].length > 0, `${kind} has no rule`);
  }
});

test("every component-level exception points at a component the model has", () => {
  for (const id of Object.keys(COMPONENT_KIND)) {
    assert.ok(COMPONENT_BY_ID.has(id), `${id} is an exception for a component that does not exist`);
  }
  /* And an exception must actually differ from the system it overrides, or it is noise. */
  for (const [id, kind] of Object.entries(COMPONENT_KIND)) {
    const system = COMPONENT_BY_ID.get(id)!.system;
    assert.notEqual(kind, kindOfSystem(system), `${id}'s exception says what its system already says`);
  }
});

test("the counted legend counts the same components the mapping assigns", () => {
  for (const row of KIND_COUNTS) {
    const components = COMPONENTS.filter((c) => kindOfComponent(c) === row.kind).length;
    assert.equal(row.components, components, `${row.kind}: the legend and the mapping disagree`);
  }
  assert.equal(
    KIND_COUNTS.reduce((n, r) => n + r.systems, 0),
    SYSTEMS.length,
  );
});

test("the trust boundary is authored, real, and crosses more than one layer", () => {
  const layers = new Set<string>();
  for (const id of TRUST_SYSTEMS) {
    const system = SYSTEMS.find((s) => s.id === id);
    assert.ok(system, `${id} is in the trust boundary and not in the model`);
    layers.add(system.layer);
  }
  assert.ok(layers.size >= 3, "a trust boundary inside one layer would not be worth drawing");
});

test("every stop names a real component, and the twelve touch all six layers", () => {
  const layers = new Set<string>();
  for (const b of BEATS) {
    assert.ok(COMPONENT_BY_ID.has(b.part), `stop ${b.index} names ${b.part}, which is not a module`);
    layers.add(b.layer);
  }
  for (const layer of LAYER_ORDER) {
    assert.ok(layers.has(layer), `the turn never enters ${layer}`);
  }
});

test("the Story Trail's authored/derived split is the edge list's own", () => {
  assert.equal(TRAIL_COUNTS.hops, BEATS.length - 1);
  assert.equal(TRAIL_COUNTS.authored + TRAIL_COUNTS.derived, TRAIL_COUNTS.hops);
  assert.ok(TRAIL_COUNTS.authored > 0, "not one hop of the turn is an authored edge — check the ids");
  assert.ok(
    TRAIL_COUNTS.derived > 0,
    "every hop is authored — then the derived dash is dead code and should go",
  );
  for (const hop of HOPS) {
    assert.equal(hop.authored, BEATS[hop.index]!.authored);
  }
});

test("the chapters partition the twelve stops, in order, with notes inside archify's 140", () => {
  const seen = CHAPTERS.flatMap((c) => c.beats.map((b) => b.index));
  assert.deepEqual(seen, [...BEATS.keys()], "the chapters do not cover the stops exactly once");
  assert.ok(CHAPTERS.length <= 5, "archify caps a story at five chapters");
  for (const c of CHAPTERS) {
    assert.ok(c.note.length <= 140, `${c.id}'s note is ${c.note.length} characters`);
    assert.ok(c.focus.length > 0);
  }
  for (const b of BEATS) {
    assert.ok(CHAPTERS[chapterOf(b.index)]!.beats.some((x) => x.index === b.index));
  }
});

test("the chapter delta is a real handoff: the first chapter brings everything in", () => {
  const first = deltaOf(0);
  assert.equal(first.stay, 0);
  assert.equal(first.leave, 0);
  assert.ok(first.enter > 0);
  assert.equal(beatState(0, 3), "past");
  assert.equal(beatState(3, 3), "active");
  assert.equal(beatState(4, 3), "next");
});

test("PATH walks the model and refuses what the model does not carry", () => {
  const down = probe(COMPONENT_GRAPH, "cmp-mod-panel", "cmp-ledger");
  assert.equal(down.found, true, "the panel must reach the ledger — that is the turn");
  assert.equal(down.nodes[0], "cmp-mod-panel");
  assert.equal(down.nodes[down.nodes.length - 1], "cmp-ledger");
  assert.match(receiptOf(down), /shortest authored route/);

  /* ADR 0002: the contracts import nothing. Nothing may be reachable FROM one. */
  const up = probe(COMPONENT_GRAPH, "cmp-c-harness", "cmp-mod-panel");
  assert.equal(up.found, false, "the contracts reach nothing — a route out of one is a model bug");
  assert.match(receiptOf(up), /no authored route/);
});

test("PATH is deterministic and works on the derived system graph too", () => {
  const a = probe(SYSTEM_GRAPH, "sys-panel", "sys-record");
  const b = probe(SYSTEM_GRAPH, "sys-panel", "sys-record");
  assert.deepEqual(a, b, "two probes of the same pair gave different routes");
  assert.equal(a.found, true);
  assert.equal(a.hops, a.nodes.length - 1);
});

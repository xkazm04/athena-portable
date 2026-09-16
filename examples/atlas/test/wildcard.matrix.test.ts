/**
 * THE WILDCARD'S FIELD: that it is a matrix, that it is complete, and that its order is the
 * argument it claims to be.
 *
 * Every assertion names a property, never a value the layout happens to have today. A test that
 * says `marks.length === 113` fails the day an edge is added to the model, which is the wrong day
 * to fail; a test that says every edge in the model lands on exactly one mark fails only when the
 * field has stopped being a picture of the model.
 *
 * The properties, in the order the round-5 brief asks for them:
 *
 *   1. EVERY MODEL ELEMENT IS PLACED. All 68 components are on the axis, once each; all 120 edges
 *      land on a mark; no mark is outside the field.
 *   2. NO OVERLAPS. Cells tile the field exactly: contiguous, non-overlapping, gapless. A matrix
 *      whose rows overlap is not a matrix.
 *   3. BAND MEMBERSHIP. Every component's row is inside its own layer's span and inside no other's,
 *      the spans are in README §3.1's order, and a system's rows never straddle two layers.
 *   4. THE ORDER IS THE ARGUMENT. A mark's side of the diagonal agrees with the direction its edge
 *      runs through the stack — which is the one claim this whole direction rests on.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import { COMPONENTS, EDGES, LAYER_ORDER, SYSTEMS, componentById, systemById } from "../data";
import {
  AXIS_IDS,
  BOUNDS,
  FIELD,
  LAYER_CELLS,
  LAYER_SPANS,
  M,
  MARKS,
  MATRIX_COUNTS,
  MAX_DEGREE,
  N,
  REACHES,
  SPAN,
  SYSTEM_CELLS,
  SYSTEM_SPANS,
  blockRect,
  cellRect,
  centreOf,
  colRect,
  contains,
  depthOf,
  diagonalCentre,
  idAt,
  inDegree,
  indexOf,
  layerAt,
  layerSpan,
  markAt,
  marksInCol,
  marksInRow,
  outDegree,
  pairRect,
  rowRect,
  systemSpan,
  UPWARD_ZONES,
  ZONE_BREACHES,
  type Rect,
} from "../components/atlas/variants/wildcard/matrix";

const overlaps = (a: Rect, b: Rect): boolean =>
  a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

const inside = (outer: Rect, inner: Rect): boolean =>
  inner.x >= outer.x &&
  inner.y >= outer.y &&
  inner.x + inner.w <= outer.x + outer.w &&
  inner.y + inner.h <= outer.y + outer.h;

/* ------------------------------ 1. every model element is placed ------------------------------ */

test("the axis carries every component in the model, exactly once", () => {
  assert.equal(N, COMPONENTS.length);
  assert.equal(new Set(AXIS_IDS).size, N, "a component appears twice on the axis");
  for (const c of COMPONENTS) {
    assert.ok(indexOf(c.id) >= 0, `${c.id} is not on the axis`);
    assert.equal(idAt(indexOf(c.id)), c.id);
  }
});

test("the axis carries every system, and each system's rows are contiguous", () => {
  assert.equal(SYSTEM_SPANS.length, SYSTEMS.length);
  for (const span of SYSTEM_SPANS) {
    assert.ok(span.count > 0, `${span.id} has an empty span`);
    for (let i = span.start; i < span.start + span.count; i += 1) {
      const id = idAt(i);
      assert.ok(id, `no component at row ${i}`);
      assert.equal(componentById(id)?.system, span.id, `row ${i} is not in ${span.id}`);
    }
  }
});

test("every edge in the model lands on exactly one mark, and no mark invents an edge", () => {
  const seen = new Set<string>();
  for (const e of EDGES) {
    const key = `${indexOf(e.from)}:${indexOf(e.to)}`;
    const mark = markAt(indexOf(e.from), indexOf(e.to));
    assert.ok(mark, `edge ${e.from} -> ${e.to} has no mark`);
    assert.ok(mark.kinds.includes(e.kind), `mark ${key} does not carry ${e.kind}`);
    seen.add(key);
  }
  assert.equal(MARKS.length, seen.size, "a mark exists that no edge put there");
  /* A mark is a POSITION, not an edge: two modules related two ways share one. */
  const kinds = MARKS.reduce((n, m) => n + m.kinds.length, 0);
  assert.ok(kinds <= EDGES.length, "more kinds on the field than edges in the model");
  assert.ok(MARKS.length <= EDGES.length);
});

test("every mark is inside the field, and the field is inside the bounds", () => {
  for (const m of MARKS) {
    assert.ok(m.row >= 0 && m.row < N, `mark ${m.id} has no row`);
    assert.ok(m.col >= 0 && m.col < N, `mark ${m.id} has no column`);
    assert.ok(inside(FIELD, cellRect(m.row, m.col)), `mark ${m.id} falls off the field`);
  }
  assert.ok(inside(BOUNDS, FIELD));
  assert.equal(FIELD.w, SPAN);
  assert.equal(FIELD.h, SPAN);
  /* The field is centred on the world origin, so the diagonal passes through it. The camera's
     `pan` is the negative of the world point under the middle of the frame only if this holds. */
  assert.equal(centreOf(FIELD).x, 0);
  assert.equal(centreOf(FIELD).y, 0);
  assert.equal(centreOf(BOUNDS).x, 0);
  assert.equal(centreOf(BOUNDS).y, 0);
});

/* ---------------------------------------- 2. no overlaps ---------------------------------------- */

test("cells tile the field: contiguous, gapless, and no two overlap", () => {
  for (let i = 0; i < N - 1; i += 1) {
    const here = cellRect(i, i);
    const next = cellRect(i + 1, i + 1);
    assert.equal(here.x + here.w, next.x, `column ${i} leaves a gap`);
    assert.equal(here.y + here.h, next.y, `row ${i} leaves a gap`);
    assert.ok(!overlaps(here, next));
  }
  assert.equal(cellRect(0, 0).x, FIELD.x);
  assert.equal(cellRect(N - 1, N - 1).x + M.cell, FIELD.x + SPAN);
});

test("no two rows overlap, and no two columns overlap", () => {
  for (let i = 0; i < N; i += 1) {
    for (let j = i + 1; j < N; j += 1) {
      assert.ok(!overlaps(rowRect(i), rowRect(j)), `rows ${i} and ${j} overlap`);
      assert.ok(!overlaps(colRect(i), colRect(j)), `columns ${i} and ${j} overlap`);
    }
  }
});

test("no two layer blocks overlap, and no two system blocks overlap", () => {
  const blocks = LAYER_SPANS.map(blockRect);
  for (let i = 0; i < blocks.length; i += 1) {
    for (let j = i + 1; j < blocks.length; j += 1) {
      assert.ok(!overlaps(blocks[i]!, blocks[j]!), `layer blocks ${i} and ${j} overlap`);
    }
  }
  const sys = SYSTEM_SPANS.map(blockRect);
  for (let i = 0; i < sys.length; i += 1) {
    for (let j = i + 1; j < sys.length; j += 1) {
      assert.ok(!overlaps(sys[i]!, sys[j]!), `system blocks ${i} and ${j} overlap`);
    }
  }
});

test("an aggregate block is exactly the rows of one span crossed with the columns of another", () => {
  for (const agg of [...LAYER_CELLS, ...SYSTEM_CELLS]) {
    assert.ok(inside(FIELD, agg.rect), `${agg.id} falls off the field`);
    assert.ok(agg.count > 0, `${agg.id} is an empty block on the field`);
    assert.ok(agg.weight > 0 && agg.weight <= 1, `${agg.id} has a weight outside (0, 1]`);
  }
  for (const a of LAYER_SPANS) {
    for (const b of LAYER_SPANS) {
      const r = pairRect(a, b);
      assert.equal(r.w, b.count * M.cell);
      assert.equal(r.h, a.count * M.cell);
    }
  }
});

/* -------------------------------------- 3. band membership -------------------------------------- */

test("the layer spans are in README order, contiguous, and cover the axis exactly once", () => {
  assert.deepEqual(
    LAYER_SPANS.map((s) => s.id),
    LAYER_ORDER.filter((id) => LAYER_SPANS.some((s) => s.id === id)),
  );
  let cursor = 0;
  for (const span of LAYER_SPANS) {
    assert.equal(span.start, cursor, `${span.id} does not start where the last layer ended`);
    cursor += span.count;
  }
  assert.equal(cursor, N, "the layer spans do not cover the axis");
});

test("every row is in its own layer's span and in no other's", () => {
  for (let i = 0; i < N; i += 1) {
    const id = idAt(i)!;
    const layer = systemById(componentById(id)?.system ?? "")?.layer;
    const mine = layerAt(i);
    assert.ok(mine, `row ${i} is in no layer`);
    assert.equal(mine.id, layer, `row ${i} (${id}) is filed under the wrong layer`);
    for (const span of LAYER_SPANS) {
      const within = i >= span.start && i < span.start + span.count;
      assert.equal(within, span.id === layer, `row ${i} is inside ${span.id} as well`);
    }
  }
});

test("a system's rows never straddle two layers, and its block sits inside its layer's block", () => {
  for (const span of SYSTEM_SPANS) {
    const layer = systemById(span.id)?.layer ?? "";
    const parent = layerSpan(layer);
    assert.ok(parent, `${span.id} has no layer span`);
    assert.ok(span.start >= parent.start, `${span.id} starts before its layer`);
    assert.ok(
      span.start + span.count <= parent.start + parent.count,
      `${span.id} runs past its layer`,
    );
    assert.ok(inside(blockRect(parent), blockRect(span)));
  }
});

test("systemSpan and layerSpan answer for every id the model has, and for nothing else", () => {
  for (const s of SYSTEMS) assert.ok(systemSpan(s.id), `no span for ${s.id}`);
  for (const l of LAYER_ORDER) assert.ok(layerSpan(l), `no span for ${l}`);
  assert.equal(systemSpan("sys-nothing"), null);
  assert.equal(layerSpan(null), null);
});

/* ----------------------------------- 4. the order is the argument ----------------------------------- */

test("a mark's side of the diagonal agrees with the way its edge runs through the stack", () => {
  for (const m of MARKS) {
    const from = depthOf(systemById(componentById(m.from)?.system ?? "")?.layer ?? "");
    const to = depthOf(systemById(componentById(m.to)?.system ?? "")?.layer ?? "");
    if (m.sense === "down") {
      assert.ok(to > from, `${m.id} claims to run down but does not`);
      assert.ok(m.col > m.row, `${m.id} runs down the stack but sits left of the diagonal`);
    } else if (m.sense === "up") {
      assert.ok(to < from, `${m.id} claims to reach up but does not`);
      assert.ok(m.col < m.row, `${m.id} reaches up the stack but sits right of the diagonal`);
    } else {
      assert.equal(to, from, `${m.id} claims to be flat but crosses a layer`);
    }
  }
});

test("every reach back up the stack is on the list, and the list is only reaches", () => {
  assert.deepEqual(
    REACHES.map((m) => m.id),
    MARKS.filter((m) => m.sense === "up").map((m) => m.id),
  );
  assert.equal(MATRIX_COUNTS.reaches, REACHES.length);
  /* The direction's whole claim: a reach is rare and findable. If the architecture ever became a
     web, this number would climb and the picture would say so — so the test pins the SHAPE (a
     small minority), not the number. */
  assert.ok(REACHES.length < MARKS.length / 2, "more than half the field reaches back up the stack");
});

test("the lower-left triangle is the zone the architecture says must be empty", () => {
  /* Fifteen blocks: every ordered pair of layers where the row's layer is BELOW the column's. */
  const pairs = LAYER_SPANS.length;
  assert.equal(UPWARD_ZONES.length, (pairs * (pairs - 1)) / 2);
  for (const z of UPWARD_ZONES) {
    assert.ok(depthOf(z.from) > depthOf(z.to), `${z.id} is not an upward pair`);
    assert.ok(inside(FIELD, z.rect));
    /* Strictly left of the diagonal: the whole block, not merely its middle. */
    assert.ok(
      z.rect.x + z.rect.w <= blockRect(layerSpan(z.from)!).x,
      `${z.id} is not left of its own layer block`,
    );
  }
  /* The zones and the reaches are two readings of one fact and must agree. */
  assert.equal(ZONE_BREACHES, REACHES.length, "a reach is outside the zone drawn for it");
  assert.equal(MATRIX_COUNTS.breaches, ZONE_BREACHES);
});

test("the aggregates account for every mark, at both grains", () => {
  const layers = LAYER_CELLS.reduce((n, a) => n + a.count, 0);
  const systems = SYSTEM_CELLS.reduce((n, a) => n + a.count, 0);
  assert.equal(layers, MARKS.length, "the 6 x 6 grain loses marks");
  assert.equal(systems, MARKS.length, "the 19 x 19 grain loses marks");
});

test("the degrees are the marks, counted the other way", () => {
  let out = 0;
  let into = 0;
  for (let i = 0; i < N; i += 1) {
    assert.equal(
      outDegree(i),
      marksInRow(i).reduce((n, m) => n + m.kinds.length, 0),
      `row ${i} disagrees with its out-degree`,
    );
    assert.equal(
      inDegree(i),
      marksInCol(i).reduce((n, m) => n + m.kinds.length, 0),
      `column ${i} disagrees with its in-degree`,
    );
    out += outDegree(i);
    into += inDegree(i);
  }
  assert.equal(out, into, "the field's out-degree and in-degree disagree");
  assert.ok(MAX_DEGREE >= 1);
});

test("the diagonal cell of a component contains its own centre — the inverse's whole basis", () => {
  for (let i = 0; i < N; i += 1) {
    assert.ok(contains(cellRect(i, i), diagonalCentre(i)), `row ${i}'s diagonal is not its own`);
  }
});

test("the headline counts are the model's, not a second copy of it", () => {
  assert.equal(MATRIX_COUNTS.axis, COMPONENTS.length);
  assert.equal(MATRIX_COUNTS.edges, EDGES.length);
  assert.equal(MATRIX_COUNTS.systems, SYSTEMS.length);
  assert.equal(MATRIX_COUNTS.cells, N * N);
  /* Honest about density: the field is mostly empty, and the number says so out loud. */
  assert.ok(MATRIX_COUNTS.density < 10, "the field is denser than a matrix can usefully be");
});

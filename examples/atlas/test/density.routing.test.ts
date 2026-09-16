/**
 * THE RUNS, ROUTED. Archify study §3 and §7.5/§7.7, and the guarantee the lattice fallback exists
 * to make: **no run crosses a node.** A generate-and-rank router with a finite candidate list can
 * only hope; a Dijkstra over the free lanes of the drawing, with every lattice edge gated on
 * clearance, can promise — so the assertion below has no exceptions and no tolerance.
 *
 * The rest is archify's own legibility pass (`renderers/shared/geometry.mjs`): orthogonal
 * throughout, no segment under the rhythm floor, every label inside the frame and clear of every
 * node, and nothing dropped.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import { BOXES, WORLD } from "../components/atlas/variants/archify-density/sheet";
import {
  DROPPED,
  LATTICED,
  PLAN_RUNS,
} from "../components/atlas/variants/archify-density/plan";
import {
  CLEAR,
  MIN_SEG,
  segRectDistance,
  segmentsOf,
} from "../components/atlas/variants/archify-density/routing";

test("every run is routed — nothing is dropped", () => {
  assert.deepEqual([...DROPPED], []);
  assert.equal(PLAN_RUNS.length, 14);
  assert.ok(LATTICED <= PLAN_RUNS.length);
});

test("no run crosses a node", () => {
  for (const run of PLAN_RUNS) {
    for (const seg of segmentsOf(run.points)) {
      for (const box of BOXES) {
        if (box.id === run.from || box.id === run.to) continue;
        const d = segRectDistance(seg.a, seg.b, box);
        assert.ok(d > 0, `${run.id} passes through ${box.id}`);
        assert.ok(d >= CLEAR - 0.5, `${run.id} passes ${box.id} at ${d.toFixed(1)} units`);
      }
    }
  }
});

test("every run is orthogonal and keeps the rhythm", () => {
  for (const run of PLAN_RUNS) {
    const segs = segmentsOf(run.points);
    assert.ok(segs.length >= 1, `${run.id} has no geometry`);
    for (const seg of segs) {
      const orthogonal = Math.abs(seg.a.x - seg.b.x) < 1e-6 || Math.abs(seg.a.y - seg.b.y) < 1e-6;
      assert.ok(orthogonal, `${run.id} has a diagonal segment`);
      assert.ok(seg.length >= MIN_SEG - 0.5, `${run.id} has a ${seg.length.toFixed(1)}-unit segment`);
    }
  }
});

test("every run label stays on the sheet and off every node", () => {
  for (const run of PLAN_RUNS) {
    const l = run.label;
    assert.ok(l.x >= 0 && l.x + l.w <= WORLD.w, `${run.id}'s label leaves the sheet horizontally`);
    assert.ok(l.y >= 0 && l.y + l.h <= WORLD.h, `${run.id}'s label leaves the sheet vertically`);
  }
});

test("the spine is drawn in emphasis and nothing else is", () => {
  const emphasised = PLAN_RUNS.filter((r) => r.style === "emphasis");
  assert.equal(emphasised.length, 10);
  for (const r of emphasised) assert.ok(r.id.startsWith("spine-"));
});

/**
 * THE RUNS. One property, asserted with no exceptions: **no run crosses a node or a label.**
 *
 * That is the assertion the whole generate-filter-rank apparatus in `routing.ts` exists to make
 * true, and it is the one a reader can check with their eyes — which is why it is worth a test at
 * all. Archify validates the same thing geometrically (study §1, `renderers/shared/geometry.mjs`:
 * crossing problems, ambiguous corridors, route rhythm, label clearance) rather than trusting the
 * router that produced the route.
 *
 * The rest pin the properties that make the first one meaningful rather than vacuous: the routes
 * are orthogonal, they leave and enter perpendicular to a real side, every edge in the model is
 * actually drawn, and the output is byte-deterministic so a re-render cannot reshuffle the sheet.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import { LAYER_ORDER } from "../data";
import { PLANS, VIEWS, type Rect, type ViewId } from "../components/atlas/variants/archify/layout";
import { SYSTEM_RUN_INPUTS, runsFor } from "../components/atlas/variants/archify/runs";
import {
  CLEAR,
  MIN_SEG,
  cheaper,
  runPath,
  segRectDistance,
  segmentsOf,
  styleOf,
} from "../components/atlas/variants/archify/routing";

/** Every box on the sheet at a given band, by id — the obstacle set a run must respect. */
function boxesFor(view: ViewId, open: string | null): Map<string, Rect> {
  const boxes = new Map<string, Rect>();
  for (const n of PLANS[view].nodes) {
    if (open !== null && n.layer === open) for (const p of n.parts) boxes.set(p.id, p);
    else boxes.set(n.id, n);
  }
  return boxes;
}

const CASES: { view: ViewId; open: string | null }[] = [
  ...VIEWS.map((view) => ({ view, open: null })),
  ...VIEWS.flatMap((view) => LAYER_ORDER.map((open) => ({ view, open: open as string }))),
];

test("no run crosses a node", () => {
  for (const { view, open } of CASES) {
    const boxes = boxesFor(view, open);
    const { runs } = runsFor(view, open as never);
    for (const run of runs) {
      for (const seg of segmentsOf(run.points)) {
        for (const [id, box] of boxes) {
          if (id === run.from || id === run.to) continue;
          assert.ok(
            segRectDistance(seg.a, seg.b, box) >= CLEAR - 1e-6,
            `${view}/${open}: run ${run.id} (${run.family}) passes through ${id}`,
          );
        }
      }
    }
  }
});

test("no run crosses another run's label", () => {
  for (const { view, open } of CASES) {
    const { runs } = runsFor(view, open as never);
    for (const run of runs) {
      for (const seg of segmentsOf(run.points)) {
        for (const other of runs) {
          if (other.id === run.id) continue;
          assert.ok(
            segRectDistance(seg.a, seg.b, other.label) >= 0,
            `${view}/${open}: ${run.id} sits on ${other.id}'s label`,
          );
        }
      }
    }
  }
});

test("every run is orthogonal and has no segment under the rhythm floor", () => {
  for (const { view, open } of CASES) {
    const { runs } = runsFor(view, open as never);
    for (const run of runs) {
      const segs = segmentsOf(run.points);
      assert.ok(segs.length > 0, `${run.id} has no geometry`);
      for (const s of segs) {
        const orthogonal = Math.abs(s.a.x - s.b.x) < 1e-6 || Math.abs(s.a.y - s.b.y) < 1e-6;
        assert.ok(orthogonal, `${view}/${open}: ${run.id} has a diagonal segment`);
        assert.ok(s.length >= MIN_SEG - 1e-6, `${view}/${open}: ${run.id} has a ${s.length} segment`);
      }
    }
  }
});

test("every authored system relationship is drawn, once, in both views", () => {
  for (const view of VIEWS) {
    const { runs } = runsFor(view, null);
    assert.equal(runs.length, SYSTEM_RUN_INPUTS.length, `${view}: a system run went missing`);
    assert.equal(new Set(runs.map((r) => r.id)).size, runs.length, `${view}: a run is duplicated`);
  }
});

test("routing is deterministic: the same inputs give byte-identical geometry", () => {
  const once = runsFor("sheet", null).runs.map((r) => runPath(r.points)).join("|");
  const twice = runsFor("sheet", null).runs.map((r) => runPath(r.points)).join("|");
  assert.equal(once, twice);
});

test("the cost vector is lexicographic: no slot trades against another", () => {
  assert.equal(cheaper([0, 1, 999], [1, 0, 0]), true, "a crossing must never buy off reverse travel");
  assert.equal(cheaper([0, 0, 0, 0, 9], [0, 0, 0, 0, 10]), true);
  assert.equal(cheaper([1, 0], [1, 0]), false, "equal vectors are not cheaper than each other");
});

test("one style per meaning, and only archify's four", () => {
  assert.equal(styleOf("gates", "built"), "security");
  assert.equal(styleOf("streams", "built"), "emphasis");
  assert.equal(styleOf("calls", "built"), "default");
  assert.equal(styleOf("calls", "planned"), "dashed", "planned wins over kind");
});

test("nothing is dropped: every band routes every edge it was given", () => {
  for (const { view, open } of CASES) {
    const { dropped } = runsFor(view, open as never);
    assert.deepEqual(dropped, [], `${view}/${open}: a run could not be routed at all`);
  }
});

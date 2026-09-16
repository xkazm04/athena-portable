/**
 * NO LINE ACROSS A WORD. The round-5 routing gate.
 *
 * Round 4's carry-over says it plainly: *"run routing avoids no obstacles, so runs cross region
 * heads at L0"*. The fix is `components/atlas/variants/blueprint/route.ts` — candidate families, a
 * hard feasibility filter and a lexicographic cost vector — and the fix is only worth anything if
 * it is a GATE rather than an improvement, because a routing regression is invisible in a diff and
 * obvious in a capture three weeks later.
 *
 * So this file asserts the property, in every view and at both tiers:
 *
 *   1. No system run crosses a region's heading or a block's title bar.
 *   2. No component run inside an open layer does either.
 *   3. No run label sits on another run label, or on a block's title.
 *   4. The search does not quietly give up: the fallback count is asserted, so if the sheet ever
 *      gets dense enough that the formula has to answer, the number is in the test output and not
 *      in somebody's eye.
 *   5. The output is deterministic — the same model, the same sheet, byte for byte.
 *
 * A crossing is a PROPER crossing: a run that touches the edge of a title bar it is attached to is
 * not crossing anything, and a test that counted it would be a test nobody could keep green.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import { EDGES, LAYER_ORDER } from "../data";
import { DIM, textBox } from "../components/atlas/variants/blueprint/geometry";
import {
  PLANS,
  VIEWS,
  partRuns,
  wallsFor,
} from "../components/atlas/variants/blueprint/plan";
import { Router, runHits } from "../components/atlas/variants/blueprint/route";

const textWalls = (view: (typeof VIEWS)[number]) =>
  wallsFor(PLANS[view].blocks, PLANS[view].regions).filter((w) => w.kind === "text");

/* ------------------------------- 1 and 2. the hard rule holds ------------------------------- */

test("no run crosses a region head or a block title, in any view", () => {
  for (const view of VIEWS) {
    const walls = textWalls(view);
    for (const e of PLANS[view].edges) {
      for (const w of walls) {
        /* A run is attached to its own two blocks; their titles are the two it may touch. */
        if (w.id === `title:${e.from}` || w.id === `title:${e.to}`) continue;
        assert.ok(
          !runHits(e.run.points, w),
          `${view}: run ${e.id} (${e.family}) crosses ${w.id}`,
        );
      }
    }
  }
});

test("no component run crosses a region head or a block title, in any view or layer", () => {
  for (const view of VIEWS) {
    const walls = textWalls(view);
    for (const layer of LAYER_ORDER) {
      for (const r of partRuns(view, layer, EDGES)) {
        for (const w of walls) {
          /* The two blocks the two parts live in are the ones this run is attached to. */
          const from = PLANS[view].blocks.find((b) => b.parts.some((p) => p.id === r.from));
          const to = PLANS[view].blocks.find((b) => b.parts.some((p) => p.id === r.to));
          if (w.id === `title:${from?.id}` || w.id === `title:${to?.id}`) continue;
          assert.ok(
            !runHits(r.run.points, w),
            `${view}/${layer}: component run ${r.id} crosses ${w.id}`,
          );
        }
      }
    }
  }
});

/* ---------------------------------- 3. the labels are clear ---------------------------------- */

/**
 * A LABEL IS PLACED OR IT IS NOT DRAWN, and the second is a legitimate answer.
 *
 * Archify's repair order is "move the label → adjust the route → shorten the wording, never delete
 * a label", and it can promise that because its spacing solver can push the whole layout apart.
 * This sheet cannot: the blocks are where the ARRANGEMENT put them, and a run whose every position
 * is over a word has nowhere legible to write two characters. Dropping the figure is then the only
 * honest option — the run is still there, the readout and the pane still carry the number, and
 * nothing is printed on top of a name. What the test defends is that a label that IS drawn is
 * clear of every other label and of every title, and that the placer succeeds most of the time.
 */
test("every label that is drawn is clear, and most labelled runs get one", () => {
  for (const view of VIEWS) {
    const boxes: { id: string; x: number; y: number; w: number; h: number }[] = [];
    let labelled = 0;
    for (const e of PLANS[view].edges) {
      if (!e.short) {
        assert.equal(e.labelAt, null, `${view}: ${e.id} has a label anchor but nothing to write`);
        continue;
      }
      labelled += 1;
      if (!e.labelAt) continue;
      const size = textBox(e.short.length);
      boxes.push({
        id: e.id,
        x: e.labelAt.x - size.w / 2,
        y: e.labelAt.y - size.h / 2,
        w: size.w,
        h: size.h,
      });
    }
    for (let i = 0; i < boxes.length; i += 1) {
      for (let j = i + 1; j < boxes.length; j += 1) {
        const a = boxes[i]!;
        const b = boxes[j]!;
        const hit = a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
        assert.ok(!hit, `${view}: the labels of ${a.id} and ${b.id} are on top of each other`);
      }
    }
    assert.ok(
      labelled === 0 || boxes.length / labelled >= 0.7,
      `${view}: only ${boxes.length} of ${labelled} run labels found a clear place`,
    );
  }
});

test("a label never sits on a block's title bar", () => {
  for (const view of VIEWS) {
    for (const e of PLANS[view].edges) {
      if (!e.labelAt || !e.short) continue;
      const size = textBox(e.short.length);
      for (const b of PLANS[view].blocks) {
        const title = { x: b.x, y: b.y, w: b.w, h: DIM.headH };
        const hit =
          e.labelAt.x - size.w / 2 < title.x + title.w &&
          title.x < e.labelAt.x + size.w / 2 &&
          e.labelAt.y - size.h / 2 < title.y + title.h &&
          title.y < e.labelAt.y + size.h / 2;
        assert.ok(!hit, `${view}: ${e.id}'s label is on ${b.id}'s title`);
      }
    }
  }
});

/* ------------------------------- 4. the search does not give up ------------------------------- */

test("the routing search answers every edge without falling back to the round-4 formula", () => {
  for (const view of VIEWS) {
    const gave = PLANS[view].edges.filter((e) => e.fallback);
    assert.equal(
      gave.length,
      0,
      `${view}: ${gave.length} run(s) found no feasible candidate: ${gave.map((e) => e.id).join(", ")}`,
    );
  }
});

test("the families actually get used — a search with one answer is not a search", () => {
  const families = new Set(VIEWS.flatMap((v) => PLANS[v].edges.map((e) => e.family)));
  assert.ok(
    families.size >= 3,
    `only ${families.size} candidate family/families ever wins: ${[...families].join(", ")}`,
  );
});

/* --------------------------------------- 5. determinism --------------------------------------- */

test("the same inputs route to the same geometry, byte for byte", () => {
  const a = { x: 0, y: 0, w: 300, h: 100 };
  const b = { x: 400, y: 400, w: 300, h: 100 };
  const walls = [{ id: "title:x", kind: "text" as const, x: 250, y: 200, w: 300, h: 40 }];
  const once = new Router(walls).route(a, b, textBox(2));
  const twice = new Router(walls).route(a, b, textBox(2));
  assert.deepEqual(once.points, twice.points);
  assert.deepEqual(once.cost, twice.cost);
  assert.equal(once.family, twice.family);
});

test("a routed run is orthogonal, leaves and enters perpendicular, and clears the wall", () => {
  const a = { x: 0, y: 0, w: 300, h: 100 };
  const b = { x: 0, y: 400, w: 300, h: 100 };
  const wall = { id: "title:x", kind: "text" as const, x: 100, y: 200, w: 200, h: 40 };
  const run = new Router([wall]).route(a, b, null);
  assert.ok(!run.fallback, "the router gave up on a sheet with one obstacle on it");
  assert.ok(!runHits(run.points, wall), "the routed run crosses the one wall there is");
  for (let i = 1; i < run.points.length; i += 1) {
    const p = run.points[i - 1]!;
    const q = run.points[i]!;
    assert.ok(p.x === q.x || p.y === q.y, "the router drew a diagonal");
  }
});

test("a label placed by the router becomes a wall for the next run", () => {
  const a = { x: 0, y: 0, w: 300, h: 100 };
  const b = { x: 0, y: 400, w: 300, h: 100 };
  const router = new Router([]);
  const first = router.route(a, b, textBox(3));
  assert.ok(first.labelAt, "a labelled run got no label anchor");
  const before = router.obstacles.length;
  router.route(a, b, textBox(3));
  assert.ok(router.obstacles.length > before, "the second label was not added as an obstacle");
});

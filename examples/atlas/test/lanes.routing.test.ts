/**
 * THE GRID'S GEOMETRY AND THE RUNS ON IT — checked for all four plans, not just the one on screen.
 *
 *   1. No two nodes overlap, in any plan. A drawing where two boxes sit on each other is not one.
 *   2. Every run is feasible by archify's own hard predicate: orthogonal, perpendicular at both
 *      ends, no segment under 9, no interior turn under 17, clearing every unrelated node by 11,
 *      with a label that clears every node when it is shown.
 *   3. ZERO CROSSINGS BETWEEN A `main` RUN AND THE `error` RUN — the success criterion study
 *      Part 2 §5 names for this proposal, stated as a number.
 *   4. Home is scale 1 and the authored world fits a 1440×900 reading column at it, which is the
 *      whole of the round-5 style correction.
 *   5. Every label a plan suppresses is shown by the plan that opens its phase, so "the label
 *      stands down" is always temporary and never a deletion.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import {
  GRID,
  NODE_H,
  NODE_W,
  overlaps,
  planOf,
  PLANS,
} from "../components/atlas/variants/archify-lanes/geometry";
import {
  allCrossings,
  defectsOf,
  mainErrorCrossings,
  routesFor,
} from "../components/atlas/variants/archify-lanes/routing";
import { EDGE_BY_ID, EDGES, PHASES } from "../components/atlas/variants/archify-lanes/workflow";
import { HOME_MAX, HOME_MIN, homeZoom } from "../components/atlas/variants/archify-lanes/poses";

const PLAN_KEYS = ["closed", ...PHASES.map((p) => p.id)];

test("no two nodes overlap, in any plan", () => {
  for (const key of PLAN_KEYS) {
    const nodes = PLANS[key]!.nodes;
    for (let i = 0; i < nodes.length; i += 1) {
      for (let j = i + 1; j < nodes.length; j += 1) {
        assert.equal(
          overlaps(nodes[i]!, nodes[j]!),
          false,
          `${key}: ${nodes[i]!.id} overlaps ${nodes[j]!.id}`,
        );
      }
    }
  }
});

test("the node is a fixed unit: 130 x 56, every node, every plan", () => {
  for (const key of PLAN_KEYS) {
    for (const n of PLANS[key]!.nodes) {
      assert.equal(n.w, NODE_W, `${key}: ${n.id} is not ${NODE_W} wide`);
      assert.equal(n.h, NODE_H, `${key}: ${n.id} is not ${NODE_H} tall`);
    }
  }
});

test("every run is feasible, in every plan", () => {
  for (const key of PLAN_KEYS) {
    const plan = PLANS[key]!;
    const { runs } = routesFor(plan);
    assert.equal(runs.length, EDGES.length, `${key}: a run went missing`);
    const defects = defectsOf(plan, runs);
    assert.deepEqual(
      defects.map((d) => `${d.run}: ${d.why}`),
      [],
      `${key}: infeasible runs`,
    );
  }
});

test("main and error never cross, and nothing else crosses either", () => {
  for (const key of PLAN_KEYS) {
    const { runs } = routesFor(PLANS[key]!);
    assert.equal(mainErrorCrossings(runs), 0, `${key}: a main run crosses the error run`);
    assert.equal(allCrossings(runs), 0, `${key}: the drawing has a crossing`);
  }
});

test("a suppressed label is always revealed by the plan that opens its phase", () => {
  const colOf = (id: string) => {
    const edge = EDGE_BY_ID.get(id)!;
    const plan = planOf(null);
    return plan.byId.get(edge.from)!.col;
  };
  for (const key of PLAN_KEYS) {
    for (const id of routesFor(PLANS[key]!).suppressed) {
      const col = colOf(id);
      const phase = PHASES.find((p) => col >= p.fromCol && col <= p.toCol)!;
      const open = routesFor(PLANS[phase.id]!);
      assert.equal(
        open.suppressed.includes(id),
        false,
        `${id} is suppressed at ${key} and still suppressed with ${phase.id} open`,
      );
    }
  }
});

test("the closed plan carries the main path's labels", () => {
  const { runs, suppressed } = routesFor(planOf(null));
  const main = runs.filter((r) => r.role === "main");
  const shown = main.filter((r) => r.label.shown).length;
  assert.ok(shown >= main.length - 1, `only ${shown} of ${main.length} main labels are shown`);
  assert.ok(
    suppressed.length <= 2,
    `${suppressed.length} labels stood down at L0: ${suppressed.join(", ")}`,
  );
  /* The exception's label always reads, at every plan: it is half the fifteen-second claim. */
  const error = runs.find((r) => r.role === "error")!;
  assert.equal(error.label.shown, true, "the decline has no label at L0");
});

test("the world is authored to fill a 1440x900 reading column at scale 1", () => {
  const world = planOf(null).world;
  /* The reading column at 1440x900 is the stage (1200) less its own padding and border: 1174.
     The canvas under the title band and over the cards is about 600 tall. Both must hold the
     authored world at scale 1, because home IS scale 1 and there is no fit pass below it. */
  assert.ok(world.w <= 1174, `the world is ${world.w} wide and the reading column is 1174`);
  assert.ok(world.h <= 600, `the world is ${world.h} tall and the canvas is about 600`);
  assert.equal(HOME_MIN, 1, "zoom-out below home must be disabled");

  /* At 1440x900 home is 1; at 1920x1080 it is capped so a bigger screen is not a deeper level. */
  assert.ok(homeZoom({ w: 1188, h: 660 }) >= 1);
  assert.ok(homeZoom({ w: 1668, h: 840 }) <= HOME_MAX);

  /* The grid is archify's 40 units, which at home is 40 screen pixels rather than eleven. */
  assert.equal(GRID, 40);
});

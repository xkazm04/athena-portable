/**
 * THE ARCHIFY SHEET'S GEOMETRY, AND THE CAMERA'S TWO DIRECTIONS.
 *
 * Every assertion names the PROPERTY it defends rather than the value the layout happens to have,
 * so adding a system to the model never fails this file and a broken arrangement always does.
 *
 *   1. No node overlaps another, in either view. A drawing where two boxes are on top of each
 *      other is not a drawing.
 *   2. Every one of the model's components has a box, and it is inside its own system's node.
 *   3. Boundaries are derived from membership: every region contains every node it wraps and no
 *      node it does not claim from another layer (study §7.4).
 *   4. Rule 14 and rule 16: `poseFor` and `resolve*` are exact inverses for every layer and every
 *      component, in both views — and the four band inequalities that make that reachable hold.
 *   5. The constraint solver satisfies the constraints it was given (study §3).
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import { COMPONENTS, LAYER_ORDER, SYSTEMS } from "../data";
import {
  BANDS,
  HOME_MAX,
  HOME_MIN,
  L1_ZOOM,
  l1Zoom,
  L2_ZOOM,
  poseFor,
  quantise,
  resolveGroup,
  resolveItem,
} from "../components/atlas/variants/archify/poses";
import {
  PLANS,
  VIEWS,
  contains,
  overlaps,
  solve,
  type ViewId,
} from "../components/atlas/variants/archify/layout";

const FRAME = { w: 1280, h: 760 };
const pose = (p: { zoom?: number; pan?: { x: number; y: number } }) => ({
  zoom: p.zoom ?? 1,
  pan: p.pan ?? { x: 0, y: 0 },
  yaw: 0,
  pitch: 0,
});

test("no two nodes overlap, in either view", () => {
  for (const view of VIEWS) {
    const nodes = PLANS[view].nodes;
    for (let i = 0; i < nodes.length; i += 1) {
      for (let j = i + 1; j < nodes.length; j += 1) {
        assert.equal(
          overlaps(nodes[i]!, nodes[j]!),
          false,
          `${view}: ${nodes[i]!.id} overlaps ${nodes[j]!.id}`,
        );
      }
    }
  }
});

test("every system is placed exactly once, and every component has a box inside its system", () => {
  for (const view of VIEWS) {
    const nodes = PLANS[view].nodes;
    assert.equal(nodes.length, SYSTEMS.length, `${view}: a system is missing from the sheet`);
    assert.equal(new Set(nodes.map((n) => n.id)).size, nodes.length);

    const placed = new Map<string, string>();
    for (const n of nodes) {
      for (const p of n.parts) {
        placed.set(p.id, n.id);
        assert.ok(
          p.x >= n.x && p.y >= n.y && p.x + p.w <= n.x + n.w && p.y + p.h <= n.y + n.h,
          `${view}: ${p.id} is not inside ${n.id}`,
        );
      }
    }
    for (const c of COMPONENTS) {
      assert.equal(placed.get(c.id), c.system, `${view}: ${c.id} is not drawn in ${c.system}`);
    }
  }
});

test("no two components overlap inside a node", () => {
  for (const view of VIEWS) {
    for (const n of PLANS[view].nodes) {
      for (let i = 0; i < n.parts.length; i += 1) {
        for (let j = i + 1; j < n.parts.length; j += 1) {
          assert.equal(overlaps(n.parts[i]!, n.parts[j]!), false, `${view}: ${n.id} parts collide`);
        }
      }
    }
  }
});

test("boundaries are derived from membership: a frame holds exactly what it wraps", () => {
  for (const view of VIEWS) {
    const plan = PLANS[view];
    const byId = new Map(plan.nodes.map((n) => [n.id, n]));
    for (const b of plan.boundaries) {
      assert.ok(b.wraps.length > 0, `${view}: ${b.id} wraps nothing`);
      for (const id of b.wraps) {
        const n = byId.get(id)!;
        assert.ok(
          n.x >= b.x && n.y >= b.y && n.x + n.w <= b.x + b.w && n.y + n.h <= b.y + b.h,
          `${view}: ${b.id} does not contain its member ${id}`,
        );
      }
    }
    /* Regions are rows: no region may contain a node belonging to another layer. */
    for (const b of plan.boundaries.filter((r) => r.kind === "region")) {
      for (const n of plan.nodes) {
        if (n.layer === b.id) continue;
        assert.equal(
          overlaps(b, n),
          false,
          `${view}: region ${b.id} overlaps ${n.id}, which is in ${n.layer}`,
        );
      }
    }
  }
});

test("the security-group crosses the regions — which is the finding it exists to make", () => {
  const plan = PLANS.sheet;
  const trust = plan.boundaries.find((b) => b.kind === "security-group")!;
  const crossed = plan.boundaries.filter((b) => b.kind === "region" && overlaps(b, trust));
  assert.ok(crossed.length >= 3, "the trust boundary should cross at least three layer regions");
  assert.equal(trust.wraps.length, 4);
});

test("rule 14: poseFor and resolveGroup are exact inverses for every layer", () => {
  for (const view of VIEWS) {
    for (const layer of LAYER_ORDER) {
      const p = poseFor({ level: 1, group: layer, item: null }, view, FRAME);
      assert.equal(resolveGroup(pose(p), view), layer, `${view}: ${layer} did not round-trip`);
    }
  }
});

test("rule 16: poseFor and resolveItem are exact inverses for every component", () => {
  for (const view of VIEWS) {
    for (const c of COMPONENTS) {
      const p = poseFor({ level: 2, group: null, item: c.id }, view, FRAME);
      const group = resolveGroup(pose(p), view)!;
      assert.equal(resolveItem(pose(p), view, group), c.id, `${view}: ${c.id} did not round-trip`);
    }
  }
});

test("the band edges leave a gap on both sides of every zoom the app flies to", () => {
  assert.ok(HOME_MAX < BANDS[0], "L0 must sit below the first band");
  assert.ok(BANDS[0] < L1_ZOOM && L1_ZOOM < BANDS[1], "L1 must sit inside the second band");
  assert.ok(L2_ZOOM > BANDS[1], "L2 must sit above the second band");
  /* Room for the kit's 8% hysteresis on both sides of both edges. */
  assert.ok(HOME_MAX * 1.08 < BANDS[0]);
  assert.ok(L1_ZOOM * 1.08 < BANDS[1]);
  assert.ok(HOME_MIN < HOME_MAX);
});

test("the fitted L1 zoom never leaves the second band, for any layer or frame", () => {
  const frames = [
    { w: 1280, h: 760 },
    { w: 420, h: 600 },
    { w: 3200, h: 1800 },
    { w: 0, h: 0 },
  ];
  for (const view of VIEWS) {
    for (const layer of LAYER_ORDER) {
      for (const f of frames) {
        const z = l1Zoom(view, layer, f);
        assert.ok(
          z > BANDS[0] && z < BANDS[1],
          `${view}/${layer} at ${f.w}x${f.h} fits to ${z}, outside the band`,
        );
      }
    }
  }
});

test("the inverse scale is quantised and symmetric", () => {
  assert.equal(quantise(1), 1);
  assert.ok(quantise(2) > quantise(1));
  assert.equal(quantise(1.02), quantise(1));
});

test("the difference-constraint solver satisfies its constraints", () => {
  const cs = [
    { from: 0, to: 1, gap: 100 },
    { from: 1, to: 2, gap: 50 },
    { from: 0, to: 2, gap: 400 },
  ];
  const at = solve(3, cs);
  for (const c of cs) assert.ok(at[c.to]! - at[c.from]! >= c.gap - 1e-6, "constraint violated");
  assert.equal(at[2], 400, "a non-chain constraint must widen the span, not be rounded away");
});

test("a layer's frame contains its own nodes' centres, which is what the camera flies to", () => {
  for (const view of VIEWS as readonly ViewId[]) {
    for (const layer of LAYER_ORDER) {
      const frame = PLANS[view].frames[layer]!;
      assert.ok(frame, `${view}: ${layer} has no frame`);
      assert.ok(contains(frame, { x: frame.x + frame.w / 2, y: frame.y + frame.h / 2 }));
    }
  }
});

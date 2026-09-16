/**
 * THE CAMERA'S TWO DIRECTIONS, AND THE TURN TOLD OVER THE GRID.
 *
 *   1. Rule 14 and rule 16: `poseFor` and `resolve*` are exact inverses for every phase and every
 *      one of the twelve nodes, in every plan. That, not hysteresis, is what stops the flapping.
 *   2. The six band inequalities that make all three levels reachable by wheel, with the kit's own
 *      8% hysteresis applied — so closing a gap fails the build instead of making the wheel feel
 *      broken.
 *   3. The story: twelve stops, each on a node the drawing has, and the hop receipt the Story
 *      Trail prints (authored / derived / inside one node) matches the drawing's own edges.
 *   4. `read_turn` answers with this drawing's lanes, phases and runs.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import { componentById } from "../data";
import { planOf } from "../components/atlas/variants/archify-lanes/geometry";
import {
  BANDS,
  HOME_MAX,
  L1_MAX,
  L1_MIN,
  L2_ZOOM,
  ZOOM_BOUNDS,
  homeZoom,
  phaseOfNode,
  poseFor,
  resolveGroup,
  resolveItem,
} from "../components/atlas/variants/archify-lanes/poses";
import { NODES, PHASES } from "../components/atlas/variants/archify-lanes/workflow";
import {
  BEAT_VIEWS,
  CHAPTER_VIEWS,
  HOPS,
  NODE_OF_STOP,
  TRAIL_COUNTS,
  beatState,
} from "../components/atlas/variants/archify-lanes/story";
import { turnRead } from "../components/atlas/variants/archify-lanes/turn";

const FRAME = { w: 1188, h: 660 };
const pose = (p: { zoom?: number; pan?: { x: number; y: number } }) => ({
  zoom: p.zoom ?? 1,
  pan: p.pan ?? { x: 0, y: 0 },
  yaw: 0,
  pitch: 0,
});

test("poseFor and resolveGroup are exact inverses for every phase", () => {
  for (const phase of PHASES) {
    const p = pose(poseFor({ level: 1, group: phase.id, item: null }, FRAME));
    assert.equal(resolveGroup(p, phase.id), phase.id, `L1 ${phase.id}`);
    assert.ok(p.zoom >= L1_MIN && p.zoom <= L1_MAX, `${phase.id} stands at ${p.zoom}`);
  }
});

/**
 * L2 IS ALWAYS REACHED WITH ITS PHASE OPEN, so the inverse is asserted against that plan.
 *
 * `focus.level === 2` carries `focus.group`, the variant derives the open phase from it, and
 * `poseFor` and `resolve*` therefore read the same plan — which is the condition rule 14 actually
 * needs. The second assertion is the property that makes it safe: widening a phase never moves a
 * node out of its own phase band, so the plan a reader crosses INTO on the way to L1 already
 * agrees about which phase they are over.
 */
test("poseFor and resolveItem are exact inverses for every node, in its own plan", () => {
  for (const node of NODES) {
    const phase = phaseOfNode(node.id);
    const p = pose(poseFor({ level: 2, group: phase, item: node.item }, FRAME));
    const group = resolveGroup(p, phase);
    assert.equal(group, phase, `${node.id} resolves to ${group}`);
    assert.equal(resolveItem(p, group!, phase), node.item, `${node.id} item round trip`);
  }
});

test("widening a phase never moves a node out of its own phase band", () => {
  for (const key of ["closed", ...PHASES.map((x) => x.id)]) {
    const plan = planOf(key === "closed" ? null : key);
    for (const box of plan.nodes) {
      const band = plan.phases.find((b) => b.id === box.phase)!;
      assert.ok(
        box.x >= band.x && box.x + box.w <= band.x + band.w,
        `${key}: ${box.id} has left the ${box.phase} band`,
      );
    }
  }
});

test("home resolves to no phase in particular and never below scale 1", () => {
  const p = pose(poseFor({ level: 0, group: null, item: null }, FRAME));
  assert.ok(p.zoom >= 1, `home is ${p.zoom}`);
  assert.ok(p.zoom < BANDS[0], "home must be below the first band");
  /* It still answers a phase — the nearest — because `useSemanticZoom` asks on the way in. */
  assert.ok(PHASES.some((x) => x.id === resolveGroup(p, null)));
});

test("the six band inequalities hold, with the kit's 8% hysteresis", () => {
  const h = 0.08;
  const [l1, l2] = BANDS;
  assert.ok(HOME_MAX < l1 * (1 + h), "home reaches into the L1 band");
  assert.ok(L1_MIN > l1 * (1 - h), "L1 sits low enough to fall out of its own band");
  assert.ok(L1_MIN > l1 * (1 + h), "arriving at L1 does not register as L1");
  assert.ok(L1_MAX < l2 * (1 + h), "L1 reaches into the L2 band");
  assert.ok(L2_ZOOM > l2 * (1 - h), "L2 sits low enough to fall out of its own band");
  assert.equal(ZOOM_BOUNDS[0], 1, "the camera may not pull out past the authored scale");
  assert.ok(ZOOM_BOUNDS[1] > L2_ZOOM, "the camera cannot reach L2");
  assert.ok(homeZoom({ w: 400, h: 300 }) >= 1, "a small frame still may not zoom out");
});

test("the twelve stops each stand on a node this drawing has", () => {
  assert.equal(BEAT_VIEWS.length, 12);
  const ids = new Set(NODES.map((n) => n.id));
  for (const b of BEAT_VIEWS) {
    assert.ok(ids.has(b.node), `stop ${b.index + 1} stands on ${b.node}, which is not a node`);
    assert.ok(componentById(b.part), `stop ${b.index + 1} names ${b.part}, not in the model`);
  }
  assert.equal(NODE_OF_STOP.length, 12);
  /* The turn ends where it started, which is the last stop's whole claim. */
  assert.equal(NODE_OF_STOP[0], NODE_OF_STOP[11]);
});

test("the Story Trail's receipt matches the drawing's own edges", () => {
  assert.equal(TRAIL_COUNTS.stops, 12);
  assert.equal(TRAIL_COUNTS.hops + TRAIL_COUNTS.internal, 11);
  assert.equal(TRAIL_COUNTS.authored + TRAIL_COUNTS.derived, TRAIL_COUNTS.hops);
  assert.ok(
    TRAIL_COUNTS.authored > TRAIL_COUNTS.derived,
    "if the grid is the turn, most hops are already runs",
  );
  const plan = planOf(null);
  for (const hop of HOPS) {
    assert.ok(plan.byId.get(hop.from), `hop ${hop.index} leaves ${hop.from}`);
    assert.ok(plan.byId.get(hop.to), `hop ${hop.index} enters ${hop.to}`);
    assert.notEqual(hop.from, hop.to, "a hop with no distance is not drawn");
  }
});

test("beats carry three states and the chapters tile the twelve stops", () => {
  assert.deepEqual([beatState(0, 1), beatState(1, 1), beatState(2, 1)], [
    "past",
    "active",
    "next",
  ]);
  assert.equal(CHAPTER_VIEWS[0]!.from, 0);
  assert.equal(CHAPTER_VIEWS[CHAPTER_VIEWS.length - 1]!.to, 11);
  for (let i = 1; i < CHAPTER_VIEWS.length; i += 1) {
    assert.equal(CHAPTER_VIEWS[i]!.from, CHAPTER_VIEWS[i - 1]!.to + 1, "the chapters leave a gap");
  }
  for (const c of CHAPTER_VIEWS) assert.ok(c.note.length <= 140, `${c.id}'s note is over 140`);
});

test("read_turn answers with this drawing's lanes, phases and runs", () => {
  const answer = turnRead(6, true, false);
  assert.equal(answer.of, 12);
  assert.equal(answer.at, 7);
  assert.equal(answer.lanes.length, 4);
  assert.equal(answer.phases.length, 3);
  assert.equal(
    answer.phases.reduce((n, p) => n + p.nodes.length, 0),
    12,
    "every node is in exactly one phase",
  );
  assert.ok(answer.items.length > 0);
  const gate = answer.items.find((i) => i.stop === 7)!;
  assert.equal(gate.beat, "active");
  assert.ok(gate.lane !== null && gate.phase !== null, "a stop knows its lane and its phase");
  assert.equal(answer.hops.authored, TRAIL_COUNTS.authored);
});

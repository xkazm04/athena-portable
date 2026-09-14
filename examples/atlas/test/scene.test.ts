/**
 * The machine's geometry, and the turn that runs through it.
 *
 * THE POINT OF THIS FILE. Round 3 draws the same scene three ways — webgl, css3d and hybrid —
 * and the owner picks from them. That comparison is only honest if the three are drawing the
 * SAME machine, so the layout is one pure module and this file is what holds it still. If a
 * renderer looks wrong, the bug is in the renderer, because the numbers are pinned here.
 *
 * Every assertion names the property it defends, not the value it happens to have. A test that
 * says `blocks.length === 19` breaks the day a system is added to the model, which is the wrong
 * day to fail; a test that says every system became exactly one block breaks only when the
 * layout is wrong.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import { COMPONENTS, LAYER_ORDER, SYSTEMS, componentById, systemById } from "../data";
import {
  DIM,
  SCENE,
  SCENE_COUNTS,
  blockAt,
  blocksOn,
  cell,
  measure,
  partAt,
  pipesOf,
  pointOn,
  route,
  stratumY,
} from "../components/atlas/scene/layout";
import { FOV, REST, REST_DIST, project, projectAll, viewOf } from "../components/atlas/scene/project";
import { poseFor, strataUnder } from "../components/atlas/scene/aim";
import { HOME_POSE, SNAPS, snapPose } from "../components/atlas/scene/poses";
import { TURN, TURN_BEATS, beatOfStop, stopAtBeat, turnAt } from "../components/atlas/scene/turn";

/* ------------------------------------- the strata ------------------------------------- */

test("there is one plane per layer, in README order, surfaces highest", () => {
  assert.equal(SCENE.strata.length, LAYER_ORDER.length);
  SCENE.strata.forEach((s, i) => {
    assert.equal(s.id, LAYER_ORDER[i], `stratum ${i} is ${s.id}`);
    assert.equal(s.index, i);
  });
  const ys = SCENE.strata.map((s) => s.y);
  for (let i = 1; i < ys.length; i += 1) {
    assert.ok(ys[i]! < ys[i - 1]!, `${SCENE.strata[i]!.id} must sit below ${SCENE.strata[i - 1]!.id}`);
  }
  /* "Up the stack" is +Y, so contracts is the floor at zero and surfaces is the lid. */
  assert.equal(ys[ys.length - 1], 0);
  assert.equal(ys[0], (LAYER_ORDER.length - 1) * DIM.stratumGap);
});

test("stratumY is the only place the stack's spacing is decided", () => {
  for (let i = 0; i < LAYER_ORDER.length; i += 1) {
    assert.equal(SCENE.strata[i]!.y, stratumY(i));
  }
});

/* ------------------------------------- the blocks ------------------------------------- */

test("every system became exactly one block, and every block is a system", () => {
  assert.equal(SCENE.blocks.length, SYSTEMS.length);
  for (const s of SYSTEMS) {
    const b = blockAt(s.id);
    assert.ok(b, `${s.id} has no block`);
    assert.equal(b!.layer, s.layer);
  }
  for (const b of SCENE.blocks) assert.ok(systemById(b.id), `${b.id} is not a system`);
});

test("every component became exactly one part, inside its own system's block", () => {
  assert.equal(SCENE_COUNTS.parts, COMPONENTS.length);
  for (const c of COMPONENTS) {
    const p = partAt(c.id);
    assert.ok(p, `${c.id} has no part`);
    assert.equal(p!.block, c.system);
  }
});

test("a block stands on its own stratum's face", () => {
  for (const b of SCENE.blocks) {
    assert.equal(b.y, stratumY(LAYER_ORDER.indexOf(b.layer)));
  }
});

test("parts stand on their block's lid and stay inside its footprint", () => {
  for (const b of SCENE.blocks) {
    for (const p of b.parts) {
      assert.equal(p.y, b.y + b.h, `${p.id} floats`);
      const dx = Math.abs(p.x - b.x) + p.w / 2;
      const dz = Math.abs(p.z - b.z) + p.d / 2;
      assert.ok(dx <= b.w / 2 + 0.01, `${p.id} overhangs its block in x`);
      assert.ok(dz <= b.d / 2 + 0.01, `${p.id} overhangs its block in z`);
    }
  }
});

test("two blocks on one stratum never overlap", () => {
  for (const layer of LAYER_ORDER) {
    const blocks = blocksOn(layer);
    for (let i = 0; i < blocks.length; i += 1) {
      for (let j = i + 1; j < blocks.length; j += 1) {
        const a = blocks[i]!;
        const b = blocks[j]!;
        const apart =
          Math.abs(a.x - b.x) >= (a.w + b.w) / 2 - 0.01 ||
          Math.abs(a.z - b.z) >= (a.d + b.d) / 2 - 0.01;
        assert.ok(apart, `${a.id} and ${b.id} overlap on ${layer}`);
      }
    }
  }
});

test("blocks stay on their plane", () => {
  for (const b of SCENE.blocks) {
    assert.ok(Math.abs(b.x) + b.w / 2 <= DIM.planeW / 2 + 0.01, `${b.id} hangs off in x`);
    assert.ok(Math.abs(b.z) + b.d / 2 <= DIM.planeD / 2 + 0.01, `${b.id} hangs off in z`);
  }
});

test("the last row of a stratum is centred, not left-hung", () => {
  /* Five cells in rows of four: the fifth sits on the plane's centre line. */
  const last = cell(4, 5, 100, 100, 4);
  assert.ok(Math.abs(last.x) < 0.001, `a lone last cell should be centred, got ${last.x}`);
});

/* -------------------------------------- the pipes -------------------------------------- */

test("every pipe joins two real blocks and knows which way it runs", () => {
  for (const p of SCENE.pipes) {
    const from = blockAt(p.from);
    const to = blockAt(p.to);
    assert.ok(from && to, `${p.id} dangles`);
    const expected = to!.y > from!.y ? "reaches" : to!.y < from!.y ? "depends" : "across";
    assert.equal(p.flow, expected, `${p.id} claims ${p.flow}`);
    assert.ok(p.points.length >= 4, `${p.id} is not routed`);
    assert.ok(p.length > 0, `${p.id} has no length`);
  }
});

test("a pipe starts on its source block's face and ends on its target's", () => {
  for (const p of SCENE.pipes) {
    const from = blockAt(p.from)!;
    const to = blockAt(p.to)!;
    const head = p.points[0]!;
    const tail = p.points[p.points.length - 1]!;
    assert.equal(head.x, from.x);
    assert.equal(head.z, from.z);
    assert.equal(tail.x, to.x);
    assert.equal(tail.z, to.z);
    const up = p.flow === "reaches";
    assert.equal(head.y, up ? from.y + from.h : from.y);
    assert.equal(tail.y, up ? to.y : to.y + to.h);
  }
});

test("a long pipe leaves the plane to a riser; a short one does not", () => {
  const near = blockAt(SCENE.strata[0]!.id === "surfaces" ? blocksOn("surfaces")[0]!.id : "");
  assert.ok(near);
  const far = blocksOn("contracts")[0]!;
  const long = route(near!, far);
  const out = Math.max(...long.points.map((p) => Math.abs(p.x)));
  assert.ok(out > DIM.planeW / 2, "a five-stratum edge must ride the riser outside the plane");

  const a = blocksOn("core")[0]!;
  const b = blocksOn("contracts")[0]!;
  const short = route(a, b);
  const shortOut = Math.max(...short.points.map((p) => Math.abs(p.x)));
  assert.ok(shortOut <= DIM.planeW / 2, "an adjacent edge must cross the gap directly");
});

test("the riser side carries the direction: reaches left, depends right", () => {
  const surf = blocksOn("surfaces")[0]!;
  const con = blocksOn("contracts")[0]!;
  const down = route(surf, con);
  const up = route(con, surf);
  const farthest = (pts: readonly { x: number }[]) =>
    pts.reduce((m, p) => (Math.abs(p.x) > Math.abs(m.x) ? p : m), pts[0]!);
  assert.ok(farthest(down.points).x > 0, "a dependency rides the right-hand riser");
  assert.ok(farthest(up.points).x < 0, "a reach rides the left-hand riser");
});

test("pipesOf finds a block's plumbing in both directions", () => {
  for (const p of SCENE.pipes.slice(0, 5)) {
    assert.ok(pipesOf(p.from).some((q) => q.id === p.id));
    assert.ok(pipesOf(p.to).some((q) => q.id === p.id));
  }
});

/* ----------------------------------- polyline maths ----------------------------------- */

test("pointOn walks a polyline by arc length and clamps at both ends", () => {
  const line = [
    { x: 0, y: 0, z: 0 },
    { x: 10, y: 0, z: 0 },
    { x: 10, y: 10, z: 0 },
  ];
  assert.equal(measure(line).length, 20);
  assert.deepEqual(pointOn(line, 0).at, line[0]);
  assert.deepEqual(pointOn(line, 1).at, line[2]);
  assert.deepEqual(pointOn(line, -5).at, line[0]);
  assert.deepEqual(pointOn(line, 5).at, line[2]);
  const mid = pointOn(line, 0.5).at;
  assert.equal(mid.x, 10);
  assert.equal(mid.y, 0);
  const three = pointOn(line, 0.75).at;
  assert.equal(three.x, 10);
  assert.equal(three.y, 5);
});

/* ------------------------------------ the projection ------------------------------------ */

test("the resting pose puts the scene centre in the middle of the frame", () => {
  const frame = { w: 1440, h: 900 };
  const view = viewOf(REST);
  const p = project(view.target, view, frame);
  assert.ok(Math.abs(p.x - frame.w / 2) < 0.001);
  assert.ok(Math.abs(p.y - frame.h / 2) < 0.001);
  assert.ok(Math.abs(p.depth - REST_DIST) < 0.001);
});

test("zoom is distance: doubling zoom halves the distance and doubles the scale", () => {
  const frame = { w: 1000, h: 1000 };
  const a = viewOf(REST);
  const b = viewOf({ ...REST, zoom: 2 });
  const pa = project(a.target, a, frame);
  const pb = project(b.target, b, frame);
  assert.ok(Math.abs(pb.depth - pa.depth / 2) < 0.001);
  assert.ok(Math.abs(pb.scale - pa.scale * 2) < 0.001);
});

test("a point behind the camera is not drawn", () => {
  const frame = { w: 800, h: 600 };
  const view = viewOf(REST);
  const behind = {
    x: view.eye.x - view.forward.x * 10,
    y: view.eye.y - view.forward.y * 10,
    z: view.eye.z - view.forward.z * 10,
  };
  assert.equal(project(behind, view, frame).visible, false);
  assert.equal(projectAll([behind, behind], view, frame).length, 0);
});

test("the view basis is orthonormal at every pose the bounds allow", () => {
  for (const yaw of [0, 0.7, -1.9, 3]) {
    for (const pitch of [-0.4, 0, 0.9, 1.2]) {
      const v = viewOf({ yaw, pitch, zoom: 1.4, pan: { x: 5, y: -3 } });
      const d = (a: typeof v.right, b: typeof v.right) => a.x * b.x + a.y * b.y + a.z * b.z;
      assert.ok(Math.abs(d(v.right, v.right) - 1) < 1e-6);
      assert.ok(Math.abs(d(v.up, v.up) - 1) < 1e-6);
      assert.ok(Math.abs(d(v.forward, v.forward) - 1) < 1e-6);
      assert.ok(Math.abs(d(v.right, v.up)) < 1e-6);
      assert.ok(Math.abs(d(v.right, v.forward)) < 1e-6);
      assert.ok(Math.abs(d(v.up, v.forward)) < 1e-6);
    }
  }
  assert.ok(FOV > 0 && FOV < Math.PI);
});

test("panning moves the frame, not the machine", () => {
  const frame = { w: 1000, h: 800 };
  const centre = { x: 0, y: 0, z: 0 };
  const a = viewOf({ ...REST, pan: { x: 0, y: 0 } }, centre);
  const b = viewOf({ ...REST, pan: { x: 20, y: 0 } }, centre);
  const pa = project(centre, a, frame);
  const pb = project(centre, b, frame);
  assert.ok(pb.x > pa.x, "panning right moves the scene right on screen");
  assert.ok(Math.abs(pb.y - pa.y) < 0.001);
});

/* ---------------------------------------- the rig ---------------------------------------- */

/*
 * THE TEST THAT TIES THE CAMERA TO THE PROJECTION.
 *
 * `poseFor` computes the pan that centres a focus by resolving the target's offset onto the
 * camera's right/up axes; `viewOf` shifts the orbit centre by that same pan. The two derive the
 * basis separately — the rig does not import the projection's internals — so they can disagree,
 * and when they did, the symptom was not an error: the camera flew to the MIRROR IMAGE of the
 * stratum that had been opened, and L1 looked like a camera aimed at nothing in particular. One
 * sign, invisible on inspection, caught here in three lines.
 */
test("poseFor puts the thing it opened in the middle of the frame", () => {
  const frame = { w: 1200, h: 660 };
  for (const layer of LAYER_ORDER) {
    const focus = { level: 1 as const, group: layer, item: null };
    const pose = { ...HOME_POSE, ...poseFor(focus, HOME_POSE) };
    const view = viewOf(pose as never);
    const target = { x: 0, y: stratumY(LAYER_ORDER.indexOf(layer)) + DIM.blockH / 2, z: 0 };
    const p = project(target, view, frame);
    assert.ok(p.visible, `${layer} is behind the camera`);
    assert.ok(Math.abs(p.x - frame.w / 2) < 1, `${layer} is ${Math.round(p.x - frame.w / 2)}px off centre in x`);
    assert.ok(Math.abs(p.y - frame.h / 2) < 1, `${layer} is ${Math.round(p.y - frame.h / 2)}px off centre in y`);
  }
});

test("poseFor centres a part at L2 too, for every part in the model", () => {
  const frame = { w: 1200, h: 660 };
  for (const b of SCENE.blocks) {
    const p0 = b.parts[0];
    if (!p0) continue;
    const focus = { level: 2 as const, group: b.layer, item: p0.id };
    const pose = { ...HOME_POSE, ...poseFor(focus, HOME_POSE) };
    const view = viewOf(pose as never);
    const aim = { x: (p0.x + b.x) / 2, y: p0.y + p0.h, z: (p0.z + b.z) / 2 };
    const p = project(aim, view, frame);
    assert.ok(p.visible && Math.abs(p.x - frame.w / 2) < 1 && Math.abs(p.y - frame.h / 2) < 1, b.id);
  }
});

test("a snap moves where the camera looks, never how far away it stands", () => {
  /* The property that matters: in a direction where distance is the level, a snap that touched
     zoom would change the LEVEL every time the reader stopped moving. */
  for (const zoom of [0.6, 0.9, 1, 1.4]) {
    for (const yaw of [-2, -0.4, 0.3, 2.9]) {
      const pose = { yaw, pitch: 0.5, zoom, pan: { x: 12, y: -7 } };
      const snapped = snapPose(pose);
      assert.equal(snapped.zoom, pose.zoom, "a snap may not change the distance");
      assert.deepEqual(snapped.pan, pose.pan, "a snap may not change the pan");
      assert.ok(SNAPS.some((s) => s.yaw === snapped.yaw && s.pitch === snapped.pitch));
    }
  }
  /* And it declines entirely once the camera is inside a level, where the nav is flying it. */
  const inside = { yaw: 1, pitch: 0.2, zoom: 2.4, pan: { x: 0, y: 30 } };
  assert.deepEqual(snapPose(inside), inside);
});

test("a zoom inside a band resolves to that band's level", () => {
  assert.equal(strataUnder(HOME_POSE), "lane");
  /* Every stratum is reachable: panning to a plane's height must resolve to that plane. */
  for (const layer of LAYER_ORDER) {
    const pose = { ...HOME_POSE, ...poseFor({ level: 1, group: layer, item: null }, HOME_POSE) };
    assert.equal(strataUnder(pose as never), layer, `panning to ${layer} resolves elsewhere`);
  }
});

/* --------------------------------------- the turn --------------------------------------- */

test("every stop names a component the model actually has", () => {
  for (const s of TURN) {
    const c = componentById(s.part);
    assert.ok(c, `stop ${s.index} names ${s.part}, which is not in the model`);
    assert.equal(s.block, c!.system, `stop ${s.index} is on the wrong block`);
    assert.ok(blockAt(s.block), `stop ${s.index}'s block has no geometry`);
    assert.ok(partAt(s.part), `stop ${s.index}'s part has no geometry`);
  }
});

test("the turn touches every stratum — it is a section through the whole machine", () => {
  const strata = new Set(TURN.map((s) => blockAt(s.block)!.layer));
  for (const layer of LAYER_ORDER) {
    assert.ok(strata.has(layer), `the turn never visits ${layer}`);
  }
});

test("the turn goes down and comes back up", () => {
  const ys = TURN.map((s) => blockAt(s.block)!.y);
  assert.equal(ys[0], ys[ys.length - 1], "it must end where it started");
  assert.ok(Math.min(...ys) < ys[0]!, "it must descend into the machine");
});

test("one label per stop, short, and every stop cites README", () => {
  for (const s of TURN) {
    assert.ok(s.label.length > 0 && s.label.length <= 60, `stop ${s.index}: "${s.label}"`);
    assert.match(s.cite, /README/);
  }
});

test("the clock is monotonic and the gate waits longest", () => {
  let last = -1;
  for (const s of TURN) {
    assert.ok(s.start >= last, `stop ${s.index} starts before the previous one ended`);
    assert.ok(s.arrive >= s.start);
    assert.ok(s.end > s.arrive, `stop ${s.index} has no dwell`);
    last = s.end;
  }
  assert.equal(TURN_BEATS, TURN[TURN.length - 1]!.end);
  const wait = TURN.find((s) => s.kind === "wait")!;
  const dwell = (s: (typeof TURN)[number]) => s.end - s.arrive;
  for (const s of TURN) {
    if (s !== wait) assert.ok(dwell(wait) > dwell(s), "the gate must be the longest stop");
  }
});

test("turnAt is total: every beat from zero to the end has a light and a subject", () => {
  for (let b = 0; b <= TURN_BEATS + 1; b += 0.25) {
    const f = turnAt(b);
    assert.ok(f.stop, `no stop at beat ${b}`);
    assert.ok(Number.isFinite(f.at.x) && Number.isFinite(f.at.y) && Number.isFinite(f.at.z));
    assert.ok(f.t >= 0 && f.t <= 1);
  }
  assert.equal(turnAt(-10).stop.index, 0);
  assert.equal(turnAt(TURN_BEATS + 99).stop.index, TURN.length - 1);
});

test("mid-dwell is parked on the stop's own part", () => {
  for (const s of TURN) {
    const f = turnAt(beatOfStop(s.index));
    assert.equal(f.stop.index, s.index);
    assert.ok(f.parked, `stop ${s.index} is not parked mid-dwell`);
    const p = partAt(s.part)!;
    assert.ok(Math.abs(f.at.x - p.x) < 0.001 && Math.abs(f.at.z - p.z) < 0.001);
    assert.equal(stopAtBeat(beatOfStop(s.index)).part, s.part);
  }
});

test("the light is somewhere on the leg while it is travelling", () => {
  const legged = TURN.filter((s) => s.leg && s.leg.points.length > 1);
  assert.ok(legged.length > 5, "most of the turn should be travel");
  for (const s of legged) {
    const half = turnAt(s.start + (s.arrive - s.start) / 2);
    assert.equal(half.parked, false);
    const ends = [s.leg!.points[0]!, s.leg!.points[s.leg!.points.length - 1]!];
    const far = ends.every(
      (e) => Math.hypot(half.at.x - e.x, half.at.y - e.y, half.at.z - e.z) > 0.5,
    );
    assert.ok(far, `stop ${s.index}'s light never leaves an endpoint`);
  }
});

test("only the gate's stop reports waiting", () => {
  const waits = TURN.filter((s) => turnAt(beatOfStop(s.index)).waiting);
  assert.equal(waits.length, 1);
  assert.equal(waits[0]!.kind, "wait");
});

/**
 * RULE 14 AND RULE 16 ON THE FIELD: `poseFor` and `resolve*` are exact inverses, for every layer
 * and every one of the 68 components, and the three bands are reachable by wheel.
 *
 * Round 3's negative (KIT-GAPS R3-2) was that `resolveItem` has no honest answer in a container
 * scene, so the wheel stopped at L1. Round 4's positive was that on a sheet the items are laid
 * out in the plane and the wheel walks all three. A matrix is the strongest form of that same
 * fact: an item IS a coordinate, so the inverse holds with no containment test and no nearest
 * fallback in two dimensions. These tests say so rather than assuming it.
 *
 * The four band inequalities at the top are the ones that make a wheel feel unbroken. They are
 * asserted against the kit's own hysteresis constant, so a future change to any of the five zoom
 * numbers that closes a gap fails the build.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import { SEMANTIC_HYSTERESIS, levelForZoom, type CameraPose } from "@athena/demo-kit/zoom";

import { COMPONENTS, LAYER_ORDER, componentById, systemById } from "../data";
import {
  AXIS_IDS,
  BOUNDS,
  FIELD,
  M,
  N,
  centreOf,
  diagonalCentre,
  indexOf,
  layerSpan,
} from "../components/atlas/variants/wildcard/matrix";
import {
  BANDS,
  HOME_MAX,
  HOME_MIN,
  L1_ZOOM,
  L2_ZOOM,
  QUANT_STEPS_PER_OCTAVE,
  ZOOM_BOUNDS,
  colCentreX,
  homeZoom,
  lookingAt,
  poseFor,
  projectX,
  projectY,
  quantise,
  resolveGroup,
  resolveItem,
  rowCentreY,
  rowUnder,
} from "../components/atlas/variants/wildcard/poses";

const FRAME = { w: 1100, h: 640 };

/** Half the field, in world units — a pan far enough to leave the drawing entirely. */
const SPAN_HALF = (N * M.cell) / 2;

const full = (pose: Partial<CameraPose>): CameraPose => ({
  yaw: 0,
  pitch: 0,
  zoom: pose.zoom ?? 1,
  pan: pose.pan ?? { x: 0, y: 0 },
});

/* ------------------------------------- the bands themselves ------------------------------------- */

test("the three bands are ordered, and each reading distance sits inside its own band", () => {
  assert.ok(BANDS[0] < BANDS[1], "the band edges are not ordered");
  assert.ok(HOME_MIN < HOME_MAX);
  assert.equal(levelForZoom(homeZoom(FRAME), BANDS), 0);
  assert.equal(levelForZoom(L1_ZOOM, BANDS), 1);
  assert.equal(levelForZoom(L2_ZOOM, BANDS), 2);
});

test("every band edge clears the kit's hysteresis on both sides", () => {
  const h = SEMANTIC_HYSTERESIS;
  assert.ok(HOME_MAX < BANDS[0] * (1 - h), "the whole field can flap into the second band");
  assert.ok(L1_ZOOM > BANDS[0] * (1 + h), "a layer's distance can flap back to the whole field");
  assert.ok(L1_ZOOM < BANDS[1] * (1 - h), "a layer's distance can flap into a component");
  assert.ok(L2_ZOOM > BANDS[1] * (1 + h), "a component's distance can flap back to its layer");
});

test("the camera's zoom bounds reach past both ends of the three bands", () => {
  assert.ok(ZOOM_BOUNDS[0] < HOME_MIN, "the camera cannot reach the whole field");
  assert.ok(ZOOM_BOUNDS[1] > L2_ZOOM, "the camera cannot reach a component");
});

test("the whole-field zoom is a fit, held between the floor and the ceiling", () => {
  assert.equal(homeZoom({ w: 0, h: 0 }), HOME_MIN);
  assert.equal(homeZoom({ w: 10, h: 10 }), HOME_MIN, "a tiny window goes below the floor");
  assert.equal(homeZoom({ w: 9000, h: 9000 }), HOME_MAX, "a huge display goes past the ceiling");
  const fitted = homeZoom(FRAME);
  assert.ok(fitted * BOUNDS.h <= FRAME.h + 1, "the field does not fit the frame it was fitted to");
});

/* --------------------------------- rule 14, the two exact inverses --------------------------------- */

test("resolveGroup(poseFor(level 1, L)) === L, for every layer", () => {
  for (const layer of LAYER_ORDER) {
    if (!layerSpan(layer)) continue;
    const pose = full(poseFor({ level: 1, group: layer, item: null }, FRAME));
    assert.equal(pose.zoom, L1_ZOOM);
    assert.equal(resolveGroup(pose), layer, `${layer} does not resolve to itself`);
  }
});

test("resolveItem(poseFor(level 2, C), layer) === C, for every component", () => {
  for (const c of COMPONENTS) {
    const layer = systemById(c.system)?.layer ?? "";
    const pose = full(poseFor({ level: 2, group: layer, item: c.id }, FRAME));
    assert.equal(pose.zoom, L2_ZOOM);
    assert.equal(resolveGroup(pose), layer, `${c.id} resolves into the wrong layer`);
    assert.equal(resolveItem(pose, layer), c.id, `${c.id} does not resolve to itself`);
  }
});

test("a level-2 pose stands on the component's own diagonal cell", () => {
  for (const c of COMPONENTS) {
    const pose = full(poseFor({ level: 2, group: null, item: c.id }, FRAME));
    const at = lookingAt(pose);
    const want = diagonalCentre(indexOf(c.id));
    assert.equal(at.x, want.x);
    assert.equal(at.y, want.y);
  }
});

test("a level-0 pose stands on the middle of the field", () => {
  const pose = full(poseFor({ level: 0, group: null, item: null }, FRAME));
  assert.deepEqual(lookingAt(pose), centreOf(BOUNDS));
  assert.equal(pose.zoom, homeZoom(FRAME));
});

test("an unknown group or item falls back to the whole field rather than to a wrong place", () => {
  const bad = full(poseFor({ level: 2, group: "nope", item: "cmp-nope" }, FRAME));
  assert.equal(bad.zoom, homeZoom(FRAME));
  const badGroup = full(poseFor({ level: 1, group: "nope", item: null }, FRAME));
  assert.equal(badGroup.zoom, homeZoom(FRAME));
});

/* ----------------------------------- the row is the subject ----------------------------------- */

test("panning along a row never changes which component is under the camera", () => {
  for (const c of COMPONENTS) {
    const layer = systemById(c.system)?.layer ?? "";
    const base = full(poseFor({ level: 2, group: layer, item: c.id }, FRAME));
    for (const dx of [-SPAN_HALF, -M.cell * 7, M.cell * 11, SPAN_HALF]) {
      const moved = full({ zoom: base.zoom, pan: { x: base.pan.x + dx, y: base.pan.y } });
      assert.equal(resolveGroup(moved), layer, `${c.id} changed layer by panning sideways`);
      assert.equal(resolveItem(moved, layer), c.id, `${c.id} changed by panning sideways`);
    }
  }
});

test("rowUnder walks the axis exactly once, top to bottom, and clamps past both ends", () => {
  for (let i = 0; i < N; i += 1) {
    const pose = full({ zoom: L2_ZOOM, pan: { x: 0, y: -(FIELD.y + (i + 0.5) * M.cell) } });
    assert.equal(rowUnder(pose), i, `row ${i} is not under its own centre`);
  }
  assert.equal(rowUnder(full({ zoom: 1, pan: { x: 0, y: 1e6 } })), 0);
  assert.equal(rowUnder(full({ zoom: 1, pan: { x: 0, y: -1e6 } })), N - 1);
});

test("resolveItem stays inside the layer it was asked about, wherever the camera is", () => {
  for (const layer of LAYER_ORDER) {
    const span = layerSpan(layer);
    if (!span) continue;
    for (const y of [-1e5, 0, 1e5]) {
      const pose = full({ zoom: L2_ZOOM, pan: { x: 0, y } });
      const answer = resolveItem(pose, layer);
      assert.ok(answer, `${layer} answered nothing`);
      const i = indexOf(answer);
      assert.ok(
        i >= span.start && i < span.start + span.count,
        `${layer} answered ${answer}, which is not in it`,
      );
    }
  }
});

test("every component on the axis resolves to itself from its own row, at every band", () => {
  for (const zoom of [BANDS[1] * 1.5, L2_ZOOM, ZOOM_BOUNDS[1]]) {
    for (let i = 0; i < N; i += 1) {
      const id = AXIS_IDS[i]!;
      const layer = systemById(componentById(id)?.system ?? "")?.layer ?? "";
      const pose = full({ zoom, pan: { x: 0, y: -(FIELD.y + (i + 0.5) * M.cell) } });
      assert.equal(resolveItem(pose, layer), id, `${id} at zoom ${zoom}`);
    }
  }
});

/* ------------------------------------ rule 13, the quantiser ------------------------------------ */

test("the inverse scale is quantised, monotone and bounded", () => {
  assert.equal(quantise(1), 1);
  assert.equal(quantise(0), 1, "an impossible zoom answers the identity, not NaN");
  assert.equal(quantise(Number.NaN), 1);
  let last = 0;
  const seen = new Set<number>();
  for (let z = 0.1; z < 8; z *= 1.01) {
    const q = quantise(z);
    assert.ok(q >= last, "the quantised scale went backwards");
    last = q;
    seen.add(q);
  }
  assert.ok(seen.size < 30, "the quantiser has too many steps to be one");
  assert.ok(seen.size > QUANT_STEPS_PER_OCTAVE, "the quantiser has too few steps to be smooth");
});

/* ------------------------------ the projection the rails depend on ------------------------------ */

test("the projection is the kit's own camera arithmetic, written out", () => {
  const pose = full({ zoom: 1.7, pan: { x: -120, y: 260 } });
  assert.equal(projectX(-pose.pan.x, pose, FRAME), FRAME.w / 2, "the pan point is not centred");
  assert.equal(projectY(-pose.pan.y, pose, FRAME), FRAME.h / 2);
  /* Doubling the zoom doubles the distance from the middle of the frame. */
  const near = projectY(400, pose, FRAME) - FRAME.h / 2;
  const far = projectY(400, full({ zoom: 3.4, pan: pose.pan }), FRAME) - FRAME.h / 2;
  assert.ok(Math.abs(far - near * 2) < 1e-9);
});

test("a rail entry sits on the middle of the row it heads, at every band", () => {
  for (const zoom of [homeZoom(FRAME), L1_ZOOM, L2_ZOOM]) {
    for (const i of [0, 1, Math.floor(N / 2), N - 1]) {
      const pose = full({ zoom, pan: { x: 0, y: 0 } });
      const top = projectY(FIELD.y + i * M.cell, pose, FRAME);
      const bottom = projectY(FIELD.y + (i + 1) * M.cell, pose, FRAME);
      const mid = rowCentreY(i, pose, FRAME);
      assert.ok(Math.abs(mid - (top + bottom) / 2) < 1e-9, `row ${i} rail is off its row`);
      /* The two axes are the same list, so the column rail is the row rail, turned. */
      const colMid = colCentreX(i, full({ zoom, pan: { x: 0, y: 0 } }), FRAME);
      assert.ok(Math.abs(colMid - (FRAME.w / 2 - FRAME.h / 2 + mid)) < 1e-9);
    }
  }
});

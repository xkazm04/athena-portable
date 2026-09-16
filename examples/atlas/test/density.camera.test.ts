/**
 * THE CAMERA, PINNED — rule 12, rule 14, rule 16, and study part 2 §4.
 *
 *   1. Home is 100 % or more, at every viewport the authoring contract names (1440×900,
 *      1600×1000, 1920×1080). That is the whole difference between this variant and round 5.
 *   2. The band edges sit in gaps no reachable pose lands in, with room for the kit's 8 %
 *      hysteresis either side — so a wheel tick never flaps a level.
 *   3. `poseFor` and `resolve*` are exact inverses. For every layer, for every one of the twelve
 *      nodes, and for every one of the sixty-eight components when one is the standing focus.
 *   4. Zoom-out below home is impossible, because the floor IS home.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import type { CameraPose } from "@athena/demo-kit/zoom";

import { COMPONENTS, LAYER_ORDER } from "../data";
import { BOXES, WORLD, centreOf, layerBox } from "../components/atlas/variants/archify-density/sheet";
import {
  BANDS,
  HOME_MAX,
  HOME_MIN,
  L1_MAX,
  L1_MIN,
  L1_ZOOM,
  L2_ZOOM,
  ZOOM_MAX,
  homeZoom,
  nodeOf,
  poseFor,
  resolveGroup,
  resolveItem,
} from "../components/atlas/variants/archify-density/poses";

const HYSTERESIS = 0.08;

/** The reading column the shell leaves at a viewport: less the claims rail (15rem) and the gutters. */
const columnAt = (w: number) => Math.min(w, 1440) - 240 - 48;

const pose = (p: Partial<CameraPose>): CameraPose => ({
  yaw: 0,
  pitch: 0,
  zoom: 1,
  pan: { x: 0, y: 0 },
  ...p,
});

test("home is 100% or more at every viewport the authoring contract names", () => {
  for (const [w, h] of [
    [1440, 900],
    [1600, 1000],
    [1920, 1080],
  ] as const) {
    /* The canvas gets the stage height less the mast, the title band and the legend strip. A
       generous estimate of that chrome still leaves the fit width-driven, which is the point. */
    const room = h - 56 - 72 - 48 - 72;
    const z = homeZoom({ w: columnAt(w), h: room });
    assert.ok(z >= 1, `home at ${w}x${h} is ${z.toFixed(3)}, under 100%`);
    assert.ok(z <= HOME_MAX);
    /* And the world really does fill the column: at 1440x900 the height clamps the fit to exactly
       archify's floor, which is the point — `HOME_MIN` is 1 and there is no pose further out. */
    assert.ok(
      z === HOME_MIN || Math.abs(z - Math.min(columnAt(w) / WORLD.w, room / 680)) < 1e-9,
      `the fit at ${w}x${h} is neither the floor nor the honest minimum`,
    );
    assert.ok(WORLD.w * z <= columnAt(w) + 1, `the world overflows the column at ${w}x${h}`);
  }
});

test("the band edges sit in gaps no reachable pose lands in", () => {
  const [l1, l2] = BANDS;
  /* Home never reaches the first edge, even at the clamp's ceiling for a realistic column. */
  const widest = homeZoom({ w: columnAt(1920), h: 10000 });
  assert.ok(widest * (1 + HYSTERESIS) < l1, `home ${widest.toFixed(3)} is too close to ${l1}`);
  for (const z of [L1_MIN, L1_ZOOM, L1_MAX]) {
    assert.ok(z > l1 * (1 + HYSTERESIS), `an L1 pose at ${z} is inside the first edge's hysteresis`);
    assert.ok(z * (1 + HYSTERESIS) < l2, `an L1 pose at ${z} is inside the second edge's hysteresis`);
  }
  assert.ok(L2_ZOOM > l2 * (1 + HYSTERESIS), "the L2 pose is inside the second edge's hysteresis");
  assert.ok(L2_ZOOM <= ZOOM_MAX, "the L2 pose is past the wheel's ceiling and cannot be reached");
  assert.equal(HOME_MIN, 1, "archify's camera starts at 100%");
});

test("poseFor and resolveGroup are exact inverses for every layer", () => {
  for (const layer of LAYER_ORDER) {
    if (!layerBox(layer)) continue;
    const p = pose(poseFor({ level: 1, group: layer, item: null }, { w: 1152, h: 680 }));
    assert.equal(resolveGroup(p), layer, `the camera at ${layer}'s pose is over ${resolveGroup(p)}`);
    assert.ok(p.zoom >= L1_MIN && p.zoom <= L1_MAX, `${layer} is framed at ${p.zoom}, outside band 1`);
  }
});

test("poseFor and resolveItem are exact inverses for every node's primary", () => {
  for (const box of BOXES) {
    assert.ok(box.primary, `${box.id} has no primary component`);
    const p = pose(poseFor({ level: 2, group: box.layer, item: box.primary }, { w: 1152, h: 680 }));
    assert.equal(p.zoom, L2_ZOOM);
    assert.deepEqual(p.pan, { x: WORLD.w / 2 - centreOf(box).x, y: WORLD.h / 2 - centreOf(box).y });
    assert.equal(resolveItem(p, null), box.primary, `${box.id} does not answer with its own primary`);
    assert.equal(resolveGroup(p), box.layer);
  }
});

test("a standing passport survives the wheel — all sixty-eight round-trip", () => {
  for (const component of COMPONENTS) {
    const box = nodeOf(component.id);
    assert.ok(box, `${component.id} has no node`);
    const p = pose(poseFor({ level: 2, group: box.layer, item: component.id }, { w: 1152, h: 680 }));
    assert.equal(
      resolveItem(p, component.id),
      component.id,
      `${component.id} is lost when the camera arrives at its own pose`,
    );
  }
});

test("home looks at the middle of the world", () => {
  const p = pose(poseFor({ level: 0, group: null, item: null }, { w: 1152, h: 680 }));
  assert.deepEqual(p.pan, { x: 0, y: 0 }, "the world's centre is the camera's rest position");
});

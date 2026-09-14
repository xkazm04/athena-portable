// The camera, as arithmetic — `docs/kit-camera-contract.md` §1–§2, the half that can be wrong.
//
// `src/zoom/camera.ts` is deliberately React-free and DOM-free so the pointer-anchored zoom, the
// inertia decay and the transform composition can be pinned here, without a browser and without
// a renderer. `useCameraRig` is the thin part.

import assert from "node:assert/strict";
import { test } from "node:test";

import {
  FRAME_MS,
  REST_POSE,
  ZERO_VELOCITY,
  clampPose,
  easeFromCss,
  isNegligible,
  lerpPose,
  mergePose,
  nearestSnap,
  orbitDelta,
  panDelta,
  poseToTransform,
  samePose,
  stepInertia,
  zoomAt,
  type CameraBounds,
  type CameraPose,
} from "../src/zoom/camera.ts";

const pose = (p: Partial<CameraPose> = {}): CameraPose => mergePose(REST_POSE, p);
const BOUNDS: CameraBounds = { zoom: [0.5, 8] };
const near = (a: number, b: number, eps = 1e-9) =>
  assert.ok(Math.abs(a - b) < eps, `${a} !== ${b}`);

/* ------------------------------------------------------------------------------- pose and bounds */

test("the resting pose is the frame at its own size, straight on", () => {
  assert.deepEqual(REST_POSE, { yaw: 0, pitch: 0, zoom: 1, pan: { x: 0, y: 0 } });
});

test("zoom is the one bound that is required, and it is clamped both ways", () => {
  assert.equal(clampPose(pose({ zoom: 99 }), BOUNDS).zoom, 8);
  assert.equal(clampPose(pose({ zoom: 0.01 }), BOUNDS).zoom, 0.5);
});

test("yaw is free unless a range is given — a turntable goes all the way round", () => {
  assert.equal(clampPose(pose({ yaw: 40 }), BOUNDS).yaw, 40);
  assert.equal(clampPose(pose({ yaw: 40 }), { ...BOUNDS, yaw: "free" }).yaw, 40);
  assert.equal(clampPose(pose({ yaw: 40 }), { ...BOUNDS, yaw: [-1, 1] }).yaw, 1);
});

test("pitch and pan are clamped only when the surface says what they mean", () => {
  const free = clampPose(pose({ pitch: 9, pan: { x: 900, y: -900 } }), BOUNDS);
  assert.equal(free.pitch, 9);
  assert.deepEqual(free.pan, { x: 900, y: -900 });

  const held = clampPose(pose({ pitch: 9, pan: { x: 900, y: -900 } }), {
    ...BOUNDS,
    pitch: [0, 1],
    pan: { x: [-100, 100], y: [-100, 100] },
  });
  assert.equal(held.pitch, 1);
  assert.deepEqual(held.pan, { x: 100, y: -100 });
});

test("a pose poisoned by a division by zero reads as the resting value, not as NaN", () => {
  const bad = clampPose({ yaw: NaN, pitch: NaN, zoom: NaN, pan: { x: NaN, y: 0 } }, BOUNDS);
  assert.deepEqual(bad, { yaw: 0, pitch: 0, zoom: 1, pan: { x: 0, y: 0 } });
});

/* --------------------------------------------------------------------------- the anchored zoom */

test("zoomAt keeps the point under the pointer exactly where it was", () => {
  // The whole difference between a camera and a slider. Project the anchor's scene point before
  // and after: `screen = zoom · (world + pan)`, and the screen offset must not move.
  const frame = { w: 800, h: 600 };
  const anchor = { x: 700, y: 120 };
  const before = pose({ zoom: 1.5, pan: { x: 30, y: -12 } });
  const after = zoomAt(before, 2, anchor, frame);

  const offset = { x: anchor.x - frame.w / 2, y: anchor.y - frame.h / 2 };
  const world = { x: offset.x / before.zoom - before.pan.x, y: offset.y / before.zoom - before.pan.y };
  near(after.zoom * (world.x + after.pan.x), offset.x);
  near(after.zoom * (world.y + after.pan.y), offset.y);
});

test("zooming at the centre is a plain zoom — no pan at all", () => {
  const after = zoomAt(pose(), 3, { x: 400, y: 300 }, { w: 800, h: 600 });
  assert.equal(after.zoom, 3);
  assert.deepEqual(after.pan, { x: 0, y: 0 });
});

test("in and out by the same factor comes back to where it started", () => {
  const frame = { w: 640, h: 480 };
  const anchor = { x: 40, y: 400 };
  const there = zoomAt(pose({ zoom: 2 }), 1.4, anchor, frame);
  const back = zoomAt(there, 1 / 1.4, anchor, frame);
  assert.ok(samePose(back, pose({ zoom: 2 })));
});

test("an element that has not been laid out yet anchors at its centre rather than dividing by 0", () => {
  const after = zoomAt(pose(), 2, { x: 0, y: 0 }, { w: 0, h: 0 });
  assert.equal(after.zoom, 2);
  assert.deepEqual(after.pan, { x: 0, y: 0 });
});

/* --------------------------------------------------------------------------------- the coasting */

test("inertia advances the pose by the velocity and then decays it", () => {
  const v = { ...ZERO_VELOCITY, yaw: 0.01 };
  const step = stepInertia(pose(), v, 0.9, FRAME_MS);
  near(step.pose.yaw, 0.01 * FRAME_MS);
  near(step.velocity.yaw, 0.01 * 0.9);
});

test("the decay is per FRAME, so a slow tab coasts the same distance as a fast one", () => {
  // Two frames at 60Hz and one frame's worth of two-frame time must leave the same velocity,
  // or a camera glides twice as far on a machine that is dropping frames.
  const v = { ...ZERO_VELOCITY, pan: { x: 1, y: 0 } };
  const twice = stepInertia(pose(), stepInertia(pose(), v, 0.9, FRAME_MS).velocity, 0.9, FRAME_MS);
  const once = stepInertia(pose(), v, 0.9, FRAME_MS * 2);
  near(twice.velocity.pan.x, once.velocity.pan.x, 1e-12);
});

test("retain 0 is no inertia: this frame still moves, the next one does not", () => {
  const v = { ...ZERO_VELOCITY, pan: { x: 2, y: 0 } };
  const step = stepInertia(pose(), v, 0, FRAME_MS);
  near(step.pose.pan.x, 2 * FRAME_MS);
  assert.equal(step.velocity.pan.x, 0);
});

test("a velocity that cannot move a visible amount in a frame is over", () => {
  assert.equal(isNegligible(ZERO_VELOCITY), true);
  assert.equal(isNegligible({ ...ZERO_VELOCITY, yaw: 1e-9 }), true);
  assert.equal(isNegligible({ ...ZERO_VELOCITY, yaw: 0.01 }), false);
});

/* ------------------------------------------------------------------------------------- the rest */

test("the nearest snap is the nearest, and ties go to the one listed first", () => {
  const a = pose({ zoom: 1 });
  const b = pose({ zoom: 4 });
  assert.equal(nearestSnap(pose({ zoom: 1.2 }), [a, b]), a);
  assert.equal(nearestSnap(pose({ zoom: 3.5 }), [a, b]), b);
  assert.equal(nearestSnap(pose(), [a, { ...a }]), a);
  assert.equal(nearestSnap(pose(), []), null);
});

test("zoom distance is a RATIO, so 1→2 and 2→4 are the same move", () => {
  const one = nearestSnap(pose({ zoom: 2 }), [pose({ zoom: 1 }), pose({ zoom: 4 })]);
  // Equidistant in log space; the tie goes to the first.
  assert.equal(one?.zoom, 1);
});

test("a drag is radians, and a pan is screen pixels divided by the zoom", () => {
  assert.deepEqual(orbitDelta(100, -50, 0.01), { yaw: 1, pitch: -0.5 });
  assert.deepEqual(panDelta(100, 40, 4), { x: 25, y: 10 });
  assert.deepEqual(panDelta(100, 40, 0), { x: 0, y: 0 });
});

test("poseToTransform composes the frame of reference the anchored zoom inverts", () => {
  assert.equal(
    poseToTransform(pose({ zoom: 2, pan: { x: 10, y: -5 } })),
    "translate(20px, -10px) scale(2) rotateX(0deg) rotateY(0deg)",
  );
});

test("perspective is the parent's unless asked for, and then it comes first", () => {
  assert.ok(!poseToTransform(pose()).includes("perspective"));
  assert.ok(poseToTransform(pose(), { perspective: 900 }).startsWith("perspective(900px) "));
});

test("radians reach CSS as degrees", () => {
  assert.ok(poseToTransform(pose({ yaw: Math.PI / 2 })).includes("rotateY(90deg)"));
});

test("a fly interpolates zoom GEOMETRICALLY, so it does not appear to stall halfway", () => {
  const half = lerpPose(pose({ zoom: 1 }), pose({ zoom: 16 }), 0.5);
  assert.equal(half.zoom, 4); // not 8.5
  assert.equal(lerpPose(pose({ zoom: 1 }), pose({ zoom: 16 }), 0).zoom, 1);
  assert.equal(lerpPose(pose({ zoom: 1 }), pose({ zoom: 16 }), 1).zoom, 16);
});

test("yaw takes the short way round", () => {
  const from = pose({ yaw: -3 });
  const to = pose({ yaw: 3 });
  // The short way is backwards through ±π, not forwards through 0.
  assert.ok(lerpPose(from, to, 0.5).yaw < -3);
});

test("mergePose takes only what the patch names, pan axis by axis", () => {
  const base = pose({ zoom: 2, pan: { x: 5, y: 6 } });
  assert.deepEqual(mergePose(base, { pan: { x: 9 } as { x: number; y: number } }).pan, { x: 9, y: 6 });
  assert.equal(mergePose(base, { yaw: 1 }).zoom, 2);
});

test("an ease from the cascade starts at 0, ends at 1 and never runs backwards", () => {
  for (const raw of ["linear", "ease-in-out", "cubic-bezier(0.2, 0, 0, 1)", "", "steps(4)"]) {
    const ease = easeFromCss(raw);
    near(ease(0), 0, 1e-6);
    near(ease(1), 1, 1e-6);
    let last = -1;
    for (let t = 0; t <= 1; t += 0.05) {
      const v = ease(t);
      assert.ok(v >= last - 1e-6, `${raw} went backwards at ${t}`);
      last = v;
    }
  }
});

test("linear is exactly linear, and the kit's curve is not", () => {
  near(easeFromCss("linear")(0.25), 0.25, 1e-9);
  assert.ok(easeFromCss("cubic-bezier(0.2, 0, 0, 1)")(0.25) > 0.25);
});

/**
 * The blocks UI: what the camera, the dossier and the sheet chrome promise, held to the code.
 *
 * The components are JSX and this runner strips types without compiling JSX, so two kinds of check
 * live here: the pure arithmetic the components call (imported and run), and the words a component
 * prints or announces (read from the source with comments stripped first, so a comment that talks
 * about a rule cannot satisfy it).
 *
 *   node --experimental-transform-types --import ./test/register.mjs --test "test/**\/*.test.ts"
 */
import assert from "node:assert/strict";
import { test } from "node:test";

const { wheelPose } = await import("../components/blocks/space/useWheelZoom");
const { BOUNDS, REST } = await import("../components/blocks/space/camera");
const { clampPose } = await import("@athena/demo-kit/zoom");

/* ------------------------------------------------------------------ the wheel */

const BOX = { left: 0, top: 0, width: 1200, height: 800 };
/** A notch at a corner, so the anchor pulls the pan hard if the step solves it. */
const notch = (deltaY: number) => ({ deltaY, deltaMode: 0, clientX: 1100, clientY: 700 });

/** One notch as the rig lands it: `rig.set` clamps the pose it is handed to the bounds. */
const step = (pose: typeof REST, deltaY: number) =>
  clampPose(wheelPose(pose, notch(deltaY), BOX, BOUNDS.zoom), BOUNDS);

test("ten wheel notches past either zoom bound leave the pose where it stood", () => {
  for (const [label, zoom, deltaY] of [
    ["in, at the maximum", BOUNDS.zoom[1], -120],
    ["out, at the minimum", BOUNDS.zoom[0], 120],
  ] as const) {
    const start = { ...REST, zoom };
    let pose = start;
    for (let i = 0; i < 10; i += 1) pose = step(pose, deltaY);
    assert.equal(pose.zoom, zoom, `${label}: the zoom stays at its bound`);
    assert.deepEqual(pose.pan, start.pan, `${label}: the pan does not slide toward the pointer`);
  }
});

test("inside the bounds the wheel still zooms at the pointer", () => {
  const pose = step(REST, -120);
  assert.ok(pose.zoom > REST.zoom, "a notch in zooms in");
  assert.notDeepEqual(pose.pan, REST.pan, "and keeps the point under the pointer, which moves the pan");
});

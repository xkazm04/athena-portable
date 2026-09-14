/**
 * The lens the one scene is seen through.
 *
 * Two numbers. Round 2's version of this file was called `flatten.ts` and held
 * six: the plane the L0 picture flattened into (`FLAT_W`, `FLAT_H`,
 * `FLAT_COLS`, `CLUSTER_FILL`), the fraction of a canvas that plane covered,
 * and where one table's cluster came to rest on it. All of it existed for the
 * hand-off between a WebGL L0 and a DOM L1 — the picture read it to decide
 * where a cluster landed, the DOM read it to start a cell exactly on top.
 *
 * ROUND 3 DELETED THE HAND-OFF. L0 and L1 are the same scene at two camera
 * distances, so there is nothing to flatten onto and nothing to measure: where
 * a table is, is `space/geometry.ts`, and how the camera gets there is
 * `space/camera.ts`. What is left is the lens itself, which both of those read
 * and `World.tsx` hands to three, so the arithmetic and the renderer cannot
 * drift about how wide the frame is.
 */

/**
 * Where the camera stands at rest, in world units, and the angle it sees
 * through.
 *
 * `CAMERA_Z` is also the unit `CameraPose.zoom` is measured against: the eye is
 * `CAMERA_Z / zoom` from what it is looking at, so zoom 1 is this distance and
 * zoom 2 is half of it. See `space/camera.ts`.
 */
export const CAMERA_Z = 9.5;
export const CAMERA_FOV = 30;

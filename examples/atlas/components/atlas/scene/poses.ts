/**
 * THE APP'S OPINIONS ABOUT THE CAMERA, with nothing React in them.
 *
 * The bands, the bounds, the resting pose and the idle snaps are Atlas's contribution to the
 * camera contract — the rig, the loop and the inertia are the kit's. Keeping them in a module
 * that imports nothing lets the pure aiming (`aim.ts`) and its tests read them without dragging a
 * hook and a package boundary in behind.
 */

/** Structurally the contract's `CameraPose`, re-declared so this module imports nothing. */
export interface PoseLike {
  yaw: number;
  pitch: number;
  zoom: number;
  pan: { x: number; y: number };
}

/**
 * The bands. Zoom is a distance divisor (`REST_DIST / zoom`), so these are "how much closer than
 * the resting frame", and they are the app's only opinion about what counts as near.
 *
 *   < 1.55   L0 — the whole machine, six planes in the frame
 *   1.55     L1 — one stratum cut open, its blocks open to show their parts
 *   3.6      L2 — a part, close enough that the pane it raises is the thing you are reading
 */
export const BANDS: readonly [number, number] = [1.55, 3.6];

/** The resting pose: three-quarters on, a little above, the whole stack in frame. */
export const HOME_POSE: PoseLike = { yaw: -0.5, pitch: 0.42, zoom: 1, pan: { x: 0, y: 0 } };

/**
 * The idle snaps — the "few good poses" of the brief.
 *
 * Three, and all of them readings of the whole machine: a reader who has walked around it and let
 * go should settle onto a view of it rather than on whatever angle their finger stopped at. They
 * are weak by construction — the kit's `nearestSnap` weights pan at a hundredth — so a reader who
 * has panned somewhere deliberate is not dragged back out of it.
 */
export const SNAPS: readonly PoseLike[] = [
  HOME_POSE,
  { yaw: 0, pitch: 0.16, zoom: 1, pan: { x: 0, y: 0 } },
  { yaw: -1.2, pitch: 0.6, zoom: 0.9, pan: { x: 0, y: 0 } },
];

/**
 * THE SNAP IS AN ORIENTATION, NEVER A DISTANCE. This was the round's most instructive bug.
 *
 * The contract offers `snap` as a list of poses applied when the camera goes idle, and a list is
 * the obvious thing to hand it. But in a direction where DISTANCE IS THE LEVEL, a snap that
 * includes `zoom` un-zooms the reader the moment they stop turning the wheel — so semantic zoom
 * silently stopped working, the level never changed, and the symptom was "the wheel does nothing"
 * rather than anything that looked like a snap. A pose is four numbers and only two of them are
 * about where the reader is STANDING; the other two are about where they are LOOKING.
 *
 * So the snap is a function: it keeps zoom and pan exactly as the reader left them, nudges yaw
 * and pitch to the nearest of the three good orientations, and declines entirely once the camera
 * is inside a level — at L1 and L2 the nav is flying the camera and a snap would fight it.
 *
 * Pure, so `test/scene.test.ts` can pin the property that actually matters: a snap never changes
 * the level.
 */
export function snapPose(pose: PoseLike): PoseLike {
  if (pose.zoom >= BANDS[0]) return pose;
  const wrap = (a: number): number => Math.atan2(Math.sin(a), Math.cos(a));
  let best = SNAPS[0]!;
  let bestD = Infinity;
  for (const s of SNAPS) {
    const d = Math.abs(wrap(s.yaw - pose.yaw)) + Math.abs(s.pitch - pose.pitch);
    if (d < bestD) {
      bestD = d;
      best = s;
    }
  }
  return { yaw: best.yaw, pitch: best.pitch, zoom: pose.zoom, pan: pose.pan };
}

/**
 * What the camera may do. Yaw is free (the machine is worth walking around); pitch is clamped
 * short of straight down and straight up, because at the poles the view basis degenerates and the
 * stack collapses into a single line, which is a picture of nothing.
 */
export const BOUNDS = {
  yaw: "free" as const,
  pitch: [-0.25, 1.15] as [number, number],
  zoom: [0.55, 6] as [number, number],
  pan: { x: [-160, 160] as [number, number], y: [-160, 160] as [number, number] },
};

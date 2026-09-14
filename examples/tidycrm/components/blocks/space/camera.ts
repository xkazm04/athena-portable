/**
 * THE CAMERA, as this sheet consumes it.
 *
 * `@athena/demo-kit/zoom` owns the RIG — the pose, the drag, the wheel, the
 * inertia, the snap, the flight — and by contract it never imports `three`. So
 * every WebGL scene has to answer one question for itself: *given a pose, where
 * is the eye and what is it looking at?* This file is this sheet's answer, and
 * it is pure arithmetic so that it can be pinned without a renderer.
 *
 * THE POSE HAS FOUR DEGREES OF FREEDOM AND A CUBE HAS SIX. `CameraPose` carries
 * `yaw`, `pitch`, `zoom` and a two-component `pan`; a camera flying into the
 * top-front-left octant has to look at a point that is not the origin, which is
 * three numbers. The contract has no room for it, and the encoding below is the
 * way out rather than a fork:
 *
 *   any world point T decomposes in the view basis as
 *       T = (T·right) right + (T·up) up + (T·dir) dir
 *   so PAN carries the two components across the viewing plane exactly, and the
 *   third — how far T is along the view axis — is absorbed into ZOOM, because
 *   "further along the view axis" and "closer to the eye" are the same fact.
 *
 * It is exact, not an approximation (`poseLookingAt` and `eyeOf` round-trip, and
 * the test asserts it), it keeps every rig feature working on an off-origin
 * target, and it costs one thing: `pan` no longer means "slide the picture", it
 * means "which point in the origin plane is the camera on". A reader dragging
 * with shift still gets what they expect; a READER of this code does not, which
 * is why this paragraph is here. It is logged as a kit gap.
 */

import { CAMERA_FOV, CAMERA_Z, DATABASE_IDS, DB_OCTANT } from "../model";
import { boxOf, slotOf, slotWorld, type Basis, type CellBox, type Vec3 } from "./geometry";

/**
 * The kit's `CameraPose`, restated structurally.
 *
 * Not imported, deliberately: this module is `node --test`-able and the kit's
 * `zoom` barrel is React. The two are structurally identical, so a `CameraPose`
 * is a `Pose` and back without a cast, and the day they diverge every consumer
 * stops compiling — which is the notice we want.
 */
export interface Pose {
  yaw: number;
  pitch: number;
  zoom: number;
  pan: { x: number; y: number };
}

/* --------------------------------------------------------------- vectors */

const dot = (a: Vec3, b: Vec3): number => a.x * b.x + a.y * b.y + a.z * b.z;

/**
 * The view basis at a pose's orientation.
 *
 * `dir` points from the subject TOWARD the eye, which is three.js's convention
 * for a camera's local +Z and the one that keeps `position = target + dir * d`
 * readable. At yaw 0 / pitch 0 the eye is on +Z looking down −Z, `right` is +X
 * and `up` is +Y; positive pitch lifts the eye, so the reader looks DOWN.
 */
export function basisOf(yaw: number, pitch: number): Basis {
  const cp = Math.cos(pitch);
  const sp = Math.sin(pitch);
  const cy = Math.cos(yaw);
  const sy = Math.sin(yaw);
  const dir: Vec3 = { x: sy * cp, y: sp, z: cy * cp };
  const right: Vec3 = { x: cy, y: 0, z: -sy };
  // up = dir x right, which is a unit vector because dir and right are
  // orthonormal by construction (right has no y component and dir's horizontal
  // part is parallel to yaw).
  const up: Vec3 = {
    x: dir.y * right.z - dir.z * right.y,
    y: dir.z * right.x - dir.x * right.z,
    z: dir.x * right.y - dir.y * right.x,
  };
  return { right, up, dir };
}

/** Where the eye is and what it is looking at, for a pose. Both in world units. */
export function eyeOf(pose: Pose): { eye: Vec3; target: Vec3; basis: Basis } {
  const basis = basisOf(pose.yaw, pose.pitch);
  const d = CAMERA_Z / Math.max(0.01, pose.zoom);
  const target: Vec3 = {
    x: pose.pan.x * basis.right.x + pose.pan.y * basis.up.x,
    y: pose.pan.x * basis.right.y + pose.pan.y * basis.up.y,
    z: pose.pan.x * basis.right.z + pose.pan.y * basis.up.z,
  };
  return {
    basis,
    target,
    eye: { x: target.x + basis.dir.x * d, y: target.y + basis.dir.y * d, z: target.z + basis.dir.z * d },
  };
}

/** The pose whose eye sits `away` world units from `at`, along `yaw`/`pitch`. */
export function poseLookingAt(at: Vec3, yaw: number, pitch: number, away: number): Pose {
  const b = basisOf(yaw, pitch);
  return {
    yaw,
    pitch,
    zoom: CAMERA_Z / (away + dot(at, b.dir)),
    pan: { x: dot(at, b.right), y: dot(at, b.up) },
  };
}

/* ------------------------------------------------------------- the poses */

/**
 * The four poses the cube snaps to when the reader lets go near one.
 *
 * Round 2 had four poses and NO drag — "3D canvas is tough to manipulate with
 * mouse drags" was the review's finding and removing the drag was the answer.
 * The owner's round-3 note reverses it: the drag has to work, and the wheel has
 * to zoom. So the four are not a navigation model any more, they are a MAGNET:
 * a pose released within `SNAP_NEAR` of one is put on it, and a pose anywhere
 * else is left exactly where the reader put it. Named, because a caption that
 * can say "front" is worth more than one that can say 0.47 radians.
 *
 * They are camera poses now, not group rotations. Round 2 turned the object and
 * left the camera still; the conversion is `yaw = -group.y`, `pitch = group.x`,
 * and the values below are round 2's four through it — but for `front`, which
 * is lifted from pitch 0.16 to 0.30 because a camera that can orbit wants a
 * resting pose that already shows three faces.
 */
export interface NamedPose {
  id: string;
  label: string;
  yaw: number;
  pitch: number;
}

export const POSES: readonly NamedPose[] = [
  { id: "front", label: "front", yaw: 0.42, pitch: 0.3 },
  { id: "right", label: "right", yaw: 1.15, pitch: 0.16 },
  { id: "top", label: "top", yaw: 0.42, pitch: 0.92 },
  { id: "left", label: "left", yaw: -0.32, pitch: 0.16 },
];

/** How near a named pose the reader has to stop for the magnet to take, in
 *  radians. About nine degrees on each axis: close enough that it reads as
 *  tidying up, far enough that it never takes a pose the reader chose. */
export const SNAP_NEAR = 0.16;

/** The resting pose: the whole cube, all nine cells, nothing opened. */
export const REST: Pose = {
  yaw: POSES[0]!.yaw,
  pitch: POSES[0]!.pitch,
  zoom: 1,
  pan: { x: 0, y: 0 },
};

/**
 * What the reader may do to the camera, and where it stops.
 *
 * `yaw` is free — a cube has no front. `pitch` stops short of the poles because
 * a camera looking straight down a cube has no horizon and nothing to recover
 * by. `zoom` runs from the whole sheet in one frame to inside one octant.
 */
export const BOUNDS = {
  yaw: "free" as const,
  pitch: [-1.28, 1.28] as [number, number],
  zoom: [0.5, 6.5] as [number, number],
};

/**
 * Where a database is looked at from.
 *
 * Yaw faces the octant's own corner, so flying in is a turn TOWARD it rather
 * than a slide across the front of the cube; pitch rises for the top four and
 * dips only slightly for the bottom four, because a camera that drops fully
 * under the cube loses the eight cells the reader is meant to keep in view. The
 * core keeps the resting orientation: it has no corner to face.
 */
export function faceOf(id: string): { yaw: number; pitch: number } {
  const at = DB_OCTANT[id];
  if (!at || at.core) return { yaw: REST.yaw, pitch: REST.pitch };
  return { yaw: Math.atan2(at.sx, at.sz), pitch: at.sy > 0 ? 0.46 : -0.1 };
}

/**
 * How square-on a slab has to be before its label is worth printing.
 *
 * The cosine between the camera's view direction and the direction the slabs
 * were laid out facing. At 0.45 a reader may turn about sixty degrees off the
 * face and still read the rank; past that the cards are edge-on, their
 * projections overlap, and the honest thing is to draw the boxes alone and let
 * turning back bring the words back.
 */
export const FACING_FLOOR = 0.45;

/**
 * The share of the frame's height one octant fills once the camera is inside it.
 *
 * Nearly all of it, and that is what makes the level legible: six table slabs
 * inside a cube are a 3x2 grid of PORTRAIT cards, each about a seventh of the
 * octant's width, so anything less than filling the frame puts the type below
 * the size it can be read at. The octant's own wire edges stay just inside the
 * frame, which is what tells the reader they are inside something.
 */
export const FRAME_FILL = 0.88;

/** World units visible across the frame's height, at one unit of distance. */
const UNITS_PER_UNIT = 2 * Math.tan(((CAMERA_FOV / 2) * Math.PI) / 180);

/** How far the eye stands off a cell of this size to frame it. */
export function standOff(box: CellBox): number {
  return box.w / UNITS_PER_UNIT / FRAME_FILL;
}

/**
 * Where the camera goes for a focus — the one function a click, a wheel, an
 * Escape and an agent's `open_group` all end up in.
 *
 * L2 is L1's pose, unchanged, and that is a decision rather than an omission:
 * the dossier is a DOM pane that rises out of its table, and a camera that
 * moved under it would drag the pane's own origin out from under it. The camera
 * holds; see `DESIGN.md` §8.
 */
export function poseFor(focus: { level: number; group: string | null }): Pose {
  if (focus.level < 1 || focus.group === null) return REST;
  const box = boxOf(focus.group);
  const { yaw, pitch } = faceOf(focus.group);
  return poseLookingAt({ x: box.cx, y: box.cy, z: box.cz }, yaw, pitch, standOff(box));
}

/**
 * The zoom at which the level changes, and the one that is never reached.
 *
 * The first is measured, not chosen: `poseFor` puts a corner octant at about
 * 2.3 and the core at about 5.8, and 1.45 is below every one of the nine with
 * room for the hysteresis band. The second is deliberately past the zoom bound,
 * because L2 IS NOT A CAMERA DISTANCE on this sheet — the dossier is a DOM pane
 * and the camera holds for it. `useSemanticZoom` wants two numbers; this is the
 * honest way to give it two when the surface has one.
 */
export const BANDS: readonly [l1: number, l2: number] = [1.45, 99];

/* --------------------------------------------------- what is under the camera */

/** How far a world point sits off the camera's view axis. */
export function offAxis(p: Vec3, pose: Pose): number {
  const { eye, basis } = eyeOf(pose);
  const rel = { x: p.x - eye.x, y: p.y - eye.y, z: p.z - eye.z };
  const along = dot(rel, basis.dir);
  return Math.hypot(rel.x - along * basis.dir.x, rel.y - along * basis.dir.y, rel.z - along * basis.dir.z);
}

/**
 * Which database the camera is pointed at, or none.
 *
 * Nearest cell centre to the view AXIS, within that cell's own half-side. Not
 * "nearest to the eye": a reader zooming toward a corner passes through the
 * space between two octants, and the one they are aiming at is the one on the
 * axis, not the one they happen to be beside. The wheel is anchored at the
 * pointer, so aiming is what zooming in on something IS.
 */
export function resolveGroup(pose: Pose): string | null {
  let best: string | null = null;
  let bestOff = Infinity;
  for (const id of DATABASE_IDS) {
    const box = boxOf(id);
    const off = offAxis({ x: box.cx, y: box.cy, z: box.cz }, pose);
    if (off < box.w * 0.72 && off < bestOff) {
      bestOff = off;
      best = id;
    }
  }
  return best;
}

/** Which table inside a database the camera is pointed at, by the same rule. */
export function resolveItem(pose: Pose, group: string, idents: readonly string[]): string | null {
  const box = boxOf(group);
  const basis = basisOf(pose.yaw, pose.pitch);
  let best: string | null = null;
  let bestOff = Infinity;
  idents.forEach((ident, i) => {
    const slot = slotOf(i, idents.length, box);
    const off = offAxis(slotWorld(slot, box, basis), pose);
    if (off < slot.w * 0.6 && off < bestOff) {
      bestOff = off;
      best = ident;
    }
  });
  return best;
}

/* ----------------------------------------------------------- the projection */

export interface Projected {
  /** Pixels from the frame's leading edge / top. */
  x: number;
  y: number;
  /** World units in front of the eye. Not positive means behind it. */
  depth: number;
  /** Pixels per world unit at that depth. Zero when the point is behind. */
  scale: number;
}

/**
 * A world point, in the canvas's own pixels.
 *
 * This is what lets L1's labels be DOM rather than sprites. The choice is
 * argued in `Field.tsx`; the arithmetic is here, and it is the same perspective
 * divide three.js does, restated so a test can hold it to the scene.
 */
export function project(p: Vec3, pose: Pose, frame: { w: number; h: number }): Projected {
  const { eye, basis } = eyeOf(pose);
  const rel = { x: p.x - eye.x, y: p.y - eye.y, z: p.z - eye.z };
  const depth = -dot(rel, basis.dir);
  if (depth <= 0.01) return { x: 0, y: 0, depth, scale: 0 };
  const focal = frame.h / 2 / Math.tan(((CAMERA_FOV / 2) * Math.PI) / 180);
  return {
    x: frame.w / 2 + (dot(rel, basis.right) * focal) / depth,
    y: frame.h / 2 - (dot(rel, basis.up) * focal) / depth,
    depth,
    scale: focal / depth,
  };
}

/* ------------------------------------------------------------- the magnet */

/**
 * The snap, as the rig's `snap` option wants it: a pose in, a pose out.
 *
 * It declines twice. Inside a database there is nothing to snap to — the four
 * poses are readings of the whole cube — and further than `SNAP_NEAR` from all
 * four the reader has chosen a pose of their own and it is not ours to tidy.
 * "Do not fight the user" is the whole of the owner's note about the canvas.
 */
export function snapNear(pose: Pose, inside: boolean): Pose {
  if (inside) return pose;
  let best: NamedPose | null = null;
  let bestOff = Infinity;
  for (const p of POSES) {
    // Yaw is free and wraps, so the distance is around the circle.
    const dy = Math.abs(((pose.yaw - p.yaw + Math.PI) % (2 * Math.PI)) - Math.PI);
    const off = Math.hypot(dy, pose.pitch - p.pitch);
    if (off < bestOff) {
      bestOff = off;
      best = p;
    }
  }
  if (!best || bestOff > SNAP_NEAR) return pose;
  return { ...pose, yaw: best.yaw, pitch: best.pitch };
}

/** Which named pose the caption may claim, or null if the reader is between them. */
export function poseName(pose: Pose): string | null {
  for (const p of POSES) {
    const dy = Math.abs(((pose.yaw - p.yaw + Math.PI) % (2 * Math.PI)) - Math.PI);
    if (Math.hypot(dy, pose.pitch - p.pitch) <= SNAP_NEAR) return p.label;
  }
  return null;
}

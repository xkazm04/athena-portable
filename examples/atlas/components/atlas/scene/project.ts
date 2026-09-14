/**
 * ONE CAMERA, THREE RENDERERS. The pose-to-screen arithmetic, pure and shared.
 *
 * The camera contract (`docs/kit-camera-contract.md` §1) says a pose is yaw, pitch, zoom and pan
 * and says nothing about what a renderer does with it, deliberately: "WebGL scenes read
 * `rig.get()` and set the camera themselves — the kit never touches three". Which leaves three
 * renderers free to disagree about where the camera IS, and a comparison between three
 * disagreeing cameras is not a comparison. So this module turns a pose into an eye position and
 * a view basis ONCE, and:
 *
 *   webgl   copies `eye` and `target` onto a `PerspectiveCamera`
 *   css3d   projects every scene point through `project()` into the SVG overlay, and builds the
 *           same view as a CSS `transform` chain for the DOM planes
 *   hybrid  runs the webgl camera and projects the DOM labels through `project()`
 *
 * Same pose in, same picture out, and a scrub of the transport moves all three identically.
 *
 * THE MODEL. The camera orbits `SCENE_CENTRE` on a sphere: yaw around +Y, pitch above the
 * horizon, and a radius that shrinks as zoom grows (`REST_DIST / zoom`) so that "zoom" in the
 * contract's sense — "1 = the resting frame" — is a distance, which is what makes semantic zoom
 * "camera distance is the level" (contract §3) literally true rather than a metaphor.
 *
 * Pan slides the orbit centre in the camera's own right/up plane, which is what a reader means
 * by dragging the scene sideways; panning in world axes makes the scene appear to swing.
 */
import { SCENE_CENTRE, type Vec3 } from "./layout";

/** The camera pose. Structurally the contract's `CameraPose`, re-declared so this module is pure. */
export interface Pose {
  yaw: number;
  pitch: number;
  zoom: number;
  pan: { x: number; y: number };
}

export const REST: Pose = { yaw: 0, pitch: 0, zoom: 1, pan: { x: 0, y: 0 } };

/**
 * The distance the camera sits at when `zoom` is 1 — the resting frame of the whole machine.
 *
 * Chosen against the geometry rather than by feel: the machine's half-extents are about 107 across
 * (a plane's half-width plus the risers), 109 up (five stratum gaps plus a block) and 31 deep, and
 * a pinhole with this field of view shows a half-height of `0.34 · d`. At 445 the whole stack
 * sits inside about three quarters of the frame with the riser pipes and the stratum names in
 * the margin — which is what L0 has to be: the WHOLE machine, with room to see that it is one.
 */
export const REST_DIST = 445;

/** Vertical field of view, in radians. Narrow enough that the stack does not keystone. */
export const FOV = 0.66;

export interface Frame {
  w: number;
  h: number;
}

export interface View {
  eye: Vec3;
  target: Vec3;
  /** The orthonormal basis: right, up, forward (forward points from eye to target). */
  right: Vec3;
  up: Vec3;
  forward: Vec3;
}

const cross = (a: Vec3, b: Vec3): Vec3 => ({
  x: a.y * b.z - a.z * b.y,
  y: a.z * b.x - a.x * b.z,
  z: a.x * b.y - a.y * b.x,
});
const dot = (a: Vec3, b: Vec3): number => a.x * b.x + a.y * b.y + a.z * b.z;
const scale = (a: Vec3, k: number): Vec3 => ({ x: a.x * k, y: a.y * k, z: a.z * k });
const add = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z });
const sub = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
const unit = (a: Vec3): Vec3 => {
  const l = Math.sqrt(dot(a, a));
  return l === 0 ? { x: 0, y: 0, z: 1 } : scale(a, 1 / l);
};

/**
 * The eye, the target and the basis for a pose.
 *
 * Pure and cheap — it is called once per frame per renderer, never per point, and `project()`
 * takes the result so a thousand labels cost one view.
 */
export function viewOf(pose: Pose, centre: Vec3 = SCENE_CENTRE): View {
  const dist = REST_DIST / Math.max(0.05, pose.zoom);
  const cp = Math.cos(pose.pitch);
  const dir: Vec3 = {
    x: Math.sin(pose.yaw) * cp,
    y: Math.sin(pose.pitch),
    z: Math.cos(pose.yaw) * cp,
  };
  const forward = unit(scale(dir, -1));
  const worldUp: Vec3 = { x: 0, y: 1, z: 0 };
  /* Looking straight down makes `forward` parallel to world up and the cross product vanishes;
     the bounds clamp pitch short of that, and this is the belt for the braces. */
  const rightRaw = cross(forward, worldUp);
  const right = dot(rightRaw, rightRaw) < 1e-6 ? { x: 1, y: 0, z: 0 } : unit(rightRaw);
  const up = unit(cross(right, forward));
  const shifted = add(centre, add(scale(right, -pose.pan.x), scale(up, -pose.pan.y)));
  return { eye: add(shifted, scale(dir, dist)), target: shifted, right, up, forward };
}

export interface Projected {
  /** Screen position, in pixels from the frame's top-left. */
  x: number;
  y: number;
  /** Distance along the view axis. Negative means behind the camera — do not draw it. */
  depth: number;
  /** How much one scene unit measures on screen at this depth. Labels scale by it. */
  scale: number;
  visible: boolean;
}

/** The near clip. A point closer than this is behind the reader's eye and is not drawn. */
const NEAR = 1;

/**
 * One scene point, on the screen.
 *
 * The projection is the plain pinhole one: distance along the view axis divides the offsets in
 * the right/up plane, a half-height of `tan(fov/2)` maps to the frame's half-height, and the
 * aspect ratio comes out of the frame rather than a constant, because these surfaces are
 * resizable and a hard-coded aspect is a bug that only appears on somebody else's monitor.
 */
export function project(p: Vec3, view: View, frame: Frame): Projected {
  const v = sub(p, view.eye);
  const depth = dot(v, view.forward);
  const half = Math.tan(FOV / 2);
  const k = frame.h / 2 / half;
  if (depth < NEAR) {
    return { x: frame.w / 2, y: frame.h / 2, depth, scale: 0, visible: false };
  }
  const px = (dot(v, view.right) / depth) * k;
  const py = (dot(v, view.up) / depth) * k;
  return {
    x: frame.w / 2 + px,
    y: frame.h / 2 - py,
    depth,
    scale: k / depth,
    visible: true,
  };
}

/** A whole polyline, projected. Points behind the camera are dropped, which is enough here:
 *  no pipe is long enough to straddle the eye at any pose the bounds allow. */
export function projectAll(points: readonly Vec3[], view: View, frame: Frame): Projected[] {
  return points.map((p) => project(p, view, frame)).filter((p) => p.visible);
}

/** An SVG `points` attribute from a projected polyline. Empty when nothing survived the clip. */
export function polyline(points: readonly Vec3[], view: View, frame: Frame): string {
  const drawn = projectAll(points, view, frame);
  if (drawn.length < 2) return "";
  return drawn.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ");
}

/**
 * How many screen pixels one scene unit measures at the orbit centre, for this frame and pose.
 *
 * This is the number that lets the css3d renderer and the SVG overlay share a picture. Derive it
 * once: a pinhole with vertical field `FOV` maps a half-height of `tan(FOV/2) * depth` onto
 * `frame.h / 2`, so a unit at the centre is `K(frame) / dist` pixels across.
 */
export const K = (frame: Frame): number => frame.h / 2 / Math.tan(FOV / 2);
export const unitsToPx = (pose: Pose, frame: Frame): number =>
  (K(frame) * Math.max(0.05, pose.zoom)) / REST_DIST;

/**
 * The CSS transform chain for a DOM scene at this pose — and the algebra that makes the browser's
 * own 3D engine agree with `project()` to the pixel.
 *
 * THE DERIVATION, because getting this wrong is the classic css3d bug and the comment is cheaper
 * than the second discovery. The browser projects a child at CSS depth `z` by `P / (P - z)` where
 * `P` is the parent's `perspective`. The pinhole above projects a scene point at depth `d` by
 * `K / d`, with `d = dist - z_scene` and `dist = REST_DIST / zoom`. Put the world at scale `U`
 * pixels per scene unit, so `z = U * z_scene`, and ask the two to be equal:
 *
 *     U * P / (P - U * z_scene)  ==  K / (dist - z_scene)
 *
 * Setting `P = U * dist` collapses the left side to `U * dist / (dist - z_scene)`, and the two
 * agree exactly when `U * dist == K` — that is, `U = K / dist`, and then `P = K`.
 *
 * So: THE PERSPECTIVE IS CONSTANT (it depends only on the frame's height and the field of view)
 * and ZOOM IS A SCALE ON THE WORLD. Which is a pleasant result and not an obvious one — the
 * instinct is to animate `perspective`, and that both mismatches the overlay and forces a layout.
 *
 * Pan is applied before the rotations, in screen pixels, because pan in the contract is a slide
 * of the frame in the camera's own right/up plane; rotating it with the world would make the
 * scene swing when a reader drags it sideways.
 */
export function cssView(
  pose: Pose,
  frame: Frame,
  centre: Vec3 = SCENE_CENTRE,
): { perspective: number; transform: string; unit: number } {
  const unit = unitsToPx(pose, frame);
  const deg = (r: number): string => `${((r * 180) / Math.PI).toFixed(4)}deg`;
  const n = (v: number): string => v.toFixed(3);
  return {
    perspective: K(frame),
    unit,
    transform: [
      `translate3d(${n(pose.pan.x * unit)}px, ${n(-pose.pan.y * unit)}px, 0)`,
      `rotateX(${deg(pose.pitch)})`,
      `rotateY(${deg(-pose.yaw)})`,
      `scale3d(${n(unit)}, ${n(unit)}, ${n(unit)})`,
      /* The world is modelled with the contracts floor at y = 0; the camera orbits the stack's
         middle, so the world is shifted to put that middle on the origin. In CSS +Y is down. */
      `translate3d(${n(-centre.x)}px, ${n(centre.y)}px, ${n(-centre.z)}px)`,
    ].join(" "),
  };
}

/** One scene point as a CSS translate, for a DOM node living inside `cssView`'s world. */
export const cssPoint = (p: Vec3): string =>
  `translate3d(${p.x.toFixed(3)}px, ${(-p.y).toFixed(3)}px, ${p.z.toFixed(3)}px)`;

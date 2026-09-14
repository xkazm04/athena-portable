/**
 * The camera, as arithmetic. `docs/kit-camera-contract.md` §1–§2, the pure half.
 *
 * WHY THE KIT OWNS A CAMERA NOW. Round 2 ended with rule 1 — "the level you leave carries the
 * camera" — still being ~30 lines of app code plus a stylesheet in every app, and with the four
 * directions all wanting the same verbs: drag to look, wheel to close in, a pose to fly to when
 * a tool or a click moves the nav. Two of those surfaces are DOM and two are WebGL, which is the
 * whole reason this file knows nothing about either: a pose is four numbers, and the two
 * consumers of those numbers — `poseToTransform` for a DOM stage, `rig.get()` inside a
 * `useFrame` for a renderer — are the only places the surface type appears. NOTHING HERE MAY
 * IMPORT `three`, and nothing here touches the DOM.
 *
 * THE FRAME OF REFERENCE, once, so the two surfaces agree:
 *
 *   screen = centre + zoom · (world + pan)
 *
 * i.e. `pan` is in SCENE units (DOM: pixels at zoom 1; WebGL: world units), positive x to the
 * right and positive y down, and the origin is the centre of the frame — not its top-left —
 * because a camera that zooms about a corner is not a camera. `poseToTransform` emits exactly
 * that composition, and `zoomAt` is the inverse of it solved for `pan`.
 *
 * Everything here is pure and total: `test/camera.test.ts` pins it under `node --test`.
 */

export interface CameraPose {
  /** Radians, rotation around the vertical axis. */
  yaw: number;
  /** Radians, tilt. DOM surfaces may use only pitch/zoom/pan. */
  pitch: number;
  /** Dimensionless scale, 1 = the resting frame. */
  zoom: number;
  /** Scene units (DOM: px at zoom 1; WebGL: world units). */
  pan: { x: number; y: number };
}

export interface CameraBounds {
  /** Omitted or `"free"` is unconstrained — a turntable that goes all the way round. */
  yaw?: [number, number] | "free";
  pitch?: [number, number];
  zoom: [number, number];
  pan?: { x: [number, number]; y: [number, number] };
}

/** Looking straight at the resting frame, from the middle, at its own size. */
export const REST_POSE: CameraPose = { yaw: 0, pitch: 0, zoom: 1, pan: { x: 0, y: 0 } };

/** A frame to zoom inside: the scene element's bounding box, in CSS pixels. */
export interface CameraFrame {
  w: number;
  h: number;
}

/** Scene units per millisecond, which is what `stepInertia` integrates. */
export interface CameraVelocity {
  yaw: number;
  pitch: number;
  zoom: number;
  pan: { x: number; y: number };
}

export const ZERO_VELOCITY: CameraVelocity = { yaw: 0, pitch: 0, zoom: 0, pan: { x: 0, y: 0 } };

/**
 * Below this, a frame of inertia moves nothing a reader can see, so the loop stops.
 *
 * Expressed per FRAME rather than per millisecond because that is the unit the eye works in:
 * a thousandth of a radian (~0.06°) or a thousandth of a scene unit in a sixtieth of a second
 * is not a movement, it is a rounding error keeping a `requestAnimationFrame` alive (§1 rule 9,
 * what is no longer seen stops costing).
 */
export const NEGLIGIBLE = 1e-3;

/** One frame at 60Hz. `inertia` is documented as "retained per frame", so this is the unit. */
export const FRAME_MS = 1000 / 60;

/** The kit's default fly duration when no token answers: the rubric's DOM level-change budget. */
export const FLY_MS = 420;

/** The kit's default fly ease. The same curve the template's `--dk-ease` declares. */
export const FLY_EASE = "cubic-bezier(0.2, 0, 0, 1)";

const clamp = (n: number, lo: number, hi: number): number => (n < lo ? lo : n > hi ? hi : n);

const finite = (n: number, fallback: number): number => (Number.isFinite(n) ? n : fallback);

/** Shortest signed angular distance from `b` to `a`, in radians. */
export const angleDelta = (a: number, b: number): number =>
  Math.atan2(Math.sin(a - b), Math.cos(a - b));

/**
 * A pose inside its bounds.
 *
 * Zoom is the only REQUIRED bound, because it is the only axis where an unbounded value is
 * incoherent rather than merely odd: zoom 0 is a scene of nothing and a negative zoom is a
 * mirror. Yaw is free unless a range is given (a turntable goes all the way round); pitch and
 * pan are clamped only when the surface says what they mean.
 *
 * Total: a non-finite number anywhere reads as the resting value for that axis, so a pose that
 * came out of a division by a zero-sized frame cannot poison the rig.
 */
export function clampPose(pose: CameraPose, bounds: CameraBounds): CameraPose {
  const [zLo, zHi] = bounds.zoom;
  const zoom = clamp(finite(pose.zoom, REST_POSE.zoom), Math.min(zLo, zHi), Math.max(zLo, zHi));

  let yaw = finite(pose.yaw, 0);
  if (Array.isArray(bounds.yaw)) yaw = clamp(yaw, bounds.yaw[0], bounds.yaw[1]);

  let pitch = finite(pose.pitch, 0);
  if (bounds.pitch) pitch = clamp(pitch, bounds.pitch[0], bounds.pitch[1]);

  let x = finite(pose.pan.x, 0);
  let y = finite(pose.pan.y, 0);
  if (bounds.pan) {
    x = clamp(x, bounds.pan.x[0], bounds.pan.x[1]);
    y = clamp(y, bounds.pan.y[0], bounds.pan.y[1]);
  }

  return { yaw, pitch, zoom, pan: { x, y } };
}

/**
 * Zoom by `factor`, keeping the scene point under `anchor` where it is.
 *
 * `anchor` is in FRAME coordinates — pixels from the frame's top-left, i.e. what
 * `event.clientX - rect.left` gives you — and `frame` is the scene element's bounding box. The
 * anchored point is the difference between a camera and a slider: wheeling over a lane closes in
 * on that lane, not on the middle of the screen.
 *
 * The arithmetic, from the frame of reference at the top of this file. With `a` the anchor's
 * offset from the frame's centre and `w` the scene point under it,
 *
 *     a = z₁ · (w + pan₁)   and we want   a = z₂ · (w + pan₂)
 *     ⇒ pan₂ = pan₁ + a · (1/z₂ − 1/z₁)
 *
 * so no knowledge of `w` is needed and the result is exact at any zoom. A zero-sized frame (an
 * element that has not been laid out yet) anchors at its centre, which is a plain zoom.
 */
export function zoomAt(
  pose: CameraPose,
  factor: number,
  anchor: { x: number; y: number },
  frame: CameraFrame,
): CameraPose {
  const z1 = pose.zoom;
  const z2 = finite(pose.zoom * factor, z1);
  if (z2 === z1 || z1 === 0 || z2 === 0) return pose;

  const w = finite(frame.w, 0);
  const h = finite(frame.h, 0);
  const ax = w > 0 ? finite(anchor.x, w / 2) - w / 2 : 0;
  const ay = h > 0 ? finite(anchor.y, h / 2) - h / 2 : 0;
  const k = 1 / z2 - 1 / z1;

  return { ...pose, zoom: z2, pan: { x: pose.pan.x + ax * k, y: pose.pan.y + ay * k } };
}

/**
 * One frame of coasting: advance the pose by the velocity, then decay the velocity.
 *
 * `retain` is the fraction of the velocity kept per FRAME (the option is documented that way and
 * a reader thinks in frames), but `dt` is real elapsed milliseconds, so the decay is raised to
 * `dt / FRAME_MS`. A tab that drops to 30fps therefore coasts the same distance as one at 120,
 * instead of gliding twice as far because the loop ran half as often.
 *
 * `retain` 0 is no inertia at all: the pose still takes this frame's movement, and the velocity
 * is zero afterwards.
 */
export function stepInertia(
  pose: CameraPose,
  velocity: CameraVelocity,
  retain: number,
  dt: number,
): { pose: CameraPose; velocity: CameraVelocity } {
  const ms = Math.max(0, finite(dt, 0));
  const keep = clamp(finite(retain, 0), 0, 1) ** (ms / FRAME_MS);

  const moved: CameraPose = {
    yaw: pose.yaw + velocity.yaw * ms,
    pitch: pose.pitch + velocity.pitch * ms,
    zoom: pose.zoom + velocity.zoom * ms,
    pan: { x: pose.pan.x + velocity.pan.x * ms, y: pose.pan.y + velocity.pan.y * ms },
  };

  return {
    pose: moved,
    velocity: {
      yaw: velocity.yaw * keep,
      pitch: velocity.pitch * keep,
      zoom: velocity.zoom * keep,
      pan: { x: velocity.pan.x * keep, y: velocity.pan.y * keep },
    },
  };
}

/** Would another frame of this velocity move anything a reader could see? */
export function isNegligible(velocity: CameraVelocity, epsilon = NEGLIGIBLE): boolean {
  const perFrame = (n: number) => Math.abs(n) * FRAME_MS;
  return (
    perFrame(velocity.yaw) < epsilon &&
    perFrame(velocity.pitch) < epsilon &&
    perFrame(velocity.zoom) < epsilon &&
    perFrame(velocity.pan.x) < epsilon &&
    perFrame(velocity.pan.y) < epsilon
  );
}

/**
 * How far apart two poses are, for picking a snap.
 *
 * Four axes in four units, so they need weights to be comparable at all. Angles are radians and
 * count for themselves; zoom is compared as a RATIO (`ln(z₂/z₁)`), because 1→2 and 2→4 are the
 * same move to a reader and the same number here; pan is in scene units, which are pixels on a
 * DOM surface, so a hundredth brings "a hundred pixels off" level with "half a radian off".
 */
export const SNAP_WEIGHTS = { yaw: 1, pitch: 1, zoom: 1, pan: 0.01 } as const;

export function poseDistance(a: CameraPose, b: CameraPose): number {
  const dz = a.zoom > 0 && b.zoom > 0 ? Math.abs(Math.log(a.zoom / b.zoom)) : Math.abs(a.zoom - b.zoom);
  return (
    SNAP_WEIGHTS.yaw * Math.abs(angleDelta(a.yaw, b.yaw)) +
    SNAP_WEIGHTS.pitch * Math.abs(angleDelta(a.pitch, b.pitch)) +
    SNAP_WEIGHTS.zoom * dz +
    SNAP_WEIGHTS.pan * Math.hypot(a.pan.x - b.pan.x, a.pan.y - b.pan.y)
  );
}

/**
 * The snap pose closest to this one, or `null` when there are none.
 *
 * Ties go to the EARLIER entry, so a surface that lists its snaps in reading order gets a
 * predictable answer rather than one that depends on the sort.
 */
export function nearestSnap(pose: CameraPose, snaps: readonly CameraPose[]): CameraPose | null {
  let best: CameraPose | null = null;
  let bestD = Infinity;
  for (const snap of snaps) {
    const d = poseDistance(pose, snap);
    if (d < bestD) {
      bestD = d;
      best = snap;
    }
  }
  return best;
}

/** The kit's drag sensitivity: radians per pixel. A half-turn across ~630 px. */
export const ORBIT_SENSITIVITY = 0.005;

/**
 * A drag, as rotation. Positive `dx` turns the scene to the right, positive `dy` tips its top
 * away, which is what a hand on a turntable expects.
 */
export function orbitDelta(dx: number, dy: number, sensitivity = ORBIT_SENSITIVITY): {
  yaw: number;
  pitch: number;
} {
  const s = finite(sensitivity, ORBIT_SENSITIVITY);
  return { yaw: finite(dx, 0) * s, pitch: finite(dy, 0) * s };
}

/**
 * A drag, as pan — screen pixels into scene units.
 *
 * Divided by zoom, because that is the whole point: the scene under the pointer must keep up
 * with it, and at 4× a hundred screen pixels is twenty-five scene units. Zoom 0 is not a camera
 * and answers no movement rather than an infinity.
 */
export function panDelta(dx: number, dy: number, zoom: number): { x: number; y: number } {
  const z = finite(zoom, 1);
  if (z === 0) return { x: 0, y: 0 };
  return { x: finite(dx, 0) / z, y: finite(dy, 0) / z };
}

const round = (n: number): string => {
  const r = Math.round((Number.isFinite(n) ? n : 0) * 1e4) / 1e4;
  return String(Object.is(r, -0) ? 0 : r);
};

const DEG = 180 / Math.PI;

/**
 * A pose as the `transform` of a DOM stage.
 *
 *     translate(<pan·zoom>px) scale(<zoom>) rotateX(<pitch>) rotateY(<yaw>)
 *
 * Read right to left, as CSS composes it: the scene is turned, then scaled, then moved — which
 * is the frame of reference at the top of this file, `screen = centre + zoom · (world + pan)`,
 * and therefore exactly what `zoomAt` inverts. The element MUST have `transform-origin: 50% 50%`
 * (the CSS default) or the centre this arithmetic is about is not the centre the browser uses.
 *
 * `perspective` is normally the PARENT's: a perspective declared on the same element as the
 * transform is applied after the scale, so the vanishing point rides along with the pan, and a
 * tilted scene shears as it moves. Pass `{ perspective }` only for a surface that has no parent
 * to put it on, and expect that artefact.
 */
export function poseToTransform(pose: CameraPose, opts: { perspective?: number } = {}): string {
  const parts: string[] = [];
  if (opts.perspective !== undefined) parts.push(`perspective(${round(opts.perspective)}px)`);
  parts.push(`translate(${round(pose.pan.x * pose.zoom)}px, ${round(pose.pan.y * pose.zoom)}px)`);
  parts.push(`scale(${round(pose.zoom)})`);
  parts.push(`rotateX(${round(pose.pitch * DEG)}deg)`);
  parts.push(`rotateY(${round(pose.yaw * DEG)}deg)`);
  return parts.join(" ");
}

/** A pose, merged from a partial one. The half of `set`/`flyTo` that is arithmetic. */
export function mergePose(base: CameraPose, patch: Partial<CameraPose>): CameraPose {
  return {
    yaw: patch.yaw ?? base.yaw,
    pitch: patch.pitch ?? base.pitch,
    zoom: patch.zoom ?? base.zoom,
    pan: { x: patch.pan?.x ?? base.pan.x, y: patch.pan?.y ?? base.pan.y },
  };
}

/** Are these the same place, to within a rounding error? */
export function samePose(a: CameraPose, b: CameraPose, epsilon = 1e-6): boolean {
  return (
    Math.abs(a.yaw - b.yaw) < epsilon &&
    Math.abs(a.pitch - b.pitch) < epsilon &&
    Math.abs(a.zoom - b.zoom) < epsilon &&
    Math.abs(a.pan.x - b.pan.x) < epsilon &&
    Math.abs(a.pan.y - b.pan.y) < epsilon
  );
}

/**
 * Between two poses, at `t` in 0..1.
 *
 * Zoom interpolates GEOMETRICALLY (`z₁^(1−t) · z₂^t`), which is the one non-obvious line in the
 * file and the difference between a fly that accelerates into the scene and one that appears to
 * stall halfway: a linear ramp from 1 to 8 spends half its time between 4.5 and 8, where the
 * reader can no longer tell it is moving. Yaw takes the SHORT way round.
 */
export function lerpPose(a: CameraPose, b: CameraPose, t: number): CameraPose {
  const k = clamp(finite(t, 0), 0, 1);
  const zoom = a.zoom > 0 && b.zoom > 0 ? a.zoom ** (1 - k) * b.zoom ** k : a.zoom + (b.zoom - a.zoom) * k;
  return {
    yaw: a.yaw + angleDelta(b.yaw, a.yaw) * k,
    pitch: a.pitch + (b.pitch - a.pitch) * k,
    zoom,
    pan: { x: a.pan.x + (b.pan.x - a.pan.x) * k, y: a.pan.y + (b.pan.y - a.pan.y) * k },
  };
}

/* ------------------------------------------------------------------------ easing, from a token */

const bezier = (p1: number, p2: number, p3: number, p4: number) => (t: number): number => {
  // x(u) and y(u) are the cubic Bézier with its endpoints pinned at (0,0) and (1,1), which is
  // what CSS's four numbers mean. Invert x by bisection — twenty-four halvings is 6e-8, far
  // inside a pixel, and unlike Newton it cannot diverge on a control point outside 0..1, which
  // CSS allows on the x axis.
  const x = (u: number) => 3 * (1 - u) ** 2 * u * p1 + 3 * (1 - u) * u * u * p3 + u ** 3;
  const y = (u: number) => 3 * (1 - u) ** 2 * u * p2 + 3 * (1 - u) * u * u * p4 + u ** 3;
  let lo = 0;
  let hi = 1;
  let u = t;
  for (let i = 0; i < 24; i += 1) {
    const at = x(u);
    if (Math.abs(at - t) < 1e-5) break;
    if (at < t) lo = u;
    else hi = u;
    u = (lo + hi) / 2;
  }
  return y(u);
};

const KEYWORDS: Record<string, (t: number) => number> = {
  linear: (t) => t,
  ease: bezier(0.25, 0.1, 0.25, 1),
  "ease-in": bezier(0.42, 0, 1, 1),
  "ease-out": bezier(0, 0, 0.58, 1),
  "ease-in-out": bezier(0.42, 0, 0.58, 1),
};

const BEZIER_RE = /^cubic-bezier\(([^)]+)\)$/;

/**
 * A CSS easing string as the function `flyTo` samples. Rule 4: JS reads tokens, it does not type
 * curves either.
 *
 * Understands the four keywords and `cubic-bezier(...)`; anything else — `steps()`, a spring, a
 * token that is not set — falls back to `FLY_EASE`, so an unreadable cascade lands on the kit's
 * curve rather than on a linear slide that reads as a machine.
 */
export function easeFromCss(raw: string | null | undefined): (t: number) => number {
  const value = (raw ?? "").trim();
  const keyword = KEYWORDS[value];
  if (keyword) return keyword;
  const m = BEZIER_RE.exec(value);
  const parts = m ? (m[1] ?? "").split(",").map((p) => Number(p.trim())) : [];
  if (parts.length === 4 && parts.every((p) => Number.isFinite(p))) {
    return bezier(parts[0] as number, parts[1] as number, parts[2] as number, parts[3] as number);
  }
  return DEFAULT_EASE;
}

/** `FLY_EASE`, resolved once. The answer for an unset token and for a curve JS cannot sample. */
const DEFAULT_EASE = bezier(0.2, 0, 0, 1);

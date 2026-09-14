/**
 * WHERE THE CAMERA STANDS FOR A FOCUS — pure, and deliberately not in `rig.ts`.
 *
 * `rig.ts` is a hook: it imports React and `@athena/demo-kit/zoom`, so nothing in it can be
 * exercised under `node --test`. And the arithmetic below is the single most breakable thing in
 * the whole camera, because ITS FAILURES DO NOT LOOK LIKE FAILURES. One sign flipped in the basis
 * and the camera flies to the mirror image of the thing that was opened; nothing throws, nothing
 * logs, and the surface simply looks like a camera aimed badly. It cost an afternoon once and
 * `test/scene.test.ts` now pins it against `project()` for every stratum and every part.
 *
 * So: the pure half here, the hook there, and the contract's `poseFor` is this file's export.
 */
import { BANDS, HOME_POSE, type PoseLike } from "./poses";
import { DIM, SCENE_CENTRE, blockAt, partAt, stratumAt, type Vec3 } from "./layout";

/** Just enough of the kit's `Focus` to aim at one. */
export interface FocusLike {
  level: number;
  group: string | null;
  item: string | null;
}

/** The stack, top-down, for `strataUnder`. The same order README §3.1 prints. */
const LAYER_IDS = ["surfaces", "channels", "lane", "harness", "core", "contracts"] as const;

/* --------------------------------------- the aiming --------------------------------------- */

/**
 * The pan that brings a world point to the middle of the frame at a given yaw and pitch.
 *
 * `viewOf` (in `project.ts`) shifts the orbit centre by `-pan.x·right - pan.y·up`, so the pan
 * that centres a point is that point's offset from the scene centre resolved onto the same two
 * axes, negated. The basis is written out here rather than imported so the rig does not depend
 * on the projection's internals — the two agree because both derive it the same way, and
 * `test/scene.test.ts` pins that the basis is orthonormal at every pose the bounds allow.
 */
function aimAt(target: Vec3, yaw: number, pitch: number): { x: number; y: number } {
  const cp = Math.cos(pitch);
  const f = { x: -Math.sin(yaw) * cp, y: -Math.sin(pitch), z: -Math.cos(yaw) * cp };
  /* right = normalize(forward × worldUp) = normalize(-f.z, 0, f.x). Writing it out is worth one
     line of care: getting the SIGN wrong here does not crash and does not look like an error — it
     flies the camera to the mirror image of the thing that was opened, which reads as "the camera
     is wrong somehow". `test/scene.test.ts` now pins `poseFor` against `project` so the two
     derivations of this basis cannot disagree again. */
  const rl = Math.hypot(f.z, f.x) || 1;
  const right = { x: -f.z / rl, y: 0, z: f.x / rl };
  const up = {
    x: right.y * f.z - right.z * f.y,
    y: right.z * f.x - right.x * f.z,
    z: right.x * f.y - right.y * f.x,
  };
  const d = {
    x: target.x - SCENE_CENTRE.x,
    y: target.y - SCENE_CENTRE.y,
    z: target.z - SCENE_CENTRE.z,
  };
  return {
    x: -(d.x * right.x + d.y * right.y + d.z * right.z),
    y: -(d.x * up.x + d.y * up.y + d.z * up.z),
  };
}

const centreOfStratum = (id: string): Vec3 => {
  const s = stratumAt(id);
  return s ? { x: 0, y: s.y + DIM.blockH / 2, z: 0 } : SCENE_CENTRE;
};

const centreOfPart = (id: string): Vec3 => {
  const p = partAt(id);
  if (!p) return SCENE_CENTRE;
  const b = blockAt(p.block);
  /* Aim between the part and its block's centre: a part alone fills the frame with one small box
     and loses the reader's place inside the system it belongs to. */
  return { x: (p.x + (b?.x ?? p.x)) / 2, y: p.y + p.h, z: (p.z + (b?.z ?? p.z)) / 2 };
};

/** Where the camera stands to look at a focus. The contract's `poseFor`. */
export function poseFor(focus: FocusLike, from: PoseLike): Partial<PoseLike> {
  if (focus.level === 0) {
    return { zoom: HOME_POSE.zoom, pan: { x: 0, y: 0 }, pitch: HOME_POSE.pitch };
  }
  const pitch = focus.level === 2 ? 0.22 : 0.34;
  const target =
    focus.level === 2 && focus.item
      ? centreOfPart(focus.item)
      : focus.group
        ? centreOfStratum(focus.group)
        : SCENE_CENTRE;
  return {
    zoom: focus.level === 2 ? BANDS[1] * 1.15 : BANDS[0] * 1.12,
    pitch,
    pan: aimAt(target, from.yaw, pitch),
  };
}

/**
 * Which stratum the camera is looking at — the contract's `resolveGroup`.
 *
 * Pan y moves the frame up the stack in the camera's own up axis, so inverting it by the pitch's
 * cosine gives the world height under the frame's centre, and the nearest plane to that height is
 * the answer. Nearest rather than "inside": at the moment the reader crosses the L1 band they are
 * still well above every plane, and a containment test would answer `null` exactly when the hook
 * needs a group.
 */
export function strataUnder(pose: PoseLike): string | null {
  const looking = SCENE_CENTRE.y - pose.pan.y * Math.cos(pose.pitch);
  let best: string | null = null;
  let bestD = Infinity;
  LAYER_IDS.forEach((id, i) => {
    const d = Math.abs((LAYER_IDS.length - 1 - i) * DIM.stratumGap - looking);
    if (d < bestD) {
      bestD = d;
      best = id;
    }
  });
  return best;
}


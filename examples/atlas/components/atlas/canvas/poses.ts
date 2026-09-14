/**
 * WHERE THE CAMERA STANDS, AND WHAT STANDING THERE MEANS. `docs/kit-camera-contract.md` §3, the
 * pure half, for a 2D sheet.
 *
 * The kit's camera is orthographic — `screen = centre + zoom · (world + pan)` — which is exactly
 * the right arithmetic for a drawing and was the wrong arithmetic for round 3's perspective
 * machine (KIT-GAPS R3, gap 1 of the round-3 list). Here `pan` is the negative of the world point
 * under the middle of the frame and `zoom` is world units per pixel, and that is the whole camera.
 *
 * RULE 14, WHICH IS WHY THIS FILE EXISTS. *"Camera distance can be the level only when `poseFor`
 * and `resolveGroup` are exact inverses. That, not hysteresis, is what stops the flapping."* Both
 * directions are here, beside each other, and `test/plan.test.ts` asserts the round trip for every
 * layer and every component in every view:
 *
 *     resolveGroup(poseFor({ level: 1, group: L })) === L      for all L
 *     resolveItem(poseFor({ level: 2, item: C }), group) === C for all C
 *
 * The inverse holds BY CONSTRUCTION rather than by tuning: `poseFor` centres the camera on a
 * rectangle, `resolve*` answers the rectangle containing the centre, and a rectangle contains its
 * own centre. Any "nearest" fallback below is only ever reached for a pose `poseFor` did not
 * produce — a reader's own wheel, between two things.
 *
 * RULE 12: two of a pose's numbers are the level and two are the framing. `zoom` is the level;
 * `pan` is the framing. There is no snap list in this app for precisely that reason (round 3's
 * gap 2: a snap carrying `zoom` silently defeats semantic zoom), and `yaw`/`pitch` are pinned at
 * zero — a blueprint has no perspective, which is the owner's verdict expressed as two bounds.
 */
import { LAYER_ORDER, type LayerId } from "@/data";
import type { CameraPose } from "@athena/demo-kit/zoom";
import type { Focus } from "@athena/demo-kit/zoom";

import { centreOf, contains, type Point, type Rect } from "./geometry";
import { PLANS, partIn, type ViewId } from "./plan";

/**
 * The two zoom bands, in world-units-per-pixel.
 *
 * `l1` sits between the largest zoom the whole sheet is ever shown at (`HOME_MAX`, below) and the
 * zoom `poseFor` puts a reader at when they open a layer, with room on both sides for the kit's
 * 8% hysteresis. `l2` sits between the layer zoom and the component zoom the same way. Those two
 * inequalities are asserted in the test, so a future change to any of the four numbers that closes
 * a gap fails the build instead of making the wheel feel broken.
 */
export const BANDS: readonly [number, number] = [0.85, 2.3];

/** Where the camera stands with one layer open. The band's own reading distance. */
export const L1_ZOOM = 1.3;

/** Where it stands with one component open — a part big enough to point at. */
export const L2_ZOOM = 3.2;

/**
 * The floor and ceiling on the whole-sheet zoom.
 *
 * Rule 15: *"a place needs a floor size"*. On a laptop the sheet is fitted to the stage; on a
 * 2560 display fitting it would put L0 at a zoom above the first band, so the ceiling holds it
 * below and the reader gets more sheet rather than a bigger sheet. The floor is the other end:
 * a very small window shows the drawing small rather than illegibly small, and pans.
 */
export const HOME_MIN = 0.2;
export const HOME_MAX = 0.72;

/** A frame to fit into: the canvas element's box, in CSS pixels. */
export interface Frame {
  w: number;
  h: number;
}

const clamp = (n: number, lo: number, hi: number) => (n < lo ? lo : n > hi ? hi : n);

/** The zoom that fits a whole view's sheet in the frame, held inside the two limits above. */
export function homeZoom(view: ViewId, frame: Frame): number {
  const b = PLANS[view].bounds;
  if (!(frame.w > 0) || !(frame.h > 0) || !(b.w > 0) || !(b.h > 0)) return HOME_MIN;
  return clamp(Math.min(frame.w / b.w, frame.h / b.h) * 0.94, HOME_MIN, HOME_MAX);
}

/** The world point the camera is looking at: the inverse of `pan`. */
export const lookingAt = (pose: CameraPose): Point => ({ x: -pose.pan.x, y: -pose.pan.y });

/** The pan that puts a world point in the middle of the frame. */
const panTo = (p: Point) => ({ x: -p.x, y: -p.y });

/**
 * Where the camera stands for a focus. The nav-to-camera half of the contract.
 *
 * Note what it does NOT do: it never touches `yaw` or `pitch`, because a blueprint has none, and
 * it never returns a partial `pan` — a pose with one axis of pan carried over from wherever the
 * reader happened to be is a pose that frames something different every time.
 */
export function poseFor(focus: Focus, view: ViewId, frame: Frame): Partial<CameraPose> {
  const plan = PLANS[view];

  if (focus.level === 2 && focus.item) {
    const part = partIn(view, focus.item);
    if (part) return { zoom: L2_ZOOM, pan: panTo(centreOf(part)) };
  }
  if (focus.level >= 1 && focus.group) {
    const box = plan.frames[focus.group as LayerId];
    if (box) return { zoom: L1_ZOOM, pan: panTo(centreOf(box)) };
  }
  return { zoom: homeZoom(view, frame), pan: panTo(centreOf(plan.bounds)) };
}

/**
 * Which layer is under the camera. The camera-to-nav half.
 *
 * Containment first — the frame the reader is standing INSIDE — and among several (the packages
 * view nests, and two layers' blocks can share a folder), the one whose middle is nearest, which
 * is what makes the round trip exact. Only a camera between frames falls through to "nearest".
 */
export function resolveGroup(pose: CameraPose, view: ViewId): LayerId | null {
  const at = lookingAt(pose);

  /*
   * RULE 12 AGAIN, AND THIS TIME IT COSTS A BRANCH. A pose is where you stand AND where you look,
   * and the two halves answer different questions: `pan` says what the reader is over, `zoom` says
   * how big the thing they mean is. Past the second band the reader is inside one block, so "which
   * layer" is the layer of THAT BLOCK; further out they are over a whole region, so it is the
   * layer whose frame they are inside.
   *
   * Without the branch the inverse is exact only in the layers view. In the other three a layer's
   * frame is the bounding box of blocks that have been scattered by the arrangement, boxes overlap,
   * and a camera centred on a component of `surfaces` can be inside the `channels` frame — which is
   * not a near miss, it is the wrong answer, and the test caught it on the first run.
   */
  if (pose.zoom >= BANDS[1]) {
    let best: LayerId | null = null;
    let bestD = Infinity;
    for (const block of PLANS[view].blocks) {
      if (contains(block, at)) return block.layer;
      const c = centreOf(block);
      const d = Math.hypot(c.x - at.x, c.y - at.y);
      if (d < bestD) {
        bestD = d;
        best = block.layer;
      }
    }
    if (best) return best;
  }

  const frames = PLANS[view].frames;
  let best: LayerId | null = null;
  let bestD = Infinity;
  let inside = false;

  for (const layer of LAYER_ORDER) {
    const box: Rect | undefined = frames[layer];
    if (!box || box.w <= 0) continue;
    const here = contains(box, at);
    if (inside && !here) continue;
    const c = centreOf(box);
    const d = Math.hypot(c.x - at.x, c.y - at.y);
    if (here && !inside) {
      inside = true;
      best = layer;
      bestD = d;
      continue;
    }
    if (d < bestD) {
      bestD = d;
      best = layer;
    }
  }
  return best;
}

/**
 * Which component is under the camera, once the layer is known.
 *
 * ROUND 3 COULD NOT ANSWER THIS (KIT-GAPS R3-1): in a container scene every part of the block in
 * frame was "under the camera" at the distance where the band was crossed, so the third band was
 * unreachable by wheel and the contract's headline claim was two thirds true. On a sheet the
 * question has an answer, because the items are laid out IN THE PLANE: the part the middle of the
 * frame is over, or — for a reader who crossed the band between two of them — the nearest part of
 * this layer. That is the round-4 finding, and it is a fact about the arrangement rather than
 * about the hook.
 */
export function resolveItem(pose: CameraPose, view: ViewId, group: string): string | null {
  const at = lookingAt(pose);
  let best: string | null = null;
  let bestD = Infinity;

  for (const block of PLANS[view].blocks) {
    if (block.layer !== group) continue;
    for (const p of block.parts) {
      const box: Rect = { x: block.x + p.x, y: block.y + p.y, w: p.w, h: p.h };
      if (contains(box, at)) return p.id;
      const c = centreOf(box);
      const d = Math.hypot(c.x - at.x, c.y - at.y);
      if (d < bestD) {
        bestD = d;
        best = p.id;
      }
    }
  }
  return best;
}

/**
 * THE QUANTISED INVERSE SCALE (formula §1 rule 13).
 *
 * Labels are screen-space: a title stays the same size in pixels however far the reader is
 * standing, so the world carries `--at-cs = 1/quantise(zoom)` and every label scales by it. If
 * that number changed on every wheel tick, every label in the drawing would re-lay-out sixty times
 * a second — round 3 measured 1,400 elements a frame doing exactly that in ledgerbox. So it moves
 * in steps of a cube root of two (~26%), which is smaller than a reader notices in a label and
 * fifty times fewer relayouts than the continuous version.
 *
 * Exported and pinned rather than inlined because "how coarse" is the part that can be wrong.
 */
export const QUANT_STEPS_PER_OCTAVE = 3;

export function quantise(zoom: number): number {
  const z = Number.isFinite(zoom) && zoom > 0 ? zoom : 1;
  const stepped = Math.round(Math.log2(z) * QUANT_STEPS_PER_OCTAVE) / QUANT_STEPS_PER_OCTAVE;
  return clamp(2 ** stepped, 0.125, 16);
}

/** The camera's bounds. Zoom is the level, so its range is the three bands with room either side. */
export const ZOOM_BOUNDS: readonly [number, number] = [HOME_MIN * 0.6, L2_ZOOM * 2.4];

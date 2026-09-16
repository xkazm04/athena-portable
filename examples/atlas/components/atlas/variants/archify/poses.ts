/**
 * WHERE THE CAMERA STANDS — rule 12, rule 14 and rule 16, for this sheet.
 *
 * `poseFor` and `resolve*` are exact inverses BY CONSTRUCTION and not by tuning: `poseFor` centres
 * the camera on a rectangle and `resolve*` answers the rectangle containing the centre, and a
 * rectangle contains its own centre. `test/archify.layout.test.ts` asserts the round trip for every
 * layer and every one of the sixty-eight components, in both views.
 *
 * RULE 16 IS WHY THE THIRD BAND EXISTS AT ALL. Round 3 could not reach L2 by wheel because in a
 * container scene every part is "under the camera"; here the components are laid out IN THE PLANE
 * inside their system's node (`layout.ts: partsOf`), so "which component is the middle of the frame
 * over" has one answer at every pose.
 *
 * THE THREE BANDS ARE ALSO THE THREE DETAIL TIERS (study §4, `data-detail="context|fine"`): the
 * band is written onto the stage as `data-band`, and CSS hides the sublabel at band 0 and the tag
 * below band 1. INTENT OVERRIDES THE BAND — hover, focus, the lens, a picked PATH endpoint and the
 * active story beat all re-reveal detail at any distance, which is archify's rule and the reason
 * the detail tiers are attributes rather than conditional rendering.
 */
import type { CameraPose, Focus } from "@athena/demo-kit/zoom";
import { LAYER_ORDER, type LayerId } from "@/data";

import { PLANS, centreOf, contains, type Rect, type ViewId } from "./layout";

/**
 * The two band edges, in world units per pixel.
 *
 * Each sits in the middle of a gap no reachable pose lands in: HOME_MAX (0.50) is well below
 * `l1` (0.72) and L1_ZOOM (1.15) is well below `l2` (2.00), with room either side for the kit's
 * 8% hysteresis. The layout test asserts all four inequalities, so a change to any one of them
 * that closes a gap fails the build instead of making the wheel feel broken.
 */
export const BANDS: readonly [number, number] = [0.72, 2.0];

/**
 * Where the camera stands with one layer open.
 *
 * A FIXED L1 ZOOM IS WRONG ON A RAGGED SHEET. Round 4's sheet had layer frames of roughly one
 * shape, so one number framed them all; here a layer's region is as wide as the KINDS it uses —
 * `contracts` is one column and `core` is four — and the same zoom leaves one region overflowing
 * the frame and another adrift in empty paper. So L1 is a FIT, clamped into the middle of the
 * second band so that rule 14 is untouched: `poseFor` still centres on the region's own rectangle,
 * `resolveGroup` still answers the region containing the centre, and the zoom it arrives at is
 * always inside the band whatever the fit computes. `L1_ZOOM` remains the answer when there is no
 * frame to measure against (the server render, and the tests' default).
 */
export const L1_ZOOM = 1.15;
export const L1_MIN = 0.84;
export const L1_MAX = 1.68;
/** Where it stands with one component open — a 96×34 part, big enough to point at. */
export const L2_ZOOM = 3.0;

export const HOME_MIN = 0.16;
export const HOME_MAX = 0.5;

export interface Frame {
  w: number;
  h: number;
}

const clamp = (n: number, lo: number, hi: number) => (n < lo ? lo : n > hi ? hi : n);

export function homeZoom(view: ViewId, frame: Frame): number {
  const b = PLANS[view].bounds;
  if (!(frame.w > 0) || !(frame.h > 0) || !(b.w > 0) || !(b.h > 0)) return HOME_MIN;
  return clamp(Math.min(frame.w / b.w, frame.h / b.h) * 0.96, HOME_MIN, HOME_MAX);
}

export const lookingAt = (pose: CameraPose) => ({ x: -pose.pan.x, y: -pose.pan.y });
const panTo = (p: { x: number; y: number }) => ({ x: -p.x, y: -p.y });

/** The fitted L1 zoom for one layer, held inside the second band. */
export function l1Zoom(view: ViewId, layer: LayerId, frame: Frame): number {
  const box = PLANS[view].frames[layer];
  if (!box || !(frame.w > 0) || !(frame.h > 0) || !(box.w > 0) || !(box.h > 0)) return L1_ZOOM;
  return clamp(Math.min(frame.w / box.w, frame.h / box.h) * 0.92, L1_MIN, L1_MAX);
}

export function poseFor(focus: Focus, view: ViewId, frame: Frame): Partial<CameraPose> {
  const plan = PLANS[view];

  if (focus.level === 2 && focus.item) {
    for (const n of plan.nodes) {
      const part = n.parts.find((p) => p.id === focus.item);
      if (part) return { zoom: L2_ZOOM, pan: panTo(centreOf(part)) };
    }
  }
  if (focus.level >= 1 && focus.group) {
    const layer = focus.group as LayerId;
    const box = plan.frames[layer];
    if (box) return { zoom: l1Zoom(view, layer, frame), pan: panTo(centreOf(box)) };
  }
  return { zoom: homeZoom(view, frame), pan: panTo(centreOf(plan.bounds)) };
}

/**
 * Which layer is under the camera.
 *
 * Past the second band the reader is inside one node, so the answer is THAT node's layer; further
 * out they are over a whole region, so it is the region they are inside. The branch is round 4's
 * finding and it is needed here for the same reason: a layer's region is the bounding box of nodes
 * scattered across the kind axis, and boxes on different rows can share an x range.
 */
export function resolveGroup(pose: CameraPose, view: ViewId): LayerId | null {
  const at = lookingAt(pose);

  if (pose.zoom >= BANDS[1]) {
    let best: LayerId | null = null;
    let bestD = Infinity;
    for (const node of PLANS[view].nodes) {
      if (contains(node, at)) return node.layer;
      const c = centreOf(node);
      const d = Math.hypot(c.x - at.x, c.y - at.y);
      if (d < bestD) {
        bestD = d;
        best = node.layer;
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

/** Which component, once the layer is known. Rule 16: the items are laid out in the plane. */
export function resolveItem(pose: CameraPose, view: ViewId, group: string): string | null {
  const at = lookingAt(pose);
  let best: string | null = null;
  let bestD = Infinity;
  for (const node of PLANS[view].nodes) {
    if (node.layer !== group) continue;
    for (const part of node.parts) {
      if (contains(part, at)) return part.id;
      const c = centreOf(part);
      const d = Math.hypot(c.x - at.x, c.y - at.y);
      if (d < bestD) {
        bestD = d;
        best = part.id;
      }
    }
  }
  return best;
}

/**
 * The quantised inverse scale (rule 13). Steps of a cube root of two — smaller than a reader
 * notices in a label, and fifty times fewer relayouts than counter-scaling every wheel tick.
 */
export const QUANT_STEPS_PER_OCTAVE = 3;

export function quantise(zoom: number): number {
  const z = Number.isFinite(zoom) && zoom > 0 ? zoom : 1;
  const stepped = Math.round(Math.log2(z) * QUANT_STEPS_PER_OCTAVE) / QUANT_STEPS_PER_OCTAVE;
  return clamp(2 ** stepped, 0.125, 16);
}

export const ZOOM_BOUNDS: readonly [number, number] = [HOME_MIN * 0.55, L2_ZOOM * 2.2];

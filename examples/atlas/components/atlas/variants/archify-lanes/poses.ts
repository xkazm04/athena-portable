/**
 * WHERE THE CAMERA STANDS — and the one number the owner's round-5 verdict was really about.
 *
 * `viewer-camera.js` starts at scale 1 and **disables zoom-out below 1**; there is no fit pass,
 * because the authoring contract makes the AUTHOR fit the drawing at 1440×900, 1600×1000 and
 * 1920×1080 ("repair overflow by removing content, never with overflow hidden, a scroller or
 * smaller type"). Round 5 instead defined home as `HOME_MIN 0.16`, and study Part 2 §4 names that
 * ratio as the single cause of the thin lines, the moiré grid and the unreadable labels. So:
 *
 *   · the world is authored at 1170×578 so it fits the reading column at scale 1 (geometry.ts);
 *   · `HOME_MIN` is **1**, and `ZOOM_BOUNDS` starts at 1, so a reader cannot pull further out
 *     than the drawing was authored for;
 *   · `HOME_MAX` is 1.15, so a 1920-wide screen gets a slightly larger drawing and not a
 *     different level.
 *
 * THE THREE LEVELS ARE THE THREE THINGS THIS DRAWING IS (rule 14, rule 16):
 *
 *   L0  the whole lane grid, phase headers on top — twelve nodes, fourteen runs, one staircase.
 *   L1  one PHASE, its columns widened (`planFor` grows the gaps it touches) and the edge labels
 *       a 52-unit gap could not hold revealed; the other two phases recede through `presenceOf`.
 *   L2  one NODE, its rect reported to the shell so the pane grows out of it.
 *
 * `poseFor` and `resolve*` ARE EXACT INVERSES BY CONSTRUCTION, not by tuning: `poseFor` centres
 * the camera on a rectangle, `resolve*` answers the rectangle containing the centre, and a
 * rectangle contains its own centre. The widening does not break that, because a plan is a pure
 * function of the open phase and every band only grows. `test/lanes.poses.test.ts` asserts the
 * round trip for all three phases and all twelve nodes, in all four plans.
 */
import type { CameraPose, Focus } from "@athena/demo-kit/zoom";

import { HEADER_Y, centreOf, contains, planOf, type Plan, type Rect } from "./geometry";
import { NODES, PHASES, nodeById } from "./workflow";

/**
 * The two band edges, in world units per pixel.
 *
 * Each sits in a gap no reachable pose lands in, with the kit's 8% hysteresis clearing both
 * sides: home tops out at 1.15 and `enter1` is 1.458; L1 tops out at 1.7 and `enter2` is 2.484;
 * L2 stands at 3.0 and `leave2` is 2.116. `test/lanes.poses.test.ts` asserts all six inequalities,
 * so closing a gap fails the build instead of making the wheel feel broken.
 */
export const BANDS: readonly [number, number] = [1.35, 2.3];

export const HOME_MIN = 1;
export const HOME_MAX = 1.15;
export const L1_MIN = 1.5;
export const L1_MAX = 1.7;
export const L2_ZOOM = 3;

/** Zoom-out below home is disabled — archify's own rule, and the round-6 correction. */
export const ZOOM_BOUNDS: readonly [number, number] = [HOME_MIN, 6];

export interface Frame {
  w: number;
  h: number;
}

const clamp = (n: number, lo: number, hi: number) => (n < lo ? lo : n > hi ? hi : n);

export function homeZoom(frame: Frame): number {
  const w = planOf(null).world;
  if (!(frame.w > 0) || !(frame.h > 0)) return HOME_MIN;
  return clamp(Math.min(frame.w / w.w, frame.h / w.h), HOME_MIN, HOME_MAX);
}

/**
 * How close a phase stands.
 *
 * A FIT, not a constant, for the same reason round 5 needed one: the three phase bands are not the
 * same width once one of them is widened, so a single number frames one and strands another. The
 * fit is clamped into the middle of the second band, which is what keeps rule 14 intact whatever
 * the arithmetic says.
 */
export function l1Zoom(phase: string, frame: Frame): number {
  const band = planOf(phase).phases.find((p) => p.id === phase);
  if (!band || !(frame.w > 0)) return L1_MIN;
  return clamp((frame.w / (band.w + 96)) * 0.98, L1_MIN, L1_MAX);
}

export const lookingAt = (pose: CameraPose) => ({ x: -pose.pan.x, y: -pose.pan.y });
const panTo = (p: { x: number; y: number }) => ({ x: -p.x, y: -p.y });

/** What the camera looks at for a phase: the middle of its band, over the middle of the stack. */
function phaseTarget(plan: Plan, phase: string): { x: number; y: number } {
  const band = plan.phases.find((p) => p.id === phase);
  const stackBottom = plan.lanes[plan.lanes.length - 1]!.y + plan.lanes[plan.lanes.length - 1]!.h;
  const y = (HEADER_Y + stackBottom) / 2;
  return band ? { x: band.x + band.w / 2, y } : centreOf(plan.bounds);
}

export function poseFor(focus: Focus, frame: Frame): Partial<CameraPose> {
  const open = focus.level >= 1 ? (focus.group ?? null) : null;
  const plan = planOf(open);

  if (focus.level === 2 && focus.item) {
    const node = NODES.find((n) => n.item === focus.item);
    const box = node ? plan.byId.get(node.id) : undefined;
    if (box) return { zoom: L2_ZOOM, pan: panTo(centreOf(box)) };
  }
  if (focus.level >= 1 && focus.group) {
    return { zoom: l1Zoom(focus.group, frame), pan: panTo(phaseTarget(plan, focus.group)) };
  }
  return { zoom: homeZoom(frame), pan: panTo(centreOf(planOf(null).bounds)) };
}

/**
 * Which phase is under the camera.
 *
 * Past the second band the reader is over one node, so the answer is THAT node's phase; further
 * out they are over a column, so it is the phase band the centre is inside. Both are containment
 * tests against the plan that is actually drawn, which is what makes them the inverse of `poseFor`
 * rather than an approximation of it.
 */
export function resolveGroup(pose: CameraPose, open: string | null): string | null {
  const plan = planOf(open);
  const at = lookingAt(pose);

  if (pose.zoom >= BANDS[1]) {
    let best: string | null = null;
    let bestD = Infinity;
    for (const node of plan.nodes) {
      if (contains(node, at)) return node.phase;
      const c = centreOf(node);
      const d = Math.hypot(c.x - at.x, c.y - at.y);
      if (d < bestD) {
        bestD = d;
        best = node.phase;
      }
    }
    if (best) return best;
  }

  let best: string | null = null;
  let bestD = Infinity;
  for (const band of plan.phases) {
    if (contains(band, at)) return band.id;
    const c = centreOf(band);
    const d = Math.abs(c.x - at.x);
    if (d < bestD) {
      bestD = d;
      best = band.id;
    }
  }
  return best;
}

/** Which node, once the phase is known. Rule 16: the nodes are laid out in the plane. */
export function resolveItem(pose: CameraPose, group: string, open: string | null): string | null {
  const plan = planOf(open);
  const at = lookingAt(pose);
  let best: string | null = null;
  let bestD = Infinity;
  for (const box of plan.nodes) {
    if (box.phase !== group) continue;
    const node = nodeById(box.id);
    if (!node) continue;
    if (contains(box, at)) return node.item;
    const c = centreOf(box);
    const d = Math.hypot(c.x - at.x, c.y - at.y);
    if (d < bestD) {
      bestD = d;
      best = node.item;
    }
  }
  return best;
}

/**
 * KEEP THE SHEET ON SCREEN — the clamp `viewer-camera.js` applies to every move.
 *
 * The story's follow camera slides onto the beat's lane, and a lane at the bottom of the stack
 * would otherwise pull the frame off the paper: archify's camera "clamps to keep content on
 * screen", which on a fixed authored world is one line of arithmetic. When the world is smaller
 * than the frame in an axis it simply centres, because there is nothing to scroll.
 */
export function clampLook(
  at: { x: number; y: number },
  zoom: number,
  frame: Frame,
  open: string | null = null,
): { x: number; y: number } {
  const w = planOf(open).world;
  const half = { x: frame.w / (2 * zoom), y: frame.h / (2 * zoom) };
  const axis = (v: number, size: number, h: number) =>
    size <= h * 2 ? size / 2 : clamp(v, h, size - h);
  return { x: axis(at.x, w.w, half.x), y: axis(at.y, w.h, half.y) };
}

/** The phase a node belongs to — the group the shell is told about when a node is opened. */
export const phaseOfNode = (id: string): string =>
  planOf(null).byId.get(id)?.phase ?? PHASES[0]!.id;

/**
 * The quantised inverse scale (rule 13). Steps of a cube root of two — smaller than a reader
 * notices in a label, and fifty times fewer relayouts than counter-scaling every wheel tick.
 */
export const QUANT_STEPS_PER_OCTAVE = 3;

export function quantise(zoom: number): number {
  const z = Number.isFinite(zoom) && zoom > 0 ? zoom : 1;
  const stepped = Math.round(Math.log2(z) * QUANT_STEPS_PER_OCTAVE) / QUANT_STEPS_PER_OCTAVE;
  return clamp(2 ** stepped, 0.25, 8);
}

/** The viewport rectangle in world units, for the receipt and the phase-under-camera readout. */
export function viewportOf(pose: CameraPose, frame: Frame): Rect {
  return {
    x: -pose.pan.x - frame.w / (2 * pose.zoom),
    y: -pose.pan.y - frame.h / (2 * pose.zoom),
    w: frame.w / pose.zoom,
    h: frame.h / pose.zoom,
  };
}

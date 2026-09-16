/**
 * WHERE THE CAMERA STANDS — and the one change study part 2 §5 says matters.
 *
 * `viewer-camera.js` starts at **scale 1** and **disables zoom-out below 1**. There is no fit pass:
 * the authored viewBox fills a reading column and the authoring contract forces the AUTHOR to make
 * it fit at 1440×900, 1600×1000 and 1920×1080 — "repair overflow by removing content, never with
 * overflow hidden, a scroller or smaller type". Round 4 and round 5 defined home as a heavy
 * zoom-out (`HOME_MIN 0.16`, measured at 0.28 on the capture), and part 2 §3 names that single
 * ratio as the cause of every cheap-looking thing in the round-5 frame: runs at 1.5 world units ×
 * 0.28 = 0.42 px on screen, a grid pitch of 11 px, labels that had to be ellipsised.
 *
 * So here:
 *
 *   home    `clamp(min(frameW/worldW, frameH/worldH), 1, 1.6)` — at 1440×900 the world was SIZED to
 *           make that ≥ 1 (`sheet.ts` WORLD), so the sheet fills the reading column at 100 %.
 *   floor   the rig's own zoom bound is the home scale. There is no zooming out past the sheet,
 *           because there is nothing out there: the drawing IS the frame.
 *   wheel   home → 3, archify's range.
 *
 * RULE 12, 14 AND 16. `poseFor` centres the camera on a rectangle and `resolve*` answers the
 * rectangle containing the centre, so the two are exact inverses BY CONSTRUCTION.
 * `test/density.camera.test.ts` asserts the round trip for all six layers and all twelve nodes, and
 * asserts the band inequalities that keep every reachable pose out of the gaps.
 *
 * WHAT L1 AND L2 MEAN HERE, and it is the variant's thesis: **no node ever opens.** L1 is the same
 * twelve boxes with the sublabel and the tag revealed and one layer band lit; L2 is one component's
 * passport over the sheet. The drawing never becomes a different drawing, which is exactly what
 * round 5 did at L1 when twelve boxes became sixty-eight.
 */
import type { CameraPose, Focus } from "@athena/demo-kit/zoom";
import { LAYER_ORDER, type LayerId } from "@/data";

import { BOXES, BOX_BY_ID, WORLD, centreOf, contains, layerBox, type NodeBox } from "./sheet";

/**
 * The two band edges, in scale.
 *
 * Home is at most 1.23 in practice (the reading column is capped, so the fit is width-driven), so
 * 1.45 sits above every home pose with room for the kit's 8 % hysteresis; 2.25 sits between
 * `L1_ZOOM` and `L2_ZOOM` with the same room either side. All four inequalities are asserted.
 */
export const BANDS: readonly [number, number] = [1.45, 2.25];

export const HOME_MIN = 1;
export const HOME_MAX = 1.6;

/**
 * L1 IS A FIT, CLAMPED INTO THE BAND — the baseline variant's finding, and it is true here for the
 * same reason. A fixed L1 zoom is wrong on a ragged sheet: `channels` is one 140-unit box and
 * `surfaces` is a 1010-unit row, and one number leaves the first adrift in empty paper and the
 * second half off the screen. So the zoom is the layer's own fit, clamped between two values that
 * both sit inside band 1 with room for the kit's 8 % hysteresis — which leaves rule 14 untouched,
 * because `poseFor` still centres on the layer's rectangle and `resolveGroup` still answers the
 * rectangle containing the centre, whatever zoom the fit lands on.
 */
export const L1_MIN = 1.6;
export const L1_MAX = 2.05;
/** The answer when there is no frame to measure against: the server render, and the tests. */
export const L1_ZOOM = 1.8;
/** Inside band 2, and reachable: the wheel's ceiling is 3. */
export const L2_ZOOM = 2.7;
export const ZOOM_MAX = 3;

export interface Frame {
  w: number;
  h: number;
}

const clamp = (n: number, lo: number, hi: number) => (n < lo ? lo : n > hi ? hi : n);

/** Archify's fit: the authored world fills the reading column, and never shrinks below 100 %. */
export function homeZoom(frame: Frame): number {
  if (!(frame.w > 0) || !(frame.h > 0)) return HOME_MIN;
  return clamp(Math.min(frame.w / WORLD.w, frame.h / WORLD.h), HOME_MIN, HOME_MAX);
}

/**
 * `pan` is scene units from the world's own centre, because the world element carries
 * `transform-origin: 50% 50%` and the kit composes `screen = centre + zoom · (world − c + pan)`.
 * Looking at world point `q` is therefore `pan = c − q`, and `lookingAt` is that solved back.
 */
const C = { x: WORLD.w / 2, y: WORLD.h / 2 };

export const panTo = (q: { x: number; y: number }) => ({ x: C.x - q.x, y: C.y - q.y });
export const lookingAt = (pose: CameraPose) => ({ x: C.x - pose.pan.x, y: C.y - pose.pan.y });

export const HOME_LOOK = { x: C.x, y: C.y };

/** The fitted L1 zoom for one layer band, held inside the band whatever the fit computes. */
export function l1Zoom(layer: LayerId, frame: Frame): number {
  const box = layerBox(layer);
  if (!box || !(frame.w > 0) || !(frame.h > 0)) return L1_ZOOM;
  return clamp(Math.min(frame.w / box.w, frame.h / box.h) * 0.94, L1_MIN, L1_MAX);
}

export function poseFor(focus: Focus, frame: Frame): Partial<CameraPose> {
  if (focus.level === 2 && focus.item) {
    const node = BOXES.find((b) => b.components.some((c) => c.id === focus.item));
    if (node) return { zoom: L2_ZOOM, pan: panTo(centreOf(node)) };
  }
  if (focus.level >= 1 && focus.group) {
    const layer = focus.group as LayerId;
    const box = layerBox(layer);
    if (box) return { zoom: l1Zoom(layer, frame), pan: panTo(centreOf(box)) };
  }
  return { zoom: homeZoom(frame), pan: panTo(HOME_LOOK) };
}

/** The node under the camera: the one containing the centre, else the nearest by centre distance. */
export function nodeUnder(pose: CameraPose): NodeBox {
  const at = lookingAt(pose);
  let best = BOXES[0]!;
  let bestD = Infinity;
  for (const node of BOXES) {
    if (contains(node, at)) return node;
    const c = centreOf(node);
    const d = Math.hypot(c.x - at.x, c.y - at.y);
    if (d < bestD) {
      bestD = d;
      best = node;
    }
  }
  return best;
}

/**
 * Which layer band the camera is over.
 *
 * The group a variant hands the nav must be a LAYER id: the shell's mast and `read_view` both read
 * `focus.group` through `layerById`, and a variant that answered with its own vocabulary would
 * leave the agent's projection of L1 empty. The rows of this sheet ARE the layers, so the layer
 * band under the camera is both the honest answer and the one the shell can read.
 */
export function resolveGroup(pose: CameraPose): LayerId {
  const at = lookingAt(pose);
  /* A node under the centre answers first: at the L2 band the reader is inside one box. */
  for (const node of BOXES) if (contains(node, at)) return node.layer;
  /* Then the BAND itself, which is what makes `poseFor` and this an exact pair: `poseFor` frames a
     layer's bounding box, and a bounding box contains its own centre. The bands never overlap —
     they are rows — so at most one can answer, and `test/density.camera.test.ts` proves it. */
  for (const layer of LAYER_ORDER) {
    const box = layerBox(layer);
    if (box && contains(box, at)) return layer;
  }
  return nodeUnder(pose).layer;
}

/**
 * Which component the passport would open.
 *
 * NO NODE EVER OPENS, so the components are not laid out in the plane and rule 16's usual answer is
 * not available. The honest one: the camera picks a NODE, and the node's answer is whichever of its
 * components the reader already has open — a passport reached from a relationship list keeps its
 * subject when the reader wheels — falling back to the system's own entry module. That makes
 * `poseFor` and `resolveItem` exact inverses for all sixty-eight components when one is standing,
 * and for the twelve primaries when none is.
 */
export function resolveItem(pose: CameraPose, standing: string | null): string | null {
  const node = nodeUnder(pose);
  if (standing && node.components.some((c) => c.id === standing)) return standing;
  return node.primary || null;
}

/** The node a component belongs to — the box the passport grows out of. */
export const nodeOf = (componentId: string): NodeBox | undefined =>
  BOXES.find((b) => b.components.some((c) => c.id === componentId));

export const boxOf = (id: string): NodeBox | undefined => BOX_BY_ID.get(id);

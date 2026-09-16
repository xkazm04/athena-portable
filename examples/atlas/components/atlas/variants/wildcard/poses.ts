/**
 * WHERE THE CAMERA STANDS OVER THE FIELD, and the exact inverse of standing there.
 *
 * RULE 14 is why this file exists: *"camera distance can be the level only when `poseFor` and
 * `resolveGroup` are exact inverses. That, not hysteresis, is what stops the flapping."* Both
 * directions are here and `test/wildcard.poses.test.ts` asserts the round trip for every layer and
 * every one of the 68 components.
 *
 * WHAT A MATRIX ADDS TO RULE 12. *"A pose is two things: where you stand and where you look."* On
 * this field the split is sharper than on a sheet, and it falls on an axis rather than between
 * `zoom` and `pan`: **the row is the subject and the column is the object**, so `pan.y` says WHICH
 * component the reader is reading and `pan.x` says only how far along its row they have got.
 * `resolveGroup` and `resolveItem` therefore read `y` alone. A reader who pans right along row 12
 * is still reading component 12 — which is the correct answer and also, conveniently, the one that
 * makes the inverse exact with no containment branch and no "nearest" fallback in two dimensions.
 * Round 4's sheet needed a band branch in `resolveGroup` because a layer's frame was a bounding
 * box of scattered blocks and boxes overlapped; the axis cannot overlap itself.
 *
 * RULE 16, satisfied by construction. *"Camera distance can be the level for all three bands only
 * when the items are laid out in the plane."* Here the items ARE the plane: component `i` is row
 * `i`, at a known `y`, at every zoom. There is no container to be inside.
 *
 * `yaw` and `pitch` are pinned at zero by the rig's bounds — the owner's round-3 verdict, typed.
 */
import type { CameraPose, Focus } from "@athena/demo-kit/zoom";

import {
  BOUNDS,
  FIELD,
  LAYER_SPANS,
  M,
  N,
  centreOf,
  diagonalCentre,
  idAt,
  indexOf,
  layerSpan,
  type Point,
} from "./matrix";

/**
 * The two band edges, in world-units-per-pixel.
 *
 * `[0]` sits above every whole-field zoom the app can produce (`HOME_MAX`) and below `L1_ZOOM`;
 * `[1]` sits above `L1_ZOOM` and below `L2_ZOOM`. Both gaps are wider than the kit's 8%
 * hysteresis on both sides, and the test asserts each of those four inequalities, so closing one
 * fails the build rather than making the wheel feel broken.
 */
export const BANDS: readonly [number, number] = [0.55, 1.6];

/** One layer open: its own diagonal block in the middle, its row band running off both edges. */
export const L1_ZOOM = 0.9;

/**
 * One component open: its diagonal cell, the system it sits among, and as much of its own row and
 * column as the frame will hold.
 *
 * CHOSEN BY LOOKING, AND THIS IS THE ONE PLACE A MATRIX FIGHTS BACK. An item on this field is a
 * row that runs the whole width of the drawing, so "closer" and "see all of it" pull in opposite
 * directions — the near band can frame the cell that belongs to the component alone, or its
 * neighbourhood, but never its whole row. The first capture at 2.6 put twelve columns on screen
 * and every one of `ledger.py`'s four marks outside them; 2.0 puts seventeen columns and eleven
 * rows in frame, which holds a component's own system and its neighbours either side, and is
 * still a clear step from L1's thirty-four. The rest of the row is reached by panning along it,
 * which is what `pan.x` is for (rule 12) and why the legend prints both degrees.
 */
export const L2_ZOOM = 2.0;

/**
 * The floor and the ceiling on the whole-field zoom.
 *
 * RULE 15 READS DIFFERENTLY ON A MATRIX and this is the round's finding about it. A sheet can be
 * sparse — a month with four entries leaves an empty near band — and the rule's answer is a
 * minimum scale the data is laid out to. A matrix has no sparse region, because every position on
 * it is defined whether or not it carries a mark; the failure available to it is the opposite one,
 * a field too FINE to resolve. The ceiling is therefore not about filling a large display with a
 * bigger drawing (it is bounded by the stage's height either way, at 68 rows) but about never
 * letting L0 stray into the first band; the floor is so that a short window shows a small field
 * rather than an invisible one.
 */
export const HOME_MIN = 0.12;
export const HOME_MAX = 0.48;

export interface Frame {
  w: number;
  h: number;
}

const clamp = (n: number, lo: number, hi: number) => (n < lo ? lo : n > hi ? hi : n);

/** The zoom that fits the whole field in the frame, held inside the two limits above. */
export function homeZoom(frame: Frame): number {
  if (!(frame.w > 0) || !(frame.h > 0)) return HOME_MIN;
  return clamp(Math.min(frame.w / BOUNDS.w, frame.h / BOUNDS.h) * 0.96, HOME_MIN, HOME_MAX);
}

/** The world point under the middle of the frame: the inverse of `pan`. */
export const lookingAt = (pose: CameraPose): Point => ({ x: -pose.pan.x, y: -pose.pan.y });

const panTo = (p: Point) => ({ x: -p.x, y: -p.y });

/**
 * Where the camera stands for a focus. The nav-to-camera half.
 *
 * L1 stands on the middle of the layer's own diagonal block — the square where its rows meet its
 * own columns, which is the layer's internal coupling and the one place from which both of its
 * bands run off the frame in a straight line. L2 stands on one component's diagonal cell, which is
 * where its row crosses its column and therefore the only point that belongs to it alone.
 */
export function poseFor(focus: Focus, frame: Frame): Partial<CameraPose> {
  if (focus.level === 2 && focus.item) {
    const i = indexOf(focus.item);
    if (i >= 0) return { zoom: L2_ZOOM, pan: panTo(diagonalCentre(i)) };
  }
  if (focus.level >= 1 && focus.group) {
    const span = layerSpan(focus.group);
    if (span) {
      const mid = span.start + span.count / 2;
      return {
        zoom: L1_ZOOM,
        pan: panTo({ x: FIELD.x + mid * M.cell, y: FIELD.y + mid * M.cell }),
      };
    }
  }
  return { zoom: homeZoom(frame), pan: panTo(centreOf(BOUNDS)) };
}

/** The axis index the camera's y is over, clamped to the axis. `-1` only for an empty axis. */
export function rowUnder(pose: CameraPose): number {
  if (N === 0) return -1;
  const y = lookingAt(pose).y;
  const i = Math.floor((y - FIELD.y) / M.cell);
  return clamp(i, 0, N - 1);
}

/**
 * Which layer is under the camera. The camera-to-nav half.
 *
 * The row band containing the camera's y, and nothing else. `poseFor(level 1, L)` puts `y` at the
 * middle of `L`'s diagonal block, which is inside `L`'s row band; `poseFor(level 2, C)` puts it at
 * the middle of `C`'s row, which is inside `C`'s layer's row band. Both inverses are exact because
 * a row belongs to exactly one layer — which is a fact `data/index.ts` already guarantees ("every
 * component belongs to exactly one system, every system to one layer") rather than one this
 * module arranges.
 */
export function resolveGroup(pose: CameraPose): string | null {
  const i = rowUnder(pose);
  if (i < 0) return null;
  for (const span of LAYER_SPANS) {
    if (i >= span.start && i < span.start + span.count) return span.id;
  }
  return LAYER_SPANS[LAYER_SPANS.length - 1]?.id ?? null;
}

/**
 * Which component is under the camera, once the layer is known.
 *
 * The row, if the row belongs to this layer; otherwise the nearest row that does. The second case
 * is only ever reached for a pose `poseFor` did not produce — a reader who crossed the second band
 * with their own wheel while the nav still holds the layer they opened a moment ago.
 */
export function resolveItem(pose: CameraPose, group: string): string | null {
  const span = layerSpan(group);
  const i = rowUnder(pose);
  if (i < 0) return null;
  if (!span) return idAt(i);
  const clamped = clamp(i, span.start, span.start + span.count - 1);
  return idAt(clamped);
}

/**
 * THE QUANTISED INVERSE SCALE (rule 13).
 *
 * Only the marks' kind glyphs and the diagonal's hairline use it here — the labels are in the
 * rails, in screen space, and never counter-scale at all, which is the one thing this direction
 * gets for free by moving the headers out of the world. Steps of a cube root of two, as round 4
 * settled: smaller than a reader notices, fifty times fewer relayouts than a continuous inverse.
 */
export const QUANT_STEPS_PER_OCTAVE = 3;

export function quantise(zoom: number): number {
  const z = Number.isFinite(zoom) && zoom > 0 ? zoom : 1;
  const stepped = Math.round(Math.log2(z) * QUANT_STEPS_PER_OCTAVE) / QUANT_STEPS_PER_OCTAVE;
  return clamp(2 ** stepped, 0.125, 16);
}

/** The camera's bounds. Zoom is the level, so its range is the three bands with room either side. */
export const ZOOM_BOUNDS: readonly [number, number] = [HOME_MIN * 0.6, L2_ZOOM * 2.2];

/* ------------------------------- the screen-space projection ------------------------------- */

/**
 * Where a world point lands in the frame, in CSS pixels from the frame's top-left.
 *
 * The kit's camera is orthographic — `screen = centre + zoom · (world + pan)` — and this is that
 * line, written out, because the RAILS need it: they are not in the world, they are pinned to the
 * frame's edges and they slide along it. Exported and pinned in the test rather than inlined in
 * the component, because a header that disagrees with the field it heads is the one bug this
 * direction can have that a reader would not recognise as a bug.
 */
export const projectY = (worldY: number, pose: CameraPose, frame: Frame): number =>
  frame.h / 2 + pose.zoom * (worldY + pose.pan.y);

export const projectX = (worldX: number, pose: CameraPose, frame: Frame): number =>
  frame.w / 2 + pose.zoom * (worldX + pose.pan.x);

/** The screen y of the middle of axis row `i`. */
export const rowCentreY = (i: number, pose: CameraPose, frame: Frame): number =>
  projectY(FIELD.y + (i + 0.5) * M.cell, pose, frame);

/** The screen x of the middle of axis column `i`. */
export const colCentreX = (i: number, pose: CameraPose, frame: Frame): number =>
  projectX(FIELD.x + (i + 0.5) * M.cell, pose, frame);

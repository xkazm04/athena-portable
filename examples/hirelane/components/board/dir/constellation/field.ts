/**
 * Where a candidate sits on the field. Pure arithmetic, no React.
 *
 * THE FIELD. One plane, divided into vertical bands — one band per group, in
 * stage-major order, so the five stages are five labelled regions and a stage
 * that holds two open roles is twice as wide as one that holds one. Inside a
 * band a point's position carries the two facts this database is actually about:
 *
 *   x   the weighted score, on the rubric's own 0-4 baseline. Right is better.
 *   y   how many sentences the applicant wrote that a scorecard quotes. Up is
 *       more. A thinly evidenced 3.4 and a well evidenced 3.4 are the same x and
 *       different y, which is the one distinction the brief's §8 exists to keep.
 *
 * WHY BANDS AND NOT A VORONOI. The brief left the choice open. A Voronoi over
 * the stage centroids would draw the regions from the points, which sounds
 * right and is backwards here: a candidate's stage is a STORED FACT, not a
 * consequence of their score, so a region whose edge moves when somebody's
 * evidence changes would be asserting a relationship the data does not have.
 * Bands say the true thing — position is the stage, and the stage is the fact —
 * and they are also the only shape whose "which region is the camera over" is
 * an exact inverse rather than a nearest-site search.
 *
 * WHY THE UNSCORED HAVE THEIR OWN GUTTER, AND WHY IT IS A QUEUE. `model/fit.ts`
 * is blunt about it: an unscored candidate has no number and must never be drawn
 * as a zero. Neither axis applies to them — no score, and no quoted sentence
 * either, because nobody has read the application the sentences would come from.
 * So they stand in a marked strip at the left edge of their band, and the strip
 * is ORDERED BY WAIT: longest waiting at the top. Stacking them at the floor
 * instead was the first cut and it drew twenty people as one smudge, which is
 * worse than dishonest — it is unreadable. The wait is a stored column
 * (`meta.waitingDays`), the axis caption says what the gutter is, and the gutter
 * is ruled off from the score axis so nothing in it can be mistaken for a
 * measurement.
 *
 * COORDINATES. Normalised: x and y both in [0, 1], y UP. The surface scales
 * them into scene units and flips y once, at the one place that draws.
 */

import { SCORE_MAX } from "../../model/fit";
import { evidenceCount, spread, type DirGroup } from "../contract";
import type { BdCandidate } from "../../model";

export interface Band {
  /** The group id, `stage::role`. */
  id: string;
  stage: string;
  stageLabel: string;
  roleId: string;
  roleTitle: string;
  /** Normalised band edges, x0 < x1, contiguous across the field. */
  x0: number;
  x1: number;
}

/**
 * The share of a band given over to the unscored gutter at its left edge.
 *
 * Wide enough for the queue to spread ACROSS as well as up. Twenty unread
 * applications in one stage share far fewer than twenty distinct wait days, so a
 * strip narrow enough to be a line drew the ties on top of each other — the same
 * smudge the queue was introduced to fix, one axis over. The height is still the
 * wait exactly; the width takes the ties.
 */
const GUTTER = 0.26;
/** Breathing room inside a band so a 0 and a 4 do not sit on its own edges. */
const PAD = 0.06;
/**
 * How far a point may be nudged off its true position so two identical
 * scorecards do not draw as one dot. Derived from the id, never random: the
 * same field has to draw the same way on two machines, which is the rule
 * `marks/Portrait.tsx` already keeps for the same reason.
 */
const JITTER = 0.018;
/**
 * The height the field's floor sits at.
 *
 * Not zero, and this is the defect the first cut of this file shipped: a
 * candidate nobody has scored has no quoted sentences either, so their y was
 * `0 + jitter` clamped at 0 — and every unscored applicant in a band landed on
 * exactly the same coordinate, one dot standing for eleven people. A floor the
 * jitter cannot be clamped against is what keeps them countable.
 */
const FLOOR = 0.08;
/**
 * The strip at the top of a band its own name is written in.
 *
 * The first capture of this field had the label ABOVE the scene, where the
 * camera's `overflow: clip` ate it: ten unlabelled columns of dots, which is a
 * scatter with no axes and therefore a decoration — the exact charge §1c upheld
 * against the tick line. The name belongs inside the region it names, and the
 * points have to leave it room.
 */
const HEADROOM = 0.18;

/**
 * The bands, in stage-major group order, partitioning [0, 1] exactly.
 *
 * Equal widths rather than widths proportional to headcount. A band's width is
 * the score axis, and an axis whose length changes with how many people are
 * standing on it cannot be read across bands — which is the comparison the
 * level exists for.
 */
export function bandsOf(groups: DirGroup[]): Band[] {
  const n = groups.length;
  return groups.map((g, i) => ({
    id: g.id,
    stage: g.stage,
    stageLabel: g.stageLabel,
    roleId: g.role.id,
    roleTitle: g.role.title,
    x0: n === 0 ? 0 : i / n,
    x1: n === 0 ? 1 : (i + 1) / n,
  }));
}

/** The largest evidence count on the field, which is what y is scaled against. */
export function evidenceCeiling(groups: DirGroup[]): number {
  let max = 0;
  for (const g of groups) {
    for (const c of g.candidates) max = Math.max(max, evidenceCount(c));
  }
  return max;
}

/** The longest wait among the unscored, which is what the gutter is ordered by. */
export function waitCeiling(groups: DirGroup[]): number {
  let max = 0;
  for (const g of groups) {
    for (const c of g.candidates) {
      if (!c.scored) max = Math.max(max, c.meta.waitingDays);
    }
  }
  return max;
}

export interface FieldPoint {
  x: number;
  y: number;
  /** True when the point is in the gutter: no score, so no place on the axis. */
  unscored: boolean;
}

/**
 * Where one candidate sits in their band.
 *
 * `ceiling` is the field's own maximum evidence count and is passed in rather
 * than recomputed, because every point on the field has to be measured against
 * the same one or the vertical axis means something different in each band.
 */
export function pointOf(
  candidate: BdCandidate,
  band: Band,
  ceiling: number,
  longestWait = 0,
): FieldPoint {
  const width = band.x1 - band.x0;
  const jitter = (spread(candidate.id) - 0.5) * 2 * JITTER;
  const span = 1 - FLOOR - HEADROOM;
  const place = (t: number) => Math.max(0, Math.min(1, FLOOR + span * t + jitter));

  if (!candidate.scored) {
    /* The QUEUE. Height is the wait, not the evidence — an unread application has
       no evidence to have, and a column of twenty dots all at the floor answers
       nothing. Inside the gutter, never out of it: the jitter is halved so a point
       cannot reach the dividing rule and claim a score it does not have. */
    const wait = longestWait > 0 ? candidate.meta.waitingDays / longestWait : 0;
    const across = (spread(candidate.id) - 0.5) * GUTTER * 0.66;
    return {
      x: band.x0 + width * (GUTTER / 2 + across),
      y: place(wait),
      unscored: true,
    };
  }

  const y = place(ceiling > 0 ? evidenceCount(candidate) / ceiling : 0);

  const inner = width * (1 - GUTTER - PAD);
  const at = Math.max(0, Math.min(1, candidate.overall / SCORE_MAX));
  const x = band.x0 + width * GUTTER + inner * at + jitter * width;
  return { x: Math.max(band.x0, Math.min(band.x1, x)), y, unscored: false };
}

/** The x the gutter's dividing rule is drawn at, in the same coordinates. */
export function gutterEdge(band: Band): number {
  return band.x0 + (band.x1 - band.x0) * GUTTER;
}

/* ------------------------------------------------------------- the camera */

/**
 * The bands the camera crosses, and what each one means.
 *
 * This is the whole concept: there is no "level" state the camera has to be
 * told about, there is only how far away it is. At rest the field is a scatter;
 * past L1 a band fills the frame and its points have become monogram chips,
 * then cards; past L2 one card fills the frame and it is the dossier. The kit's
 * `useSemanticZoom` turns a crossing into `nav.openGroup` / `nav.openItem`, so
 * tools, Escape and focus stay the single truth (rule 6 still holds).
 */
export const ZOOM_REST = 1;
export const ZOOM_BAND = 2.6;
export const ZOOM_CARD = 5.4;

/** The field's own size in scene units at zoom 1. */
export const FIELD_W = 1300;
export const FIELD_H = 500;

export interface Pose {
  zoom: number;
  pan: { x: number; y: number };
}

/** Where the camera stands to read one band — or the whole field, for `null`. */
export function bandPose(band: Band | null): Pose {
  if (!band) return { zoom: ZOOM_REST, pan: { x: 0, y: 0 } };
  const centre = (band.x0 + band.x1) / 2;
  return { zoom: ZOOM_BAND, pan: { x: -(centre - 0.5) * FIELD_W, y: 0 } };
}

/** Where it stands to read one point, at the zoom that makes it a dossier. */
export function pointPose(point: FieldPoint): Pose {
  return {
    zoom: ZOOM_CARD,
    pan: { x: -(point.x - 0.5) * FIELD_W, y: (point.y - 0.5) * FIELD_H },
  };
}

/**
 * Which band the camera is over, given its pan. The exact inverse of
 * `bandPose`, which is what keeps the wheel and the click agreeing.
 */
export function bandAt(pan: { x: number; y: number }, bands: Band[]): Band | null {
  if (bands.length === 0) return null;
  const at = 0.5 - pan.x / FIELD_W;
  const found = bands.find((b) => at >= b.x0 && at < b.x1);
  if (found) return found;
  return at < 0 ? (bands[0] ?? null) : (bands[bands.length - 1] ?? null);
}

/**
 * Which point the camera is over, among the ones in a band.
 *
 * Nearest in field space, with x and y weighted by the field's own aspect so
 * "nearest" means nearest on SCREEN rather than nearest in a unit square that
 * is drawn two and a half times wider than it is tall.
 */
export function pointAt<T>(
  pan: { x: number; y: number },
  points: { key: T; point: FieldPoint }[],
): T | null {
  if (points.length === 0) return null;
  const x = 0.5 - pan.x / FIELD_W;
  const y = 0.5 + pan.y / FIELD_H;
  let best = points[0]!;
  let bestD = Infinity;
  for (const p of points) {
    const dx = (p.point.x - x) * FIELD_W;
    const dy = (p.point.y - y) * FIELD_H;
    const d = dx * dx + dy * dy;
    if (d < bestD) {
      bestD = d;
      best = p;
    }
  }
  return best.key;
}

/** The rig's bounds: the whole field plus a margin, in to one card. */
export function fieldBounds(): {
  zoom: [number, number];
  pan: { x: [number, number]; y: [number, number] };
} {
  return {
    zoom: [ZOOM_REST * 0.7, ZOOM_CARD * 1.15],
    pan: { x: [-FIELD_W / 2, FIELD_W / 2], y: [-FIELD_H / 2, FIELD_H / 2] },
  };
}

/**
 * Which band the world is drawn in.
 *
 * THE POINT OF THE ROUND IS IN THIS FILE'S FOUR VALUES. A level is a navigation fact: which
 * group is open, which item, what Escape means, what an agent's `read_view` answers. A BAND is a
 * rendering fact: how much ink an object is worth at this distance. Round 2 had three of each
 * and pretended they were the same three, so "show the amounts" and "open the lane" had to be
 * one event. Here there are four bands over three levels — `far` and `mid` are both L0 — and the
 * extra one costs nothing, because a band change is a class flip on one element.
 *
 * The two thresholds that ARE navigation (`near`, `closest`) belong to the kit's
 * `levelForZoom`, which `useSemanticZoom` owns; this file must never second-guess it, so the
 * level is an argument rather than something re-derived from the zoom. The only decision left
 * here is far vs mid, and it gets its own hysteresis for the reason the kit's does: a trackpad
 * emits a dozen events per flick and a bare threshold flaps, which would strobe the amounts.
 *
 * Pure: `test/world.test.ts` pins it.
 */

import { ZOOM } from "./layout";

export type Band = "far" | "mid" | "near" | "closest";

/** The order the bands run in, closest last. Used for "which way did we just move". */
export const BANDS: readonly Band[] = ["far", "mid", "near", "closest"];

/** Overshoot before the amounts appear, and undershoot before they go. The kit's own default. */
export const MID_HYSTERESIS = 0.08;

/**
 * The band, given the level the nav is on and where the camera is.
 *
 * L1 and L2 answer `near` and `closest` outright: the nav is the single truth about which group
 * is open, and a camera drifting a little below the band while the reducer still says L1 must
 * not blank the cards out from under the reader's drag. Only L0 has a choice to make.
 */
export function bandOf(level: number, zoom: number, current: Band = "far"): Band {
  if (level >= 2) return "closest";
  if (level === 1) return "near";
  const z = Number.isFinite(zoom) ? zoom : 0;
  const threshold = current === "mid" ? ZOOM.mid * (1 - MID_HYSTERESIS) : ZOOM.mid * (1 + MID_HYSTERESIS);
  return z >= threshold ? "mid" : "far";
}

/** The level a band implies. The inverse of `bandOf`, for the readout and for tests. */
export function levelOfBand(band: Band): 0 | 1 | 2 {
  if (band === "closest") return 2;
  if (band === "near") return 1;
  return 0;
}

/** What the readout calls each band. The reader is told where they are, in words. */
export const BAND_LABEL: Record<Band, string> = {
  far: "the quarter",
  mid: "the quarter, with amounts",
  near: "one area",
  closest: "one invoice",
};

/** What the next press of Escape does from here, said in the readout. */
export const BAND_OUT: Record<Band, string | null> = {
  far: null,
  mid: null,
  near: "Esc — back to the quarter",
  closest: "Esc — back to the area",
};

/**
 * THE TYPE LADDER — and the one number this round had to measure rather than reason about.
 *
 * Text in the world is sized `calc(<token> * var(--ln-inv))`, which is what keeps a lane's name
 * the same number of pixels tall at zoom 1 and at zoom 12. Writing that custom property on the
 * scene root on every camera frame is correct and ruinous: a font size is a LAYOUT input, so
 * sixty writes a second relaid out about fourteen hundred elements and the first capture of this
 * surface ran at 23fps with 70–110 ms long tasks on every flight.
 *
 * So the inverse is quantised onto a geometric ladder and written only when the RUNG changes. A
 * flight from the far band to the closest one crosses about eleven rungs instead of producing
 * twenty-five distinct values, and a drag at a fixed zoom produces none at all. The ratio is the
 * whole trade: 1.22 means a glyph is within ±10% of its nominal size at any moment, which is a
 * thing you can only see by looking for it, and it is geometric rather than linear so the error
 * is the same fraction at zoom 1 and at zoom 12.
 *
 * Pure, and pinned by `test/world.test.ts`.
 */
export const INV_RATIO = 1.22;

export function quantizeInverse(zoom: number): number {
  const z = Number.isFinite(zoom) && zoom > 0 ? zoom : 1;
  /*
   * CEIL, NOT ROUND, and that is the difference between a ladder and a floor.
   *
   * Rounding puts the rung on whichever side is nearer, so half the ladder sits BELOW the true
   * inverse and the type it sizes lands under 13px — measured at 12.4px in the first capture,
   * which is the exact defect the owner has named twice. Rounding up can only ever make a glyph
   * larger than nominal, by at most the ratio, so the floor holds at every zoom by construction
   * and the cost is that some rungs read 13 and some read up to 15.9.
   */
  const rung = Math.ceil(Math.log(1 / z) / Math.log(INV_RATIO) - 1e-9);
  return INV_RATIO ** rung;
}

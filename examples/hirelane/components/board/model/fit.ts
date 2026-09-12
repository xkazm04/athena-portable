/**
 * The fit bands and the confidence bands, and the two floors between them.
 *
 * `FIT_STRONG` and `FIT_PROMISING` are the only numbers in this direction that
 * decide anything about a person, so they are declared once and every surface
 * that draws a line reads them from here. A tick on the board's fit rule and a
 * band on a carousel card are the same judgement drawn twice.
 *
 * Two floors, not one: "worth a real look" and "strong". A single threshold
 * turns a scale into a pass mark and throws away the middle, which in this
 * database is exactly where the six deliberately borderline applicants live.
 */

/** How confident the score is, and why it is as wide as it is. */
export type Band = "tight" | "moderate" | "wide";

export const BAND_LABEL: Record<Band, string> = {
  tight: "well evidenced",
  moderate: "partly evidenced",
  wide: "thinly evidenced",
};

export const FIT_STRONG = 2.8;
export const FIT_PROMISING = 2.2;

export type Fit = "strong" | "promising" | "thin" | "unscored";

export const FIT_LABEL: Record<Fit, string> = {
  strong: "strong",
  promising: "worth a look",
  thin: "thin",
  unscored: "not scored",
};

export function fitOf(scored: boolean, overall: number): Fit {
  if (!scored) return "unscored";
  if (overall >= FIT_STRONG) return "strong";
  if (overall >= FIT_PROMISING) return "promising";
  return "thin";
}

export const SCORE_MAX = 4;

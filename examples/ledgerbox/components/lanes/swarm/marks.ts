/**
 * Which marks speak, and what a mark's box is.
 *
 * The swarm is 124 invoices and it must not become 124 labels, so labelling is
 * a rule rather than a threshold: three amounts per lane, picked by balance, so
 * the labels land on the money actually at stake. A width threshold was the
 * obvious rule and the wrong one — at this scale a dense stretch of a lane
 * turned into a run of colliding figures.
 *
 * `markVars` is the geometry: a mark's width IS its weight and its tail IS how
 * late it is, expressed as custom properties the stylesheet reads.
 */
import type { CSSProperties } from "react";

import { markWidth, type LnLane, type LnMark } from "../model";


/**
 * How many amounts each lane prints.
 *
 * A width threshold was the obvious rule and the wrong one: at this scale no
 * mark is as wide as its own amount, so every label overflowed to the right and
 * dense stretches of a lane turned into a run of colliding figures. A fixed
 * count per lane is sparse by construction, and picking it by balance means the
 * labels land on the money that is actually at stake.
 */
const LABELS_PER_LANE = 3;

/**
 * At or past this many days a mark is worth interrupting someone about — the
 * footer key publishes this as "45+ days", and the key is the contract.
 */
export const SHOUT_AT = 45;

/** The glyph a mark carries, or none. Ordered by how much it wants you. */
export function flagOf(mark: LnMark): string | null {
  if (mark.state === "disputed") return "?";
  if (mark.daysOverdue >= SHOUT_AT && mark.balanceCents > 0) return "!";
  if (mark.candidateCount > 0 && mark.balanceCents > 0) return "+";
  return null;
}

/** The ids in this lane whose amount is printed. */
export function labelledIn(lane: LnLane): Set<string> {
  return new Set(
    [...lane.marks]
      .filter((m) => m.balanceCents > 0)
      .sort((a, b) => b.balanceCents - a.balanceCents)
      .slice(0, LABELS_PER_LANE)
      .map((m) => m.id),
  );
}

export function markVars(mark: LnMark, todayX: number): CSSProperties {
  return {
    "--x": mark.x,
    "--w": markWidth(mark.weight) / 1000,
    "--row": mark.row,
    "--todayX": todayX,
  } as CSSProperties;
}

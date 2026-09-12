/**
 * What each area of the practice is called, and what kind of work it is.
 *
 * The blurb is the one sentence L1 opens with, so a reader landing in a lane
 * knows what they are looking at before they read a single mark.
 */
import type { Category } from "../types";

export const MS_DAY = 86_400_000;
/** Lines the L2 card draws before it says how many it left out. */
export const CARD_LINES = 5;

/** What each area of the books is, in the practice's own words. */
export const LANE_BLURB: Record<Category, string> = {
  uncategorized: "Filed under nothing yet. Every one of these is a decision nobody has made.",
  design: "Studio design work, billed on delivery.",
  development: "Build work, billed monthly against a statement of work.",
  consulting: "Advisory days, billed in arrears.",
  retainer: "Standing monthly fees. These should never be late, and some are.",
  reimbursable: "Costs passed through at no margin. Small, numerous, easy to lose.",
};

export const LANE_LABEL: Record<Category, string> = {
  uncategorized: "Unfiled",
  design: "Design",
  development: "Development",
  consulting: "Consulting",
  retainer: "Retainer",
  reimbursable: "Reimbursable",
};

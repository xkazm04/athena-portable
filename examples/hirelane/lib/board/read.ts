import "server-only";

/**
 * How a person is named on the board, and how sure the score is.
 *
 * `bandOf` is the one that matters: confidence is not a model output here, it
 * is a count of how many criteria the application actually spoke to. A score
 * built on one quoted sentence and a score built on five are different claims,
 * and the surface says which is which by naming the criteria that carried
 * nothing.
 */
import type { CriterionScore } from "../types";
import type { Band, BdEvidence } from "@/components/board/model";


export const MS_DAY = 86_400_000;

/** Two words at most: a criterion name has to survive labelling a bar. */
export function shorten(name: string): string {
  const words = name.split(/\s+/);
  return words.length <= 2 ? name : `${words[0] ?? ""} ${words[1] ?? ""}`.trim();
}

export function initialsOf(name: string): string {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0] ?? "")
    .join("")
    .toUpperCase();
}

/**
 * How much of the rubric this application actually speaks to.
 *
 * The honest analogue of a confidence band. A score built on two quoted
 * criteria out of five is not the same claim as one built on all five, and a
 * surface that renders both as a bare number invites the reader to over-trust
 * the first. The drivers are named so the width can be explained rather than
 * merely displayed.
 */
export function bandOf(scores: CriterionScore[]): { band: Band; drivers: string[] } {
  const total = scores.length;
  if (total === 0) return { band: "wide", drivers: [] };
  const evidenced = scores.filter((s) => s.evidence.length > 0);
  const missing = scores.filter((s) => s.evidence.length === 0).map((s) => s.name);
  const share = evidenced.length / total;
  const band: Band = share >= 0.8 ? "tight" : share >= 0.5 ? "moderate" : "wide";
  return { band, drivers: missing };
}

/**
 * The evidence facets of a STORED scorecard, or null when there is none.
 *
 * The only door to `BdCandidate.evidence`. It takes the stored rows, not the zero row the board
 * draws an unscored candidate with, so an unread application cannot come out "thinly evidenced".
 */
export function evidenceOf(stored: CriterionScore[] | undefined, criteriaCount: number): BdEvidence | null {
  if (!stored) return null;
  const { band, drivers } = bandOf(stored);
  return {
    evidenced: stored.filter((s) => s.evidence.length > 0).length,
    criteriaCount,
    band,
    drivers,
  };
}

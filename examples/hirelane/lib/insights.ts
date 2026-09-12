import { gapOf, overallScore, summarise } from "./scoring";
import type { Applicant, Criterion, CriterionScore, Insight } from "./types";

/**
 * Board-level read of the latest scorecard per applicant.
 *
 * Deliberately reads STORED scorecards rather than scoring on the fly: an applicant nobody has
 * scored shows as unscored, not as a number that appeared without anyone deciding to produce it.
 *
 * Pure, and it takes the scorecards rather than reading them. It used to issue the latest-scorecard
 * query itself - byte-identical, once whitespace is collapsed, to `latestScorecards` in
 * lib/queries.ts - and `buildBoard` called both, back to back, with the same role id. Two copies of
 * "the latest rubric note for an applicant of this role" would be a tolerable duplication if they
 * fed different things, but they feed different fields of the SAME candidate: `scored` and `scores`
 * come from one, `gap` and `line` from the other. A correctness fix applied to one and not the
 * other is not a stale number, it is a card reading `not scored` while printing a gap.
 *
 * Taking `criteria` as an argument closes the second copy: `buildBoard` has already listed them
 * nine lines earlier with the same argument.
 */
export function insightsFor(
  applicants: Applicant[],
  scorecards: Record<string, CriterionScore[]>,
  criteria: Criterion[],
): Record<string, Insight> {
  const latest = new Map(Object.entries(scorecards));
  const criteriaNames = new Map(criteria.map((c) => [c.id, c.name]));

  const out: Record<string, Insight> = {};
  for (const applicant of applicants) {
    const scores = latest.get(applicant.id);
    const seededGap = applicant.gap_criterion_id
      ? (criteriaNames.get(applicant.gap_criterion_id) ?? null)
      : null;
    out[applicant.id] = scores
      ? {
          applicant_id: applicant.id,
          scored: true,
          overall: overallScore(scores),
          gap: gapOf(scores)?.name ?? seededGap,
          line: summarise(scores),
        }
      : {
          applicant_id: applicant.id,
          scored: false,
          overall: 0,
          gap: seededGap,
          line: seededGap
            ? `Not scored yet. The application never mentions ${seededGap.toLowerCase()}.`
            : "Not scored yet.",
        };
  }
  return out;
}

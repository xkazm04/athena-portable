/**
 * Finding one candidate or one column, and the order they compare in.
 *
 * The comparison the board draws is `criterionMedians`: each criterion on an L1
 * card as a signed distance from the middle of the column's scored field.
 */

import type { BdCandidate, BdColumn, BdRole } from "./candidates";

/**
 * Best first, unscored strictly last.
 *
 * The second clause is the whole point: sorting by a coerced zero would put a
 * person nobody has read below a person somebody read and rated poorly, which
 * is a claim the database does not support.
 */
export function byScoreDesc(a: BdCandidate, b: BdCandidate): number {
  if (a.scored !== b.scored) return a.scored ? -1 : 1;
  if (!a.scored) return a.name.localeCompare(b.name);
  return b.overall - a.overall || a.name.localeCompare(b.name);
}

/** What a column's comparison should open on: the arguable ones first. */
export function comparisonOrder(column: BdColumn): BdCandidate[] {
  return [...column.candidates].sort(
    (a, b) => Number(b.borderline) - Number(a.borderline) || byScoreDesc(a, b),
  );
}

export function columnOf(role: BdRole, id: string | null): BdColumn | undefined {
  return id ? role.columns.find((c) => c.id === id) : undefined;
}

export function candidateOf(role: BdRole, id: string | null): BdCandidate | undefined {
  if (!id) return undefined;
  for (const column of role.columns) {
    const hit = column.candidates.find((c) => c.id === id);
    if (hit) return hit;
  }
  return undefined;
}

/* -------------------------------------------------------------- comparison */

/**
 * Per-criterion median among the SCORED candidates in a column.
 *
 * The L1 card prints every criterion as a signed distance from this, because a 3.1 on API design
 * means nothing until you know whether the rest of the field is above or below it — the argument
 * `dossier/Bench.tsx` already makes in prose about the overall score, applied to the five
 * criteria that produce it.
 *
 * THE MEDIAN RATHER THAN THE MEAN. In a column of ten, one generously read application moves a
 * mean enough to shift everybody else's delta, and the card's whole claim is that the number
 * beside a criterion says something about THIS candidate.
 *
 * THE UNSCORED ARE NOT IN THE POPULATION. They are excluded rather than counted as zero — the
 * same rule the bench defends when it sorts them last. An absent measurement is not a low one and
 * must not be allowed to drag the middle of the field down. A column where nobody has been scored
 * yields an empty map, and the card renders that as "no comparison" rather than as a row of
 * zeroes.
 */
export function criterionMedians(candidates: BdCandidate[]): Map<string, number> {
  const buckets = new Map<string, number[]>();
  for (const candidate of candidates) {
    if (!candidate.scored) continue;
    for (const score of candidate.scores) {
      const bucket = buckets.get(score.criterionId);
      if (bucket) bucket.push(score.score);
      else buckets.set(score.criterionId, [score.score]);
    }
  }
  const out = new Map<string, number>();
  for (const [id, values] of buckets) {
    values.sort((a, b) => a - b);
    const mid = Math.floor(values.length / 2);
    out.set(
      id,
      values.length % 2 === 0 ? ((values[mid - 1] ?? 0) + (values[mid] ?? 0)) / 2 : (values[mid] ?? 0),
    );
  }
  return out;
}

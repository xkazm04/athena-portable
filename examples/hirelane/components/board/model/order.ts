/**
 * Finding one candidate or one column, and the order they compare in.
 *
 * `diff` is the head-to-head: the criteria where two people actually differ,
 * widest gap first, so a reader is shown the argument rather than left to
 * subtract two lists of five numbers.
 */

import type {
  BdCandidate,
  BdColumn,
  BdCriterion,
  BdRole,
  BdScore,
} from "./candidates";

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

export function scoreFor(candidate: BdCandidate, criterionId: string): BdScore | undefined {
  return candidate.scores.find((s) => s.criterionId === criterionId);
}

/* -------------------------------------------------------------- comparison */

export interface BdDiff {
  criterion: BdCriterion;
  a: BdScore | undefined;
  b: BdScore | undefined;
  /** Positive when A is ahead. */
  delta: number;
}

/**
 * What separates two candidates, widest gap first.
 *
 * A hiring manager does not need to be told that somebody is a 3.4. They need
 * to be told where the two people in front of them differ, and what each one
 * wrote to earn it.
 */
export function diff(criteria: BdCriterion[], a: BdCandidate, b: BdCandidate): BdDiff[] {
  return criteria
    .map((criterion) => {
      const sa = scoreFor(a, criterion.id);
      const sb = scoreFor(b, criterion.id);
      return { criterion, a: sa, b: sb, delta: (sa?.score ?? 0) - (sb?.score ?? 0) };
    })
    .sort((x, y) => Math.abs(y.delta) - Math.abs(x.delta));
}

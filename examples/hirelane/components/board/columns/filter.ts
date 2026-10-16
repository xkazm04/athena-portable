/**
 * What the board's two filters leave standing, and what it adds up to. One rule, two readers.
 *
 * The board is narrowed by a role (`roleFilter`) and by "arguable only" (`onlyBorderline`), and
 * the surface states the result twice: each column counts the people it draws, and the masthead
 * and the crumb total the pipeline. Those were two implementations of one filter. `Columns.tsx`
 * applied both halves; `Board.tsx`'s totals applied the role and not the flag, so with "arguable
 * only" on, five columns summing to 6 sat under a headline and a crumb reading 40.
 *
 * Both read this file now. `groupsAt` is what a column draws; `boardTotals` is the same groups
 * summed over every stage, so the totals cannot count anyone the board has dropped.
 *
 * `roles` obeys the role filter and not the flag, on purpose: an open role is open whether or not
 * anybody in it is arguable today, and the headline says "open roles".
 */
import { STAGES, type Stage } from "@/lib/constants";
import type { BdBoard, BdCandidate, BdRole } from "../model";

/** The two filters, as `Board.tsx` holds them. */
export interface BoardFilter {
  roleFilter: string;
  onlyBorderline: boolean;
}

export interface BoardTotals {
  roles: number;
  applicants: number;
  scored: number;
  borderline: number;
}

export function keepsRole(role: BdRole, { roleFilter }: BoardFilter): boolean {
  return roleFilter === "all" || role.id === roleFilter;
}

export function keepsCandidate(candidate: BdCandidate, { onlyBorderline }: BoardFilter): boolean {
  return !onlyBorderline || candidate.borderline;
}

/** One stage's rows: every role the filters keep, with the people they keep, empty rows dropped. */
export function groupsAt(
  board: BdBoard,
  stage: Stage,
  filter: BoardFilter,
): { role: BdRole; candidates: BdCandidate[] }[] {
  return board.roles
    .filter((role) => keepsRole(role, filter))
    .map((role) => ({
      role,
      candidates: (role.columns.find((c) => c.id === stage)?.candidates ?? []).filter((c) =>
        keepsCandidate(c, filter),
      ),
    }))
    .filter((g) => g.candidates.length > 0);
}

/** The pipeline as the board draws it: every stage's groups, summed. */
export function boardTotals(board: BdBoard, filter: BoardFilter): BoardTotals {
  const kept = STAGES.flatMap((stage) => groupsAt(board, stage, filter).flatMap((g) => g.candidates));
  return {
    roles: board.roles.filter((role) => keepsRole(role, filter)).length,
    applicants: kept.length,
    scored: kept.filter((c) => c.scored).length,
    borderline: kept.filter((c) => c.borderline).length,
  };
}

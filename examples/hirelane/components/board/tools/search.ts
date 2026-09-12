/**
 * Search the pipeline, across both roles and all five stages at once.
 *
 * An agent should not have to open five stages twice over to find the person it
 * is looking for. Every result carries the group id it lives in, so it can be
 * handed straight to `open_group` or `open_item`.
 *
 * The score filters only ever match SCORED candidates, and the tool says so in
 * its own result. That is not a nicety: a filter like "under 2.5" that silently
 * swept in forty unread applications would be an agent's first and worst
 * mistake in this domain, and the design law is explicit that an unscored
 * candidate has no score to compare.
 */
import { bounded } from "@athena/demo-kit/webmcp";
import { companyByName } from "@athena/demo-kit/seed";

import { groupId, type BdBoard, type BdCandidate, type BdRole } from "../model";
import { candidateRead } from "./read";

/** Results returned before the search stops and says how many it left out. */
export const SEARCH_PAGE = 25;

export interface BoardQuery {
  text?: string;
  role?: string;
  /** Only candidates whose current employer is this company, by name or domain. */
  employer?: string;
  stage?: string;
  /** Only candidates somebody has scored at or above this weighted 0-4. */
  scored_at_least?: number;
  /** Only candidates somebody has scored at or below this weighted 0-4. */
  scored_at_most?: number;
  /** Only the ones a person flagged as arguable. */
  arguable?: boolean;
  /** Only the ones nobody has scored yet. */
  unscored?: boolean;
}

function hay(c: BdCandidate): string {
  return `${c.name} ${c.headline} ${c.line} ${c.shortAnswer} ${c.employer}`.toLowerCase();
}

/** By name or by domain, because an agent arriving from another app has the domain. */
function employed(c: BdCandidate, at: string): boolean {
  const want = at.toLowerCase();
  return c.employer.toLowerCase() === want || companyByName(c.employer)?.domain === want;
}

function hit(c: BdCandidate, q: BoardQuery): boolean {
  if (q.text && !hay(c).includes(q.text.toLowerCase())) return false;
  if (q.stage && q.stage !== "all" && c.stage !== q.stage) return false;
  if (q.employer && !employed(c, q.employer)) return false;
  if (q.arguable && !c.borderline) return false;
  if (q.unscored && c.scored) return false;
  // A score comparison is only ever asked of somebody who has one.
  if (q.scored_at_least !== undefined && (!c.scored || c.overall < q.scored_at_least)) return false;
  if (q.scored_at_most !== undefined && (!c.scored || c.overall > q.scored_at_most)) return false;
  return true;
}

/**
 * Scored first and best first, then the unscored by how long they have waited.
 *
 * Two orderings rather than one, because they answer two different questions
 * and mixing them would rank an unread application against a read one.
 */
function rank(a: BdCandidate, b: BdCandidate): number {
  if (a.scored !== b.scored) return a.scored ? -1 : 1;
  if (a.scored) return b.overall - a.overall;
  return b.meta.waitingDays - a.meta.waitingDays;
}

export function searchBoard(board: BdBoard, q: BoardQuery) {
  const roles: BdRole[] =
    q.role && q.role !== "all" ? board.roles.filter((r) => r.id === q.role) : board.roles;
  if (roles.length === 0) {
    return {
      ...bounded([], SEARCH_PAGE),
      error: `No role with id ${q.role}.`,
      roles: board.roles.map((r) => ({ id: r.id, title: r.title })),
    };
  }

  const found = roles
    .flatMap((role) =>
      role.columns.flatMap((column) =>
        column.candidates.filter((c) => hit(c, q)).map((c) => ({ role, column, c })),
      ),
    )
    .sort((a, b) => rank(a.c, b.c));

  return {
    ...(q.scored_at_least === undefined && q.scored_at_most === undefined
      ? {}
      : { note: "A score filter matches only candidates somebody has actually scored." }),
    ...bounded(found, SEARCH_PAGE, ({ role, column, c }) => ({
      ...candidateRead(c),
      role: role.title,
      group: groupId(column.id, role.id),
    })),
  };
}

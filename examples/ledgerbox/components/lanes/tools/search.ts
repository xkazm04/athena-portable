/**
 * Search the books, across every level at once.
 *
 * The point of this tool is that an agent should not have to walk the three
 * levels to find something. It asks a question of the whole fixture set and
 * gets back ids it can hand straight to `open_item`, each carrying the area it
 * lives in so the caller never has to guess which lane to open first.
 *
 * The filters are the ones the surface itself offers plus the two an agent
 * always wants and a pointer cannot express: a money floor and a lateness
 * floor. Everything is AND-ed, and every result says which area it came from.
 */
import { bounded } from "@athena/demo-kit/webmcp";

import { matches, STATE_FILTERS, type LnFilter, type LnMark, type LnSheet } from "../model";
import { markRead } from "./read";

/** Results returned before the search stops and says how many it left out. */
export const SEARCH_PAGE = 25;

export interface LanesQuery {
  /** Matched against the number, the client and the waiting-on clause. */
  text?: string;
  /** Restrict to one area of the practice. */
  area?: string;
  /**
   * Restrict to one invoice state, in the surface's own vocabulary — which is
   * the filter's vocabulary, not the `state` column's: `overdue` means past due
   * with a balance, so it includes part-paid invoices.
   */
  state?: string;
  /**
   * Only invoices at least this many days past due. 0 and 1 both mean "overdue
   * at all" — omit the parameter for no filter, because a floor that admits
   * everything is not a floor.
   */
  overdue_by?: number;
  /**
   * Only invoices with at least this much still owed, in units. 0 and 1 cent
   * both mean "anything still owed"; omit the parameter for no filter.
   */
  balance_over?: number;
  /** Only invoices carrying at least one unapplied credit that might fit. */
  unmatched?: boolean;
}

function hay(mark: LnMark): string {
  return `${mark.number} ${mark.clientName} ${mark.status} ${mark.state}`.toLowerCase();
}

function hit(mark: LnMark, q: LanesQuery): boolean {
  if (q.text && !hay(mark).includes(q.text.toLowerCase())) return false;
  // `matches` is the surface's own rule for this enum, and `overdue` is not the
  // `state` column: it is past-due-with-a-balance, so a part-paid invoice 61
  // days late is `partial` here and still Late there. Re-deriving it made the
  // search disagree with the chip the agent can see. `client: "all"` keeps the
  // client clause out of it — the search has no client filter.
  if (q.state && !matches(mark, { state: q.state as LnFilter["state"], client: "all" })) return false;
  // Floored at 1, because "at least 0 days past due" reads as "is overdue" and
  // a caller who sends 0 gets the whole book back sorted worst-first, which
  // looks exactly like a correct overdue search at the top of the page. The
  // unfiltered case stays reachable by omitting the parameter.
  if (q.overdue_by !== undefined && mark.daysOverdue < Math.max(1, q.overdue_by)) return false;
  if (q.balance_over !== undefined && mark.balanceCents < Math.max(1, q.balance_over * 100)) return false;
  if (q.unmatched && mark.candidateCount === 0) return false;
  return true;
}

/**
 * Worst first, because the question behind almost every search here is "what
 * should I look at": most days overdue, then most money still owed.
 */
function worstFirst(a: LnMark, b: LnMark): number {
  return b.daysOverdue - a.daysOverdue || b.balanceCents - a.balanceCents;
}

export function searchLanes(sheet: LnSheet, q: LanesQuery) {
  // The enum is offered to the caller verbatim, so an unknown value is a caller
  // error and says so, the way `set_filter` rejects an unknown client id.
  if (q.state !== undefined && !(STATE_FILTERS as readonly string[]).includes(q.state)) {
    return {
      ...bounded([], SEARCH_PAGE),
      error: `No state called ${q.state}.`,
      states: [...STATE_FILTERS],
    };
  }

  const lanes = q.area && q.area !== "all" ? sheet.lanes.filter((l) => l.id === q.area) : sheet.lanes;
  if (lanes.length === 0) {
    return {
      ...bounded([], SEARCH_PAGE),
      error: `No area called ${q.area}.`,
      areas: sheet.lanes.map((l) => l.id),
    };
  }

  const found = lanes
    .flatMap((lane) => lane.marks.filter((m) => hit(m, q)).map((m) => ({ lane, mark: m })))
    .sort((a, b) => worstFirst(a.mark, b.mark));

  return {
    // `markRead` already names the area; the label is what a person would call
    // it, and it saves the caller a second lookup before it opens anything.
    ...bounded(found, SEARCH_PAGE, ({ lane, mark }) => ({
      ...markRead(mark),
      area_label: lane.label,
    })),
  };
}

/**
 * What the surface's own filter is hiding right now.
 *
 * A filter here dims rather than removes, so an agent reading the screen has to
 * be told the difference between "not in the books" and "not lit".
 */
export function filterState(sheet: LnSheet, filter: LnFilter) {
  const all = sheet.lanes.flatMap((l) => l.marks);
  const lit = all.filter((m) => matches(m, filter)).length;
  return {
    state: filter.state,
    client: filter.client,
    lit,
    dimmed: all.length - lit,
    note: "A filter here dims rather than removes; every invoice is still on the sheet.",
  };
}

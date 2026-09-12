/**
 * What the swarm is lit by, and how a lane finds its own marks.
 *
 * A filter here DIMS rather than removes. Every invoice stays on the sheet at
 * every filter, because the shape of the books is the thing the level is for
 * and a filter that deletes rows changes the shape. `matches` decides lit or
 * dimmed; nothing here ever shortens a list.
 */

import type { LnLane, LnMark, LnSheet } from "./sheet";
import type { Heat } from "@/lib/lanes/heat";

/* ----------------------------------------------------------------- filters */

/** The states the L0 and L1 filter offers, in reading order. */
export const STATE_FILTERS = [
  "all",
  "overdue",
  // Not a column: an invoice carrying at least one unapplied credit that might settle it. It is
  // here because `navigate("unmatched")` is one of the four views the books have always offered,
  // and a tool that moves the view has to move something a reader can see.
  "unmatched",
  "open",
  "partial",
  "disputed",
  "paid",
  "void",
] as const;
export type StateFilter = (typeof STATE_FILTERS)[number];

export const STATE_FILTER_LABEL: Record<StateFilter, string> = {
  all: "Everything",
  overdue: "Late",
  unmatched: "Credit waiting",
  open: "Within terms",
  partial: "Part paid",
  disputed: "Disputed",
  paid: "Settled",
  void: "Void",
};

export interface LnFilter {
  state: StateFilter;
  /** Client id, or "all". */
  client: string;
}

export const NO_FILTER: LnFilter = { state: "all", client: "all" };

export function isFiltered(filter: LnFilter): boolean {
  return filter.state !== "all" || filter.client !== "all";
}

/**
 * Does a mark survive the filter?
 *
 * A filtered-out mark is dimmed rather than removed, so the shape of the books
 * does not change under your hands while you are reading it. The count in the
 * gutter is what tells you how far you narrowed it.
 */
export function matches(mark: LnMark, filter: LnFilter): boolean {
  if (filter.client !== "all" && mark.clientId !== filter.client) return false;
  switch (filter.state) {
    case "all":
      return true;
    case "overdue":
      return mark.daysOverdue > 0 && mark.balanceCents > 0;
    case "unmatched":
      return mark.candidateCount > 0;
    default:
      return mark.state === filter.state;
  }
}

/* -------------------------------------------------------------- vocabulary */

export const HEAT_LABEL: Record<Heat, string> = {
  good: "settled",
  watch: "within terms",
  risk: "late",
  alert: "long overdue",
  inert: "not in play",
};

/** Lanes worth opening, worst first — the L0 to L1 recommendation. */
export function laneOrder(lanes: readonly LnLane[]): LnLane[] {
  return [...lanes].sort((a, b) => b.lateCents - a.lateCents || b.owedCents - a.owedCents);
}

export function laneById(sheet: LnSheet, id: string | null): LnLane | undefined {
  return id ? sheet.lanes.find((l) => l.id === id) : undefined;
}

export function markById(sheet: LnSheet, id: string | null): LnMark | undefined {
  if (!id) return undefined;
  for (const lane of sheet.lanes) {
    const hit = lane.marks.find((m) => m.id === id);
    if (hit) return hit;
  }
  return undefined;
}

/** Marks in a lane, in the order the lane is laid out: by due date. */
export function chronological(lane: LnLane): LnMark[] {
  return [...lane.marks].sort((a, b) => Date.parse(a.dueAt) - Date.parse(b.dueAt));
}

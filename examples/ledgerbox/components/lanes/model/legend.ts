/**
 * The legend, and the fact that it is also the filter.
 *
 * THE COMPLAINT THIS ANSWERS. "Legend in app footer can also serve as filter
 * panel for the cards." The footer carried a key — five colours and three
 * glyphs — that told you what a mark meant and then let you do nothing about it,
 * while the one control that could narrow the sheet had gone with the toolbar
 * and survived only as a tool an agent could call. A key naming eight readings
 * beside a sheet you cannot narrow is two thirds of a control.
 *
 * IT ADDS NO NEW VOCABULARY. Every entry below is one of `STATE_FILTERS`, which
 * is the enum `set_filter` and `navigate` already address and the enum the
 * manifest publishes; the colour is the `Heat` that state reads as on the sheet,
 * and the glyph is one of the three `flagOf` already draws. So the panel teaches
 * exactly what the key taught, and pressing an entry moves the same state a
 * tool moves — a click and a call end in one `setFilter`.
 *
 * Pure, and held by `test/lanes.test.ts`.
 */

import type { Heat } from "@/lib/lanes/heat";
import { STATE_FILTER_LABEL, matches, type LnFilter, type StateFilter } from "./filters";
import type { LnSheet } from "./sheet";

export interface LegendEntry {
  state: StateFilter;
  label: string;
  /** The colour this state reads as on the sheet, or `null` for the reset. */
  heat: Heat | null;
  /** The glyph a mark in this state carries at L0, when it carries one. */
  glyph: string | null;
  /** What the state means, one clause, for the entry's accessible name. */
  says: string;
}

/**
 * The panel, in the order `STATE_FILTERS` declares — worst first after the
 * reset, which is the order the sheet is read in.
 */
export const LEGEND: readonly LegendEntry[] = [
  { state: "all", label: STATE_FILTER_LABEL.all, heat: null, glyph: null, says: "every invoice on the sheet" },
  { state: "overdue", label: STATE_FILTER_LABEL.overdue, heat: "alert", glyph: "!", says: "past its due date and still owed" },
  { state: "unmatched", label: STATE_FILTER_LABEL.unmatched, heat: "watch", glyph: "+", says: "a credit has landed that might clear it" },
  { state: "disputed", label: STATE_FILTER_LABEL.disputed, heat: "alert", glyph: "?", says: "the client has said in writing that they disagree" },
  { state: "partial", label: STATE_FILTER_LABEL.partial, heat: "risk", glyph: null, says: "part of it has been paid" },
  { state: "open", label: STATE_FILTER_LABEL.open, heat: "watch", glyph: null, says: "not due yet" },
  { state: "paid", label: STATE_FILTER_LABEL.paid, heat: "good", glyph: null, says: "settled in full" },
  { state: "void", label: STATE_FILTER_LABEL.void, heat: "inert", glyph: null, says: "voided, and not in play" },
];

/**
 * How many invoices each entry would leave lit, counted against the sheet as it
 * stands — the client half of the filter included, because a count that ignored
 * it would be a promise the press then breaks.
 *
 * Counted rather than estimated: these are the numbers the panel announces, and
 * a filter panel that says "37" and lights 30 is worse than one that says
 * nothing.
 */
export function legendCounts(sheet: LnSheet, client: string): Record<StateFilter, number> {
  const counts = {} as Record<StateFilter, number>;
  for (const entry of LEGEND) counts[entry.state] = 0;
  for (const lane of sheet.lanes) {
    for (const mark of lane.marks) {
      for (const entry of LEGEND) {
        if (matches(mark, { state: entry.state, client })) counts[entry.state] += 1;
      }
    }
  }
  return counts;
}

/**
 * Pressing an entry.
 *
 * A pressed entry pressed again is the reset, which is the behaviour of every
 * toggle a person has ever met — and it means the reset is reachable without
 * hunting for the "Everything" chip, which is nonetheless there because a panel
 * whose only way out is a second press on the thing you cannot remember pressing
 * is not a way out.
 */
export function toggleState(filter: LnFilter, state: StateFilter): LnFilter {
  return { ...filter, state: filter.state === state ? "all" : state };
}

/** The sentence the panel's live region says after a press. */
export function legendSay(state: StateFilter, lit: number, of: number): string {
  const entry = LEGEND.find((e) => e.state === state);
  if (!entry || state === "all") return `Showing all ${of} invoices.`;
  return `${entry.label}: ${lit} of ${of} invoices lit, the rest dimmed.`;
}

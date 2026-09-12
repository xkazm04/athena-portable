/**
 * What the server hands the surface: one sheet, six lanes, 124 marks.
 *
 * Money is in minor units everywhere in this file and everywhere downstream of
 * it. There is exactly one place that divides by a hundred and it is the
 * formatter — an amount that is sometimes pounds and sometimes pence is how a
 * ledger tells its first lie.
 *
 * The layout numbers live here too, because a mark's width IS its weight and a
 * lane's row count IS how many marks overlap in time. They are facts about the
 * data expressed as geometry, not styling.
 */

import type { Category, InvoiceState, Tone } from "@/lib/types";
import type { Heat } from "@/lib/lanes/heat";

export type { Heat };

/**
 * Geometry is computed in virtual units and rendered as percentages, so the
 * packing the server decided survives every viewport and the marks never reflow
 * into a different shape on a narrow screen.
 */
export const SPAN = 1000;

/** L0 mark width in span units: the floor keeps a small invoice clickable. */
export const MARK_MIN = 9;
export const MARK_MAX = 34;
/** L1 card width in span units. Wide enough for a number and a clause. */
export const CARD_W = 132;
export const LANE_GAP = 6;

export interface LnMark {
  id: string;
  number: string;
  clientId: string;
  clientName: string;
  category: Category;
  issuedAt: string;
  dueAt: string;
  /** Minor units, always. */
  amountCents: number;
  paidCents: number;
  balanceCents: number;
  state: InvoiceState;
  daysOverdue: number;
  /** Unapplied credits that plausibly belong to this invoice. */
  candidateCount: number;
  remindersSent: number;
  hasDraft: boolean;
  heat: Heat;
  /** 0-1 along the sheet's time axis, by due date. */
  x: number;
  /** 0-1 within the books, log-compressed so one whale does not flatten the rest. */
  weight: number;
  /** Packed sub-row inside its lane at L0. */
  row: number;
  /** One clause: what this invoice is waiting for. Drawn from L1 up. */
  status: string;
}

export interface LnLane {
  id: Category;
  label: string;
  /** What kind of work this area of the books is. */
  blurb: string;
  marks: LnMark[];
  /** Packed sub-rows this lane needs at L0. */
  rows: number;
  count: number;
  invoicedCents: number;
  collectedCents: number;
  owedCents: number;
  lateCents: number;
  lateCount: number;
  worstDays: number;
  heat: Heat;
}

export interface LnAxis {
  startIso: string;
  endIso: string;
  /** 0-1 position of the frozen "today". */
  todayX: number;
  months: { label: string; x: number }[];
}

/** The evidence behind one proposed credit-to-invoice match. */
export interface LnCandidate {
  lineId: string;
  memo: string;
  amountCents: number;
  postedAt: string;
  confidence: "strong" | "likely" | "weak";
  /** One clause per signal that fired. */
  evidence: string[];
}

/** Everything L2 shows about one invoice, precomputed so the drill is instant. */
export interface LnDetail {
  invoiceId: string;
  contact: string;
  email: string;
  address: string;
  terms: number;
  note: string;
  disputeNote: string | null;
  lines: { description: string; quantity: number; amountCents: number }[];
  /** How many lines the card is not drawing, for the truncation notice. */
  linesHidden: number;
  candidates: LnCandidate[];
  /** `lineId` is what an unapply needs; without it the payload itself encoded a one-way door. */
  matched: { lineId: string; memo: string; amountCents: number; postedAt: string; evidence: string }[];
  draft: { tone: Tone; body: string } | null;
  sentCount: number;
  /** Paid most of it and went quiet. Chasing is the wrong move; the card says so. */
  mostlyPaid: boolean;
}

export interface LnTotals {
  invoiceCount: number;
  invoicedCents: number;
  collectedCents: number;
  outstandingCents: number;
  overdueCents: number;
  overdueCount: number;
  disputedCount: number;
  unmatchedCount: number;
}

export interface LnSheet {
  lanes: LnLane[];
  axis: LnAxis;
  /** Every client in the books with an invoice count, for the L0/L1 filter. */
  clients: { id: string; name: string; count: number }[];
  totals: LnTotals;
  details: Record<string, LnDetail>;
}

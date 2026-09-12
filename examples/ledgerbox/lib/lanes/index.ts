/**
 * Builds the one dataset The Lanes reads (design 4.6.1).
 *
 * Computed once per request on the server and handed down as plain props. A
 * direction whose whole claim is a seamless zoom cannot fetch on the way in, so
 * every level's data — the swarm, the spread and the invoice card — is already
 * in the payload before the first frame.
 *
 * The grouping is the book-keeping CATEGORY, not the client. That is the choice
 * the direction is making: a swimlane is an *area of the practice*, so the state
 * and client filters cut across the lanes instead of being the lanes.
 */
import "server-only";

import { CATEGORIES, PERIODS, type Category, type Period } from "../constants";
import {
  getInvoiceDetail,
  lineSuggestions,
  listClients,
  listInvoices,
  summarize,
  unappliedCredits,
  unappliedLines,
} from "../db";
import { isMostlyPaid } from "../filter";
import type { InvoiceRow, PeriodSummary } from "../types";
import { heatOf } from "@/lib/lanes/heat";
import type { LnBooks } from "@/components/lanes/model";
import {
  CARD_W,
  markWidth,
  packRows,
  type LnDetail,
  type LnLane,
  type LnMark,
  type LnSheet,
} from "@/components/lanes/model";
import { CARD_LINES, LANE_BLURB, LANE_LABEL, MS_DAY } from "./constants";
import { buildAxis, laneHeat, statusOf, weightOf } from "./read";

export function buildSheet(): LnSheet {
  const rows = listInvoices();
  const quarter = summarize("quarter");
  const axis = buildAxis(rows);
  const startMs = Date.parse(axis.startIso);
  const span = Math.max(MS_DAY, Date.parse(axis.endIso) - startMs);

  const maxBalance = rows.reduce((m, r) => Math.max(m, r.balance_cents), 0);
  const maxAmount = rows.reduce((m, r) => Math.max(m, r.amount_cents), 0);

  const toMark = (r: InvoiceRow): LnMark => ({
    id: r.id,
    number: r.number,
    clientId: r.client_id,
    clientName: r.client_name,
    category: r.category,
    issuedAt: r.issued_at,
    dueAt: r.due_at,
    amountCents: r.amount_cents,
    paidCents: r.paid_cents,
    balanceCents: r.balance_cents,
    state: r.state,
    daysOverdue: r.days_overdue,
    candidateCount: r.candidate_count,
    remindersSent: r.reminders_sent,
    hasDraft: r.has_draft_reminder,
    heat: heatOf(r.state, r.days_overdue),
    x: (Date.parse(r.due_at) - startMs) / span,
    // Weight is what the invoice still COSTS you. A settled one keeps a floor
    // presence so the lane still shows the work that was done, but it must not
    // compete for attention with the money that is missing.
    weight:
      r.balance_cents > 0
        ? weightOf(r.balance_cents, maxBalance)
        : weightOf(r.amount_cents, maxAmount) * 0.3,
    row: 0,
    status: statusOf(r),
  });

  const byCategory = new Map<Category, LnMark[]>();
  for (const r of rows) {
    const mark = toMark(r);
    const list = byCategory.get(mark.category);
    if (list) list.push(mark);
    else byCategory.set(mark.category, [mark]);
  }

  const lanes: LnLane[] = CATEGORIES.filter((c) => (byCategory.get(c)?.length ?? 0) > 0).map(
    (category) => {
      const marks = byCategory.get(category) ?? [];
      // L0 packing happens here so every client renders the identical shape.
      const { rows: subRows, rowOf } = packRows(marks, (m) => markWidth(m.weight));
      for (const m of marks) m.row = rowOf.get(m) ?? 0;
      const late = marks.filter((m) => m.daysOverdue > 0 && m.balanceCents > 0);
      return {
        id: category,
        label: LANE_LABEL[category],
        blurb: LANE_BLURB[category],
        marks,
        rows: subRows,
        count: marks.length,
        invoicedCents: marks.reduce((s, m) => (m.state === "void" ? s : s + m.amountCents), 0),
        collectedCents: marks.reduce((s, m) => s + m.paidCents, 0),
        owedCents: marks.reduce((s, m) => (m.state === "void" ? s : s + m.balanceCents), 0),
        lateCents: late.reduce((s, m) => s + m.balanceCents, 0),
        lateCount: late.length,
        worstDays: marks.reduce((m, x) => Math.max(m, x.daysOverdue), 0),
        heat: laneHeat(marks),
      } satisfies LnLane;
    },
  );

  const clientCounts = new Map<string, { id: string; name: string; count: number }>();
  for (const r of rows) {
    const seen = clientCounts.get(r.client_id);
    if (seen) seen.count += 1;
    else clientCounts.set(r.client_id, { id: r.client_id, name: r.client_name, count: 1 });
  }

  // Detail only for what can still be acted on: a settled or voided invoice has
  // nothing on its card to press, so building one would be work for no button.
  const details: Record<string, LnDetail> = {};
  for (const r of rows) {
    if (r.balance_cents <= 0 && r.state !== "disputed") continue;
    const d = getInvoiceDetail(r.id);
    if (!d) continue;
    const draft = d.reminders.find((rem) => !rem.sent_at);
    details[r.id] = {
      invoiceId: r.id,
      contact: d.client.contact,
      email: d.client.email,
      address: d.client.address,
      terms: d.client.terms_days,
      note: d.invoice.note,
      disputeNote: d.invoice.dispute_note,
      lines: d.lines.slice(0, CARD_LINES).map((l) => ({
        description: l.description,
        quantity: l.quantity,
        amountCents: l.amount_cents,
      })),
      linesHidden: Math.max(0, d.lines.length - CARD_LINES),
      candidates: d.candidates.slice(0, 3).map((c) => ({
        lineId: c.line.id,
        memo: c.line.memo,
        amountCents: c.line.amount_cents,
        postedAt: c.line.posted_at,
        confidence: c.confidence,
        evidence: c.evidence,
      })),
      matched: d.matches.map((m) => ({
        lineId: m.line.id,
        memo: m.line.memo,
        amountCents: m.line.amount_cents,
        postedAt: m.line.posted_at,
        evidence: m.evidence,
      })),
      draft: draft ? { tone: draft.tone, body: draft.body } : null,
      sentCount: d.reminders.filter((rem) => rem.sent_at).length,
      mostlyPaid: isMostlyPaid(d.invoice),
    };
  }

  return {
    lanes,
    axis,
    clients: [...clientCounts.values()].sort((a, b) => a.name.localeCompare(b.name)),
    totals: {
      invoiceCount: rows.length,
      invoicedCents: quarter.invoiced_cents,
      collectedCents: quarter.collected_cents,
      outstandingCents: quarter.outstanding_cents,
      overdueCents: quarter.overdue_cents,
      overdueCount: quarter.overdue_count,
      disputedCount: quarter.disputed_count,
      unmatchedCount: unappliedLines().filter((l) => l.direction === "in").length,
    },
    details,
  };
}

export { CARD_W };

/**
 * The ledger beside the picture: what the books' own tool layer answers from.
 *
 * `buildSheet` is the surface — lanes, marks, geometry. This is the same request's reading of the
 * rows, the statement, the client book and the period totals, in the shapes `lib/db.ts` already
 * returns them, so `read_inbox` and `read_credits` are not a second query with a second opinion.
 * The credit VIEW is what travels, not the bare line: the ambiguity judgement is made once in
 * `lib/db.ts` rather than re-derived inside a tool.
 */
export function buildBooks(): LnBooks {
  return {
    rows: listInvoices(),
    credits: unappliedCredits(),
    suggestions: lineSuggestions(),
    summaries: Object.fromEntries(PERIODS.map((p) => [p, summarize(p)])) as Record<
      Period,
      PeriodSummary
    >,
    clients: listClients(),
  };
}

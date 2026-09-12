/**
 * The books, as an agent reads them.
 *
 * Two rules hold everything in this file. Money is in units, not minor units,
 * because an agent that gets `1250` for twelve pounds fifty will eventually say
 * so out loud. And nothing here is a layout fact: no `x`, no `weight`, no
 * `row`. Those are how a mark is DRAWN, and an agent that starts reasoning
 * about them is reasoning about the picture rather than about the books.
 */
import { companyDomain } from "@athena/demo-kit/seed";

import { HEAT_LABEL, type LnLane, type LnMark, type LnSheet } from "../model";

const money = (cents: number): number => Math.round(cents) / 100;

/** One invoice: the money, the clock and the state. */
export function markRead(mark: LnMark) {
  return {
    id: mark.id,
    number: mark.number,
    client: mark.clientName,
    // The cross-app key: the domain TidyCRM files this client under and Hirelane resolves
    // an employer to. Present at every level, so a fact filed elsewhere can find this page.
    client_domain: companyDomain(mark.clientName),
    area: mark.category,
    state: mark.state,
    heat: HEAT_LABEL[mark.heat],
    issued: mark.issuedAt.slice(0, 10),
    due: mark.dueAt.slice(0, 10),
    days_overdue: mark.daysOverdue,
    amount: money(mark.amountCents),
    balance: money(mark.balanceCents),
    unapplied_credits: mark.candidateCount,
    reminders_sent: mark.remindersSent,
    has_draft_reminder: mark.hasDraft,
    waiting_on: mark.status,
  };
}

/** One area of the practice, as the gutter states it. */
export function laneRead(lane: LnLane) {
  return {
    id: lane.id,
    label: lane.label,
    what_it_is: lane.blurb,
    invoices: lane.count,
    invoiced: money(lane.invoicedCents),
    collected: money(lane.collectedCents),
    still_open: money(lane.owedCents),
    late: money(lane.lateCents),
    late_count: lane.lateCount,
    worst_days_overdue: lane.worstDays,
    heat: HEAT_LABEL[lane.heat],
  };
}

/** The whole books, which is what L0 is showing. */
export function totalsRead(sheet: LnSheet) {
  const t = sheet.totals;
  return {
    invoices: t.invoiceCount,
    invoiced: money(t.invoicedCents),
    collected: money(t.collectedCents),
    outstanding: money(t.outstandingCents),
    overdue: money(t.overdueCents),
    overdue_count: t.overdueCount,
    disputed: t.disputedCount,
    unmatched_credits: t.unmatchedCount,
    covering: `${sheet.axis.startIso.slice(0, 10)} to ${sheet.axis.endIso.slice(0, 10)}`,
  };
}

/**
 * The one invoice at L2, with everything the card has on it.
 *
 * `lines` is capped where the card caps it and says how many it left out, which
 * is the same promise the surface makes to a reader.
 */
export function detailRead(sheet: LnSheet, mark: LnMark) {
  const d = sheet.details[mark.id];
  if (!d) return markRead(mark);
  return {
    ...markRead(mark),
    contact: d.contact,
    email: d.email,
    terms_days: d.terms,
    note: d.note,
    dispute: d.disputeNote,
    lines: d.lines.map((l) => ({
      description: l.description,
      quantity: l.quantity,
      amount: money(l.amountCents),
    })),
    lines_hidden: d.linesHidden,
    credits_that_might_fit: d.candidates.length,
    payments_applied: d.matched.map((m) => ({
      memo: m.memo,
      amount: money(m.amountCents),
      posted: m.postedAt.slice(0, 10),
      why: m.evidence,
    })),
    draft_reminder: d.draft ? { tone: d.draft.tone, body: d.draft.body } : null,
    reminders_sent: d.sentCount,
    mostly_paid: d.mostlyPaid,
  };
}

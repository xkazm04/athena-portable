/**
 * The books, as an agent reads them.
 *
 * Two rules hold everything in this file. Money is in units, not minor units,
 * because an agent that gets `1250` for twelve pounds fifty will eventually say
 * so out loud. And nothing here is a layout fact: no `x`, no `weight`, no
 * `row`. Those are how a mark is DRAWN, and an agent that starts reasoning
 * about them is reasoning about the picture rather than about the books.
 */
import { companyByName, companyDomain } from "@athena/demo-kit/seed";

import { isMostlyPaid } from "@/lib/filter";
import type { InvoiceRow } from "@/lib/types";

import { HEAT_LABEL, type LnDetail, type LnLane, type LnMark, type LnSheet } from "../model";

const money = (cents: number): number => Math.round(cents) / 100;

/**
 * What any build of the books knows about one invoice, before it is projected.
 *
 * The page holds the same invoice twice: as a ledger row (`InvoiceRow`, from `buildBooks`) and as
 * a mark on the picture (`LnMark` plus its card's `LnDetail`, from `buildSheet`). Every tool that
 * answers with an invoice projects through `invoiceCore` over these facts, so an agent comparing
 * two tools' answers compares like with like, and a field cannot be added to one tool's reading
 * and not the others (ADR "one invoice, one reading").
 */
export interface InvoiceFacts {
  id: string;
  number: string;
  clientName: string;
  category: string;
  state: string;
  dueAt: string;
  daysOverdue: number;
  amountCents: number;
  paidCents: number;
  balanceCents: number;
  candidateCount: number;
  remindersSent: number;
  hasDraft: boolean;
  contactName: string | null;
  contactEmail: string | null;
}

/**
 * One invoice: the money, the clock, the state and who a chase would reach.
 *
 * The names are `read_inbox`'s, the dialect examples/journey declares as the contract's Row.
 * `mostly_paid` is always present, so its absence never has to mean "unknown", and it is decided
 * by `isMostlyPaid` alone - the judgement README.md says the demo exists to make, stated beside
 * the ratio it reads, never instead of it.
 */
export function invoiceCore(f: InvoiceFacts) {
  return {
    id: f.id,
    number: f.number,
    client: f.clientName,
    // The cross-app key: the domain TidyCRM files this client under and Hirelane resolves
    // an employer to. Present at every level, so a fact filed elsewhere can find this page.
    client_domain: companyDomain(f.clientName),
    category: f.category,
    state: f.state,
    due_at: f.dueAt.slice(0, 10),
    days_overdue: f.daysOverdue,
    amount: money(f.amountCents),
    paid: money(f.paidCents),
    balance: money(f.balanceCents),
    // The two facts behind "paid most of it and went quiet", stated for EVERY invoice, so the
    // caller can apply its own judgement rather than trust this app to have flagged the right one.
    paid_ratio: Math.round((f.paidCents / Math.max(1, f.amountCents)) * 100) / 100,
    mostly_paid: isMostlyPaid({ paid_cents: f.paidCents, amount_cents: f.amountCents }),
    candidates: f.candidateCount,
    reminders_sent: f.remindersSent,
    has_draft_reminder: f.hasDraft,
    // Who a reminder would be addressed to, so chasing never needs a second read. It is the
    // registry contact - the same person and address in the studio's other two apps.
    contact_name: f.contactName,
    contact_email: f.contactEmail,
  };
}

/** The ledger's facts about an invoice. */
export function factsOfRow(r: InvoiceRow): InvoiceFacts {
  return {
    id: r.id,
    number: r.number,
    clientName: r.client_name,
    category: r.category,
    state: r.state,
    dueAt: r.due_at,
    daysOverdue: r.days_overdue,
    amountCents: r.amount_cents,
    paidCents: r.paid_cents,
    balanceCents: r.balance_cents,
    candidateCount: r.candidate_count,
    remindersSent: r.reminders_sent,
    hasDraft: r.has_draft_reminder,
    contactName: r.client_contact,
    contactEmail: r.client_email,
  };
}

/**
 * The picture's facts about an invoice. The card's detail is the source where the sheet built
 * one; a settled invoice has no card, and its billing contact is then the registry's, which is
 * where the seed takes every client's contact from verbatim.
 */
export function factsOfMark(mark: LnMark, detail?: LnDetail): InvoiceFacts {
  const registry = detail ? null : companyByName(mark.clientName)?.contact;
  return {
    id: mark.id,
    number: mark.number,
    clientName: mark.clientName,
    category: mark.category,
    state: mark.state,
    dueAt: mark.dueAt,
    daysOverdue: mark.daysOverdue,
    amountCents: mark.amountCents,
    paidCents: mark.paidCents,
    balanceCents: mark.balanceCents,
    candidateCount: mark.candidateCount,
    remindersSent: detail ? detail.sentCount : mark.remindersSent,
    hasDraft: detail ? detail.draft !== null : mark.hasDraft,
    contactName: detail ? detail.contact : (registry?.name ?? null),
    contactEmail: detail ? detail.email : (registry?.email ?? null),
  };
}

/** One invoice as the ledger tools read it: the core, plus when it was last paid and any dispute. */
export function rowRead(r: InvoiceRow) {
  return {
    ...invoiceCore(factsOfRow(r)),
    last_payment_at: r.last_payment_at ? r.last_payment_at.slice(0, 10) : null,
    ...(r.dispute_note ? { dispute: r.dispute_note } : {}),
  };
}

/** What only the picture states: the area it is filed in, how hot it is drawn, and what it waits on. */
function pictureExtras(mark: LnMark) {
  return {
    area: mark.category,
    heat: HEAT_LABEL[mark.heat],
    issued: mark.issuedAt.slice(0, 10),
    waiting_on: mark.status,
  };
}

/** One invoice as the picture's tools read it: the core, plus the picture's own facts. */
export function markRead(mark: LnMark) {
  return { ...invoiceCore(factsOfMark(mark)), ...pictureExtras(mark) };
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
    ...invoiceCore(factsOfMark(mark, d)),
    ...pictureExtras(mark),
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
  };
}

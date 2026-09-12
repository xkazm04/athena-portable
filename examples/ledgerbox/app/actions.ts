"use server";

/**
 * One server action per mutating capability. Each writes the domain tables, appends to `activity`,
 * and stores an `undo` payload whenever the action is reversible - the design 5.1 flags on the
 * manifest and the behaviour here are the same claim, made twice.
 */
import { revalidatePath } from "next/cache";
import { logActivity, undoActivity, type ActivityEntry } from "@athena/demo-kit/activity";
import type { Db } from "@athena/demo-kit/db";

import { MAX_IDS, type Category, type Period, type Tone } from "@/lib/constants";
import { COUNTED_OUT, db, getInvoice, inPeriod, listInvoices, summarize, unappliedLines } from "@/lib/db";
import { isMostlyPaid } from "@/lib/filter";
import { renderSummary, renderSummaryMarkdown, summaryTitle } from "@/lib/export";
import { formatMoney } from "@/lib/format";
import { scoreCandidate } from "@/lib/match";
import { composeReminder, type ReminderDraft } from "@/lib/reminder";
import type { ActionResult } from "@/lib/types";

/** `match_bank_line`'s answer: the message, plus the trading name the credit arrived under. */
export interface MatchResult extends ActionResult {
  counterparty_alias?: string;
}

/**
 * `draft_reminder`'s answer. The draft is WHOLE - `to`, `subject`, `body` - because the send is
 * carried by a connector outside the page, and half a message is not something a gate can approve.
 */
export interface DraftResult extends ActionResult {
  draft?: ReminderDraft & { reminder_id: string; invoice_id: string; tone: Tone };
}

/** `send_reminder`'s answer: who it reached, so the gate's record and the books agree. */
export interface SendResult extends ActionResult {
  to?: string;
  subject?: string;
}

/** `export_summary`'s answer: a page, not a paragraph. */
export interface ExportResult extends ActionResult {
  title: string;
  markdown?: string;
  body?: string;
}

type Undo =
  | { kind: "categorize"; prior: [string, Category][] }
  | { kind: "match"; invoice_id: string; line_id: string }
  | {
      kind: "unmatch";
      invoice_id: string;
      line_id: string;
      matched_at: string;
      actor: string;
      evidence: string;
      amount_cents: number;
      /** The payment row that was deleted, so undo restores it exactly. Absent on older entries. */
      payment?: { id: string; paid_at: string; method: string; note: string };
    }
  | { kind: "reminder"; id: string }
  | { kind: "export"; id: string };

function refresh(): void {
  revalidatePath("/");
}

/** Payments created by reconciling a bank line are named after the line, so unmatch can find them. */
function paymentIdFor(lineId: string): string {
  return `pay_match_${lineId}`;
}

/**
 * The payment row a match stands for.
 *
 * `payments` carries no `line_id`, so the id above is only a hint - and it is one the seeder never
 * uses (`lib/seed.ts:175` names its rows `pay_<suffix>_<n>`). Every writer of a reconciled payment,
 * here and in the seed, copies the same three facts off the bank line, so those are what resolves
 * it: the invoice it was applied to, the day the line posted, and its amount. Without this, unmatch
 * deleted nothing for all 65 seeded matches and left the money applied.
 */
function paymentForMatch(
  handle: Db,
  invoiceId: string,
  lineId: string,
  postedAt: string,
  amountCents: number,
): { id: string; paid_at: string; method: string; note: string } | undefined {
  const byId = handle.get<{ id: string; paid_at: string; method: string; note: string }>(
    "SELECT id, paid_at, method, note FROM payments WHERE id = ? AND invoice_id = ?",
    [paymentIdFor(lineId), invoiceId],
  );
  if (byId) return byId;
  return handle.get<{ id: string; paid_at: string; method: string; note: string }>(
    `SELECT id, paid_at, method, note FROM payments
     WHERE invoice_id = ? AND paid_at = ? AND amount_cents = ?
     ORDER BY id LIMIT 1`,
    [invoiceId, postedAt, amountCents],
  );
}

function fail(message: string): ActionResult {
  return { ok: false, message };
}

/** AUTO - file invoices under a book-keeping category. */
export async function categorizeAction(ids: string[], category: Category): Promise<ActionResult> {
  const targets = ids.slice(0, MAX_IDS);
  if (targets.length === 0) return fail("Select at least one invoice first.");
  const requested = targets.length;
  const handle = db();
  const prior: [string, Category][] = [];

  handle.withTx((tx) => {
    for (const id of targets) {
      const row = tx.get<{ category: Category }>("SELECT category FROM invoices WHERE id = ?", [id]);
      if (!row) continue;
      prior.push([id, row.category]);
      tx.run("UPDATE invoices SET category = ? WHERE id = ?", [category, id]);
    }
    // No row for a write that did not happen: an activity entry whose undo payload is empty
    // reverses nothing, and the Trail should not carry it.
    if (prior.length === 0) return;
    logActivity(tx, {
      actor: "user",
      action: "categorize",
      target: `invoice:${prior.length === 1 ? prior[0]![0] : `${prior.length} invoices`}`,
      summary: `Filed ${prior.length} invoice${prior.length === 1 ? "" : "s"} under ${category}.`,
      reversible: true,
      undo: { kind: "categorize", prior } satisfies Undo,
    });
  });

  refresh();
  // This is the one bulk write an agent can make, so a stale id list is the expected failure and
  // it has to be reported as one. Name the shortfall the way the reads do.
  if (prior.length === 0) {
    return fail(`None of those ${requested} id${requested === 1 ? " is an invoice" : "s are invoices"} in the books.`);
  }
  return {
    ok: true,
    message:
      prior.length === requested
        ? `Filed ${prior.length} under ${category}.`
        : `Filed ${prior.length} of ${requested} under ${category}; ${requested - prior.length} ids were not found.`,
  };
}

/** AUTO - apply a bank line to an invoice and record the payment it represents. */
export async function matchAction(invoiceId: string, lineId: string): Promise<MatchResult> {
  const invoice = getInvoice(invoiceId);
  if (!invoice) return fail("That invoice is gone.");
  const line = unappliedLines().find((l) => l.id === lineId);
  if (!line) return fail("That bank line is already applied elsewhere.");
  // The guard `markPaidAction` has always had. Without it any credit could be applied to any
  // invoice: the balance goes negative, `stateOf` calls it paid, and `summarize` subtracts the
  // overshoot from `outstanding_cents` while the export's positive-balance table does not - two
  // figures in one document that stop agreeing. Refusing leaves the decision with the user.
  if (line.amount_cents > invoice.balance_cents) {
    return fail(
      `${formatMoney(line.amount_cents)} is more than the ${formatMoney(invoice.balance_cents)} still owed on ${invoice.number}.`,
    );
  }

  const scored = scoreCandidate(
    {
      invoice,
      clientName: invoice.client_name,
      balanceCents: invoice.balance_cents,
      alias: invoice.client_bank_alias,
    },
    line,
  );
  const evidence = scored ? scored.evidence.join("; ") : "matched by hand";
  const alias = scored?.counterparty_alias;

  db().withTx((tx) => {
    tx.run("INSERT INTO matches (invoice_id, line_id, matched_at, actor, evidence) VALUES (?, ?, ?, 'user', ?)", [
      invoiceId,
      lineId,
      new Date().toISOString(),
      evidence,
    ]);
    tx.run(
      "INSERT INTO payments (id, invoice_id, paid_at, amount_cents, method, note) VALUES (?, ?, ?, ?, 'transfer', ?)",
      [paymentIdFor(lineId), invoiceId, line.posted_at, line.amount_cents, `Reconciled from ${line.source_file}.`],
    );
    logActivity(tx, {
      actor: "user",
      action: "match_bank_line",
      target: `invoice:${invoiceId}`,
      summary: `Matched ${formatMoney(line.amount_cents)} from "${line.memo}" to ${invoice.number} (${evidence}).`,
      reversible: true,
      undo: { kind: "match", invoice_id: invoiceId, line_id: lineId } satisfies Undo,
    });
  });

  refresh();
  // The alias is said out loud, in the answer, on the one call that proves it: the credit that
  // settled this invoice was printed under a name the books have never used. An agent that reads
  // it can remember the equivalence instead of re-deriving it next month.
  const under = alias ? ` ${invoice.client_name} banks as "${alias}".` : "";
  return {
    ok: true,
    message: `Applied ${formatMoney(line.amount_cents)} to ${invoice.number}.${under}`,
    ...(alias ? { counterparty_alias: alias } : {}),
  };
}

/** AUTO - take a bank line back off an invoice. */
export async function unmatchAction(invoiceId: string, lineId: string): Promise<ActionResult> {
  const handle = db();
  const row = handle.get<{
    matched_at: string;
    actor: string;
    evidence: string;
    amount_cents: number;
    posted_at: string;
  }>(
    `SELECT m.matched_at, m.actor, m.evidence, b.amount_cents, b.posted_at
     FROM matches m JOIN bank_lines b ON b.id = m.line_id
     WHERE m.invoice_id = ? AND m.line_id = ?`,
    [invoiceId, lineId],
  );
  if (!row) return fail("That line is not applied to this invoice.");
  const payment = paymentForMatch(handle, invoiceId, lineId, row.posted_at, row.amount_cents);
  // Refuse rather than half-reverse: dropping the match while the payment stands would report money
  // moved, leave the balance where it was, and let the same credit be applied a second time.
  if (!payment) {
    return fail(
      `No payment of ${formatMoney(row.amount_cents)} is recorded against this line, so there is nothing to lift off.`,
    );
  }
  const invoice = getInvoice(invoiceId);

  handle.withTx((tx) => {
    tx.run("DELETE FROM matches WHERE invoice_id = ? AND line_id = ?", [invoiceId, lineId]);
    tx.run("DELETE FROM payments WHERE id = ?", [payment.id]);
    logActivity(tx, {
      actor: "user",
      action: "unmatch",
      target: `invoice:${invoiceId}`,
      summary: `Unapplied ${formatMoney(row.amount_cents)} from ${invoice?.number ?? invoiceId}.`,
      reversible: true,
      undo: {
        kind: "unmatch",
        invoice_id: invoiceId,
        line_id: lineId,
        matched_at: row.matched_at,
        actor: row.actor,
        evidence: row.evidence,
        amount_cents: row.amount_cents,
        payment,
      } satisfies Undo,
    });
  });

  refresh();
  return { ok: true, message: `Unapplied ${formatMoney(row.amount_cents)}.` };
}

/** GATED - money. Recording a payment against the books is not something the app takes back. */
export async function markPaidAction(invoiceId: string, amountCents: number): Promise<ActionResult> {
  const invoice = getInvoice(invoiceId);
  if (!invoice) return fail("That invoice is gone.");
  if (invoice.state === "void") return fail("A voided invoice cannot be paid.");
  // NaN is false on both comparisons below, so without this it passes every guard and reaches the
  // INSERT, where `amount_cents INTEGER NOT NULL` throws mid-action instead of answering the user.
  if (!Number.isFinite(amountCents)) return fail("That is not an amount.");
  const amount = Math.round(amountCents);
  if (amount <= 0) return fail("Enter an amount above zero.");
  if (amount > invoice.balance_cents) {
    return fail(`That is more than the ${formatMoney(invoice.balance_cents)} still owed.`);
  }

  db().withTx((tx) => {
    tx.run(
      "INSERT INTO payments (id, invoice_id, paid_at, amount_cents, method, note) VALUES (?, ?, ?, ?, 'transfer', 'Recorded by hand.')",
      [`pay_manual_${invoiceId}_${Date.now()}`, invoiceId, new Date().toISOString(), amount],
    );
    logActivity(tx, {
      actor: "user",
      action: "mark_paid",
      target: `invoice:${invoiceId}`,
      summary: `Recorded ${formatMoney(amount)} against ${invoice.number}.`,
      reversible: false,
    });
  });

  refresh();
  return { ok: true, message: `Recorded ${formatMoney(amount)} against ${invoice.number}.` };
}

/** AUTO - writes a draft. Nothing leaves the building until `send_reminder`. */
export async function draftReminderAction(invoiceId: string, tone: Tone): Promise<DraftResult> {
  const invoice = getInvoice(invoiceId);
  if (!invoice) return fail("That invoice is gone.");
  if (invoice.balance_cents <= 0) return fail(`${invoice.number} is settled - nothing to chase.`);
  // Stated where it is meant. This used to be an accident of the days_overdue arithmetic.
  if (invoice.state === "disputed") {
    return fail(`${invoice.number} is disputed - resolve the dispute before chasing.`);
  }

  const id = `rem_${invoiceId}_${Date.now()}`;
  const draft = composeReminder({
    number: invoice.number,
    clientName: invoice.client_name,
    contactName: invoice.client_contact,
    contactEmail: invoice.client_email,
    tone,
    daysOverdue: invoice.days_overdue,
    balanceCents: invoice.balance_cents,
    amountCents: invoice.amount_cents,
  });

  db().withTx((tx) => {
    tx.run(
      "INSERT INTO reminders (id, invoice_id, tone, recipient, subject, body, created_at, sent_at) VALUES (?, ?, ?, ?, ?, ?, ?, NULL)",
      [id, invoiceId, tone, draft.to, draft.subject, draft.body, new Date().toISOString()],
    );
    logActivity(tx, {
      actor: "user",
      action: "draft_reminder",
      target: `invoice:${invoiceId}`,
      summary: `Drafted a ${tone} reminder for ${invoice.number} to ${draft.to_name} <${draft.to}>. Not sent.`,
      reversible: true,
      undo: { kind: "reminder", id } satisfies Undo,
    });
  });

  refresh();
  const whole = { ...draft, reminder_id: id, invoice_id: invoiceId, tone };
  // The judgement README.md names, delivered in the tool's own return value at the moment it
  // matters: the draft is written either way, but the agent is told before it can send.
  if (isMostlyPaid(invoice)) {
    const share = Math.round(invoice.paid_ratio * 100);
    return {
      ok: true,
      message: `${invoice.client_name} has already paid ${share}% of ${invoice.number} - the draft is saved, read the balance before sending.`,
      draft: whole,
    };
  }
  return { ok: true, message: `Drafted a ${tone} reminder for ${draft.to}. Nothing has been sent.`, draft: whole };
}

/**
 * GATED - reaches a person. Simulated: the draft is stamped sent and logged, no mail is posted.
 *
 * The RECIPIENT is read off the stored draft rather than recomputed, and it goes into the activity
 * row and the answer. In the demo the send is carried by a connector outside the page, so the one
 * fact the books must keep is which address the letter went to - "sent to Solstice Partners" is
 * not a record of that, and a second derivation could name a different person than the draft did.
 */
export async function sendReminderAction(invoiceId: string): Promise<SendResult> {
  const invoice = getInvoice(invoiceId);
  if (!invoice) return fail("That invoice is gone.");
  const handle = db();
  const draft = handle.get<{ id: string; tone: Tone; recipient: string; subject: string }>(
    "SELECT id, tone, recipient, subject FROM reminders WHERE invoice_id = ? AND sent_at IS NULL ORDER BY created_at DESC LIMIT 1",
    [invoiceId],
  );
  if (!draft) return fail("Draft a reminder first - there is nothing to send.");

  const sentAt = new Date().toISOString();
  handle.withTx((tx) => {
    tx.run("UPDATE reminders SET sent_at = ? WHERE id = ?", [sentAt, draft.id]);
    logActivity(tx, {
      actor: "user",
      action: "send_reminder",
      target: `invoice:${invoiceId}`,
      summary: `Sent the ${draft.tone} reminder for ${invoice.number} to ${invoice.client_name} <${draft.recipient}>.`,
      reversible: false,
    });
  });

  refresh();
  return {
    ok: true,
    message: `Sent to ${invoice.client_name} <${draft.recipient}>. This one cannot be taken back.`,
    to: draft.recipient,
    subject: draft.subject,
  };
}

/** GATED - voiding is a permanent statement about the books. */
export async function voidInvoiceAction(invoiceId: string): Promise<ActionResult> {
  const invoice = getInvoice(invoiceId);
  if (!invoice) return fail("That invoice is gone.");
  if (invoice.state === "void") return fail(`${invoice.number} is already void.`);
  if (invoice.paid_cents > 0) return fail("Unapply the payments before voiding this invoice.");

  db().withTx((tx) => {
    tx.run("UPDATE invoices SET status = 'void' WHERE id = ?", [invoiceId]);
    logActivity(tx, {
      actor: "user",
      action: "void_invoice",
      target: `invoice:${invoiceId}`,
      summary: `Voided ${invoice.number} (${formatMoney(invoice.amount_cents)}, ${invoice.client_name}).`,
      reversible: false,
    });
  });

  refresh();
  return { ok: true, message: `${invoice.number} is void.` };
}

/**
 * AUTO - writes a summary row the reports view lists and the browser can download.
 *
 * It answers with a PAGE: a `title` and a `markdown` body, alongside the plain text the reports
 * view prints. Act 1 closes by putting this somewhere else, and everything that receives a
 * document - a wiki page, a note, a mail - wants those two fields, so the app supplies them rather
 * than leaving a caller to invent a heading and reflow a monospaced block into one.
 */
export async function exportSummaryAction(period: Period): Promise<ExportResult> {
  const summary = summarize(period);
  const outstanding = listInvoices()
    .filter((r) => r.balance_cents > 0 && !COUNTED_OUT.includes(r.state) && inPeriod(r.issued_at, period))
    .sort((a, b) => b.balance_cents - a.balance_cents);
  const body = renderSummary({ summary, outstanding });
  const markdown = renderSummaryMarkdown({ summary, outstanding });
  const id = `exp_${period}_${Date.now()}`;

  db().withTx((tx) => {
    tx.run("INSERT INTO exports (id, period, generated_at, body) VALUES (?, ?, ?, ?)", [
      id,
      period,
      new Date().toISOString(),
      body,
    ]);
    logActivity(tx, {
      actor: "user",
      action: "export_summary",
      target: `period:${period}`,
      summary: `Exported the ${period} summary: ${formatMoney(summary.outstanding_cents)} outstanding across ${summary.invoice_count} invoices.`,
      reversible: true,
      undo: { kind: "export", id } satisfies Undo,
    });
  });

  refresh();
  return {
    ok: true,
    message: `Summary for ${period} ready.`,
    title: summaryTitle(period),
    markdown,
    body,
  };
}

/** The app-specific half of `undoActivity`: only this file knows how to reverse these writes. */
function applyUndo(tx: Db, entry: ActivityEntry): void {
  const undo = entry.undo as Undo | null;
  switch (undo?.kind) {
    case "categorize":
      for (const [id, category] of undo.prior) {
        tx.run("UPDATE invoices SET category = ? WHERE id = ?", [category, id]);
      }
      return;
    case "match":
      tx.run("DELETE FROM matches WHERE invoice_id = ? AND line_id = ?", [undo.invoice_id, undo.line_id]);
      tx.run("DELETE FROM payments WHERE id = ?", [paymentIdFor(undo.line_id)]);
      return;
    case "unmatch":
      tx.run("INSERT INTO matches (invoice_id, line_id, matched_at, actor, evidence) VALUES (?, ?, ?, ?, ?)", [
        undo.invoice_id,
        undo.line_id,
        undo.matched_at,
        undo.actor,
        undo.evidence,
      ]);
      // Restore the row that was deleted, not a reconstruction of it: an unmatch of a seeded match
      // takes away `pay_<suffix>_<n>` dated to the bank line, and undo must put that back.
      tx.run(
        "INSERT INTO payments (id, invoice_id, paid_at, amount_cents, method, note) VALUES (?, ?, ?, ?, ?, ?)",
        [
          undo.payment?.id ?? paymentIdFor(undo.line_id),
          undo.invoice_id,
          undo.payment?.paid_at ?? undo.matched_at,
          undo.amount_cents,
          undo.payment?.method ?? "transfer",
          undo.payment?.note ?? "Reapplied by undo.",
        ],
      );
      return;
    case "reminder":
      tx.run("DELETE FROM reminders WHERE id = ? AND sent_at IS NULL", [undo.id]);
      return;
    case "export":
      tx.run("DELETE FROM exports WHERE id = ?", [undo.id]);
      return;
    default:
      throw new Error(`no undo strategy for ${entry.action}`);
  }
}

export async function undoAction(id: number): Promise<{ ok: boolean; reason?: string }> {
  const result = undoActivity(db(), id, applyUndo);
  refresh();
  return { ok: result.ok, ...(result.reason ? { reason: result.reason } : {}) };
}

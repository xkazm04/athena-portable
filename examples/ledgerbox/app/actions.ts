"use server";

/**
 * One server action per mutating capability. Each writes the domain tables, appends to `activity`,
 * and stores an `undo` payload whenever the action is reversible - the design 5.1 flags on the
 * manifest and the behaviour here are the same claim, made twice.
 */
import { revalidatePath } from "next/cache";
import { logActivity, undoActivity, type ActivityEntry } from "@athena/demo-kit/activity";
import type { Db } from "@athena/demo-kit/db";

import { CATEGORIES, MAX_IDS, PERIODS, TONES, type Category, type Period, type Tone } from "@/lib/constants";
import {
  COUNTED_OUT,
  db,
  findInvoiceId,
  getInvoice,
  inPeriod,
  listInvoices,
  resolveInvoice,
  summarize,
  unappliedLines,
} from "@/lib/db";
import { isMostlyPaid } from "@/lib/filter";
import { renderSummary, renderSummaryMarkdown, summaryTitle } from "@/lib/export";
import { formatMoney } from "@/lib/format";
import { scoreCandidate } from "@/lib/match";
import { composeReminder, type ReminderDraft } from "@/lib/reminder";
import type { ActionResult, InvoiceRow } from "@/lib/types";

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

/**
 * Who a write is logged as. The tool handlers pass "athena"; a page leaves it off and is "user".
 * The argument is caller-supplied, so a page could claim to be athena - acceptable in a scratch
 * example host (ADR 0018), where the Trail is a courtesy and not an audit.
 */
const ACTORS = ["user", "athena"] as const;
type Actor = (typeof ACTORS)[number];

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

/**
 * Whether `value` is one of a closed vocabulary. The tool layer checks its enums before it calls
 * (BooksTools' own `isOneOf`), but a server action is an endpoint of its own and its parameter
 * types do not exist at runtime, so every act that takes an enum checks it here as well.
 */
function oneOf<T extends string>(list: readonly T[], value: unknown): value is T {
  return typeof value === "string" && (list as readonly string[]).includes(value);
}

/** "Unknown tone "rude" - one of gentle, firm." */
function unknown(what: string, value: unknown, list: readonly string[]): string {
  return `Unknown ${what} ${JSON.stringify(value)} - one of ${list.join(", ")}.`;
}

/**
 * Why nothing about money may touch this invoice: it is not a debt. `COUNTED_OUT` is the books'
 * one statement of which states those are - a draft was never sent to the client, a void was
 * withdrawn - and every total already reads it. The acts that chase or apply money read it here,
 * so the sentence a refusal gives is the reason, not a balance of zero standing in for one.
 * `consequence` finishes the sentence for the act that asked.
 */
function notADebt(invoice: InvoiceRow, consequence: string): string | null {
  if (!COUNTED_OUT.includes(invoice.state)) return null;
  if (invoice.state === "draft") {
    return `${invoice.number} is a draft - it has not been sent to the client, so ${consequence}.`;
  }
  return `${invoice.number} is ${invoice.state}, so ${consequence}.`;
}

/** AUTO - file invoices under a book-keeping category. */
export async function categorizeAction(
  ids: string[],
  category: Category,
  actor: Actor = "user",
): Promise<ActionResult> {
  if (!oneOf(ACTORS, actor)) return fail(unknown("actor", actor, ACTORS));
  if (!oneOf(CATEGORIES, category)) return fail(unknown("category", category, CATEGORIES));
  if (!Array.isArray(ids)) return fail("Pass the invoices as a list of ids or numbers.");
  // An id or a number, whichever the caller read; a reference that matches nothing stays in the
  // count as not found, so the shortfall is still reported.
  const targets = ids.slice(0, MAX_IDS).map((ref) => findInvoiceId(ref) ?? String(ref));
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
      actor,
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

/**
 * Why a line is not in the unapplied pool. It used to be "already applied elsewhere" for every
 * case, which sent a caller with a mistyped id hunting for another invoice, and told one whose
 * line was already on THIS invoice that it was on a different one.
 */
function whyNotInPool(lineId: unknown): string {
  const handle = db();
  const exists = handle.get<{ id: string }>("SELECT id FROM bank_lines WHERE id = ?", [String(lineId)]);
  if (!exists) return `No bank line ${JSON.stringify(String(lineId))} in the books.`;
  const on = handle.all<{ number: string }>(
    "SELECT i.number FROM matches m JOIN invoices i ON i.id = m.invoice_id WHERE m.line_id = ? ORDER BY i.number",
    [String(lineId)],
  );
  return `That bank line is already applied to ${on.map((r) => r.number).join(", ")}.`;
}

/** AUTO - apply a bank line to an invoice and record the payment it represents. */
export async function matchAction(ref: string, lineId: string, actor: Actor = "user"): Promise<MatchResult> {
  if (!oneOf(ACTORS, actor)) return fail(unknown("actor", actor, ACTORS));
  const resolved = resolveInvoice(ref);
  if (!resolved.ok) return fail(resolved.error);
  const invoiceId = resolved.id;
  const invoice = getInvoice(invoiceId)!;
  // The same rule `mark_paid` reads: a credit applied to a draft or a void is money no total shows.
  // Before the balance check, whose "more than the $0.00 still owed" is not why a void refuses.
  const unowed = notADebt(invoice, "no credit can be applied to it");
  if (unowed) return fail(unowed);
  const line = unappliedLines().find((l) => l.id === lineId);
  if (!line) return fail(whyNotInPool(lineId));
  // The pool is every line nobody matched, debits included, and a debit's amount is stored
  // positive: without this the studio's own subscription settled part of a client's invoice.
  if (line.direction !== "in") {
    return fail(`"${line.memo}" is money paid out, not received - it cannot settle ${invoice.number}.`);
  }
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
    tx.run("INSERT INTO matches (invoice_id, line_id, matched_at, actor, evidence) VALUES (?, ?, ?, ?, ?)", [
      invoiceId,
      lineId,
      new Date().toISOString(),
      actor,
      evidence,
    ]);
    tx.run(
      "INSERT INTO payments (id, invoice_id, paid_at, amount_cents, method, note) VALUES (?, ?, ?, ?, 'transfer', ?)",
      [paymentIdFor(lineId), invoiceId, line.posted_at, line.amount_cents, `Reconciled from ${line.source_file}.`],
    );
    logActivity(tx, {
      actor,
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
export async function unmatchAction(ref: string, lineId: string, actor: Actor = "user"): Promise<ActionResult> {
  if (!oneOf(ACTORS, actor)) return fail(unknown("actor", actor, ACTORS));
  const resolved = resolveInvoice(ref);
  if (!resolved.ok) return fail(resolved.error);
  const invoiceId = resolved.id;
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
      actor,
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

/** An identical manual payment inside this many seconds is a retry, not a second part-payment. */
const MANUAL_PAYMENT_REPEAT_WINDOW_MS = 10_000;

/** GATED - money. Recording a payment against the books is not something the app takes back. */
export async function markPaidAction(ref: string, amountCents: number, actor: Actor = "user"): Promise<ActionResult> {
  if (!oneOf(ACTORS, actor)) return fail(unknown("actor", actor, ACTORS));
  const resolved = resolveInvoice(ref);
  if (!resolved.ok) return fail(resolved.error);
  const invoiceId = resolved.id;
  const invoice = getInvoice(invoiceId)!;
  // A void was the only state refused, so a payment landed on a draft no total counts - money
  // applied that shows nowhere, on the one act Undo cannot take back.
  const unowed = notADebt(invoice, "no payment can be recorded against it");
  if (unowed) return fail(unowed);
  // NaN is false on both comparisons below, so without this it passes every guard and reaches the
  // INSERT, where `amount_cents INTEGER NOT NULL` throws mid-action instead of answering the user.
  if (!Number.isFinite(amountCents)) return fail("That is not an amount.");
  // `parseDollars`, the reading the tool and the card apply, refuses a sub-cent amount as a guess;
  // rounding one here recorded 1000.5 cents as $10.01, permanently.
  if (!Number.isInteger(amountCents)) return fail("That amount has a fraction of a cent - the books hold whole cents.");
  const amount = amountCents;
  if (amount <= 0) return fail("Enter an amount above zero.");
  if (amount > invoice.balance_cents) {
    return fail(`That is more than the ${formatMoney(invoice.balance_cents)} still owed.`);
  }

  // A double click or a retried tool call sends the same payment twice, and two equal part-payments
  // both pass the balance guard. An identical hand-recorded payment inside the window is a repeat.
  const since = new Date(Date.now() - MANUAL_PAYMENT_REPEAT_WINDOW_MS).toISOString();
  const repeat = db().get<{ id: string }>(
    "SELECT id FROM payments WHERE invoice_id = ? AND amount_cents = ? AND note = 'Recorded by hand.' AND paid_at >= ?",
    [invoiceId, amount, since],
  );
  if (repeat) {
    return fail(`${formatMoney(amount)} was just recorded against ${invoice.number} - not recording it twice.`);
  }

  db().withTx((tx) => {
    tx.run(
      "INSERT INTO payments (id, invoice_id, paid_at, amount_cents, method, note) VALUES (?, ?, ?, ?, 'transfer', 'Recorded by hand.')",
      [`pay_manual_${invoiceId}_${Date.now()}`, invoiceId, new Date().toISOString(), amount],
    );
    logActivity(tx, {
      actor,
      action: "mark_paid",
      target: `invoice:${invoiceId}`,
      summary: `Recorded ${formatMoney(amount)} against ${invoice.number}.`,
      reversible: false,
    });
  });

  refresh();
  return { ok: true, message: `Recorded ${formatMoney(amount)} against ${invoice.number}.` };
}

/**
 * Why this invoice cannot be chased, or null. Asked when the letter is drafted AND again when it
 * is sent: the draft can wait any length of time for its gate, and the books keep moving - a
 * payment, a void, a dispute - while it waits.
 */
function whyNotChase(invoice: InvoiceRow): string | null {
  // Before the balance: a void's balance reads 0, and "settled" is not why it cannot be chased.
  const unowed = notADebt(invoice, "there is nothing to chase");
  if (unowed) return unowed;
  if (invoice.balance_cents <= 0) return `${invoice.number} is settled - nothing to chase.`;
  // Stated where it is meant. This used to be an accident of the days_overdue arithmetic.
  if (invoice.state === "disputed") return `${invoice.number} is disputed - resolve the dispute before chasing.`;
  return null;
}

/** The letter the books stand behind today. `send_reminder` compares the stored draft with it. */
function letterFor(invoice: InvoiceRow, tone: Tone): ReminderDraft {
  return composeReminder({
    number: invoice.number,
    clientName: invoice.client_name,
    contactName: invoice.client_contact,
    contactEmail: invoice.client_email,
    tone,
    daysOverdue: invoice.days_overdue,
    balanceCents: invoice.balance_cents,
    amountCents: invoice.amount_cents,
  });
}

/** AUTO - writes a draft. Nothing leaves the building until `send_reminder`. */
export async function draftReminderAction(ref: string, tone: Tone, actor: Actor = "user"): Promise<DraftResult> {
  if (!oneOf(ACTORS, actor)) return fail(unknown("actor", actor, ACTORS));
  if (!oneOf(TONES, tone)) return fail(unknown("tone", tone, TONES));
  const resolved = resolveInvoice(ref);
  if (!resolved.ok) return fail(resolved.error);
  const invoiceId = resolved.id;
  const invoice = getInvoice(invoiceId)!;
  const why = whyNotChase(invoice);
  if (why) return fail(why);

  const id = `rem_${invoiceId}_${Date.now()}`;
  const draft = letterFor(invoice, tone);

  db().withTx((tx) => {
    tx.run(
      "INSERT INTO reminders (id, invoice_id, tone, recipient, subject, body, created_at, sent_at) VALUES (?, ?, ?, ?, ?, ?, ?, NULL)",
      [id, invoiceId, tone, draft.to, draft.subject, draft.body, new Date().toISOString()],
    );
    logActivity(tx, {
      actor,
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
export async function sendReminderAction(ref: string, actor: Actor = "user"): Promise<SendResult> {
  if (!oneOf(ACTORS, actor)) return fail(unknown("actor", actor, ACTORS));
  const resolved = resolveInvoice(ref);
  if (!resolved.ok) return fail(resolved.error);
  const invoiceId = resolved.id;
  const invoice = getInvoice(invoiceId)!;
  const handle = db();
  const draft = handle.get<{ id: string; tone: Tone; recipient: string; subject: string; body: string }>(
    "SELECT id, tone, recipient, subject, body FROM reminders WHERE invoice_id = ? AND sent_at IS NULL ORDER BY created_at DESC LIMIT 1",
    [invoiceId],
  );
  if (!draft) return fail("Draft a reminder first - there is nothing to send.");
  // The verdict on the draft pinned its words, not the world. Paid, voided or disputed since it
  // was written, it is not sent; nor is a letter whose figures the books no longer hold - a part
  // payment since the draft would otherwise ask the client for money already received.
  const why = whyNotChase(invoice);
  if (why) return fail(`${why} The reminder was not sent.`);
  const today = letterFor(invoice, draft.tone);
  if (today.subject !== draft.subject || today.body !== draft.body) {
    return fail(
      `The ${draft.tone} reminder for ${invoice.number} states figures the books no longer hold - ${formatMoney(invoice.balance_cents)} is owed now. Draft it again; it was not sent.`,
    );
  }

  const sentAt = new Date().toISOString();
  handle.withTx((tx) => {
    tx.run("UPDATE reminders SET sent_at = ? WHERE id = ?", [sentAt, draft.id]);
    // The letter that went is the one drafted last. Any older unsent draft of this invoice was
    // replaced by it; left in place, a second Send would dispatch a letter nobody approved. Undoing
    // such a draft's activity row only deletes `WHERE sent_at IS NULL`, so it stays a clean no-op.
    tx.run("DELETE FROM reminders WHERE invoice_id = ? AND sent_at IS NULL AND id <> ?", [invoiceId, draft.id]);
    logActivity(tx, {
      actor,
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
export async function voidInvoiceAction(ref: string, actor: Actor = "user"): Promise<ActionResult> {
  if (!oneOf(ACTORS, actor)) return fail(unknown("actor", actor, ACTORS));
  const resolved = resolveInvoice(ref);
  if (!resolved.ok) return fail(resolved.error);
  const invoiceId = resolved.id;
  const invoice = getInvoice(invoiceId)!;
  if (invoice.state === "void") return fail(`${invoice.number} is already void.`);
  if (invoice.paid_cents > 0) return fail("Unapply the payments before voiding this invoice.");

  db().withTx((tx) => {
    tx.run("UPDATE invoices SET status = 'void' WHERE id = ?", [invoiceId]);
    logActivity(tx, {
      actor,
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
export async function exportSummaryAction(period: Period, actor: Actor = "user"): Promise<ExportResult> {
  if (!oneOf(ACTORS, actor)) return { ...fail(unknown("actor", actor, ACTORS)), title: "" };
  // A period the books do not have summarizes to zeros and would still be filed as an export.
  if (!oneOf(PERIODS, period)) return { ...fail(unknown("period", period, PERIODS)), title: "" };
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
      actor,
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

/**
 * An undo the books can no longer take. Thrown from `applyUndo` so `undoActivity`'s transaction
 * rolls back with nothing written, and answered by `undoAction` as a reason rather than a throw.
 */
class UndoRefused extends Error {}

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
    case "unmatch": {
      // The world moved after the unmatch. Re-applying a line that is now on another invoice would
      // have one bank credit pay two; re-applying it past what is still owed overshoots the
      // balance - the guard `matchAction` has, which this path never asked.
      const now = tx.all<{ number: string }>(
        "SELECT i.number FROM matches m JOIN invoices i ON i.id = m.invoice_id WHERE m.line_id = ? ORDER BY i.number",
        [undo.line_id],
      );
      if (now.length > 0) {
        throw new UndoRefused(`That bank line is applied to ${now.map((r) => r.number).join(", ")} now - unapply it there first.`);
      }
      const invoice = getInvoice(undo.invoice_id);
      if (invoice && undo.amount_cents > invoice.balance_cents) {
        throw new UndoRefused(
          `${formatMoney(undo.amount_cents)} is more than the ${formatMoney(invoice.balance_cents)} now owed on ${invoice.number}.`,
        );
      }
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
    }
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
  let result: { ok: boolean; reason?: string };
  try {
    result = undoActivity(db(), id, applyUndo);
  } catch (error) {
    if (!(error instanceof UndoRefused)) throw error;
    return { ok: false, reason: error.message };
  }
  refresh();
  return { ok: result.ok, ...(result.reason ? { reason: result.reason } : {}) };
}

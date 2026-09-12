"use client";

/**
 * The Strip's capabilities, on WebMCP (second host of the ADR 0009 spike).
 *
 * This design hosts no chat. Everything the shipped surface can do — read the books, scrub to a
 * filter, open an invoice, tick cards, file, match, chase, settle — is registered on
 * `document.modelContext`, and the agent beside the page drives the same app state the clicks do.
 *
 * The money gates are the app's own and have not moved: `mark_paid` and `void_invoice` are
 * irreversible, `send_reminder` reaches a person, so all three carry `consequentialHint`. Reads are
 * `readOnlyHint`, bounded, and say how much they left out. Every one of those flags comes from
 * `lib/tool-classes.ts`, which is also what the class test reads - so the manifest an agent sees
 * and the classes the app claims cannot drift apart.
 *
 * What the reads must EXPOSE is the other half of the contract (design 4.6.1, act 1). The app does
 * not decide the agent's moves; it decides what the agent cannot be left to guess. So a credit that
 * fits two invoices equally well says `ambiguous` and names both, a credit that falls short says
 * by how much, a credit that arrived under a trading name says which, and an invoice that is 80%
 * paid says `paid_ratio` and when the money last moved. Those are signals, not instructions: the
 * app never says "skip this client", it says what is true and leaves the judgement where it
 * belongs.
 */
import { useRouter } from "next/navigation";

import { STUDIO } from "@athena/demo-kit/seed";
import { useToast } from "@athena/demo-kit/ui";
import { bounded, boundedPage, useWebMCPTool } from "@athena/demo-kit/webmcp";

import {
  categorizeAction,
  draftReminderAction,
  exportSummaryAction,
  markPaidAction,
  matchAction,
  sendReminderAction,
  unmatchAction,
  voidInvoiceAction,
} from "@/app/actions";
import { useAppState } from "@/components/state/AppState";
import { CATEGORIES, DETAIL_CANDIDATES, FILTERS, LINE_SUGGESTIONS, MAX_IDS, PERIODS, TONES, VIEWS, type Category, type Filter, type Period, type Tone } from "@/lib/constants";
import type { CreditView, LineSuggestion } from "@/lib/db";
import { isMostlyPaid, matchesFilterClient } from "@/lib/filter";
import { TOOL_CLASSES } from "@/lib/tool-classes";
import { parseDollars } from "@/lib/format";
import type { Client, InvoiceRow, PeriodSummary } from "@/lib/types";

const PAGE = 20;
const SELECT_MAX = 50;

/**
 * What `read_credits` may be narrowed to. An enum, like every other parameter that addresses the
 * app (design 5.1) - and the split that matters to the reconciliation beat: the credits with one
 * reading, and the ones with two.
 */
const CREDIT_FILTERS = ["all", "ambiguous", "unambiguous"] as const;
type CreditFilter = (typeof CREDIT_FILTERS)[number];

function asIds(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map(String).slice(0, MAX_IDS);
}

const isOneOf = <T extends string>(list: readonly T[], v: unknown): v is T => list.includes(String(v) as T);

/** One invoice as an agent reads it: the money and the state, not the layout. */
function row(r: InvoiceRow) {
  return {
    id: r.id,
    number: r.number,
    client: r.client_name,
    // Who a reminder would be addressed to, on this row, so chasing never needs a second read.
    // It is the registry contact - the same person and the same address in the studio's other two
    // apps - not a name this app made up.
    contact_name: r.client_contact,
    contact_email: r.client_email,
    state: r.state,
    category: r.category,
    due_at: r.due_at.slice(0, 10),
    days_overdue: r.days_overdue,
    amount: r.amount_cents / 100,
    paid: r.paid_cents / 100,
    balance: r.balance_cents / 100,
    // The two facts behind "paid most of it and went quiet". They are stated for EVERY row, not
    // only the one they happen to describe, so the caller applies its own judgement to the books
    // rather than trusting this app to have flagged the right client.
    paid_ratio: r.paid_ratio,
    last_payment_at: r.last_payment_at ? r.last_payment_at.slice(0, 10) : null,
    candidates: r.candidate_count,
    has_draft_reminder: r.has_draft_reminder,
    reminders_sent: r.reminders_sent,
    ...(r.dispute_note ? { dispute: r.dispute_note } : {}),
    // Conditional like `dispute` above: the field appears only when it is true. It is the app's
    // own reading of `paid_ratio`, offered beside the ratio, never instead of it.
    ...(isMostlyPaid(r) ? { mostly_paid: true } : {}),
  };
}

/** One candidate invoice for a credit, with both structured facts beside the English. */
function offer(h: LineSuggestion) {
  return {
    invoice_id: h.invoice_id,
    number: h.number,
    client: h.client_name,
    score: h.score,
    confidence: h.confidence,
    evidence: h.evidence,
    ...(h.short_by_cents !== undefined ? { short_by: h.short_by_cents / 100 } : {}),
    ...(h.counterparty_alias ? { counterparty_alias: h.counterparty_alias } : {}),
  };
}

/** One unapplied credit, with everything the reconciliation beat must not have to infer. */
function credit(c: CreditView) {
  return {
    line_id: c.line.id,
    posted_at: c.line.posted_at.slice(0, 10),
    amount: c.line.amount_cents / 100,
    memo: c.line.memo,
    // The app's judgement, made once in `lib/match.ts` and applied in `lib/db.ts`: the top two
    // candidates are too close to choose between. A caller that sees this should ask, not guess.
    ambiguous: c.ambiguous,
    // Named explicitly so an ambiguous credit does not have to be re-derived from `could_be`.
    candidate_invoice_ids: c.suggestions.map((h) => h.invoice_id),
    counterparty_alias: c.counterparty_alias,
    short_by: c.short_by_cents === null ? null : c.short_by_cents / 100,
    could_be: c.suggestions.map(offer),
  };
}

export interface StripToolsProps {
  rows: InvoiceRow[];
  /** Unapplied incoming credits, each already carrying its candidates and the two judgements. */
  credits: CreditView[];
  suggestions: Record<string, LineSuggestion[]>;
  summaries: Record<Period, PeriodSummary>;
  clients: Client[];
}

export function StripTools({ rows, credits, suggestions, summaries, clients }: StripToolsProps) {
  const router = useRouter();
  const { toast } = useToast();
  const { filter, setFilter, period, setPeriod, selection, setSelection } = useAppState();

  /**
   * Every mutating tool answers the same way: toast the message, refresh the books.
   *
   * It returns the WHOLE result, not its message. A tool that only needs the sentence returns
   * `.message`; the three that carry structure - the draft, the send and the close - return the
   * object, and the kit serialises it. Flattening everything to a string here is what used to
   * make a complete, addressable draft unreachable from outside the page.
   */
  const settle = async <T extends { ok: boolean; message: string }>(run: Promise<T>): Promise<T> => {
    const result = await run;
    toast(result.message, result.ok ? "success" : "error");
    router.refresh();
    return result;
  };

  const say = async (run: Promise<{ ok: boolean; message: string }>) => (await settle(run)).message;

  useWebMCPTool({
    name: "read_books",
    description: "The quarter at a glance: each period's totals, the inbox counts, and what is on screen now.",
    ...TOOL_CLASSES.read_books,
    handler: () => ({
      periods: PERIODS.map((p) => {
        const s = summaries[p];
        return {
          period: p,
          invoices: s.invoice_count,
          invoiced: s.invoiced_cents / 100,
          collected: s.collected_cents / 100,
          outstanding: s.outstanding_cents / 100,
          overdue: s.overdue_cents / 100,
          overdue_count: s.overdue_count,
          unmatched_credits: s.unmatched_lines,
          disputed: s.disputed_count,
        };
      }),
      // Whose books these are. The same studio TidyCRM and Hirelane show, so an agent moving
      // between the three tabs knows it is one owner's world and not three demos.
      studio: { name: STUDIO.name, inbox: STUDIO.inbox },
      screen: { filter, period, selected: selection.length },
    }),
  });

  useWebMCPTool({
    name: "read_inbox",
    description: "Invoices on the strip under a filter, latest due first. Paged; the footer says how many there are.",
    parameters: [
      { name: "filter", type: "string", enum: [...FILTERS], required: false, description: "Defaults to the filter on screen" },
      { name: "page", type: "number", required: false, description: `Zero-based page of ${PAGE}` },
    ],
    ...TOOL_CLASSES.read_inbox,
    handler: ({ filter: f, page }) => {
      const which: Filter = isOneOf(FILTERS, f) ? f : filter;
      const hits = rows.filter((r) => matchesFilterClient(r, which)).sort((a, b) => b.days_overdue - a.days_overdue);
      // The envelope comes first: a consumer that caps the payload still gets the counts. It is
      // the kit's one truncation shape - `showing` and `of` as numbers, never a sentence an agent
      // has to parse - so this answers "how many did I not see" the way every other tool in every
      // other app does.
      return { ...boundedPage(hits, Number(page), PAGE, row), filter: which };
    },
  });

  useWebMCPTool({
    name: "read_invoice",
    description: "One invoice with the bank credits that could settle it. Changes nothing.",
    parameters: [{ name: "id", type: "string", required: true, description: "Invoice id, e.g. inv_0042" }],
    ...TOOL_CLASSES.read_invoice,
    handler: ({ id }) => {
      const r = rows.find((x) => x.id === String(id));
      if (!r) return `No invoice ${String(id)}.`;
      const offers = Object.entries(suggestions)
        .flatMap(([line_id, hits]) => hits.filter((h) => h.invoice_id === r.id).map((h) => ({ line_id, ...offer(h) })))
        .sort((a, b) => b.score - a.score);
      // The same cap the detail pane draws, so the agent's view and the user's are the same size,
      // and the footer first, for the reason read_inbox gives above. The pool `offers` is drawn
      // from was itself already capped at LINE_SUGGESTIONS per credit upstream.
      return {
        invoice: row(r),
        note: r.note,
        // `at most N per credit` is a second, upstream bound, so it is its own field rather than
        // folded into the envelope's counts.
        per_credit_cap: LINE_SUGGESTIONS,
        candidate_lines: bounded(offers, DETAIL_CANDIDATES),
      };
    },
  });

  useWebMCPTool({
    name: "read_credits",
    description:
      "Unapplied bank credits on the lower lane, each with the invoices it could belong to, whether the choice is ambiguous, the trading name it arrived under and how far it falls short.",
    parameters: [
      {
        name: "only",
        type: "string",
        enum: [...CREDIT_FILTERS],
        required: false,
        description: "all (default), ambiguous, or unambiguous - the credits that can be applied without asking",
      },
    ],
    ...TOOL_CLASSES.read_credits,
    handler: ({ only }) => {
      const which: CreditFilter = isOneOf(CREDIT_FILTERS, only) ? only : "all";
      const hits = credits.filter((c) => {
        if (which === "ambiguous") return c.ambiguous;
        // "Unambiguous" is the reconciliation beat's working set: exactly one reading of the
        // credit exists, so applying it needs no question. A credit no invoice claims is not
        // unambiguous, it is unexplained, and it is excluded here for that reason.
        if (which === "unambiguous") return !c.ambiguous && c.suggestions.length > 0;
        return true;
      });
      return { ...bounded(hits, PAGE, credit), only: which };
    },
  });

  useWebMCPTool({
    name: "read_clients",
    description:
      "The client book: who to write to, what they bank under, and what each of them still owes.",
    ...TOOL_CLASSES.read_clients,
    handler: () => {
      const view = clients.map((c) => {
        const mine = rows.filter((r) => r.client_id === c.id);
        const owed = mine.filter((r) => r.balance_cents > 0 && r.state !== "void" && r.state !== "draft");
        const billed = mine.reduce((sum, r) => sum + (r.state === "void" || r.state === "draft" ? 0 : r.amount_cents), 0);
        const paid = mine.reduce((sum, r) => sum + (r.state === "void" || r.state === "draft" ? 0 : r.paid_cents), 0);
        const last = mine.reduce<string | null>(
          (latest, r) => (r.last_payment_at && (!latest || r.last_payment_at > latest) ? r.last_payment_at : latest),
          null,
        );
        return {
          id: c.id,
          name: c.name,
          contact_name: c.contact,
          contact_email: c.email,
          // The one fact that cannot be derived from the books: the name their bank prints.
          bank_alias: c.bank_alias,
          terms_days: c.terms_days,
          note: c.note,
          open_invoices: owed.length,
          overdue_invoices: owed.filter((r) => r.days_overdue > 0).length,
          oldest_days_overdue: owed.reduce((worst, r) => Math.max(worst, r.days_overdue), 0),
          balance: owed.reduce((sum, r) => sum + r.balance_cents, 0) / 100,
          paid_ratio: billed === 0 ? 0 : Math.round((paid / billed) * 100) / 100,
          last_payment_at: last ? last.slice(0, 10) : null,
        };
      });
      return bounded(view, PAGE);
    },
  });

  useWebMCPTool({
    name: "navigate",
    description: "Scrub the strip to a filter: the whole inbox, or only overdue, unmatched or disputed invoices.",
    parameters: [{ name: "view", type: "string", enum: [...VIEWS], required: true, description: "View to open" }],
    ...TOOL_CLASSES.navigate,
    handler: ({ view }) => {
      if (!isOneOf(VIEWS, view)) return `Unknown view ${String(view)}.`;
      setFilter(view === "inbox" ? "all" : view);
      router.push("/");
      return view === "inbox" ? "Opened the inbox." : `Opened the inbox filtered to ${view}.`;
    },
  });

  useWebMCPTool({
    name: "open_invoice",
    description: "Open one invoice on the stage, with its lines, payments and candidate credits.",
    parameters: [{ name: "id", type: "string", required: true, description: "Invoice id" }],
    ...TOOL_CLASSES.open_invoice,
    handler: ({ id }) => {
      const r = rows.find((x) => x.id === String(id));
      if (!r) return `No invoice ${String(id)}.`;
      router.push(`/invoices/${r.id}`);
      return `Opened ${r.number} (${r.client_name}).`;
    },
  });

  useWebMCPTool({
    name: "select",
    description: "Tick invoices on the strip so the dock offers bulk actions on them. Pass an empty list to clear.",
    parameters: [{ name: "ids", type: "string[]", required: true, maxItems: SELECT_MAX, description: "Invoice ids" }],
    ...TOOL_CLASSES.select,
    handler: ({ ids }) => {
      // Count what was actually sent before anything is dropped: `asIds` caps at MAX_IDS (100),
      // which belongs to `categorize`, not here, and reporting against it hid a second truncation.
      const sent = Array.isArray(ids) ? ids.map(String) : [];
      const known = new Set(rows.map((r) => r.id));
      const capped = sent.slice(0, SELECT_MAX);
      const picked = capped.filter((id) => known.has(id));
      setSelection(picked);
      // Capped and not-found are different failures and an agent has to be able to tell them apart.
      const over = sent.length > SELECT_MAX ? `; ${sent.length - SELECT_MAX} over the cap of ${SELECT_MAX}` : "";
      const unknown = capped.length - picked.length;
      const missing = unknown > 0 ? `; ${unknown} not in the books` : "";
      return `Selected ${picked.length} of ${sent.length} requested${over}${missing}.`;
    },
  });

  useWebMCPTool({
    name: "set_period",
    description: "Point the reports and exports at an accounting period.",
    parameters: [{ name: "period", type: "string", enum: [...PERIODS], required: true }],
    ...TOOL_CLASSES.set_period,
    handler: ({ period: p }) => {
      if (!isOneOf(PERIODS, p)) return `Unknown period ${String(p)}.`;
      setPeriod(p);
      return `Reports now on ${p}.`;
    },
  });

  useWebMCPTool({
    name: "categorize",
    description: "File invoices under a book-keeping category. Reversible.",
    parameters: [
      { name: "ids", type: "string[]", required: true, maxItems: MAX_IDS, description: "Invoice ids" },
      { name: "category", type: "string", enum: [...CATEGORIES], required: true },
    ],
    ...TOOL_CLASSES.categorize,
    handler: ({ ids, category }) =>
      isOneOf(CATEGORIES, category) ? say(categorizeAction(asIds(ids), category as Category)) : `Unknown category ${String(category)}.`,
  });

  useWebMCPTool({
    name: "match_bank_line",
    description: "Apply an unapplied bank credit to an invoice and record the payment. Reversible with unmatch.",
    parameters: [
      { name: "invoice_id", type: "string", required: true },
      { name: "line_id", type: "string", required: true, description: "Bank line id, e.g. bl_00042" },
    ],
    ...TOOL_CLASSES.match_bank_line,
    handler: async ({ invoice_id, line_id }) => {
      const result = await settle(matchAction(String(invoice_id), String(line_id)));
      // The alias travels with the match, so a credit that arrived under a trading name can be
      // remembered as one fact rather than re-derived from the memo next month.
      return result.counterparty_alias ? result : result.message;
    },
  });

  useWebMCPTool({
    name: "unmatch",
    description: "Take a bank credit back off an invoice.",
    parameters: [
      { name: "invoice_id", type: "string", required: true },
      { name: "line_id", type: "string", required: true },
    ],
    ...TOOL_CLASSES.unmatch,
    handler: ({ invoice_id, line_id }) => say(unmatchAction(String(invoice_id), String(line_id))),
  });

  useWebMCPTool({
    name: "draft_reminder",
    description:
      "Write a payment reminder in a tone and save it as a draft addressed to the client's billing contact. Returns the whole message - to, subject, body. Nothing is sent.",
    parameters: [
      { name: "id", type: "string", required: true },
      { name: "tone", type: "string", enum: [...TONES], required: true },
    ],
    ...TOOL_CLASSES.draft_reminder,
    handler: async ({ id, tone }) => {
      if (!isOneOf(TONES, tone)) return `Unknown tone ${String(tone)}.`;
      const result = await settle(draftReminderAction(String(id), tone as Tone));
      // The whole message, not a confirmation that one exists. `send_reminder` is carried by a
      // connector outside the page, and what it carries has to be addressable before the gate.
      return result.draft ? { ...result, draft: result.draft } : result.message;
    },
  });

  useWebMCPTool({
    name: "mark_paid",
    description: "Record a payment against an invoice. Cannot be taken back.",
    parameters: [
      { name: "id", type: "string", required: true },
      { name: "amount", type: "number", required: true, description: "Amount in dollars, e.g. 1250.00" },
    ],
    ...TOOL_CLASSES.mark_paid,
    handler: ({ id, amount }) => {
      // The same reading the Close panel uses: an agent that sends "1,250" is told so, rather than
      // having `Number()` turn it into NaN and the INSERT fail under it.
      const cents = parseDollars(amount as string | number);
      if (cents === null) return say(Promise.resolve({ ok: false, message: `"${String(amount)}" is not an amount.` }));
      return say(markPaidAction(String(id), cents));
    },
  });

  useWebMCPTool({
    name: "send_reminder",
    description:
      "Send the saved draft reminder to the client's billing contact. Reaches a person; simulated here and recorded against the invoice.",
    parameters: [{ name: "id", type: "string", required: true }],
    ...TOOL_CLASSES.send_reminder,
    handler: async ({ id }) => {
      const result = await settle(sendReminderAction(String(id)));
      // Who it reached, in the answer as well as in the activity row.
      return result.to ? { ok: result.ok, message: result.message, to: result.to, subject: result.subject } : result.message;
    },
  });

  useWebMCPTool({
    name: "void_invoice",
    description: "Void an invoice. Permanent.",
    parameters: [{ name: "id", type: "string", required: true }],
    ...TOOL_CLASSES.void_invoice,
    handler: ({ id }) => say(voidInvoiceAction(String(id))),
  });

  useWebMCPTool({
    name: "export_summary",
    description:
      "Generate the summary for an accounting period and point the reports at it. Returns a page: title, markdown, and the plain-text body.",
    parameters: [{ name: "period", type: "string", enum: [...PERIODS], required: true }],
    ...TOOL_CLASSES.export_summary,
    handler: async ({ period: p }) => {
      if (!isOneOf(PERIODS, p)) return `Unknown period ${String(p)}.`;
      setPeriod(p);
      const result = await settle(exportSummaryAction(p));
      // A page, ready to become one somewhere else: a title and a Markdown body. `body` is the
      // plain-text form the reports view prints, kept so the two callers read one result.
      return { ok: result.ok, message: result.message, period: p, title: result.title, markdown: result.markdown, body: result.body };
    },
  });

  return null;
}

"use client";

/**
 * The books on WebMCP: what the studio can read about its money, and the seven acts that change
 * it.
 *
 * Ledgerbox ships WITHOUT Athena; these are registered and waiting (design 4.6.2) on
 * `document.modelContext` rather than in a chat the app hosts itself. A browser agent reads the
 * standard annotations and applies the one rule in design 5.1, so the class is carried by what a
 * tool IS — and the two flags come from `lib/tool-classes.ts` through `registration()`, never
 * from this file.
 *
 * MOUNTED TOGETHER WITH `LanesTools`, on the one shipped route. They used to be two half-surfaces
 * on two routes: the Strip registered the money and the Lanes registered the view, so neither
 * list had to be complete. The demo journey has to read the books AND act on them in the same
 * breath, so both sets are one register now (`lib/manifest.ts`) and the foot prints the class of
 * the union.
 *
 * EVERY TOOL HERE LANDS ON THE PICTURE. That is the second half of mounting them together: the
 * Strip's `navigate` moved a filter that no longer exists and `open_invoice` pushed a route that
 * no longer exists, so both are re-pointed at the Lanes' own state — `navigate` lights the swarm,
 * `open_invoice` lifts the invoice's card exactly as `open_item` does. An agent's call and a
 * person's click end in the same place, which is the only version of this that can be recorded.
 */
import { useMemo } from "react";
import { useRouter } from "next/navigation";

import { STUDIO } from "@athena/demo-kit/seed";
import { useToast } from "@athena/demo-kit/ui";
import { bounded, boundedPage, useWebMCPTool } from "@athena/demo-kit/webmcp";
import type { ZoomNav } from "@athena/demo-kit/zoom";

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
import {
  CATEGORIES,
  CREDIT_FILTERS,
  DETAIL_CANDIDATES,
  FILTERS,
  INBOX_PAGE,
  LINE_SUGGESTIONS,
  MAX_IDS,
  PERIODS,
  SELECT_MAX,
  TONES,
  VIEWS,
  type Category,
  type CreditFilter,
  type Filter,
  type Period,
  type Tone,
  type View,
} from "@/lib/constants";
import type { CreditView, LineSuggestion } from "@/lib/db";
import { isMostlyPaid, matchesFilterClient } from "@/lib/filter";
import { parseDollars } from "@/lib/format";
import { registration } from "@/lib/manifest";
import type { InvoiceRow } from "@/lib/types";

import {
  STATE_FILTER_LABEL,
  matches,
  type LnBooks,
  type LnFilter,
  type LnSheet,
  type StateFilter,
} from "../model";

/**
 * The four views the books have always offered, as states of the one filter the sheet is lit by.
 *
 * `navigate` is the older vocabulary and `set_filter` is the Lanes' own; they are two names for
 * one piece of state on purpose, because the demo's act 1 speaks the first and the surface speaks
 * the second. `unmatched` exists as a state filter for exactly this reason.
 */
const VIEW_STATE: Record<View, StateFilter> = {
  inbox: "all",
  overdue: "overdue",
  unmatched: "unmatched",
  disputed: "disputed",
};

const isOneOf = <T extends string>(list: readonly T[], v: unknown): v is T =>
  list.includes(String(v) as T);

function asIds(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map(String).slice(0, MAX_IDS);
}

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

export interface BooksToolsProps {
  sheet: LnSheet;
  books: LnBooks;
  nav: ZoomNav;
  filter: LnFilter;
  setFilter: (next: LnFilter) => void;
  /** Invoices ticked on the sheet, and the setter the `select` tool moves. */
  picked: readonly string[];
  setPicked: (ids: string[]) => void;
  /** Which accounting period the mast's close readout and `export_summary` are pointed at. */
  period: Period;
  setPeriod: (p: Period) => void;
}

export function BooksTools({
  sheet,
  books,
  nav,
  filter,
  setFilter,
  picked,
  setPicked,
  period,
  setPeriod,
}: BooksToolsProps) {
  const { rows, credits, suggestions, summaries, clients } = books;
  const router = useRouter();
  const { toast } = useToast();

  /** Where every invoice lives, so `open_invoice` can lift a card from an id alone. */
  const laneOf = useMemo(() => {
    const map = new Map<string, string>();
    for (const lane of sheet.lanes) for (const mark of lane.marks) map.set(mark.id, lane.id);
    return map;
  }, [sheet.lanes]);

  /**
   * Every mutating tool answers the same way: run the server action, toast the sentence it
   * returned, and refresh the tree so the sheet under the open card is rebuilt from the books.
   *
   * It returns the WHOLE result, not its message. A tool that only needs the sentence takes
   * `.message`; the three that carry structure — the draft, the send and the close — return the
   * object, and the kit serialises it. Flattening everything to a string here is what used to
   * make a complete, addressable draft unreachable from outside the page.
   */
  const settle = async <T extends { ok: boolean; message: string }>(work: Promise<T>): Promise<T> => {
    const result = await work;
    toast(result.message, result.ok ? "success" : "error");
    router.refresh();
    return result;
  };

  const say = async (work: Promise<{ ok: boolean; message: string }>) => (await settle(work)).message;

  /** What is lit right now — the answer both `navigate` and `set_filter` owe their caller. */
  const litBy = (next: LnFilter) => {
    const all = sheet.lanes.flatMap((l) => l.marks);
    const lit = all.filter((m) => matches(m, next)).length;
    return {
      state: next.state,
      state_label: STATE_FILTER_LABEL[next.state],
      client: next.client,
      lit,
      dimmed: all.length - lit,
      note: "A filter here dims rather than removes; every invoice is still on the sheet.",
    };
  };

  useWebMCPTool({
    name: "read_books",
    description:
      "The quarter at a glance: each period's totals, the inbox counts, the studio, and what is on screen now.",
    ...registration("read_books"),
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
      screen: {
        level: nav.state.focus.level,
        area_open: nav.state.focus.group,
        invoice_open: nav.state.focus.item,
        filter: filter.state,
        client: filter.client,
        period,
        selected: picked.length,
      },
    }),
  });

  useWebMCPTool({
    name: "read_inbox",
    description:
      "Invoices under a filter, worst first. Paged; the envelope says how many there are.",
    ...registration("read_inbox"),
    handler: ({ filter: f, page }) => {
      const which: Filter = isOneOf(FILTERS, f) ? f : "all";
      const hits = rows
        .filter((r) => matchesFilterClient(r, which))
        .sort((a, b) => b.days_overdue - a.days_overdue);
      // The envelope comes first: a consumer that caps the payload still gets the counts. It is
      // the kit's one truncation shape - `showing` and `of` as numbers, never a sentence an agent
      // has to parse - so this answers "how many did I not see" the way every other tool in every
      // other app does.
      return { ...boundedPage(hits, Number(page), INBOX_PAGE, row), filter: which };
    },
  });

  useWebMCPTool({
    name: "read_invoice",
    description: "One invoice with the bank credits that could settle it. Changes nothing.",
    ...registration("read_invoice"),
    handler: ({ id }) => {
      const r = rows.find((x) => x.id === String(id));
      if (!r) return `No invoice ${String(id)}.`;
      const offers = Object.entries(suggestions)
        .flatMap(([line_id, hits]) =>
          hits.filter((h) => h.invoice_id === r.id).map((h) => ({ line_id, ...offer(h) })),
        )
        .sort((a, b) => b.score - a.score);
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
      "Unapplied bank credits on the statement, each with the invoices it could belong to, whether the choice is ambiguous, the trading name it arrived under and how far it falls short.",
    ...registration("read_credits"),
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
      return { ...bounded(hits, INBOX_PAGE, credit), only: which };
    },
  });

  useWebMCPTool({
    name: "read_clients",
    description:
      "The client book: who to write to, what they bank under, and what each of them still owes.",
    ...registration("read_clients"),
    handler: () => {
      const view = clients.map((c) => {
        const mine = rows.filter((r) => r.client_id === c.id);
        const owed = mine.filter(
          (r) => r.balance_cents > 0 && r.state !== "void" && r.state !== "draft",
        );
        const billed = mine.reduce(
          (sum, r) => sum + (r.state === "void" || r.state === "draft" ? 0 : r.amount_cents),
          0,
        );
        const paid = mine.reduce(
          (sum, r) => sum + (r.state === "void" || r.state === "draft" ? 0 : r.paid_cents),
          0,
        );
        const last = mine.reduce<string | null>(
          (latest, r) =>
            r.last_payment_at && (!latest || r.last_payment_at > latest) ? r.last_payment_at : latest,
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
      return bounded(view, INBOX_PAGE);
    },
  });

  useWebMCPTool({
    name: "navigate",
    description:
      "Move the sheet to a view: the whole book, or only what is overdue, carrying an unapplied credit, or disputed. Returns to the overview and lights that subset; nothing is removed from the sheet.",
    ...registration("navigate"),
    handler: ({ view }) => {
      if (!isOneOf(VIEWS, view)) return { ok: false, error: `Unknown view ${String(view)}.`, views: [...VIEWS] };
      const next: LnFilter = { ...filter, state: VIEW_STATE[view] };
      setFilter(next);
      nav.home();
      return { ok: true, view, level: 0, ...litBy(next) };
    },
  });

  useWebMCPTool({
    name: "open_invoice",
    description:
      "Open one invoice at full depth — the same card `open_item` lifts, addressed by invoice id alone. Its lines, the credits that could settle it, any draft on file and the three gated acts are on it.",
    ...registration("open_invoice"),
    handler: ({ id }) => {
      const wanted = String(id);
      const r = rows.find((x) => x.id === wanted);
      const lane = laneOf.get(wanted);
      if (!r || !lane) return { ok: false, error: `No invoice ${wanted}.` };
      nav.openItem(lane, wanted);
      return {
        ok: true,
        level: 2,
        opened: { id: r.id, number: r.number, client: r.client_name, area: lane },
      };
    },
  });

  useWebMCPTool({
    name: "select",
    description:
      "Tick invoices on the sheet so a person can see which ones a run is about. Ticked marks are ringed at every level. Pass an empty list to clear.",
    ...registration("select"),
    handler: ({ ids }) => {
      // Count what was actually sent before anything is dropped: `asIds` caps at MAX_IDS (100),
      // which belongs to `categorize`, not here, and reporting against it hid a second truncation.
      const sent = Array.isArray(ids) ? ids.map(String) : [];
      const known = new Set(rows.map((r) => r.id));
      const capped = sent.slice(0, SELECT_MAX);
      const kept = capped.filter((id) => known.has(id));
      setPicked(kept);
      // Capped and not-found are different failures and an agent has to be able to tell them apart.
      const over = sent.length > SELECT_MAX ? `; ${sent.length - SELECT_MAX} over the cap of ${SELECT_MAX}` : "";
      const unknown = capped.length - kept.length;
      const missing = unknown > 0 ? `; ${unknown} not in the books` : "";
      return `Ticked ${kept.length} of ${sent.length} requested${over}${missing}.`;
    },
  });

  useWebMCPTool({
    name: "set_period",
    description: "Point the close readout and export_summary at an accounting period.",
    ...registration("set_period"),
    handler: ({ period: p }) => {
      if (!isOneOf(PERIODS, p)) return `Unknown period ${String(p)}.`;
      setPeriod(p);
      return `The close is now on ${p}.`;
    },
  });

  useWebMCPTool({
    name: "categorize",
    description: "File invoices under a book-keeping category, which moves them between lanes. Reversible.",
    ...registration("categorize"),
    handler: ({ ids, category }) =>
      isOneOf(CATEGORIES, category)
        ? say(categorizeAction(asIds(ids), category as Category))
        : `Unknown category ${String(category)}.`,
  });

  useWebMCPTool({
    name: "match_bank_line",
    description:
      "Apply an unapplied bank credit to an invoice and record the payment. The card's balance and its colour change under the open invoice. Reversible with unmatch.",
    ...registration("match_bank_line"),
    handler: async ({ invoice_id, line_id }) => {
      const result = await settle(matchAction(String(invoice_id), String(line_id)));
      // The alias travels with the match, so a credit that arrived under a trading name can be
      // remembered as one fact rather than re-derived from the memo next month.
      return result.counterparty_alias ? result : result.message;
    },
  });

  useWebMCPTool({
    name: "unmatch",
    description: "Take a bank credit back off an invoice, restoring the balance.",
    ...registration("unmatch"),
    handler: ({ invoice_id, line_id }) => say(unmatchAction(String(invoice_id), String(line_id))),
  });

  useWebMCPTool({
    name: "draft_reminder",
    description:
      "Write a payment reminder in a tone and save it as a draft addressed to the client's billing contact. The draft appears on the invoice's card. Returns the whole message - to, subject, body. Nothing is sent.",
    ...registration("draft_reminder"),
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
    ...registration("mark_paid"),
    handler: ({ id, amount }) => {
      // The same reading the card's gate uses: an agent that sends "1,250" is told so, rather than
      // having `Number()` turn it into NaN and the INSERT fail under it.
      const cents = parseDollars(amount as string | number);
      if (cents === null) return `"${String(amount)}" is not an amount.`;
      return say(markPaidAction(String(id), cents));
    },
  });

  useWebMCPTool({
    name: "send_reminder",
    description:
      "Send the saved draft reminder to the client's billing contact. The card's draft block clears and its reminder count goes up. Reaches a person; simulated here and recorded against the invoice.",
    ...registration("send_reminder"),
    handler: async ({ id }) => {
      const result = await settle(sendReminderAction(String(id)));
      // Who it reached, in the answer as well as in the activity row.
      return result.to
        ? { ok: result.ok, message: result.message, to: result.to, subject: result.subject }
        : result.message;
    },
  });

  useWebMCPTool({
    name: "void_invoice",
    description: "Void an invoice. Permanent.",
    ...registration("void_invoice"),
    handler: ({ id }) => say(voidInvoiceAction(String(id))),
  });

  useWebMCPTool({
    name: "export_summary",
    description:
      "Generate the summary for an accounting period and point the close readout at it. Returns a page: title, markdown, and the plain-text body.",
    ...registration("export_summary"),
    handler: async ({ period: p }) => {
      if (!isOneOf(PERIODS, p)) return `Unknown period ${String(p)}.`;
      setPeriod(p);
      const result = await settle(exportSummaryAction(p));
      // A page, ready to become one somewhere else: a title and a Markdown body. `body` is the
      // plain-text form the close readout prints, kept so the two callers read one result.
      return {
        ok: result.ok,
        message: result.message,
        period: p,
        title: result.title,
        markdown: result.markdown,
        body: result.body,
      };
    },
  });

  return null;
}

# 0200. One invoice, one reading across the books tools

Date: 2026-10-25

## Context

Ledgerbox answers an agent's questions about one invoice from two builds of the same books:
`buildBooks` (the ledger, `InvoiceRow`) and `buildSheet` (the picture, `LnMark` plus the card's
`LnDetail`). Each had its own projection. `row()` in `BooksTools.tsx` served `read_inbox` and
`read_invoice` (20 keys: `due_at`, `candidates`, `contact_name`, `contact_email`, `paid`,
`paid_ratio`, a conditional `mostly_paid`, no `client_domain`). `markRead` in
`components/lanes/tools/read.ts` served `search_invoices` and the L1 `read_view` (16 keys: `due`,
`unapplied_credits`, `area`, no `paid`, no `paid_ratio`, no `mostly_paid`), and `detailRead` the
L2 card (27 keys, naming the contact `contact`/`email`).

The split was not cosmetic. `search_invoices({state: "overdue"})`, the worst-first chase finder,
could not say that LB-2026-0920 is 80% paid, so the demo's one mostly-paid late invoice read as a
plain 50-day chase - the move README.md names as the wrong one. `read.ts` promised the cross-app
key `client_domain` "at every level", and the ledger reads never carried it. And
examples/journey's runner already hand-carried the dialect split (`contact_email ?? email`;
`paidRatio` throwing on a `markRead` row and reading as 0).

## Decision

1. **One core, two adapters.** `invoiceCore(facts)` in `components/lanes/tools/read.ts` projects
   a small `InvoiceFacts` record into the 18 keys every invoice-returning tool carries: `id`,
   `number`, `client`, `client_domain`, `category`, `state`, `due_at`, `days_overdue`, `amount`,
   `paid`, `balance`, `paid_ratio`, `mostly_paid`, `candidates`, `reminders_sent`,
   `has_draft_reminder`, `contact_name`, `contact_email`. `factsOfRow(row)` reads the ledger and
   `factsOfMark(mark, detail?)` the picture.
2. **Each tool is core plus its own extras.** `rowRead` (moved out of `BooksTools.tsx`) adds
   `last_payment_at` and a conditional `dispute`; `markRead` adds the picture's `area`, `heat`,
   `issued` and `waiting_on`; `detailRead` adds the card (terms, note, lines, payments, draft).
3. **The canonical names are `read_inbox`'s**, the dialect examples/journey declares as the
   contract's Row. The Lanes reads rename four keys (`due` -> `due_at`, `unapplied_credits` ->
   `candidates`, `contact` -> `contact_name`, `email` -> `contact_email`) and gain `category`,
   `paid`, `paid_ratio`, `mostly_paid`, and (L1, search) the contact. `area` stays beside
   `category` because `search_invoices`' results are addressed by area.
4. **`mostly_paid` is always present** and decided only by `isMostlyPaid`, in every projection;
   `paid_ratio` is computed by the core from the cents with the formula `lib/db.ts` uses. The
   card's own `mostlyPaid` flag is no longer read by the tool layer.
5. **A mark with no card takes its contact from the registry.** `buildSheet` builds a detail only
   for an invoice that can still be acted on; for a settled one `factsOfMark` reads
   `companyByName(client).contact`, which is where the seed takes every client's contact from
   verbatim and which no action edits.
6. **The agreement is a test.** `test/ledgerbox-invoice-read.test.ts` walks all 125 seeded
   invoices through both pipelines and requires the two cores to be deep-equal;
   `test/tool-handlers.test.ts` drives `read_inbox`, `read_invoice`, `search_invoices` and
   `read_view` at L1 and L2 through their own handlers and requires one core for LB-2026-0920.

## Consequences

- An agent comparing two tools' answers compares like with like, and the demo's central judgement
  is visible from every place an invoice is listed.
- Agent-facing field names change on the Lanes reads (point 3). No in-repo consumer reads the old
  names (apps/, examples/journey, src/); journey's `?? email` fallback becomes dead but harmless.
- A field added to one projection and not the others, or `buildBooks` and `buildSheet`
  disagreeing about an invoice, now fails a test instead of waiting for review.
- If a client's contact ever becomes editable, the registry fallback in point 5 would drift from
  the ledger on settled invoices; the parity test is what would say so.

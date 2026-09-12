# Ledgerbox

The invoice and expense inbox of design 4.6.1: what **Halden Studio** opens on the first of the
month to find out who has paid, who has not, and which credits on the bank statement nobody has
posted yet. The studio's name, its shared inbox and every client's billing contact come from
`@athena/demo-kit/seed`, so this app, TidyCRM and Hirelane read as one owner's three tabs rather
than three demos.

It ships **without** Athena. The shipped surface registers its own capabilities on
`document.modelContext` through `@athena/demo-kit/webmcp` — `components/edge/StripTools.tsx`, with
the class of every tool held as data in `lib/tool-classes.ts` — so Act 1 of the demo adds an agent
to an app that already describes itself. There is no app-wide registrar and no chat: every tool
carries the design 5.1 flags (`reversible`, `sideEffects`) that classify it AUTO or GATED.

## The books

The seed is deterministic (`rngFor("ledgerbox", …)`), so the same invoices land in the same rows on
every machine:

- 15 clients, 125 invoices and 122 bank lines across June, July and August 2026, with the books
  frozen at 1 September so the story never drifts.
- 73 invoices still carrying a balance, 37 of them more than 30 days past due.
- 13 part payments, 2 disputed invoices, 2 voided, 1 draft, 12 unfiled.
- 19 credits sitting on the statement with nothing posted against them — **14 unambiguous**, 1
  where two identical Kestrel Labs retainers fit the same credit equally well, and 4 that belong to
  no invoice at all. One of the fourteen is Quarry House paying short by a wire fee, and one is
  Pinegrove Collective paying under their trading name.
- Pinegrove Collective banks as `PINEGROVE COOP` (`PINEGROVE_ALIAS.bank` in the registry) and their
  August invoice is unreconciled, so the alias is a fact the demo has to learn rather than one it is
  handed. They also moved on 14 July; invoices raised before that carry the old address and say so.
- Solstice Partners paid exactly 80% of the summer retainer and went quiet — `paid_ratio` 0.8 and a
  `last_payment_at` in mid-August, on an invoice 39 days past due.

Statement noise (software, coworking, rail, an accountant) is on the ledger too, so reconciliation
means picking the payment out of a real month, not out of a list of payments.

## The three acts it stages

1. **Onboard.** The manifest is generated from the code; an agent reading it finds the seventeen
   tools below with no patch to the app.
2. **Command.** *"Reconcile August and chase anything over 30 days."* `read_credits` returns the
   fourteen credits with exactly one reading and the one with two; `match_bank_line` applies the
   fourteen and hands back the trading name when a credit arrived under one. `navigate("overdue")`
   moves the inbox while the long job runs; `read_books` returns a `screen` object — the current
   filter, the period and how many invoices are ticked — so the agent knows where the user is.
3. **See results.** Every read carries its own evidence: a credit says whether it is `ambiguous` and
   names `candidate_invoice_ids`, says `short_by` when it falls short, and says
   `counterparty_alias` when the memo used a trading name. Every invoice says `paid_ratio` and
   `last_payment_at`, so the client who paid 80% is *visible* rather than *flagged for skipping* —
   the judgement is the agent's. `draft_reminder` returns a whole, addressable message and
   `send_reminder` is the gate in front of it.

The app never says "skip this client". It says what is true and leaves the decision on the other
side of the seam.

## Host manifest

`reversible && side_effects !== "external"` is the whole classification rule (design 5.1), and the
flags live in `lib/tool-classes.ts` — one table, read by the registrations in `StripTools.tsx` and
by the class test. Anything that reaches a person or makes a permanent statement about money is
GATED by what it is.

| Tool | Class | Reversible | Side effects | What it does |
|---|---|---|---|---|
| `read_books` | **A** | yes | none | Each period's totals, the inbox counts, the studio, and what is on screen now |
| `read_inbox(filter?, page?)` | **A** | yes | none | Invoices under a filter, paged, with a `showing N of M` envelope |
| `read_invoice(id)` | **A** | yes | none | One invoice and the credits that could settle it, capped and counted |
| `read_credits(only?)` | **A** | yes | none | Unapplied credits: `ambiguous`, `candidate_invoice_ids`, `counterparty_alias`, `short_by`, `could_be[]` |
| `read_clients` | **A** | yes | none | The client book: contact, email, bank alias, what each still owes and when they last paid |
| `navigate(view)` | **A** | yes | none | Scrubs the strip to the inbox, or to overdue / unmatched / disputed |
| `open_invoice(id)` | **A** | yes | none | Opens one invoice on the stage |
| `select(ids)` | **A** | yes | none | Ticks up to 50 invoices so the dock offers bulk actions |
| `set_period(period)` | **A** | yes | none | Points the reports and exports at an accounting period |
| `categorize(ids, category)` | **A** | yes | data | Files up to 100 invoices under a book-keeping category |
| `match_bank_line(invoice_id, line_id)` | **A** | yes | data | Applies a bank credit, records the payment, and names the trading name it arrived under |
| `unmatch(invoice_id, line_id)` | **A** | yes | data | Takes a credit back off an invoice, restoring the balance |
| `draft_reminder(id, tone)` | **A** | yes | data | Writes a `gentle` or `firm` draft and returns the whole message: `to`, `subject`, `body`. Nothing is sent |
| `mark_paid(id, amount)` | **G** | no | data | Records a payment against the books |
| `send_reminder(id)` | **G** | no | external | Sends the saved draft to the client's billing contact (simulated, logged with the recipient) |
| `void_invoice(id)` | **G** | no | data | Voids an invoice, permanently |
| `export_summary(period)` | **A** | yes | data | Files the period summary and returns a page: `title`, `markdown`, `body` |

There are no host readables. What a readable would carry is returned inside `read_books`'s `screen`
object instead. Every parameter that addresses UI is an enum, every array carries `maxItems`, and
every bounded read states how much it left out through the kit's one envelope —
`{ showing, of, items }`.

Every mutating action logs to `activity` and stores an `undo` payload when it is reversible;
`app/actions.ts` holds the matching `applyUndo` branch for each one. `send_reminder` records the
address it reached, not just the client's name, because in the demo the send itself is carried by a
connector outside the page.

## The design

Ledgerbox ships one design, **The Strip**: the quarter as a film strip you scrub. Invoices are cards
pinned to their due day, an overdue card drags a red tail to the "today" beam, unplaced credits are
coins on a lower lane. The month title and the running total follow the scroll, and settling a coin
on the invoice stage moves it physically between trays.

The full design notes — metaphor, type, palette tokens, motion vocabulary, signature moment, what it
gives up — are in `components/edge/README.md`.

## Run it

```bash
pnpm --filter ledgerbox dev        # http://localhost:3001
pnpm --filter ledgerbox typecheck && pnpm --filter ledgerbox lint && pnpm --filter ledgerbox test
```

Delete `data/ledgerbox.sqlite` to reseed. No API keys, no network at runtime, no telemetry — the
app ships no chat, no runtime endpoint and no provider to host one.

## Where things are

| Path | Holds |
|---|---|
| `lib/seed.ts`, `lib/seed-fixtures.ts` | the deterministic books, including every deliberate defect |
| `lib/match.ts` | the matching heuristic, the evidence clauses, the shortfall and the alias |
| `lib/db.ts` | queries, derived invoice state, period summaries, candidate scoring both ways, `unappliedCredits` |
| `lib/reminder.ts` | the addressable reminder: `to`, `from`, `subject`, `body`, composed once |
| `lib/export.ts` | the close, as plain text for the reports view and as Markdown for a page |
| `lib/tool-classes.ts` | the design 5.1 class of every capability, as data |
| `app/actions.ts` | one server action per mutating capability, with `applyUndo` |
| `components/edge/StripTools.tsx` | the Strip's tools on `document.modelContext` |
| `components/edge/` | the whole UI — shell, inbox, invoice stage, statement, reports, activity — plus its css tokens |
| `test/books.test.ts`, `test/journey.test.ts` | the money rules, and act 1's read surface |

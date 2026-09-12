# Ledgerbox

The invoice and expense inbox of design 4.6.1: what **Halden Studio** opens on the first of the
month to find out who has paid, who has not, and which credits on the bank statement nobody has
posted yet. The studio's name, its shared inbox and every client's billing contact come from
`@athena/demo-kit/seed`, so this app, TidyCRM and Hirelane read as one owner's three tabs rather
than three demos.

It ships **without** Athena. The shipped surface registers its own capabilities on
`document.modelContext` through `@athena/demo-kit/webmcp` — two files on one page,
`components/lanes/tools/LanesTools.tsx` for the view and `components/lanes/tools/BooksTools.tsx`
for the money, with the parameters of both in `lib/manifest.ts` and the class of every tool held as
data in `lib/tool-classes.ts`. Act 1 of the demo therefore adds an agent to an app that already
describes itself. There is no app-wide registrar and no chat: every tool carries the design 5.1
flags (`reversible`, `sideEffects`) that classify it AUTO or GATED.

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

1. **Onboard.** The manifest is generated from the code; an agent reading it finds the twenty-three
   tools below with no patch to the app.
2. **Command.** *"Reconcile August and chase anything over 30 days."* `read_credits` returns the
   fourteen credits with exactly one reading and the one with two; `match_bank_line` applies the
   fourteen and hands back the trading name when a credit arrived under one. `navigate("overdue")`
   lights the late invoices on the sheet while the long job runs; `read_books` returns a `screen`
   object — the level, the filter, the period and how many invoices are ticked — so the agent knows
   where the user is.
3. **See results.** Every read carries its own evidence: a credit says whether it is `ambiguous` and
   names `candidate_invoice_ids`, says `short_by` when it falls short, and says
   `counterparty_alias` when the memo used a trading name. Every invoice says `paid_ratio` and
   `last_payment_at`, so the client who paid 80% is *visible* rather than *flagged for skipping* —
   the judgement is the agent's. `draft_reminder` returns a whole, addressable message and
   `send_reminder` is the gate in front of it.

The app never says "skip this client". It says what is true and leaves the decision on the other
side of the seam.

## The design

Ledgerbox ships one design, **The Lanes**, and it is the root route. Six chronological swimlanes,
one per area of the practice, all reading one clock on a single-hue lit ground under a condensed
poster masthead. A mark is worth its width and late by the tail it drags into the now-line; the
three largest balances in each lane print their amount and the few asking for something carry a
glyph, so the swarm has a focus without 124 labels in it.

Three levels, and every one of them zooms through the point you clicked rather than swapping views:

| Level | Shows | The agent's verb |
|---|---|---|
| **L0** the swarm | all six lanes on one time axis | `read_view`, `zoom_out` |
| **L1** one lane spread | one area's invoices as cards, packed by date or standing up by balance | `open_group` |
| **L2** one invoice lifted | the card: lines, the credits that could settle it, any draft, and the three gates | `open_item` / `open_invoice` |

The Strip — the older quarter-as-a-film-strip direction that used to be the root, with its own
invoice stage at `/invoices/[id]` and a direction index at `/v` — is gone, and so is everything
under `components/edge/`. One design, one page, one register.

## Host manifest

`reversible && side_effects !== "external"` is the whole classification rule (design 5.1). The flags
live in `lib/tool-classes.ts` — one table, read by `lib/manifest.ts`, by both registration files and
by the class tests. Anything that reaches a person or makes a permanent statement about money is
GATED by what it is.

**The view layer** (`components/lanes/tools/LanesTools.tsx`; the first four come from the kit's
`useZoomTools`, so "open a group" means here what it means in every other three-level direction):

| Tool | Class | Parameters | What comes back |
|---|---|---|---|
| `read_view` | **A** | – | `level`, `level_name`, `area_open`, `invoice_open`, `areas: {showing, of, items}`, and a `detail` object for the level you are on |
| `open_group(id)` | **A** | `id` — an area id from `read_view` | `{ok, level: 1, opened}` — or `{ok: false, error, available[]}` |
| `open_item(id, group?)` | **A** | `id`, optional `group` | `{ok, level: 2, opened}` |
| `zoom_out` | **A** | – | `{ok, level, level_name}` |
| `search_invoices(…)` | **A** | `text`, `area`, `state` (enum), `overdue_by`, `balance_over`, `unmatched` | `{showing, of, items[]}` worst first, each item a mark read plus `area_label` |
| `set_filter(state?, client?)` | **A** | `state` (enum), `client` | `{ok, state, client, lit, dimmed, note}`; no arguments reads the filter without moving it |

**The books layer** (`components/lanes/tools/BooksTools.tsx`):

| Tool | Class | Parameters | What comes back |
|---|---|---|---|
| `read_books` | **A** | – | `periods[]`, `studio`, and `screen` — `level`, `area_open`, `invoice_open`, `filter`, `client`, `period`, `selected` |
| `read_inbox(filter?, page?)` | **A** | `filter` (enum), `page` | `{showing, of, page, items[], filter}` |
| `read_invoice(id)` | **A** | `id` | `{invoice, note, per_credit_cap, candidate_lines: {showing, of, items}}` |
| `read_credits(only?)` | **A** | `only` — all / ambiguous / unambiguous | `{showing, of, items[], only}`; each credit carries `ambiguous`, `candidate_invoice_ids`, `counterparty_alias`, `short_by`, `could_be[]` |
| `read_clients` | **A** | – | `{showing, of, items[]}` — contact, email, `bank_alias`, what each still owes and when they last paid |
| `navigate(view)` | **A** | `view` — inbox / overdue / unmatched / disputed | `{ok, view, level: 0, state, state_label, lit, dimmed, note}` |
| `open_invoice(id)` | **A** | `id` | `{ok, level: 2, opened: {id, number, client, area}}` |
| `select(ids)` | **A** | `ids` (max 50) | a sentence saying how many were ticked, how many were over the cap and how many are not in the books |
| `set_period(period)` | **A** | `period` (enum) | a sentence naming the period |
| `categorize(ids, category)` | **A** | `ids` (max 100), `category` (enum) | the action's message |
| `match_bank_line(invoice_id, line_id)` | **A** | both ids | the message, plus `counterparty_alias` when the credit arrived under a trading name |
| `unmatch(invoice_id, line_id)` | **A** | both ids | the action's message |
| `draft_reminder(id, tone)` | **A** | `id`, `tone` — gentle / firm | the whole message: `draft.to`, `to_name`, `from`, `subject`, `body`, `tone` |
| `mark_paid(id, amount)` | **G** | `id`, `amount` in dollars | the action's message |
| `send_reminder(id)` | **G** | `id` | `{ok, message, to, subject}` |
| `void_invoice(id)` | **G** | `id` | the action's message |
| `export_summary(period)` | **A** | `period` (enum) | `{ok, message, period, title, markdown, body}` |

There are no host readables. What a readable would carry is returned inside `read_books`'s `screen`
object instead. Every parameter that addresses UI is an enum, every array carries `maxItems`, and
every bounded read states how much it left out through the kit's one envelope —
`{ showing, of, items }`.

Every mutating action logs to `activity` and stores an `undo` payload when it is reversible;
`app/actions.ts` holds the matching `applyUndo` branch for each one. `send_reminder` records the
address it reached, not just the client's name, because in the demo the send itself is carried by a
connector outside the page.

### What each tool moves on screen

A tool has to walk the path a click walks, or the recording shows an agent talking about a page
that never changed. Ids come out of `read_view`: the six areas are its `areas.items[].id`
(`design`, `development`, `consulting`, `retainer`, `reimbursable`, `uncategorized`), and an
invoice id is `inv_NNNN` — from `read_view`'s detail at L1, from `search_invoices`, or from
`read_inbox`.

- `open_group` zooms L0 into one lane. `open_item` and `open_invoice` are the **same move**: the
  mark morphs into the L2 card, `.ln-root` gains `data-level="2"`, and the card names the client.
- `navigate` returns to the overview and lights a subset of the swarm — `overdue` presses the Late
  chip, `unmatched` presses Credit waiting, `disputed` presses Disputed, `inbox` clears it. It dims
  rather than removes, and says how many it dimmed. `set_filter` moves the same two chips plus the
  client select.
- `select` rings the ticked marks in the accent at L0 and L1 and prints `N ticked` on the toolbar.
- `set_period` and `export_summary` move the **Close** select on the toolbar.
- `match_bank_line` rebuilds the sheet under the open card: the lead figure flips from *Still owed*
  to *Settled* when the credit covers the balance, the card's `data-heat` goes to `good`, and a
  partial payment leaves a **Credits already applied** block with the memo and an Unapply button.
  `unmatch` puts the balance back, live, on the same card.
- `draft_reminder` adds the **Draft reminder, ⟨tone⟩, not sent** block to the open card.
  `send_reminder` clears it and raises *Reminders sent* in the card's aside.
- `categorize` moves the invoice into another lane; `void_invoice` turns its mark grey (`inert`).
- The masthead's presence line is a reading, not a caption: `components/lanes/presence.ts` looks
  for the surface's injected bridge (`window.__athenaBridge`) and the line switches to "Athena is
  connected" with a filled dot when one is there.

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
| `lib/export.ts` | the close, as plain text for the readout and as Markdown for a page |
| `lib/tool-classes.ts` | the design 5.1 class of every capability, as data — the single source of the flags |
| `lib/manifest.ts` | the union both registration files spread: every tool's parameters, with the class read from the table |
| `lib/lanes/` | the server build: `buildSheet()` (the picture) and `buildBooks()` (the ledger the tools answer from) |
| `app/actions.ts` | one server action per mutating capability, with `applyUndo` |
| `app/page.tsx` | the one route: one server read, two props |
| `components/lanes/` | the whole UI — swarm, spread, card, shell, style — plus its three zoom levels |
| `components/lanes/tools/` | the two registration files and the pure read and search layer behind them |
| `test/books.test.ts`, `test/journey.test.ts`, `test/tools.test.ts` | the money rules, act 1's read surface, and the union manifest |

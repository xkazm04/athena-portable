# 0194. Ledgerbox offers a credit only where it could be for

Date: 2026-10-25

## Context

The relation "this unapplied credit could settle this invoice" was computed three times in
`examples/ledgerbox/lib/db.ts`: the row's `candidate_count` and the card's candidates by two
invoice-side passes over `candidatesFor`, and the credits strip and `read_credits` by a third,
credit-side pass (`lineSuggestions`). Only the credit side judged ambiguity (`isAmbiguous`,
`AMBIGUOUS_GAP = 12`). So the two halves of the app disagreed about the same credit: on the
seeded books bl_00072 (TRANSFER FROM IRONWOOD STUDIO, $43,650) scores 99 for LB-2026-0115 and 54
for LB-2026-0057. The credit side called it 0115's; the invoice side still counted it for 0057,
which lit 0057 in the "unmatched" filter, gave it the swarm's credit glyph, printed "1 unapplied
credit could belong here" and put the credit on 0057's card, where `matchAction` would accept it
and leave 0115 overdue and chaseable. bl_00010 did the same to LB-2026-0047 (71 against
LB-2026-0015's 99). The 5-against-3 slicing of the two sides was a second, latent drift.

## Decision

1. **One table.** `lib/reconcile.ts` (pure) scores every (open invoice, incoming credit) pair once
   and gives each pair a standing: `best` (the credit's clear best fit), `contested` (the best fit
   or within AMBIGUOUS_GAP of it, beside another such invoice) or `claimed_elsewhere` (clearly
   behind another invoice, which it names in `claimed_by`).
2. **A credit is offered only to its best fit or a real contender.** The row's `candidate_count`,
   the card's candidates and `read_invoice` count and show only pairs that are not
   `claimed_elsewhere`. The threshold is the one `isAmbiguous` already used, now exported as
   `isContender` in `lib/match.ts`.
3. **The runner-up stays visible on the credit's side.** `lineSuggestions` and `unappliedCredits`
   still list a clearly-behind invoice so a person checking the credit sees what else it nearly
   fit, marked `claimed_elsewhere`. The list is cut at LINE_SUGGESTIONS but never below the
   invoices the credit is offered to, so no offered pair is invisible from the credit's side.
4. `lib/db.ts` builds the table once per request (`reconciliation()`) from the rows before their
   count, then derives the count from it; it no longer calls the scorer itself.

## Consequences

- Two seeded invoices (LB-2026-0057, LB-2026-0047) stop advertising a credit that belongs to
  another invoice; the filter, glyph, status sentence, card and `read_invoice` agree by
  construction (pinned by `test/ledgerbox-reconcile.test.ts`, including a parity property over
  every seeded invoice).
- The Kestrel retainers' credit, a real tie, is still offered on both invoices and flagged
  ambiguous.
- `LineSuggestion` gains a required `standing` and an optional `claimed_by`; `MatchCandidate`
  gains both as optional. Additive for every reader.
- `read_credits`' `could_be` still lists a `claimed_elsewhere` runner-up without its standing; an
  agent that applies `could_be[1]` can still misapply it. Projecting the standing there is the
  natural follow-up.
- `matchAction` still accepts any credit an invoice can take; the offer is narrowed, the act is
  not. A person who knows better can still apply the credit by hand.

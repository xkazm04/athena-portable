# 0197. A chase waits while the statement holds the money

Date: 2026-10-25

## Context

`draft_reminder` and the GATED `send_reminder` in `examples/ledgerbox/app/actions.ts` asked one
question before chasing an invoice (`whyNotChase`): is it a debt, is anything owed, is it
disputed. Nothing asked whether the bank statement already held the money. On the seeded books
14 invoices (13 of them overdue) have a strong, unambiguous credit on the statement whose best fit
is that invoice - the seed's "awaiting" fate, where the money has arrived and the books have not
been told - and several memos quote the invoice number: "SEPA CR IRONWOOD STUDIO INV
LB-2026-0104", $17,775.00, posted 28 Jun. `draft_reminder("LB-2026-0104", "firm")` drafted a
letter telling that client the invoice was 67 days past due and that work would pause until it
cleared, and `send_reminder` sent it. The README's act-2 beat ("every invoice over 30 days, draft
a chase for each") drafted six such letters, and ADR 0147's tray can draft them in one press. The
reconciliation table (ADR 0194) already held the answer.

## Decision

1. **A chase is refused while the statement holds a credit that settles the invoice.** A credit
   settles an invoice when the one reconciliation table calls that invoice its clear best fit
   (`standing: "best"`, no contender within AMBIGUOUS_GAP) and the match is `strong`. The rule is
   `chaseVerdict` in `lib/chase.ts` (pure), asked against `chaseCredits(id)` from `lib/db.ts`.
2. **The refusal names the credit to apply.** Memo, amount, posting date and bank line id are in
   the message, and `DraftResult` / `SendResult` carry `settling_credit`, so the next act is
   `match_bank_line`, not a dunning letter. A credit that falls short says by how much and that
   the remainder can be chased once it is applied.
3. **No dead end.** The block lifts the moment the credit is applied - here, or to the invoice it
   really belongs to by someone who knows better - because an applied credit leaves the table.
4. **An ambiguous credit warns, it does not block.** A strong credit `contested` between this
   invoice and another lets the draft through and appends "... could be for LB-x or LB-y - check
   before sending." A `likely` or `weak` fit, or a credit whose best fit is another invoice, says
   nothing.
5. **The send re-checks.** The verdict is asked again at `send_reminder`
   (concurrency-guards / preparation-is-the-staleness-window): a letter drafted before the
   statement import is not sent after it, and its row stays unsent.
6. **The status sentence agrees.** `statusOf` in `lib/lanes/read.ts` takes the settling credit and
   says "Looks paid: $17,775.00 arrived 28 Jun as "..." - apply it before chasing." in place of
   "1 unapplied credit could belong here.", still after the lateness when the glyph leads with it.

## Consequences

- This tightens policy: a draft and a send the app used to allow are refused. 6 of the 35
  invoices over 30 days are refused on the README beat; 14 invoices across the seeded books.
- `components/lanes/card/read.ts` `actRefusal` does not predict the new refusal yet, so the card
  and the tray still offer Draft on those invoices and the press comes back naming the credit.
  `test/ledgerbox-lanes-ui.test.ts` pins that gap to exactly the settling invoices; teaching the
  card the rule (and a "settling" heat in `lib/lanes/heat.ts`) is the follow-up.
- `DraftResult` and `SendResult` gain an optional `settling_credit`; additive for every reader.
- The tests: `test/ledgerbox-chase-paid.test.ts`.

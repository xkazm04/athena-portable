# 0104. A turn's cards are answered as one ordered sheet, each row its own grant

Date: 2026-10-15

Builds on [0038](0038-an-approval-is-spent-when-the-gate-lets-it-through.md)'s single-use, parameter-bound grant,
[0099](0099-a-card-names-its-app-its-tier-and-what-its-ref-points-at.md)'s card rendering and
[0103](0103-an-approval-runs-on-the-tab-and-document-it-was-proposed-on.md)'s tab binding. The
gate's classes, the grant and `POST /decisions/<id>` do not change.

## Context

The round loop files one card per gated OP of a reply, in reply order (`rounds.py` walks
`parsed.ops` in order). The panel answered each card alone, in whatever order the user tapped, and
every approval started its own continuation exchange (`answer()` called `exchange()` per card).
Mira's ten overdue reminders were ten answers and eleven model runs; a tier-2 form (fill, fill,
select, Save) was four cards, and Save could be approved before the fields were filled. Nothing
checked that a click still landed on the control the card named.

## Decision

1. **Grouping is the surface's.** A card that arrives on the stream gets a slot keyed by the
   `POST /run` request it arrived in, its catalog origin and its bound tab. Cards of one slot form a
   sheet in arrival order, which is proposal order. A sheet holds at most 12 rows (`SHEET_CAP`); a
   card past the cap keeps its slot but is no row, stays a card of its own, and the sheet footer
   says `(showing 12 of N)`. A card the daemon reported later (reconcile) has no slot and is a card.
   A sheet with one row left is a card, exactly as before.
2. **One press, N ordinary answers, not one batch grant.** Approve walks the ticked rows in order
   and, for each, calls the same per-card path a single card uses: the tab-binding check, then
   `POST /decisions/<id>` approve, where the daemon replays the gate and spends *that row's* grant,
   then the released `execute` through `onPage`. There is no batch route, no composite hand and no
   grant that covers several calls: every row keeps exactly-once on its own row, and a row is shown
   whole (C1's app, tier and target line, every parameter uncut) before it can be spent. A batch
   grant would have needed new gate semantics and would have made "approve 10" one permission
   whose parts cannot be refused separately; the per-row walk needs neither.
3. **Stop at the first row that is not ok.** A row stops the walk when the daemon refuses its
   answer, when the binding check refuses it, or when any call it released comes back not ok
   (`validator_failed`, `outcome_unknown`, a refusal on the page, anything). Earlier rows' side
   effects stay - they ran, and undoing them is not the panel's to attempt. Later ticked rows are
   never posted, so their grants stay unspent (`consumed_at` NULL) and their cards stay pending for
   a fresh answer; the remaining rows are still a sheet, which says `ran k of n; stopped at row k+1:
   <reason>`.
4. **Unticked rows are declined, first.** An unticked row is a "no" the user gave in so many words,
   so it is declined (`user_denied`, the existing decline episode) before any ticked row runs, and
   whether a ticked row later fails does not change it. Leaving unticked rows pending was the
   alternative; it would leave a card the user already refused waiting for a second refusal, and
   a later press of the sheet would offer it again ticked. A decline spends no grant and needs no
   page. "Decline all" declines every row.
5. **The model continues once.** Rows answered through a sheet never start their own continuation;
   after the walk the panel calls `exchange()` once with every row's result in `tool_results`. That
   exchange is bounded by `MAX_CONTINUATIONS` (8) like any other.
6. **An acting hand checks its label.** `page_click`, `page_fill`, `page_select` and `page_submit`
   take an optional `expect` (maxLength 120 = `LABEL_CAP`): the label `page_find` returned. Before
   any mutation `hands.js` compares it, squashed and case-blind, with `labelOf(el)`; a mismatch does
   nothing and answers `validator_failed` with what it saw. Optional, so existing callers and a
   page that cannot name a control keep working. `hands.rs` and `hands.js` spell the same schema
   and the same descriptions, and a Rust test holds them together. The hands' contracts change
   (schema and description); the per-contract trust table (ADR 0100) holds page-listed tools only,
   so no trusted app is re-gated by it, and the acting hands are `GATED` regardless.

## Consequences

- Ten reminders are one press, ten `POST /decisions`, ten consumes, ten page calls in proposal
  order and two model runs instead of eleven. Unticking two sends exactly eight.
- A long sheet invites rubber-stamping. The guards: 12 rows at most, every row uncut, a button that
  says `Approve 8 of 10`, and each row still `GATED` and still its own grant.
- A failure mid-sheet leaves a half-done task (three reminders sent, seven waiting). The sheet says
  so and the rest wait unspent; it does not retry or roll back.
- A hostile page can relabel its own button to match `expect`; the label remains the page's claim,
  as it was on the card. `expect` catches drift, not deceit.
- The runtime still holds one card while the slip tears, so the stamp animation shows the first
  row, not the sheet.

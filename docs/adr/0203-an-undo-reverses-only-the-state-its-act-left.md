# 0203. An undo reverses only the state its act left

Date: 2026-10-25

## Context

Ledgerbox's `applyUndo` (`examples/ledgerbox/app/actions.ts`) holds a hand-written inverse for
each reversible act. ADR 0156 let it answer `{ refused }`, which rolls back and leaves the row
undoable. Two cases used that answer: `unmatch` asked whether its line had gone elsewhere, and
`reminder` (ADR 0191) asked whether its draft had been sent. The rest reversed blind, and the kit
then logged "Undid #n" over each one:

- **categorize** wrote every prior category back. Undoing an older refile silently erased a
  later one that nobody had undone.
- **match** deleted the payment `pay_match_<line>` with no invoice scope. After unmatch from A
  and match to B, that id is B's payment. Undoing A's old match stripped B's money and left B's
  match row standing, so the books said a credit was applied that no balance showed.
- **reminder**, for a draft a later send had replaced (`sendReminderAction` deletes older unsent
  drafts), deleted nothing and still reported a clean undo.

No surface reached `undoAction` widely yet. The agent's toast (ADR 0191) does now, so the
money-corrupting path was one click away.

## Decision

1. **Each payload names the after-state its act left.** categorize records `to`, the category it
   applied. match records `payment_id`, the payment it inserted for that invoice. reminder
   already records the draft id, which must still exist and be unsent.
2. **`applyUndo` compares, then sets, or refuses.** categorize refuses if any target is no longer
   under `to`. match refuses unless both the (invoice, line) match row and the (id, invoice)
   payment row are still there, and its delete is scoped to the invoice. reminder refuses a sent
   draft (ADR 0191) and a replaced one. Each refusal is a sentence naming what changed: the
   invoice number and its category now, where the line is now, sent or replaced.
3. **A batch is all or nothing.** If one invoice of a batch refile has moved, none is reversed.
   A half-reversed batch is worse than either end.
4. **Older rows keep their old reversal.** A payload without `to` or `payment_id`, written before
   this ADR, reverses as before. The seed writes no undo payloads, so no seeded row is affected.
   The legacy match delete is now scoped to its invoice too. On the plain path that is the same
   row; elsewhere it can only delete less.

## Consequences

- An "Undid #n" row in the Trail is true. A refusal leaves the books and the row as they were,
  so the act can still be undone once the later act is undone first.
- A reversible row can refuse its undo. The tool class (`lib/tool-classes.ts`) still says
  reversible, because the act is reversible from the state it left. The class-parity test drives
  each undo at once, so it is unaffected.
- `undoAction` does not pass `{ through: true }`, and the refusals here name no `blockedBy`. Undo
  the later act first, by hand. Naming the blocker is left for whichever surface offers a chain.

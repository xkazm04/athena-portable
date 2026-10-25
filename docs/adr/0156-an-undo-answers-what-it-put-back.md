# 0156. An undo answers what it put back

Date: 2026-10-25

Amends ADR 0111 decisions 2 and 3 (the toast's Undo and the History band). Builds on ADR 0017
(the demo kit's shared activity log).

## Context

`undoActivity(db, id, applyUndo)` took `applyUndo: (db, entry) => void` and treated any return as a
clean reversal: it set `undone = 1` and logged "Undid #n: <summary>". An app that had to decline
had no way to say so. Hirelane, asked to undo a move after a later move or after a decision,
logged its own "left the stage alone" row and returned, so the kit then marked the row undone, the
toast said "Undone: ...", and the History band took the row's Undo away, although the stage had not
changed. Hirelane's partial slot release hand-logged a second row because the kit's line reported
a clean undo either way. Ledgerbox and tidycrm invented a private `UndoRefused` throw. And the one
act that would work after a later move, undoing that move first, was never offered, though the app
knew which row stood in the way (ADR 0111: "The band makes this reachable. It does not change it.").

## Decision

1. **`applyUndo` returns a verdict** (`UndoVerdict`, `@athena/demo-kit/activity`). Nothing is a
   clean undo, exactly as before. `{ refused, blockedBy? }` means nothing was put back: the kit
   rolls back any write the call made (a savepoint, so it holds inside a caller's transaction too),
   leaves the row undoable and logs nothing, and answers `{ ok: false, reason, blockedBy }`.
   `{ partial }` marks the row undone with ONE compensating line, "Partly undid #n: <partial>", and
   answers `{ ok: true, partial }`.
2. **`{ through: true }` takes the chain.** A refusal naming `blockedBy` undoes that row first (and
   whatever blocks it, newest first, at most 16 deep) and then retries this one, in one
   transaction, all or nothing; the answer lists the blockers as `alsoUndone`. The kit does not
   decide what blocks what; the app's verdict does.
3. **Hirelane answers truthfully.** A move undone after a later move is refused with the later
   move's row as `blockedBy`; after a decision it is refused with no blocker, because a decision
   has no undo; a slot release that had to keep a booked slot is partial. The toast says "Not
   undone: <reason>." with **Undo both** (through the existing Toast action slot) when there is a
   blocker, and "Partly undone: <what stayed>" for a partial undo. The History band needed no
   change of its own: a refused row is no longer marked undone, so it keeps its Undo.
4. **`ActivityLog` renders the answer.** A refusal shows its reason and, with a blocker, an
   "Undo #n and this" button (`onUndo(id, { through: true })`); a partial shows "Partly undone".
   `onUndo`'s new second argument and answer fields are optional, so existing callers are unchanged.

## Consequences

- A person is no longer told an act was undone when nothing changed, and a blocked undo is one
  press instead of finding the later row by hand.
- The contract is additive: a `void` `applyUndo` behaves exactly as before (pinned by
  `examples/demo-kit/test/activity-undo.test.ts` case 3), so ledgerbox, tidycrm and the template
  need no change. Ledgerbox's sent-reminder undo can become a one-line `refused` return as a
  follow-up (its open backlog item), retiring its `UndoRefused` throw.
- The refused "left the stage alone" rows hirelane used to log are gone; the refusal lives in the
  answer, not the log, because nothing happened to log.
- Rollback: revert the commit. The kit change alone is backward compatible.

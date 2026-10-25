# 0219. A sleep proposal's answer waits six seconds behind one Undo, and only Keep is answered in bulk

Date: 2026-10-25

Extends ADR 0143 (device-vitals: her sleep) on the desktop side only (`apps/desktop/src/stores/sleep.ts`,
`apps/desktop/src/scenes/mind/sleep.tsx`). No contract, daemon or wire change.

## Context

A sleep cycle can leave up to 20 open proposals (`OPEN_PROPOSALS_CAP`), and once 20 are open it
offers no new forget. Each one was answered by its own press, and the press posted at once. A
forget retires the memory and closes the proposal in the same call; the daemon has no un-forget
route. A mis-pressed Forget was a lost memory, and a full queue took 20 presses to clear.

## Decision

1. **Every answer is staged, not sent** (batch-undo-commit-window, deferred-write-window): Keep,
   Forget and a contradiction's "Forget this one" put the proposal in `staged` for `COMMIT_MS`
   (6000 ms), one timer per batch. The section shows "Forgetting N · Undo" or "Keeping N · Undo"
   with the seconds left; Undo sends nothing.
2. **One batch is pending at a time** (single-pending-batch-invariant): a second answer sends the
   pending batch first, then opens its own window, so one Undo never covers two decisions.
3. **The staged and the sending rows are drawn nowhere** (freeze-refresh-during-window):
   `openProposals(state)` leaves them out, so a `sleep.changed` re-read mid-window cannot paint
   them back. A refused answer comes back open with its sentence under it after the read that
   follows (partial-failure-reselect).
4. **A batch is sent 2 at a time with one read after** (bounded-fanout-commit, `COMMIT_FANOUT`).
5. **The last holder letting go sends the batch** (flush-on-teardown): the person decided, and
   leaving the section is not a cancel.
6. **Only Keep is answered in bulk.** `stageAll` takes `'keep'` alone and keeps every open forget
   offer; it never touches a contradiction, which always asks which memory goes. A forget stays
   one row's press, each behind its own window: a bulk forget would retire up to 20 memories on
   one press, and the Undo is the only way back from it.

## Consequences

- A forget lands about six seconds after the press, or at once when the section closes; nothing is
  sent that a person did not press.
- Clearing a full queue of forget offers by keeping them is one press.
- The app closing (not the section) inside the window drops the batch; the proposals stay open and
  are asked again. Nothing is lost that was not already undecided.
- `decide()` is gone from the store; `stage`, `stageAll`, `undo` and `commitNow` replace it.

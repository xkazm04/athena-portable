# 0111. Every reversible act on the board offers its undo

Date: 2026-10-15

Builds on ADR 0107 (`examples/hirelane/lib/acts.ts`) and DESIGN-LAW §7 in `examples/hirelane`.
Keeps ADR 0022's action-bar budget.

## Context

The board says twice that each AUTO act writes an undo: the reversible zone of the dossier
("Auto — reversible. Each of these writes an undo.") and the capability register in the foot. Each
of those acts did log an undo payload, and `undoAction` in `app/actions.ts` reversed it, partial
reversals included. But no component called `undoAction`. The /activity route that once listed
the log was reviewed out, so the remedy for a wrong move, especially one the agent ran unattended,
was a server function no surface reached. The refusal for moving a decided candidate went further
and named that remedy ("use Undo on the activity row that made it"), although `decide_stage` logs
`reversible: false` and `undoActivity` refuses to undo such a row.

## Decision

1. **A reversible write hands back its undo.** `ActionResult.undoId` is the activity row id that
   `logActivity` already returned, set by the four AUTO writes (`score_against_rubric`, `add_note`,
   `move_stage`, `propose_slots`) and absent on the three gated ones, which log no undo.
2. **The toast for the act just taken carries Undo.** The kit `Toast` gains an optional third
   argument, `{label, onAction}`, which draws one button and dismisses the toast when pressed.
   Callers that pass two arguments are unchanged, so ledgerbox and tidycrm are untouched.
   `toastFor` in `components/board/history.ts` decides when a toast gets the Undo.
3. **The dossier gets a History band in the reading column.** It does not go in the action bar,
   so ADR 0022's budget stays won. It lists the person's activity rows newest first (the agent's
   acts and every undo included), bounded at 8 with "(showing N of M)". Each reversible, not-undone
   row has Undo. A row without one says why in words ("reached the person and cannot be taken
   back", "undone", "the undo of an earlier act") instead of drawing a disabled control, because a
   disabled button reads as "not yet". `historyRow` is the one place that decides.
4. **A refusal names only a remedy the board would accept.** The decided-move refusal now says a
   decision is final and has no undo.

## Consequences

- The toast's Undo lasts as long as the toast (4 s). The History band is the durable way back, so
  the short window costs nothing that cannot be done a moment later.
- Undoing an older move after a later one still restores the older move's from-stage, which is
  `applyUndo`'s existing behaviour. The band makes this reachable. It does not change it.
- The `actor` column says `user` for acts the agent ran through the same actions, so the band
  does not print an actor rather than print a wrong one.
- Rollback is one `git revert`. The kit's action argument is optional, so reverting only the
  hirelane side leaves the kit and its other consumers working. No schema change: the activity
  table and `undoActivity` already existed.

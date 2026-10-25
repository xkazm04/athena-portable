# 0212. Scoring is the one act that runs over a group

Date: 2026-10-25

Builds on ADR 0107 (an act is offered exactly when its action would accept it), ADR 0156 (what an
undo puts back) and ADR 0205 (every act's row goes through `commitAct`, and its class is the
manifest's).

## Context

Hirelane's journey starts with "score the pile", and the only scoring act was
`score_against_rubric`, one applicant per call. On a fresh seed the pile is 12 unscored backend
applicants and 13 designer ones. A person scored a group by opening it, opening a candidate,
pressing Score and backing out, twelve times, and got twelve toasts and twelve History rows; an
agent made twelve tool calls, and a wrong run took twelve undos to reverse. The README said "Bulk
actions cover scoring and moves", but no bulk act existed, while the agent's `move_stage`
description said there is no bulk move.

## Decision

1. **One batch is one act.** `score_batch(role_id, stage?)` (`scoreBatch` in `app/actions.ts`)
   scores every unscored, undecided applicant of the role, or only those at `stage`, inside one
   `withTx`. Each person gets the same rubric note `scoreAgainstRubric` writes, from the same
   `listCriteria` and `scoreAgainst`. The batch logs ONE activity row (`target = role:<id>`) whose
   undo is `{ kind: "notes", noteIds }`, exactly the ids the write produced, so one Undo reverses
   the whole batch (one intent, one undo step).
2. **Who is in it is one function.** `scoreBatchFor(people, stage?)` in `lib/acts.ts`: not decided,
   no rubric scorecard yet, and at `stage` when given. The action guards with it and the L1 group's
   "Score N unscored" control counts from it, so the label and the act cannot disagree (ADR 0107).
   The control is drawn only when N > 0.
3. **AUTO by the manifest's own rule.** `reversible: true`, `sideEffects: "data"`. The GATED set
   stays exactly three.
4. **Only scoring runs over a group.** A score is not a decision and writes only notes. Moves,
   offers and rejections stay one person at a time, and the README now says exactly that.

## Consequences

- The journey's first step is one press, or one tool call, and a wrong batch is one undo.
- A refused batch (unknown role, unknown stage, nothing left to score) writes nothing and logs
  nothing; an unknown role is answered with the role ids there are.
- The batch row targets the role, not a person, so it does not appear in a dossier's per-person
  History band (which reads `applicant:<id>` rows). The toast carries its Undo; the notes it wrote
  show on every card.
- Reverting this change leaves any already-logged `notes` undo rows without a strategy in
  `applyUndo`; a revert should keep the `notes` case or accept that those rows are not undoable.

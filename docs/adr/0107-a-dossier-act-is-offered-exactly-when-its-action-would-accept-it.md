# 0107. A dossier act is offered exactly when its action would accept it

Date: 2026-10-15

Amends DESIGN-LAW §7.7 in `examples/hirelane`. Follows the pattern `nextMoveFor` in
`examples/hirelane/lib/constants.ts` already set for the Move button.

## Context

DESIGN-LAW §7.7 governed one direction: every precondition the surface states is enforced in the
server action, so an agent's option set is never larger than a person's. Nothing governed the
other direction, and it drifted. The dossier's gate panel recomputed the rules locally
(`canScheduleFor = stage === "interview"`, `settled = isDecisionStage(...)`) and listed slots from
`board.openSlots`, which `buildBoard` filtered to `status = 'open'`. `sendSchedulingEmail` books any
slot that is not booked and not held for somebody else. On a fresh seed, after Propose slots held
three slots for an interview candidate, the dossier offered 0 of the 3 and defaulted to a slot
nobody held, while the agent could book any of them. `read_view` reported the same capped list's
length as the number of open slots.

## Decision

1. **One module answers "may this act run for this person, with which choices, and if not, why".**
   `examples/hirelane/lib/acts.ts` is pure and client-safe. `actsFor(person, slots)` returns
   `{score, move, propose, offer, reject, schedule}`, each `{enabled, reason?}`, with `move.to` and
   `schedule.slots` as the choices. The reasons are one vocabulary: `decided`, `too_early`,
   `no_slot`, `next_is_a_decision`. `REFUSAL` holds the sentence for each.
2. **The server actions guard with the same predicates and refuse with `REFUSAL`.** `decidedReason`,
   `scheduleReason`, `canBook` and `isFree` replace the actions' inline checks and the SQL filters
   on `slots`. Accept and refuse are unchanged for every action. One message changes: scheduling a
   decided candidate now says the decision has been made, instead of telling the reader to move
   them to Interview, which a decided candidate cannot be.
3. **The board hands down every slot with whose it is.** `BdBoard.openSlots` is replaced by
   `BdBoard.slots` (status and holder included). The dossier computes `actsFor` once, and both zones
   of the action bar render from it. The slot list is the candidate's own held slots first, then up
   to 12 free ones, and the default pick is the first held slot.
4. **The agent reads the same answer.** `dossierRead` carries `acts`, keyed by tool name, with the
   choices or the refusal sentence. `read_view` at L0 counts free slots with `isFree`.
5. **The move act is the next step on the ladder.** `move` is enabled when `nextMoveFor` names a
   stage, and the parity check calls `moveStage` with that next ladder stage. A backward move
   (interview to screening) is still accepted by the action and still not offered as a button.
   That is the deliberate scope of the act ("forward one step"), not drift.

## Consequences

- `test/acts.test.ts` runs every seeded applicant through all six acts against the real actions
  (each call rolled back through a SAVEPOINT), once with three slots held and once with every free
  slot held. Any act whose button and action disagree, in either direction, fails it.
- A new availability rule goes in `lib/acts.ts` or nowhere. A component that re-derives one is a
  review finding under DESIGN-LAW §7.7.
- Proposing slots for decided or pre-interview candidates is still accepted. Tightening that is a
  policy change, out of scope here, and the parity test will hold the button to it when it lands.
- Rollback is one `git revert`. There is no schema change, no data migration and no manifest change.

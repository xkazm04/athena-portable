# 0125. Rehearsal dollars only where the answer key holds

Date: 2026-10-22

Amends [0097](0097-adopting-a-playbook-is-a-conversation-held-outside-the-turn-lock.md)'s showcase, whose rehearsal ended with the bench's dollar score.

## Context

The showcase rehearses a real bench run on a copy of the playbook's world shaped like the person's
case. The `shape` leg may edit up to twenty rows and move `today`; `truth.json` is changed only by
the portal renames and is never recomputed. Yet the `done` event sent `found_usd` from the bench's
`value_found_usd`, and the studio printed it as "found in the rehearsal". When the shape edited a
row or moved the date, that figure was scored against an answer key written for different rows:
a dollar claim the run did not earn.

## Decision

`answer_key_holds(spec, world)` in `adopt/showcase.py` reads the spec as applied (`shape.json`):
the key holds when the spec has no row edit and `today` is empty or the date the world already
had. Only then does `adopt.showcase {status: "done"}` carry `found_usd`. Otherwise `found_usd` is
`null` and the new field `found_reason` is `"shaped"` (closed vocabulary `FoundReason`, `""` or
`"shaped"`, declared in `contracts/adopt.py` and its port `lib/adopt.ts`, held by the parity test).
A spec that cannot be read back counts as not holding. The studio then shows the cards the
rehearsal proposed against the recorded run's, and says "Your case changed rows the answer key was
written for, so no dollar figure is claimed"; the "Rehearsal on invented data… nothing was sent"
label stays.

## Consequences

Most rehearsals that shape a case at all will show cards, not dollars; the dollar figure returns
only for renames-only worlds, where it is honest. Recomputing the truth for a shaped world would
earn the figure back and is not done here. The desktop reads an absent `found_reason` (an older
daemon) as `""`, so it keeps showing whatever `found_usd` such a daemon sends.

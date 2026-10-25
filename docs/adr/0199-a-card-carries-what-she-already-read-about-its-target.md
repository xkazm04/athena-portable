# 0199. A card carries what she already read about its target

Date: 2026-10-25

## Context

A decision is signed against one sentence and up to three facts on the slip's front (README
section 3.1, ADR 0026), or the effect alone on the rail's Gate. Whatever the turn read about the
card's target before the card rose stayed one level down, in a step's table: a dispute note on the
invoice, how many days overdue it is, and when that was read. The translator already saw it (the
step's line says "1 with a note"), but `buildContext` kept only the raw record under its id, not
which step read it or when, and `describeDecision` built its facts from the recipient, subject,
amount and balance only. A person could approve a chase of a disputed invoice without the window
ever putting the dispute in front of them, though the window held it.

## Decision

1. **The context keeps provenance per id.** `TurnContext.seen[id]` is `{at, tool}` of the step
   that last read the record (later wins, as `byId` already did). The transcript cache folds it
   like the other maps; it is not part of what a message reads, so a re-read alone re-translates
   nothing, and no message's title, sub or detail changes.
2. **`DecisionWords.standing`** is `{notes, facts, readAt, readBy}` for the card's target, or
   `null` when the turn never read it. Notes are the record's `NOTE_KEY` fields, facts its
   `AGE_KEY` fields formatted as the table formats them, `readAt` the step's clock and `readBy` the
   step in plain words ("Read the inbox in Ledgerbox"). It is generic over the existing
   vocabulary: no tool gets copy of its own.
3. **Every form of the card shows it.** The slip's front, the rail's Gate and each sheet row render
   the notes as a `role="note"` notice (`data-standing-note`) carrying one quiet line "As she read
   it at 09:41: Read the inbox in Ledgerbox"; a record read with no note shows only that line
   (`data-standing-asof`); a target never read shows nothing (hitl-approval, decision records:
   what the decider saw is part of the decision; oracle before gate: give the reviewer the thing
   to check against).

## Consequences

- The person signs with the dispute, the age and the age of that knowledge on the face they press
  A on, not two clicks away.
- The as-of line is honest about staleness but does not re-read: a record changed in the app since
  the step read it still shows what she read, and says when.
- The standing reads only records with a string `id` that the card's `params.id` names; a card
  addressed some other way shows nothing extra. No store, protocol or gate change; reverting
  removes an optional field and its rendering.

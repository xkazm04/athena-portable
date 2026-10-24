# 0151. An approval pins the draft it was shown

Date: 2026-10-25

## Context

The adopt studio's law is draft, preview, apply (ADR 0097): every brief has a `rev`, approval
names the rev, and only the current, unanswered-past rev is accepted. That check bound the Brief
object only. Everything around it was read live when the approval's consequences ran:

- `CaseBook.save` took `session.slots` and `session.answers` at request time (ADR 0123).
- The showcase's background job took `session.brief` and `session.slots` when it got round to
  them, though `on_approve` had handed it the approved rev.

Research lanes run beside the conversation for minutes and apply findings whenever they finish; a
dropped document does the same. Neither marks the brief stale (only an answer does). So a person
could approve a brief that said "Deposit held: not known yet" and the case file recorded
"$1,500" under that approval, coming back on reopen as her own memory; and an answer typed after
approving drafted rev 2, which a rehearsal that had not started yet would shape instead of rev 1.
The approval pinned a rev number, not the artifact.

## Decision

1. **A Draft is recorded with every brief.** `session.Draft(rev, brief, slots, answers)` is frozen.
   `loop._write_brief` takes one snapshot of the slots and answers, drafts from it and records it
   with the brief (`AdoptSession.record_draft`); `session.reopen` records the case's approved
   brief standing on the reopened slots. `AdoptSession.draft_of(rev)` answers it.
2. **What follows an approval reads the Draft only.** `CaseBook.save(session, rev)` and
   `Showcase.run(session, rev)` build from `draft_of(rev)`, never from the live brief, slots or
   answers. A rev never drafted is refused (`ValueError` for the save, a failed showcase).
3. **A late finding waits for the next draft.** A lane or document that lands after the draft
   changes the live slots only. It is not saved into the case under an approval of a brief that
   did not show it; the next brief carries it (with its "(from research)" mark), and approving
   that brief saves it. Late findings still do not make a brief stale: that would make approval
   race every lane.

The hook signatures, the wire contract (`contracts/adopt.py`) and the case file's shape are
unchanged.

## Consequences

- The case file and the rehearsal are, byte for byte, built from what the person approved.
- A research guess that lands between the draft and the approval is not in the saved case until
  a later draft carries it and she approves that one. A person who approves at once and never
  answers again keeps a case that says "not known yet" for it; on reopen the lanes run again.
- Code that sets `session.brief` directly (the adopt-tiers simulator's shape cells) has no draft
  and cannot be saved or rehearsed through the showcase; it calls `shape_world` itself, so
  nothing it does changes.
- A session holds one Draft per rev drafted, bounded by the card cap.

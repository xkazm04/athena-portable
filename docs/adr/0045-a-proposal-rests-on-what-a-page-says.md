# 0045. A proposal rests on what a page says, and cross-tab work is gathered tab by tab

Date: 2026-10-07

Amends `constitution/law.md`, "Judgement: act or propose" (README §2, §3.2 step 2). Found by the
playbook bench (ADR 0040).

## Context

Two failure classes kept recurring across benched runs, and neither was a gate or harness defect:

1. **Inferred evidence.** In the second FBA run Athena filed a $132 inbound-shortage case whose
   evidence read "POD: 12 of 12 cartons (240 units) delivered". The proof of delivery counts
   cartons; the 3PL's packing list, which she did not open, says carton 12 held eight units and
   the supplier short-shipped. The card carried a figure no page stated. In the first run she had
   read the packing list and refused the same claim.
2. **Work left in the wrong tab.** In the medical-bills runs she knew in the insurer's tab that the
   MRI appeal needed therapy notes from MyChart, then worked only the bills while in MyChart, and
   could not reach the notes from the insurer's tab afterwards ($1,240 left unclaimed until the
   person was asked to switch back, ADR 0044 and the bench's follow-ups).

Both are judgement the law can state in two short paragraphs, and both generalise beyond any one
playbook: an agent that files in a person's name must not put an unstated number on the card,
and an agent pinned to one tab at a time must gather while it is there.

## Decision

Two paragraphs join "Judgement: act or propose":

- A proposal rests on what a page says, not on what was worked out from it; a missing figure is
  named, with where it would be, never derived from a neighbouring one.
- Work that spans tabs is done tab by tab: in each, read what any open part of the work needs.

## Consequences

- The law's content hash changes, so every CLI session starts afresh once with the new law.
- The effect is measured, not assumed: the benches are re-run after this change and the result is
  recorded in each playbook's history with this ADR as the note.

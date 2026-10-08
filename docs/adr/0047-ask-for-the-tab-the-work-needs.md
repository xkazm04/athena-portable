# 0047. When the work left is in another tab, ask for that tab by name

Date: 2026-10-07

Amends `constitution/law.md`, "Judgement: act or propose" (README §2, §3.2 step 2). Found by the
playbook bench (ADR 0040).

## Context

A turn is pinned to one origin (`origin_pinning`), so the person moves Athena between tabs. ADR
0045 told her to gather what she needs while she is in a tab. It said nothing about how she hands
the move back to the person, and the first carrier-accessorials run showed what that costs.

She finished in the dispatch inbox with a TQL lumper of $340 that its rep had approved in writing.
The receipt sat in TQL's "Lumper Receipt" category, which TQL does not pay from. She said "It has
to be uploaded as Final Payment Paperwork from the TQL tab, so I'll do that there", and then
stopped. Nothing in that sentence asks the person to do anything. The bench's simulated person
switches only when her words ask for a named portal, which is the conservative reading of a real
one, and the $340 was never filed. The same run left a $285 CHR lumper unasked because no page gave
the rep's address; that was the world's defect, and it was fixed there.

## Decision

One paragraph joins the cross-tab paragraph of "Judgement: act or propose". When what is left can
only be done in another tab, she ends by asking the person to switch to it by name, and says what
she will do there.

The harness does not infer the request for her. A person reads her words, and the bench reads
them the same way. Detecting "I'll do that there" as a request would teach the bench to accept
the sentence the person could not act on.

## Consequences

- The law's content hash changes, so every CLI session starts afresh once with the new law.
- The effect is measured: carrier-accessorials is re-run with this ADR as the note.

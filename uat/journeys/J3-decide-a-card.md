---
id: J3
title: A decision arrives and I answer it
promotion: discovery
characters: [mira, jonas, ana, juror]
level: L1+L2
---
# J3 - Decide a card

**Goal.** I asked her to chase an overdue invoice. She needs my approval before anything leaves. I want to
see exactly what will happen, answer in seconds, and be sure the answer was recorded.

**Definition of done.** The card shows the action, recipient, rationale and exact parameters. I approve or
decline with the mouse, the keyboard (A/D) or the global chord without opening Main. The answer is visibly
acknowledged, the card goes away, the action runs or is refused, and it appears in the record.

**Surface.** `run.ts` cards, `views.tsx` slip, `machine.ts` stamp, `athena:chord`, `hotkeys.rs`, the daemon decision route.
**Watch for.** A card arriving while she is hidden or docked; two cards at once; answering by voice (no stamp,
known gap); a long parameter; what happens if the page navigated away before approval (grant is per origin).

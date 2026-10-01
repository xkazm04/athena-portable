---
id: J4
title: Audit what she did and why
promotion: discovery
characters: [jonas]
level: L1+L2
---
# J4 - Trust and the record

**Goal.** Before I let her near a real app I want to see the rules: what is gated, what each origin may do,
and afterwards, a complete honest log, including what I refused.

**Definition of done.** From her ledger I can see this session's calls and decisions, the model calls with
their cost and a shown-of-total count, and the origins she has seen with a switch to enable or disable each.
The page's tools and the generic hands show their gate class. A declined card is in the log as declined.

**Surface.** ledger Record/Origins tabs, `useOrigins`, Setup, `/ledger`, `gate.js` classes.
**Watch for.** A switch whose state disagrees across the two windows (`store:changed`); truncation without a
count; any secret on screen; "enabled" meaning something different from what the gate does.

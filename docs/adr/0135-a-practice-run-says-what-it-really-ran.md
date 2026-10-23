# 0135. A practice run says what it really ran

Date: 2026-10-23 (spark chores-uat, WP-R)

## Context
The rehearsal said "shaped like your case" when the shape had edited no row, so its dollar figure was always the
invented household's total (housing-02, consumer-10). A shaped rehearsal still graded cards against an answer key it
said no longer fit (public-05), played the example persona's own lines ("I'm Marian Oyelaran", public-03), and showed
proposed cards as if filed.

## Decision
- Unshaped: "Practice run on the example's data, with your app names", and the figure reads as the example's, not
  the person's. Shaped: "Practice run adjusted to N things you told her", and no dollar figure (ADR 0125 holds).
- `found_usd` counts only `money_back` cards (ADR 0133); `null` when no target is money back. Each trace card carries
  its `kind`; `count` cards carry no dollar value.
- A shaped run's cards carry outcome `proposed` and no value; the desktop draws them without outcome words.
- `for_the_person()` drops the persona's self-introductions from the copied world's phase lines, and the first phase
  opens "Run the chore we agreed: <brief command>". No bench seam: the phases live in the copied `world.json`.
- Every practice-run card is described as one she would propose; `approve="none"` sends nothing.

## Consequences
"N things" and per-card kinds ride in the free-form trace (`trace[0].adjusted`, `cards[].kind`) rather than a contract
field; promote them if a second consumer appears. The recorded run keeps its own label and the example's lines.

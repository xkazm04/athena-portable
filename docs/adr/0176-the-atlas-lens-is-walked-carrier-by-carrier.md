# 0176. The atlas lens is walked carrier by carrier, and a lit part says why it is lit

Date: 2026-10-25

## Context

A lens in Atlas was a count and a glow. The mast printed "19 of 68" and offered only "clear"; to
see the nineteen, a reader hunted the sheet. The lanes drawing lights a node when ANY of the
systems it stands for holds a carrier (`archify-lanes/Drawing.tsx`, `intentOf`), while the L2 pane
listed only the claims the component itself carries. Measured over `data/` and the lane workflow:
for 7 of the 17 claims, none of the nodes that light carry the claim themselves (inv-disk lights 2
nodes and 0 carry it; inv-provenance 2/0; tier-act 2/0; act-setup 5/0; act-record 2/0;
dec-module-first 1/0). A reader could open a lit node and be shown a pane that did not mention the
lens, and nothing said why.

## Decision

1. **One pure module walks the lens**, `components/atlas/chrome/evidence.ts`: `carriersOf` (the
   carriers in model order: layer, then system, then component), `carrierAt`, `stepCarrier` (wraps
   both ways; from a non-carrier, the nearest carrier after it, or before it, so the reader keeps
   their place), `whyLit` and `stepLensRead`.
2. **"Why lit" is computed over the systems the drawing draws a part with**
   (`systemsDrawnWith`): a lane node's item is drawn with every system of its node, so the record
   node's component names `sys-brain` when the brain's carriers lit it; any other map draws a
   component in its own system alone. The answer is either "carries" or the lit systems, each with
   its carriers.
3. **The mast's count becomes a stepper** ("< 3 of 19 >", with `[` and `]` while a lens is on and
   focus is not in a field), and **the pane gains "Under this lens"**: "Carrier 3 of 19", or
   "Lit because <system> holds N carriers" with each carrier one click away, plus Previous and
   Next. Neither renders without carriers.
4. **A step opens through the level map's `targetFor` (ADR 0173)**: a drawn carrier opens in its
   own group and the camera flies; an undrawn one keeps the reader's group and swaps the pane.
5. **Agents get the same walk.** `step_lens` (AUTO: a move, reversible, no side effects) answers
   the carrier it LEAVES open with its index and total, or refuses naming `set_lens`; `read_view`
   at L2 carries `lens.at` ({index, of} or null) and `lens.why` (the via systems, or null).

## Consequences

- The lit-but-does-not-carry contradiction is explained in place instead of silently disagreeing.
- The mast no longer prints the model share inline; it is in the stepper's accessible name and
  title ("19 of 68 components carry it").
- `systemsDrawnWith` knows the lanes map by identity, as `levels.ts` already knows the lane
  workflow; a future variant that merges systems differently would add its own case there (or
  declare drawn systems in its level map, a later contract change).
- `test/evidence.test.ts` pins the eight acceptance cases; case 7 is a guard on today's lens
  arithmetic.

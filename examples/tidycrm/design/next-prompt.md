---
page: none
---

# The baton — terminal

`stitch-loop`'s relay file. Its rule is that you **must** write the next task here before finishing,
or the loop dies. This one deliberately ends the loop, and that is the finding: the rule is written
for a site that always wants one more page, and it has no notion of "the work is done". Left to its
own instructions the loop would have invented a fifth direction to stay alive.

## What ran

| # | page | design system block | outcome |
|---|---|---|---|
| 1 | `daylight` | `DESIGN.md` §0 dials 10/3/9/7 + §§4,6,7,8,9 shared law | shipped at `/v/daylight` |
| 2 | `lattice` | `DESIGN.md` §0 dials 8/8/7/9 + §§4,6,7,8,9 shared law | shipped at `/v/lattice` |
| 3 | `/v` index | n/a — integration step | five directions listed |

## What the substituted step 3 actually caught

The loop's design-tool step was replaced by *render it and look at it* (see `SITE.md` §7). Three
defects came out of that step and only that step — each one passed `tsc --noEmit` and `eslint`
first:

1. **daylight, hero.** A viewport media query said "desktop, two columns" while the real content
   well was 800px, because the CopilotKit assistant panel takes ~480px of a 1280px window. The
   display headline wrapped six times with a single orphaned word. Fixed by moving the whole
   direction onto **container queries** keyed to `.d-main`.
2. **daylight, sunrise figure.** The disc rose from below the horizon in proportion to defects
   resolved — which is zero in the seeded starting state, so the figure's main element was invisible
   on first load and the panel read as broken. Rebuilt so the disc is always drawn and the light
   rises inside it.
3. **lattice, graph.** Confidence is a sum over an eight-entry weight table, so it takes discrete
   values; sixteen equal-width numeric buckets left ten of them empty and clumped every pair into
   three columns with dead air between. Rebuilt on ordinal columns over the distinct values.

A fourth came from the CDP pass measuring rather than eyeballing: `/v/lattice/review` at 390px
reported `scrollWidth 736 > clientWidth 390`, a horizontal overflow — the graph's 680px minimum
escaping its own scroll container because grid items default to `min-width: auto`.

None of these were visible in the markup. All four are the kind of thing the loop exists to catch.

## The honest limit

Every one of those four is an **execution** defect. Not one of them is a *direction* — the
substituted step never once said "this layout is the wrong idea". A rendering tool can only tell you
whether you built what you meant; a design tool can tell you that you meant the wrong thing. That
gap is what the missing Stitch server would have filled, and nothing in this repo fills it.

## Next

None. See `SITE.md` §5 — the `/v` routes are a comparison, not a product backlog, and the loop is
allowed to stop.

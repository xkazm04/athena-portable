# 0022. The dossier is one action bar of two zones, and arming takes the bar

Date: 2026-09-12

## Context

The dossier carried two stacked action panels at its foot — `.bd-auto-panel` for the four
reversible acts and `.bd-gate-panel` for the three that reach a person — plus a head made of an
identity row and a separately bordered band of four figures. Measured on the live page at 1440×900
with `getBoundingClientRect`:

| region | height | share of an 828px modal |
|---|---|---|
| head — identity row + figure band | 190px | 22.9% |
| body — the evidence and the bench | 406px | 49.0% |
| `.bd-auto-panel` | 121px | 14.6% |
| `.bd-gate-panel` | 109px | 13.2% |

**Half the pane was chrome** — 420px of 828. And the half that was left did not fit what it held:
`.bd-dossier-body` had a `scrollHeight` of 1401px in a `clientHeight` of 406px, so **29% of the
reading column was visible at a time** and the screenshot cut off mid-sentence. The bottom fade
`l2-dossier.css` documents so carefully — there to say "there is more here" — was covering 995px of
hidden evidence rather than a section boundary.

The largest single control in the dossier was the one nobody uses: a permanently mounted 469×62
note textarea, sitting open at all times in case somebody wanted to file a note.

The obvious merge is one row of six buttons, and it is forbidden. `DESIGN-LAW.md` §7.1: "turn the
page greyscale: the gated actions must still be identifiable." Six identical controls in a row fail
that on the first look, and `l2-dossier-3.css` already argues at length for why the gated region is
a light sheet rather than a differently coloured button.

## Decision

**One bar, two zones, side by side.** `.bd-actbar` is a two-column grid; `DossierActs` and
`DossierGate` each render a `.bd-zone` into it. Neither class loses the structural device it had:
the reversible zone stays on the glass at the lightest rule, the irreversible zone stays the one
light surface in the room at the only 3px weight in the direction. The heavy rule moves from
`border-block-start` to `border-inline-start`, because that is the edge the two now meet on.

**The class sits above its controls inside each zone, not beside them.** Inline, the two zones
competed for one line and the longest string won — "Scheduling opens at Interview", a *disabled*
button explaining why it is disabled, took 250px and pushed the reversible zone's four controls
onto three wrapped rows, making the bar 173px. Every length that did it is data or state: a
candidate's name, a stage label, a precondition sentence. Stacked, each zone is a 12px line plus one
row of controls, and it also gives both class sentences their full §7.4 wording back.

**Arming takes the whole bar.** `.bd-actbar:has(.bd-arm)` hides the reversible zone and gives the
gated one the full width. `:has()` rather than a hoisted flag: the armed state belongs to
`Gate.tsx`, which `Dossier.tsx` keys by the candidate so consent is voided on a bench click (§7.3);
threading that fact up to a parent and back down would put a second copy of it somewhere it could
disagree.

**The note becomes a disclosure** — a `Note…` button that swaps the reversible zone's controls for
an input, *File it* and *Cancel*, at the same height, and gives the row back when it closes.

**The head folds the figures into the identity row** and drops the bordered band. The remark moves
under the sub-line, where it reads as a remark about the person rather than as a caption on the
figures.

## Consequences

Measured on the live page after the change:

| | before | after | |
|---|---|---|---|
| head | 190px | 116px | |
| action chrome | 230px, two panels | 95px, one bar | |
| **total chrome** | **420px (50.7%)** | **211px (25.5%)** | |
| body | 406px | 615px | **+51%** |
| body content visible | 29% | 44% | |

At 1920×1080 the body shows 56%. The reading column still scrolls, and it should: 1401px of
evidence was never going to fit an 828px modal, and the rubric is four sections down. The claim is
only that half a pane of chrome above two thirds of a screen of hidden evidence was the wrong
split.

**Three strings shortened, and it is worth naming which.** "Score against the rubric" → "Score",
because the register in the foot carries `score_against_rubric` in full and the dossier *is* the
rubric; "Email a scheduling invitation" → "Email an invitation", because the disabled form of the
same button already says scheduling. Every precondition sentence, both class sentences and all
three arming sentences keep their exact wording — those are the ones §7.4 and §8 are about. Bar
controls also take `--bd-s3` padding instead of `--bd-s4`, the step below on the same scale and the
one the toolbar's chip and rung already use; `--bd-control` still sets the height, which is the
dimension a reach target is measured in.

**The bar is 95px nominal and 147px worst case.** A long candidate name or a long stage label can
still push a zone's controls onto a second row — with seven controls and two sentences at 1180px
the headroom is about 50px per zone. That degrades gracefully and is still well under the 230px it
replaced, but it is a real limit and the next direction that adds an eighth act will meet it.

**The phone was measured and then fixed, rather than inferred.** At 390×844 the first version of
this bar left the head at 307px, the bar at 366px and the body showing **3%** — a pane that is 87%
chrome is not a small dossier, it is a different and useless object. Three changes at
`bd-root (max-width: 48rem)` and `bd-dossier (max-width: 40rem)`: the pane becomes a full-height
sheet with no gutter or corners, the close button is ordered up beside the monogram instead of
taking a row of its own, and each zone's controls scroll sideways on one row instead of wrapping.
Head 226px, bar 200px, body 14%. Still the tightest of the four widths, and honest about it.

**A container cannot style itself.** The sheet rules live in the `bd-root` block rather than the
`bd-dossier` one because `.bd-dossier` carries `container-name: bd-dossier`, so its own
`max-block-size` and corners have to be set from the container above it. This cost one wrong pass
and is written into the stylesheet so it costs the next reader none.

**What did not change.** Every gated act still arms before it fires, through the same `useArm` with
the same 8-second self-disarm; the arming sentences still name the person, the address and what
stops being true; both zones are still keyed by the candidate; every precondition is still a
projection of a rule `app/actions.ts` enforces. `.bd-gate-panel` is gone as a selector and its
descendant rules now hang off `.bd-zone[data-class="GATED"]` — the region did not stop being a
region when it stopped being a band, it stopped being a separate block.

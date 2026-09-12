# 0023. Contrast is measured against the composited surface, and the label tier carries the accent

Date: 2026-09-12

## Context

Hirelane has now been reviewed three times with readability named as the complaint, and twice the
answer was to raise a grey. The second of those, `e08163c`, raised `--bd-ink-4` from `#6b6b77` and
recorded the result in the commit message as "3.8:1 to 5.3:1".

Both figures are correct and neither describes the surface the text is on. They were taken against
`--bd-void`, the page's own backdrop. Almost nothing in this direction is set on `--bd-void`: the
direction's whole depth grammar is translucent planes — `--bd-glass` is white at 4% over
`--bd-ground`, `--bd-glass-2` is 7%, a carousel card's gradient tops out at 8% over the void — and
every one of those is *lighter* than the backdrop, so every ratio taken against the backdrop
flatters the token by roughly a fifth. Composited and re-measured:

| token | value | against `--bd-void` | against the worst real surface |
|---|---|---|---|
| `--bd-ink-3` | `#93939f` | 6.67 | **5.65** — passes AA, fails AAA |
| `--bd-ink-4` | `#83838f` | 5.41 | **4.59** — clears AA by 0.09, fails AAA |
| `--bd-ink-4` *(before `e08163c`)* | `#6b6b77` | 3.99 | **3.27** — a WCAG AA failure |

So the readability pass was right and landed one step short, and the prior state had been a genuine
AA failure carrying 12px text at eighteen sites through two reviews that both named readability.

The second fault was the shape of the ladder rather than any rung. `10.43 / 5.65 / 4.59` put the two
*quiet* rungs 1.23× apart — closer to each other than either was to `--bd-ink-2` — so the range was
spent getting darker than legible instead of separating the tiers a reader has to tell apart.
`components/board/style/base/tokens.css` already makes exactly this argument about `--bd-control`:
four numbers that close together cannot be read as a rank.

Underneath both is the reason this kept happening: nothing in the repo read a colour. `DESIGN-LAW`
§9 opens with "a 'yes' you did not check is a failure", and §9.2's post-mortem ends with "a check
nobody can fail is worse than no check". `design/check-law.mjs` made §9.1, §9.2 and §4.2
executable. Contrast was the fourth decidable rule and had no instrument.

Separately, the surface reads as one grey. `design/board-brief.md` §2 locks four hue-bearing tokens
and gives one of them a job in writing — "`--bd-accent` — pastel sky — structure: the open group,
the level rail, the rule under a heading" — and the implementation spent it on a focus ring, one
column's top rule and the bench's self-row border. Not the level rail. Not a heading. With the hue
unspent, a region title was told apart from the running text under it by 1.4× of lightness and
nothing else.

## Decision

**Contrast is measured against the composited surface, and the measurement is executable.**
`design/check-contrast.mjs` reads the direction's own `base/tokens.css`, composites every plane the
direction paints, scores each text-bearing token against the *worst* of them, and fails under a
declared floor. Nothing is typed into the checker: both the tokens and the surfaces come out of the
token block, so the check cannot drift from the thing it checks. It is chained into `lint` beside
`check-law.mjs`, so CI runs it.

Floors are set by the size the token is set at, not by aspiration: `--bd-ink` through `--bd-ink-3`
carry text at or under 15px including the 12px `--bd-label`, so they take AAA (7.0);
`--bd-ink-4` is the subordinate rung and takes AA (4.5); the four locked hues take AA, because for
`--bd-auto` and `--bd-gate` the binding constraint is §7.1's greyscale test rather than contrast.

The ladder is retuned to clear those floors with an even step:

```
--bd-ink-2  #c9c9d1  10.43:1   prose and values                     unchanged
--bd-ink-3  #aeaeb9   7.81:1   labels, captions, the stage fact     was #93939f
--bd-ink-4  #9494a0   5.73:1   disabled, denominators, hints        was #83838f
```

**The label tier carries `--bd-accent`.** The hue goes where the brief always said it goes: the
level rail's current rung, and the region-title use of `.bd-block-label` — the masthead eyebrow,
every dossier band head, the bench's heading, the note field's label. It is scoped by region rather
than applied to the class, because two places must not have it.

## Consequences

**Spending the accent is a contrast upgrade, not a trade.** `#a8c8f0` measures 9.96:1 on the worst
surface here — better than `--bd-ink-2`, and nearly double either grey it replaces. The less
monotone answer and the more readable answer turned out to be the same answer, which is why this is
one decision and not two.

**Two places the accent must never reach, and both are the colour lock (§4.2) rather than taste.**
The AUTO/GATED legend — `.bd-register-group .bd-block-label` in the foot and `.bd-class` in the
dossier — because a third hue inside the one distinction this app exists to make is that
distinction blurred. And the gated panel, the one light surface in the room, where pastel sky on
`#fbf4f2` measures 1.9:1; `level2/l2-dossier-3.css` already overrides it and wins only because
`style/index.css` imports the room second and the dossier thirteenth. **That import order is now
load-bearing for a contrast result**, which is a cost this decision accepts and writes down.

§4.2 itself is untouched: `--bd-accent` is one of the four already-locked hues and no new colour is
introduced. §9.10, the greyscale test, is unaffected — the accent carries region *names*, which are
not class signals, and no AUTO/GATED structure changed.

**No call site moves.** Each ink tier keeps the meaning it had, so the retune is three values. That
is deliberate: it lets the theme land ahead of the L1 and L2 work in `design/ui-pass-brief.md`
without entangling them, and it makes the two layers that follow reviewable on screenshots that are
legible to begin with.

**What the checker does not do.** It does not verify which token is used where; that needs the
cascade, and a static reader guessing at it would be wrong in both directions. The floors encode the
*role* each rung is given, and the role is enforced by review. The promise is narrower and true:
whatever is set in these tokens is legible on every surface this direction paints. A future
direction adds its own surfaces to `SURFACES` when it adds them to its stylesheet, and a token
listed with no floor fails rather than being skipped.

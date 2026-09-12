# hirelane — the three-layer UI pass: brief, written before the code

**Status: LANDED, and this document is now a record rather than a specification.** All three
layers shipped — ADR 0023 the theme, ADR 0022 the dossier, and §2.7 below records which L1
direction won and what was deleted with the other. Where a built result differs from what was
specified, §2.7 and §3.6 say so and the code is right.

**Baseline.** Commit `e08163c`, *feat(examples): hirelane readability pass* — the state of
`components/board/` as this was written. Every measurement below was taken against that commit, in
Chromium at 1440×900 and 1280×800, by reading `getBoundingClientRect` off the live page rather than
by reading the stylesheet. Where a number contradicts a claim in an existing comment, the number is
in the right and the comment was measured on a different surface; §1.1 says which.

**Scope.** Three complaints, in the order they were raised:

1. The theme is monotone, which costs readability. Raise the greys that carry text to a measured
   floor, and give the label tier the secondary hue the brief has always declared for it.
2. L1's candidate cards do not fit their content and are hard to compare side by side. Two new
   directions, behind a tab switcher, then one wins and the other is deleted.
3. L2's dossier carries two stacked action bars and spends half its height on chrome. One thin
   bar, and a head that stops taking a fifth of the pane.

Binding on all three: `DESIGN-LAW.md`, and in particular §1 (no raw numbers), §2.1 (the tell list),
§2.2 (the diff gate, written *before* the code — §3.1 and §3.2 below are that gate discharged), §3
(the container model), §4.2 (the colour lock), §5 (divergence), §7 (the gate is structural) and §9
(the pre-ship gate). Where this document and the law disagree, the law wins and this document is
wrong.

---

## 1. LAYER ZERO — the theme: contrast, and the hue the brief already owns

### 1.1 What is actually on the surface, measured

`e08163c` raised `--bd-ink-4` and its commit message records the result as "3.8:1 to 5.3:1". Both
figures are correct **against `--bd-void`**, the page's own backdrop. Almost no text sits on
`--bd-void`. Text sits on the glass planes — `--bd-glass` is `rgb(255 255 255 / 4%)` over
`--bd-ground`, `--bd-glass-2` is 7%, and a carousel card's own gradient tops out at 8% over the
void. Composite those and measure again:

| token | value | on `--bd-void` | on a glass panel | worst surface | AA (4.5) | AAA (7.0) |
|---|---|---|---|---|---|---|
| `--bd-ink` | `#ffffff` | 20.25 | 18.43 | 17.17 | pass | pass |
| `--bd-ink-2` | `#c9c9d1` | 12.31 | 11.20 | 10.43 | pass | pass |
| `--bd-ink-3` | `#93939f` | 6.67 | 6.07 | **5.65** | pass | **fail** |
| `--bd-ink-4` | `#83838f` | 5.41 | 4.92 | **4.59** | pass by 0.09 | **fail** |

So the pass was real — `#6b6b77` measured 3.27 on a glass panel and was a genuine AA failure at
eighteen sites — and it stopped one step short. `--bd-ink-4` carries 12px and 13px text (the slide's
stage fact, the capability register, the fit band, the crumb detail, the keyboard hint) at 4.59:1,
which clears the AA floor by nine hundredths and fails AAA outright. Small text is exactly where AAA
earns its keep.

The second fault is the shape of the ladder, not any single rung. `10.43 / 5.65 / 4.59` puts its two
quiet rungs 1.23× apart — closer together than either is to `--bd-ink-2`. The file already makes
this argument about something else, in `tokens.css` on `--bd-control`: *"Four numbers that close
together cannot be read as a rank; they say nothing at all."* The same is true of these three.

### 1.2 The retune

```css
--bd-ink-2: #c9c9d1;   /* 10.43 worst-surface — prose, values                      unchanged */
--bd-ink-3: #aeaeb9;   /*  7.81 worst-surface — labels, captions, the stage fact   was #93939f */
--bd-ink-4: #9494a0;   /*  5.73 worst-surface — disabled, denominators, hints      was #83838f */
```

Every rung clears AA, the top three clear AAA, and the steps are an even ~1.34× / ~1.36× instead of
1.85× / 1.23×. No call site moves: the tiers keep the meanings they already have, so this is three
token values and nothing else.

### 1.3 The secondary hue — `--bd-accent`, which the brief has declared since round 3

`design/board-brief.md` §2 locks four hue-bearing tokens and gives this one a job in writing:

> `--bd-accent` — pastel sky — **structure: the open group, the level rail, the rule under a heading**

The implementation spends it in three places — a focus ring in `base/the-room.css`, one column's top
rule in `level0/l0-board.css`, and the bench's self-row border in `level2/l2-dossier-2.css`. Not the
level rail. Not a heading. That gap is the monotone complaint: with the hue unspent, a region title
is told apart from the running text beneath it by 1.4× of lightness and nothing else.

Spending it is a **contrast upgrade, not a trade**. `#a8c8f0` measures **9.96:1** on the worst
surface in the room — better than `--bd-ink-2`, and nearly double either grey it replaces. This is
the uncommon case where the less monotone answer and the more readable answer are the same answer,
which is why it is the first thing to do and not the last.

**Where it goes.** The label tier, scoped by region — not a blanket `.bd-block-label`:

```css
.bd-mast-id .bd-block-label,      /* the studio eyebrow                        */
.bd-band-head .bd-block-label,    /* every dossier section title, parts.tsx    */
.bd-bench .bd-block-label,        /* "The field · 11 at Applied"               */
.bd-note-field .bd-block-label {  /* the Note field label                      */
  color: var(--bd-accent);
}

.bd-rung[data-here="true"] {      /* the level rail — the brief names it       */
  color: var(--bd-accent);
  border-color: var(--bd-accent);
}
```

**Where it must not go, and both are the colour lock rather than taste.**

- **The AUTO/GATED legend** — `.bd-register-group .bd-block-label` in the foot, and `.bd-class` in
  the dossier. A third hue inside the one distinction this app exists to make is that distinction
  blurred. Those keep the ink ladder; the class keeps `--bd-auto` and `--bd-gate`. §4.2 is not
  violated by this change, because `--bd-accent` is neither of the two locked hues — but it is
  violated the moment accent appears *inside* the region those two hues are doing their work in.
- **The gated panel.** It is the one light surface in the room. Pastel sky on `#fbf4f2` measures
  **1.9:1**. `level2/l2-dossier-3.css` already overrides `.bd-gate-panel .bd-block-label` to
  `--bd-gate-ink-2`, and that override is downstream of `base/the-room.css` in the cascade
  (`style/index.css` imports the room second and the dossier thirteenth), which is what keeps it
  true. **Do not reorder those imports**, and if the accent rule is written anywhere later than
  `the-room.css`, re-check this by eye before shipping.

§9.10, the greyscale test, is unaffected: nothing about the AUTO/GATED structure changes, and the
accent carries region *names*, which are not class signals.

### 1.4 `design/check-contrast.mjs` — the rule made executable

`DESIGN-LAW.md` §9 opens with "a 'yes' you did not check is a failure", and §9.2's post-mortem ends
with "a check nobody can fail is worse than no check". Contrast is the third law in this repo that
is fully decidable by reading files and has no instrument, which is how `#6b6b77` sat at 3.27:1
through two reviews that both listed readability as the complaint.

The checker, beside `design/check-law.mjs` and chained into `lint` the same way:

1. Parse `components/<slug>/style/base/tokens.css` for the hex tokens and the `rgb(255 255 255 / N%)`
   glass alphas. No values are typed into the checker — it reads the direction's own token block, so
   it cannot drift from it.
2. Composite the surface set: `--bd-void`, `--bd-ground`, `--bd-sheet`, each glass alpha over
   `--bd-ground`, and the card gradient's top stop over `--bd-void`.
3. Assert each text token against the **worst** of those, to a declared floor:
   `--bd-ink`/`-2`/`-3` at 7.0, `--bd-ink-4` at 4.5, the four locked hues at 4.5.
4. Report every ratio, not only the failures, so a retune can be read off one run.

Floors live in a table at the top of the checker with the reason beside each, in the shape
`design/check-law.mjs` already uses for its baseline file. A token that is genuinely not text —
should one be added — is declared as such in that table rather than exempted case by case.

### 1.5 What this layer does not do

It does not touch `--bd-auto`, `--bd-gate` or `--bd-mark`; all three already clear 9.4:1 and all
three are load-bearing. It does not change a type size, a spacing step or a single component's
markup. It is three token values, six selectors and one checker — which is the right size for a
complaint about legibility, and deliberately small enough that it can land ahead of §2 and §3
without entangling them.

---

## 2. LAYER ONE — the candidate card

### 2.1 What is wrong, measured

The focused card at 1440×900, by `getBoundingClientRect`:

| region | height | share of card |
|---|---|---|
| `.bd-slide-who` — monogram, name, headline | 90px | 18.0% |
| `.bd-slide-verdict` — overall, fit, evidence band | 53px | 10.6% |
| `.bd-bars` — the five criteria | **279px** | **55.8%** |
| `.bd-slide-meta` — the stage fact | 20px | 4.0% |
| padding and gaps | 58px | 11.6% |
| **card** | **500px** | |

Four findings follow from that row and from the two screenshots.

1. **The five criteria take 56% of the card to say very little.** Each is a label row plus a track
   (`.bd-bar-top` + `.bd-bar-track`), so five criteria cost ten stacked elements.
2. **The labels are the same on every card and carry no comparative information.** All three cards
   under the loupe belong to one column, so they are scored against one role's rubric, in one
   order. "Distributed systems / Testing discipline / API design / Operational ownership /
   Collaboration" is rendered three times at L1 — fifteen label renders, of which five would do.
3. **An unscored column is five rows of em dash.** At *Backend Engineer · Applied*, nobody is
   scored, so 56% of every card is label-plus-dash. The direction is right that absence must not be
   drawn as zero; it does not follow that absence should cost the same room as a score.
4. **Comparison is a reading task, not a looking one.** To compare two cards a reader matches a word
   in one card against the same word in the next and then compares two bar lengths at different
   heights on the screen. A contact sheet — this direction's own source — is a looking task.

None of this is a defect in the card so much as the wrong container for the job the level does.
`DESIGN-LAW.md` §3 requires, for this concept, *"a carousel whose three centre cards are held at
full size, each carrying all five criteria on a shared 0-4 baseline"*. Both directions below keep
that. They disagree about everything else.

### 2.2 The diff gate (§2.2), written before either variant exists

> **Generic answer.** A dark rounded card at 12px radius. Avatar disc top-left, name in 18px
> semibold beside it, a coloured score chip top-right. Five rows, each a left-aligned criterion
> label with a right-aligned `3/4`, a 6px rounded progress track underneath filled in the accent
> hue. A muted footer line. A 1px border, a drop shadow on hover, and a fade-up on mount.

That is close enough to the card in the tree to be uncomfortable, which is the gate working. Both
variants below state their diff from it, and neither may be built until its diff is written here.

### 2.3 Variant A — **the strip**

> **Mood adjective.** *Comparative.*
> **Source direction.** A spectrogram, or the density strip on a film contact sheet's edge — one
> continuous signal per frame, read across frames rather than down one.
> **Why this source.** The level's whole job is "which of these three", and the contact sheet is
> this direction's declared genre (`board-brief.md` §1b). On a real sheet you do not read each
> frame's caption; you scan the strip and stop where the shape changes. A rubric with a fixed
> criterion order is already a signal with a fixed x-axis. Drawing it as one makes the comparison a
> glance.

**Diff from the generic answer.**

- **The criterion labels leave the card.** They are printed once, as a legend on the rail's own
  baseline, under all three cards, aligned to the same five positions every card uses. Fifteen label
  renders become five.
- **The five scores become one 5-segment meter** across the card's full width. Score is the fill
  height within each segment; **weight is the segment's height** (`--bd-rule-1/2/3` territory,
  drawn from the weight the scorecard stores), so the heaviest criterion is literally the tallest
  part of the signal.
- **The gap is a break in the baseline**, reusing `marks/Marks.tsx`'s `GapMark`, at the segment it
  belongs to — legible at row level, which §9.7 requires.
- **The overall score becomes the card's dominant object**, at `--bd-text-2xl`. With the labels
  gone it is the only figure on the card, so it may carry the emphasis the rubric rows were
  splitting between them.
- **Unscored is a flat baseline with no segments** — the signal absent rather than five dashes.
- **The card halves**, 500px to roughly 300px, which lets the rail hold **five** cards under the
  loupe instead of three. That is the real prize: the group at *Backend screening* is six borderline
  applicants, and the level exists to argue about exactly those six.

**Container check (§3).** Five criteria, one shared 0-4 baseline, weight visible, gap visible at row
level. Passes. **Colour check (§4.2).** No new hue: fill is the ink ladder, the gap is `--bd-mark`,
which is already the gap's colour in `l1-carousel-2.css`.

### 2.4 Variant B — **the column**

> **Mood adjective.** *Dimensional.*
> **Source direction.** A small-multiple bar chart from a metrology sheet — five columns, one ruled
> axis, the same five in the same order on every card.
> **Why this source.** The score is the fact and the name is the label, and every applicant-tracking
> system in existence prints them the other way round. At L1 you are not looking anybody up; you
> already know you are in *Backend · Screening* and you are choosing between shapes. Putting the
> chart first and the identity under it is the one arrangement that makes the level's actual
> question the first thing on the card.

**Diff from the generic answer.**

- **The scorecard rotates 90°.** Five vertical columns on one ruled 0-4 axis, ticked at 0, 2 and 4 —
  a chart, not five progress bars.
- **Criterion identity is a two-letter stub under each column** (`DS TD AP OO CO`), with the full
  name in `title` and `aria-label`. It is learnable because it is the same five, in the same order,
  on every card in the column — and it is the *only* variant where the label stays on the card.
- **Weight is the column's width**, 1/2/3 mapping to narrow/medium/wide. Score is its height.
- **The gap column is drawn as an open outline**, unfilled, rather than as a short column — absence
  rendered as absence rather than as a low measurement, which is the distinction
  `dossier/Bench.tsx` already defends in prose.
- **The header moves below the chart.** Monogram, name and overall sit under the axis.
- **The card stays near its current height** and does not add cards to the loupe. This variant buys
  precision, not density.

**Container check (§3).** Passes on the same four counts. **Colour check (§4.2).** No new hue.

### 2.5 Why these two are two (§5)

Seven axes, opposite on all seven — the threshold is five:

| axis | A · the strip | B · the column |
|---|---|---|
| Orientation of the scorecard | horizontal, one continuous signal | vertical, five discrete columns |
| Where the criterion name lives | once, on the rail | on every card, as a stub |
| What dominates the card | the overall figure | the shape |
| Reading order | identity → signal | signal → identity |
| Weight encoded as | segment height | column width |
| Gap encoded as | a break in the baseline | an unfilled outline |
| Cards under the loupe | five | three |

**A reason to prefer A.** It is the only one of the two that changes how many people you can compare
at once, and the group that matters in this database has six people in it.

**A reason to prefer B.** It is the only one of the two that keeps a criterion legible on the card,
so a reader who does not yet know the rubric can still use L1 — and it renders an unscored applicant
honestly without the card going blank.

### 2.6 The tab switcher, and its removal

- `CardVariant.tsx` (deleted with the loser) — a `CARD_VARIANTS` map of
  `{ slug, label, Component }` over `Slide` (the incumbent, kept as the third option so the
  comparison has a baseline), `SlideStrip` and `SlideColumn`.
- `Carousel.tsx` holds the selected slug in state and renders `CARD_VARIANTS[slug].Component` in the
  existing `ordered.map`. The pose, the keyboard handling, the dots and `layoutId` are untouched —
  all three variants are one card's worth of markup and nothing else, so `carousel/pose.ts` does not
  move.
- The switcher renders as a `role="tablist"` beside `.bd-carousel-nav`, sharing `--bd-control` and
  the focus ring so it does not read as a foreign control.
- **It is scaffolding and the spec says so up front.** It does not ship. When a winner is chosen,
  the losing components, the map, the switcher and the state are deleted in the same commit that
  renames the winner to `Slide.tsx`, and `board-brief.md` §1b records which direction won and the
  one-sentence reason. A variant switcher left in the tree is a second direction nobody is
  maintaining, which is the failure `design/` already has four briefs' worth of.

Note for whoever builds this: §5's divergence rule is about two *directions*, and these are two
treatments of one card inside one direction. The seven-axis table above is offered because the rule
is a good test of whether two things are really different, not because §5 binds here. §9.8 stays
"not applicable, single direction".

---

### 2.7 The winner, and what went with the loser

**The ledger won.** `components/board/carousel/Slide.tsx` is it; the strip, the incumbent card,
`CardVariant.tsx`, the switcher, the shared legend and `--bd-meter-h` were deleted in the same
commit, as §2.6 said they would be. Nothing about the deck moved: `pose.ts`, the keyboard
handling, the dots and the `layoutId` never learned which direction was mounted, which is what
made the switch a one-file change.

**Why it won, in one sentence each.** The ledger answers the question the level is actually asking
— not "what did this person score" but "what is distinctive about them against the people they are
being chosen against" — and it answers it in words a reader can quote in a hiring meeting. The
strip answered a different and narrower question beautifully: it made three silhouettes comparable
at a glance and halved the card, but a shape cannot be read aloud, and every criterion name had to
leave the card to buy that.

**What the strip was right about, and what survives it.** Its legend proved that the five names are
column-constant, and its measurement — that the old card spent 56% of its height on five
label-over-bar rows — is why the ledger's rows are one line of type each with the bar inline. The
compact rule at 1024×768 in `l1-carousel-3.css` inherited that: there is far less to compact now,
because the row was already one line.

**`criterionMedians` moved into `components/board/model/order.ts`** rather than staying beside the
card. It is a comparison helper, that file is where comparison lives, and it is the one piece of
this direction a second direction would want.

## 3. LAYER TWO — the dossier

### 3.1 What is wrong, measured

The dossier at 1440×900, by `getBoundingClientRect`:

| region | height | share of modal |
|---|---|---|
| `.bd-dossier-head` — name row + verdict band | 190px | 22.9% |
| `.bd-dossier-body` — the evidence and the bench | 406px | 49.0% |
| `.bd-auto-panel` | 121px | 14.6% |
| `.bd-gate-panel` | 109px | 13.2% |
| **`.bd-dossier`** | **828px** | |

- **The two action bars are 230px — 27.8% of the modal.**
- **Head plus bars is 420px — 50.7%. Half the pane is chrome.**
- And the half that is left does not fit its content: `.bd-dossier-body` has a `scrollHeight` of
  **1401px** in a `clientHeight` of **406px**. **995px is hidden. 29% of the reading column is
  visible at a time** — which is why the screenshot cuts off mid-sentence, and why the bottom fade
  that `l2-dossier.css` documents so carefully is doing far more work than it was designed for.

The user's phrasing was "impossible to ingest", and 29% is the number behind it.

### 3.2 One bar, and what may not be lost in the merge

The obvious merge — one row of six buttons — is forbidden, and by the law rather than by taste.
§7.1: *"the AUTO/GATED distinction is expressed structurally … turn the page greyscale: the gated
actions must still be identifiable."* Six identical buttons in a row fails that on the first test.
`l2-dossier-3.css` makes the same argument at length about why the gated panel is a light sheet.

So: **one bar, two zones, one row.**

```
┌──────────────────────────────────────────────────┬──────────────────────────────────────┐
│ ● Auto   [Score again] [Move to Screening]       ┃ ● Gated — reaches Ada Tanaka         │
│          [Propose slots] [Note…]                 ┃   [Record an offer] [Send a rejection]│
└──────────────────────────────────────────────────┴──────────────────────────────────────┘
   glass, --bd-rule-1, the room's own ink            --bd-gate-sheet, --bd-rule-w3 on the
                                                     leading edge, --bd-gate-ink
```

- **The inversion survives and so does the greyscale test.** The gated zone keeps
  `--bd-gate-sheet`, keeps `--bd-gate-ink`, and keeps `--bd-rule-w3` — moved from its `border-block-
  start` to its `border-inline-start`, because the zone is now beside the reversible half rather
  than beneath it. It is still the only light region in the room and still the only 3px rule.
- **`.bd-class` is unchanged**, both instances, including the sentence naming the candidate. §7.4
  wants who it reaches on the surface, and that is the cheapest possible place to keep it.
- **The note stops being a permanent 469×62 textarea.** It becomes `[Note…]`, which swaps the AUTO
  zone's buttons for an input plus *File it* plus *Cancel*, in the same row, at the same height. The
  field is the least-used control in the panel and it is the largest.
- **Arming raises a strip above the bar** rather than reflowing the bar. `.bd-arm` keeps its
  sentence verbatim, keeps `autoFocus`, keeps `useArm`'s 8-second self-disarm, and keeps
  `key={candidate.id}` on both panels so a bench click voids an armed gate (§7.3). The strip costs
  ~72px, and only in the moment that has earned them.
- **Target height: 64px idle**, from 230px. **166px returned.**

Two things to verify by hand after the merge, because both are easy to lose and neither is caught by
a test: the focus trap in `Dossier.tsx` queries `paneRef` for focusable elements, so the disclosure
and the armed strip must both sit inside it; and the armed strip must not become the last tab stop
in a way that puts *Cancel* before *Fire*.

### 3.3 The head

190px for a name, a sub-line and four figures. The verdict band is a separately bordered box
(`.bd-verdict`, 74px) sitting under a 71px identity row, with the italic note floating right of the
figures on a line of its own.

Fold the figures into the identity row, right-aligned, keeping the mono face, `tabular-nums` and the
`data-word` rule that sets a fit band in the text face one step down:

```
(AT)  Ada Tanaka                                  2.0/4     thin    5/5        11
      Backend Engineer · Applied · applied Aug 31 weighted  fit  evidenced  years   [×]
```

The italic note moves under the sub-line, where it reads as a remark about the person rather than as
a caption on the figures. **Target: 96px, from 190px. 94px returned.**

### 3.4 What the pane gets back

| | now | after | |
|---|---|---|---|
| head | 190px | 96px | |
| action bars | 230px | 64px | |
| **body** | **406px** | **668px** | **+65%** |
| body content visible | 29% | 48% | |

The reading column still scrolls — 1401px of evidence was never going to fit 828px of modal, and it
should not: the rubric is four sections down and the fade that says so is correct. The claim is only
that half a pane of chrome above two thirds of a screen of hidden evidence is the wrong split, and
48% is a defensible one where 29% is not.

### 3.5 Out of scope for this layer

The bench rail, `comparisonOrder`, the unscored-sort-last rule, every server action, and the
evidence column's own structure. This layer moves chrome and returns room; it does not touch what is
written in the room it returns.

---

### 3.6 What the build changed about this spec — written after, and marked as such

Three things above were wrong or incomplete, and the code is the authority on all three.

- **The bar is 95px, not 64px, and the class sits *above* its controls rather than beside them.**
  The one-row sketch in §3.2 was measured as a drawing, not as a layout. Built inline it came out
  at **173px**, because the two zones competed for one line and the longest string won:
  "Scheduling opens at Interview" — a disabled button explaining why it is disabled — took 250px
  and wrapped the reversible zone's controls onto three rows. Every length that did it is data or
  state. Stacking the class line above each zone's controls made the height independent of name
  and stage length, and had the side benefit of giving both class sentences their full §7.4
  wording back, which the inline sketch had shortened to fit.
- **No `dossier/Bar.tsx` was added.** `.bd-actbar` is a wrapper element in `Dossier.tsx` around the
  two existing components. A third component to hold two components would have had to own the
  armed state to lay itself out, and that state belongs to `Gate.tsx`, which is keyed by the
  candidate so consent is voided on a bench click (§7.3). `:has(.bd-arm)` reads the fact where it
  already lives instead of copying it.
- **§3 did not mention the phone, and the phone was broken.** At 390×844 the first build of this
  bar left head 307px, bar 366px and the body showing **3%**. Fixed at
  `bd-root (max-width: 48rem)` and `bd-dossier (max-width: 40rem)`: a full-height sheet, the close
  button ordered up beside the monogram, and each zone's controls scrolling sideways on one row
  instead of wrapping. 226 / 200 / 14%. A spec that specifies one width has specified one width.

Measured result, against §3.1's baseline:

| | before | after |
|---|---|---|
| head | 190px | 116px |
| action chrome | 230px (two panels) | 95px (one bar) |
| total chrome | 420px (50.7%) | 211px (25.5%) |
| body | 406px | 615px |
| body visible | 29% | 44% (56% at 1920) |

## 4. Order, and why

1. **§1, the theme.** Three token values, six selectors, one checker. Nothing else depends on it and
   everything else is easier to judge after it, because both remaining layers get reviewed on
   screenshots and the screenshots are currently hard to read. It can land on its own.
2. **§3, the dossier.** Self-contained, one region, and the largest single win available — 260px of
   a 828px pane. It shares no file with §2.
3. **§2, the card.** Last, because it is the only one of the three that ends in a decision rather
   than a state, and because the switcher wants the theme settled underneath it or the comparison is
   between two cards that are both hard to read.

## 5. The pre-ship gate (§9), per layer

Everything in §9 applies to all three. These are the lines each layer is most likely to fail, and
the evidence that answers them:

| layer | the line that bites | how it is answered |
|---|---|---|
| §1 | §9.12 — the locked hues appear nowhere decorative | accent is neither locked hue; the register and the gate panel are explicitly excluded in §1.3 |
| §1 | §9.1 — zero raw values | three hex values inside the token block, which is where §9.1 puts them |
| §2 | §9.6 / §9.7 — container model, and the gap legible at row level | §2.3 and §2.4 each state the gap's encoding; check it on an unscored column, which is where it is hardest |
| §2 | §2.1 tell 2 — a card grid for a comparable set | both variants keep the carousel and the shared baseline; neither introduces a grid |
| §3 | §9.10 / §9.11 — greyscale, and arm-before-fire | greyscale the merged bar and confirm the gated zone is still the only light region; re-run the arm path on all three gated acts |
| §3 | §9.15 — checked at 390, 768, 1280, 1920 and *looked at* | the bar is two zones on one row; at 390 it must stack, and the gated zone must stay visibly the inverted one when it does |
| all | §9.17 — `typecheck`, `lint`, `test` green, `/` returns 200 | `lint` chains `design:check`; §1.4 adds `check-contrast.mjs` to the same chain |

`test/brief.test.ts` asserts that every backticked repo path in a `design/*.md` either exists or the
brief carries a status marker in its first thirty lines. This one carries **NOT WIRED**, because it
names five files that do not exist yet. **When a layer lands, remove its files from that list; when
all three have landed, this brief is superseded — fold what survives into `design/board-brief.md`
§1b and mark this one SUPERSEDED rather than leaving two live specs in `design/`.**

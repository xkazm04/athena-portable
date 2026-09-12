# pass 3 — `/v/dials` design brief

> **REVIEWED OUT (2026-09).** This file is the brief for the `dials` direction. `/v/dials` has no
> route and `components/dials/` no tree; neither does `/v/scale`, the direction §1 surveys beside
> it. `app/v/` holds `board/` and the index. Its survey table is measured over four directions —
> `prime`, `law`, `scale`, `token` — whose stylesheets are no longer in this working tree, so the
> counts in §1 cannot be reproduced here; they are in git history. Kept as the record of the
> four-dials method and of what pass 3 measured, **not as a specification to build against.** The
> binding brief is `design/board-brief.md`.

Method: `google-labs-code/stitch-skills` › `stitch-utilities/taste-design`, as captured and amended in
`examples/tidycrm/DESIGN.md`. The method's generative mechanism is **four dials** — Creativity,
Density, Variance, Motion, 1–10 — used not to describe a direction after the fact but to *find* one:
survey which corners of the four-dimensional space the existing directions already occupy, then
deliberately take an empty corner.

This file is written **before** any component was authored. That ordering is the method's only real
gate and it is the reason this direction is what it is.

---

## 1. Survey — which corners hirelane already occupies

Four directions already exist in this app. I read every scoped CSS file, counted their motion
surface mechanically, and rendered each one in headless Chrome at 1280 to see the actual pixels
rather than infer from markup.

Mechanical counts (`components/<slug>/*.css` and `*.tsx`):

| | `@keyframes` | `motion.*` | `transition=` | **`stiffness`** | `container-type` | `@container` | `@media (width)` |
|---|---|---|---|---|---|---|---|
| `prime` | 0 | 16 | 2 | 1 | 0 | 0 | 1 |
| `law` | 1 | 16 | 9 | **0** | 1 | 12 | 0 |
| `scale` | 1 | 10 | 5 | **0** | 4 | 5 | 0 |
| `token` | 0 | 16 | 8 | **0** | 4 | 9 | 0 |

Read from the rendered pixels:

- **`law`** — warm cream paper, ink-black rounded boxes with a drawn/offset depth, a hand face
  (Shantell Sans) for a drawn underline, Martian Mono for labels. Opens with a full-width editorial
  headline; the board is below the fold. Depth is *drawn*, not lit.
- **`scale`** — near-white, Instrument Serif display with a lime-green underline, pill filter chips
  (`LANES` / `DENSITY` / `SHOW`), white cards with 1px borders, small pie glyphs for score. Opens
  with a headline + a prose paragraph; the board starts around 570px down. Depth is a hairline.
- **`token`** — warm light grey, Archivo grotesque set very heavy, per-state hue encoding
  (green / purple / teal), unit-person glyph rows, hairline rules, mono chips. Opens with a headline
  and a stats block; the board starts around 650px down. Depth is a hairline.
- **`prime`** — the surviving round-1 baseline. Neutral, conventional, viewport media queries.

**The three pass-3 directions are the same corner.** All three are light-canvas, flat-depth
(hairline / drawn ink / border), and all three lead with a tall editorial hero that pushes the actual
lane×column board below the fold. Estimated dials:

| Direction | Creativity | Density | Variance | Motion |
|---|---|---|---|---|
| `prime` | 3 | 6 | 2 | 2 |
| `law` | 8 | 5 | 7 | 3 |
| `scale` | 6 | 6 | 5 | 3 |
| `token` | 7 | 8 | 5 | 2 |

### What is empty

1. **Motion ≥ 4 is entirely empty.** The whole app ships **two `@keyframes`**. More decisively,
   `stiffness` appears **zero** times in `law`, `scale` and `token` — every transition in all three
   is a duration tween. Nobody uses `useSpring`, `useMotionValue`, `useTransform`, `variants` with
   `staggerChildren`, or drag. Every animation in the app interpolates between two fixed states on a
   timer; **no value in this app tracks a gesture.** The one motion vocabulary `taste-design`
   actually supplies (spring physics) is unused by every direction that exists.
2. **Depth from layered light is empty.** Nothing builds depth from bloom, glass, grain, SVG filter,
   `mask-image` or `mix-blend-mode`. `law` is zero-blur drawn ink, `token` is misregistration and
   chamfer, `scale` is the only one with soft shadow and it uses `blur(3px)` twice.
3. **A dark canvas is empty.** All three grounds are pale: `#fdf8ee`, `#e9eef0`, `#E4E3DE`. No
   direction ships an inverted *default* surface, and none ships a saturated palette.
4. **Density ≥ 9 is empty**, and connected to a stated defect: all three siblings spend the first
   fold on prose. The owner's complaint about Waterline was *"does not provide good overview over
   what is inside."*

### Three mechanics that are specifically unoccupied

The survey turned up three places where all three siblings converged on the same solution, which
makes a fourth answer available rather than merely different:

- **The gate.** `law` is arm→fire (`useGate`, 6s TTL). `scale` is press-and-hold 1200ms. `token` is
  a 6-second departure window you may cancel. All three are *timers*. A fourth honest mechanic has
  to be structurally different, not a fourth duration.
- **The Interview calendar.** All three flatten 36 slots to a **list grouped by interviewer**. None
  puts time-of-day on an axis, none uses `slot.minutes` as a length, none shows two interviewers'
  availability against each other, and none shows where the week is congested.
- **The Offer comparison.** All three render a **static N-column score matrix**. The weighted total
  is computed once, on the server's fixed weights, and shown. Nobody lets the weights move.

## 2a. The mechanic this direction is built on

The slug is `dials`, the method is dials, and the measured gap is gesture-driven motion. Those three
coincide, so the direction takes the coincidence literally: **the dial is the interaction primitive
of this surface, and a dial is a value that tracks a gesture.**

1. **The rubric weight dials — the offer comparison.** `lib/seed-content.ts` gives each criterion a
   weight of 1–3, summing to 12 for both roles, and `overallScore()` is a weighted mean over them.
   Every other direction treats those weights as fixed and prints the answer. Here each criterion
   carries a dial, and turning it **re-ranks the finalists live**: the bars re-length and the
   candidates physically re-order under spring layout as the weight moves. This is the honest form
   of "compare 2–4 candidates and decide": the decision is *what this role actually needs*, and the
   dial makes the reviewer commit to that in the open before it names a winner.
   The seeded weights are the datum and are always marked; leaving them is a visible act.
2. **The commit dial — the gate.** A gated action is fired by **turning a dial to its stop**, by
   drag or by arrow keys. Release before the stop and it springs back to zero. It is not a timer:
   it cannot be waited out and it cannot be fired by one stray click, and unlike a press-and-hold
   it is fully keyboard-operable as an ARIA slider. It is the only place spring *return* is used.
3. **The week field — the Interview calendar.** A real grid: the seven days of the seeded fortnight
   across, hours of the day down, each slot a block whose **height is `slot.minutes`** and whose
   column is its day. Six interviewers are legible against each other at once, and the congested
   and empty parts of the week are visible as shape. `proposeSlots` holds three; the three that get
   held light up in place rather than being listed somewhere else.

## 2. Dials for `/v/dials`

| Creativity | Density | Variance | Motion |
|---|---|---|---|
| **9** | **9** | **8** | **10** |

Chosen as the antipode of the occupied cluster, and each setting is load-bearing rather than
decorative, because `taste-design` binds rules to dial thresholds:

- **Motion 10** takes the one empty axis and spends it on the method's own §8 spec — spring
  `stiffness: 100, damping: 20`, stagger at `calc(var(--index) * 100ms)`, `transform` and `opacity`
  only. This is the hint in the assignment and the survey confirms it independently.
- **Density 9** triggers two of the method's threshold rules: at Density > 7 **all numbers are
  monospace and tabular** (§3), and at Density > 7 **cards are replaced by dividers, negative space
  or glass planes** (§4). The first is adopted whole — every figure on the surface is tabular mono.
  The second is where the method and the owner's product disagree, and §2b below records why the
  owner wins: the density rule is satisfied with **negative space and a drawn plane** rather than
  glass, because `kp` builds depth by drawing and never by diffusing. Density 9 also means **no
  editorial hero**: the board is the entry surface, all four columns and both roles visible without
  scrolling, which is the direct answer to "no good overview".
- **Variance 8** triggers §5: **centred entry layouts are banned above Variance 4**, and §6's ban on
  three-equal-card rows and on vertically adjacent sections sharing a column structure.
- **Creativity 9** is the budget for bespoke inline SVG: the lane rails, the score arc, the calendar
  field and the comparison plot are all drawn, not composed from library icons.

## 2b. What I took from `kiro\kp`, and the decision it reversed

Three earlier agents studied `kp` and took its palette and drawn depth, its interaction laws, and
its per-role aging SLAs. **All three read the same register.** `kp` contains three: *Studio Light*
(the workspace — Fraunces, two-layer soft ambient shadow, calm), *Spark Dark* (the same workspace
inverted — Bricolage display, hard zero-blur offset shadows, panels become stickers, back-out
overshoot easing) and *Spark* (the fixed marketing layer). What the earlier agents took is all
Studio Light. **The dark register is a different design system in the same repo and nobody has
taken it.**

That reverses this brief's original depth decision. The survey says layered light — bloom, glass,
grain — is hirelane's unoccupied depth corner, and it is. But `kp` contains, across its entire
`app/` tree: **no `<filter>`, no `feTurbulence`, no `feGaussianBlur`, no `<mask>`, no `<pattern>`,
no noise or grain of any kind, and exactly one gradient.** Depth in the owner's own product is
*drawn* — an outline plus a hard offset — never diffused. The owner also rejected Waterline for
exactly the failure a glass direction risks: *"3D looked good on first sight, but does not provide
good overview over what is inside."*

So this direction takes the **dark canvas** (unoccupied in hirelane) with **`kp`'s drawn depth
grammar** (validated by the owner's own taste), and declines the glass. `law` already took drawn
depth, but took it on cream paper from Studio Light; Spark Dark's specific grammar — inverted
ground, `5px 5px 0` ink at 85% opacity, a 2px drawn outline riding the shadow class itself, dashed
rules, rest rotation that straightens under the cursor, and a back-out easing where the light
register has none — is untouched. The one concession to light is the ground itself: **one** radial
field behind the board, because `kp` allows itself exactly one gradient and this is where it earns
its place. *The ground is lit; every object on it is drawn.*

What else this direction takes from `kp`, that the earlier three left:

- **The capped stagger ladder.** `40 / 90 / 140 / 190 / 240ms`, then a hard ceiling of `280ms` for
  every child from the sixth on. This **corrects `taste-design`'s motion spec**, whose stagger is
  `calc(var(--index) * 100ms)` with no cap — on a 40-applicant lane that is a four-second entrance.
  The method's own §8 says "capped so a long list does not take seconds to arrive" and then supplies
  a formula that does exactly that. `kp` has the cap; the skill does not.
- **The ambient-loop guardrails**, verbatim from `motionPresets.ts`: translate ≤ 3px, opacity delta
  ≤ 0.08, period 3–6s, *"a screenshot 3s apart should look near-identical"*, and **never loop a
  transform that implies progress where no work is happening**. That last one is the same rule this
  repo needs for a different reason: Athena is not connected, so nothing may read as her working.
- **Reduced motion is less motion, not no feedback.** `kp` slows a spinner to 3s rather than
  freezing it, because a frozen spinner reads as a hung app. And the gate is **the transition, never
  the `initial` prop and never the markup** — branching markup on a media query is what took `kp`'s
  hero down with a hydration mismatch.
- **The peer rail** (`DecisionsPeerViz`): peers as quiet ticks, the subject as an accent marker, the
  field's best as an ink tick, on one track. *"Every mark encodes a real candidate — no decorative
  meters."* And `RankChips` discloses its own incompleteness with a pill counting the unscored.
- **The calendar's suggested-vs-confirmed distinction.** A chip whose time is a guess is drawn with
  a dashed edge; one a candidate confirmed is solid. In `kp` this was a fixed bug: the two used to
  be pixel-identical. Here it maps exactly onto `slots.status`: `open` / `proposed` / `booked`.
- **"A dead control reads as broken; a control that visibly shakes its head reads as a rule."**
  A refused act animates its refusal instead of rendering `disabled`.
- **The editorial rule**: *a fact that carries no decision does not get pixels.*

## 3. Direction — "The Dark Room"

An inverted canvas — deep slate-indigo, never `#000000` — with a single warm field lit behind the
board and every object on it drawn: a 2px outline and a hard zero-blur offset, so a candidate reads
as a sticker laid on a lit table rather than a div with a border. The board fills the surface at
load — two roles, four columns, forty applicants, no editorial hero — and every change of state is
a spring, so the surface reads as a physical field being steered rather than a table being
re-rendered.

The argument this direction makes against its three siblings: **a pipeline is a thing in motion, and
none of the existing directions can show motion.** A candidate moving from Submitted to Screened is
the app's central event; here that event is a body travelling between columns under spring physics
with its score settling behind it, not a list that re-orders between two paints.

### Typography

Faces already claimed in this app: Bricolage Grotesque, Gabarito, Martian Mono, Shantell Sans,
Instrument Serif, Inter Tight, JetBrains Mono, Archivo, Azeret Mono, Fraunces, IBM Plex Sans/Mono.

| Role | Face |
|---|---|
| Display | Sora (variable) |
| Body / UI | Manrope (variable) |
| Figures | Roboto Mono (tabular) |

`taste-design`'s **`Inter` ban is adopted** (note: `/v/scale` uses Inter Tight, so the ban is already
broken in this app; I am not compounding it). Its **blanket serif ban is rejected** on the round-2
precedent — the owner kept a serif-led direction — but is moot here, since a dark luminous field
wants a grotesque, not a didone.

Type floor is 13px absolute, 15px for any control, per the wave facts. At Density 9 the temptation is
to buy density with smaller type; the `kp` interaction law forbids exactly that, so density is bought
with **negative space and plane separation** instead.

### Colour

One accent, per §2. Never `#000000` — the canvas bottoms out at an indigo near-black. The
"AI purple/blue neon" aesthetic is banned; the bloom is a warm light source, not a glow effect.

Three colours are reserved for governance and may not be spent on anything else:

| Role | Meaning |
|---|---|
| auto | Reversible. `score_against_rubric`, `add_note`, `move_stage`, `propose_slots`. |
| gated | Irreversible. `decide_stage`, `send_scheduling_email`, `send_rejection`. |
| destructive | The fired state of a gated action. |

That mapping is read off `app/actions.ts`, not invented: the three GATED actions are exactly the
three that store no undo payload, because they reach a person.

### Motion contract (the method's §8, adopted whole)

- Spring `stiffness: 100, damping: 20` as the default interactive feel (damping ratio 1.0 — settles
  without overshoot). No linear easing anywhere except a genuinely continuous loop.
- **Bounce is a register, not a texture.** Following `kp`, the calm springs are the default and
  overshoot is reserved for the two moments that should feel like a physical landing: a score
  stamping onto a card, and a dial hitting its stop.
- List and grid mounts stagger at `calc(var(--dl-index) * 100ms)` per the method — **capped by
  `kp`'s ladder at 280ms** from the sixth child on. Uncapped, the method's own formula gives a
  40-applicant lane a four-second entrance, which contradicts the sentence the method wrote next to
  it. This is the one place the reference is internally inconsistent and it had to be corrected
  against the owner's product.
- **`transform` and `opacity` only.** Never `top` / `left` / `width` / `height`.
- A perpetual micro-loop is permitted **only** on a control while a real server action is in flight,
  and on nothing else. Nothing may imply Athena is working: she is not connected to this app. Any
  ambient motion obeys `kp`'s guardrail — translate ≤ 3px, opacity delta ≤ 0.08, period 3–6s.
- Everything degrades under `prefers-reduced-motion` via `useReducedMotion`. The gate is **the
  transition**, never the `initial` prop and never the markup, so a reduced-motion visitor lands on
  the end state rather than getting a different tree than the server wrote.
- **Reduced motion is less motion, not no feedback**: a control with real work in flight keeps a
  slowed signal rather than freezing, because a frozen indicator reads as a hung app.

### Scales — what already exists

`app/globals.css` imports `design/hl-scales.css` onto `:root`, which supplies `--hl-space-1..10`,
`--hl-dur-1..6`, four `--hl-ease-*` curves, `--hl-elev-0..4`, `--hl-radius-*`, `--hl-rule-*`,
`--hl-track-*`, `--hl-leading-*` and `--hl-measure-*`. This direction consumes that layer rather
than re-declaring it, and adds only what is its own under `--dl-`. Worth recording for the report:
**that layer is not `taste-design`'s.** The method supplies no spacing scale and no type scale at
all; hirelane has one because a previous wave wrote it.

### Layout and responsive

- Container queries only. `@media (width…)` is banned in this direction's CSS — `body` measures
  ~800px inside a 1280 viewport and ~288px inside 768 because of the CopilotKit sidebar, so `vw`
  and viewport media queries lie. Sizing is on `cqi` and `@container`.
- `container-type` is declared on **inner regions only, never on the wrapper**, because
  `container-type` makes an element a containing block for `position: fixed` descendants and would
  trap the overlay.
- Full height uses `100dvh`, never `100vh`. No `h-screen`.
- Wide content scrolls inside its own region; the page body never scrolls horizontally.
- All custom properties are prefixed `--dl-`. Tailwind v4 owns `--ease-*`, `--text-*`, `--radius-*`,
  `--shadow-*`, `--leading-*`, `--tracking-*` on `:root`; an unprefixed token would silently rewrite
  every Tailwind utility inside the subtree.

## 4. The four states, and what differs in each

One page. No route-level navigation. Every state change is an animated transition on one surface;
the deeper states open as overlays over the board, never as another page.

| Column | Stage in `lib/constants.ts` | What the surface does here |
|---|---|---|
| Submitted | `applied` | Pre-evaluation of fit: `scoreAgainstRubric` writes a real scorecard, and the score arrives by spring. AUTO. |
| Screened | `screening` | The a→b transition itself — `moveStage(id,'screening')` — animated as a body crossing the rail with its evidence decomposing behind it. AUTO. |
| Interview | `interview` | A drawn calendar field over the 36 real seeded slots; `proposeSlots` holds three (AUTO), `sendSchedulingEmail` books one (GATED, two-step arm-then-fire). |
| Offer | `offer` | 2–4 real finalists side by side on one baseline, compared on the shared rubric; the user picks one; `decideStage` offers the winner and `sendRejection` closes the others. Both GATED. |

Every number on the surface comes from the seeded SQLite through `lib/`. **Confidence is never a
bare number**: a score is always shown decomposed into the named criteria and weights that produced
it. An **absent score is not a verdict** — an unscored applicant renders as unscored, never as zero.

## 5. Banned (the method's §9 list, judged)

Adopted: no emojis; no `Inter`; no default serif stacks; no pure `#000000`; no neon outer glows; no
gradient text on large headers; no custom cursors; no overlapping content layers; no three-equal-card
rows; no centred entry at Variance > 4; no filler chrome ("scroll to explore", bouncing chevrons); no
AI copy clichés ("Elevate", "Seamless", "Unleash", "Next-Gen"); no `LABEL // YEAR`; no circular
spinners; no `h-screen`; no fabricated data or invented metrics; no mock arrays inlined in a
component.

Rejected: the blanket **serif-in-software ban** (falsified in round 2 when the owner kept a serif-led
direction; the skill's own escape hatch permitting real display serifs is the correct reading).

Added for this repo: no claim that Athena did something — she is not connected; capabilities are
described in the present tense of the manifest. No governance colour spent on decoration.

## 6. What `taste-design` does not supply

Recorded here before building so the report cannot be written with hindsight:

- It has **no spacing scale**. §4 and §6 talk about rhythm and negative space and give no numbers.
  Every spacing value in this direction is mine.
- It has **no type scale**. §3 gives rules *about* type (tracking tightens as size grows, body caps
  at 65ch) but no ramp. The ramp is mine.
- It has **no colour system** — one accent, no `#000`, no neon, one neutral family. Those are four
  constraints, not a palette. Every hex is mine.
- It **assumes one design system per project** and has no concept of an app carrying four arguable
  directions at once, which is exactly what `/v` is.
- Its §5 assumes a marketing hero with photographic content, which does not exist here.
- Motion is the **one** place it supplies real values, and that is the whole reason this direction
  exists.

---

## 7. Appendix — what rendering it caught that reading it did not

Written after the build, kept here because it is the evidence for the one substitution this method
needs. `taste-design` has no verification step at all: it prescribes an output format and stops.
The rendering loop borrowed from `stitch-loop`'s §7 substitution — author the component, then drive
headless Chrome over CDP and read the screenshots back — is what produced these, and none of them
were visible in the markup:

1. **The finalist name and its summary line were inline spans** and printed on top of each other.
   A direct violation of the method's own "no overlapping content layers" ban, invisible in the
   JSX, obvious in the first screenshot of the Offer panel.
2. **Slots at the same hour stacked on top of each other** in the week field. The seeded fortnight
   has three interviewers free at 11:00 on 14 September; drawn without interval partitioning, a
   calendar silently hides two thirds of its own data. Fixed by assigning each slot a sub-column.
3. **A 30-minute block was 14px tall**, so the interviewer's name was clipped to nothing. The type
   floor is 13px, so the block had to grow or the second line had to go; the second line went, and
   the full reading moved to the accessible name.
4. **Two rapid presses of the arrow key on the commit dial advanced it one step, not two**, because
   each press read the spring's in-flight position rather than its target. Only findable by driving
   the control: it is correct on a single press and wrong on a double, and no amount of reading the
   component would have shown it.
5. **A dark zero-blur drop shadow barely reads on a dark ground.** The depth ladder was written from
   `kp`'s Spark Dark values and looked flat in the first render; the fix was to brighten the drawn
   outline, which is what actually carries the depth in an inverted register, and to rest every
   object one rung deeper.

Items 2 and 4 are domain bugs, not styling bugs, and both would have shipped.

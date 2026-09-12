# Variant brief — `law` (the Bay)

> **REVIEWED OUT (2026-09).** This file is the brief for the `law` direction. Its route `/v/law`
> and its component tree `components/law/` were removed in the board rework, as were the
> `components/shared/` hooks it builds on (`useAction.ts`, `useVariantAction.ts`); none of them
> exists in this working tree. It is also written against `./pass3-law-amendments.md`, which was
> never folded into `DESIGN-LAW.md` — the law in this directory is the un-amended text. Kept as the
> brief-before-code record `DESIGN-LAW.md` §2.2 and §6 require, **not as a specification to build
> against.** The binding brief is `design/board-brief.md`.

Produced under `../DESIGN-LAW.md` as amended by `./pass3-law-amendments.md`.
§6 forbids generating before the seven fields are answered; §2.2 forbids code before the diff gate
below is written. **Both were written before any file in `components/law/` existed.**

Route: `/v/law` — one route, one page (amendment A4). Components: `components/law/`.

---

## 1. Domain reading (§6, field 1)

Two open roles, forty applications between them (24 Backend Engineer / Platform, 16 Product
Designer / Product). Five weighted criteria per role. `lib/scoring.ts` scores each criterion 0–4 by
counting **distinct sentences that contain one of the criterion's keywords** and it keeps those
sentences: `CriterionScore.evidence` is verbatim applicant prose. There is no other input — no
school, no date, no proxy. Every number in this app traces to a sentence a person wrote about their
own work.

`gapOf()` names the one criterion an otherwise-strong application carries no evidence for. Six
applicants per role are seeded to be exactly that shape. **The gap is the product.** An interface
that averages five scores into one number has deleted the reason to open the app.

Only nine of the forty have a filed scorecard, and all nine are already at interview, offer or
rejected. Everyone in Submitted and Screened is unscored. That is not a data gap, it is the demo:
the work the agent is dispatched to do is exactly the work that has not been done.

The stakes are asymmetric and the schema says so. `move_stage` and `score_against_rubric` and
`propose_slots` each write an undo payload. `decide_stage`, `send_rejection` and
`send_scheduling_email` write none, because there is nothing to store: those three reach a person.
**Reversibility is what buys the AUTO class, not harmlessness.**

Athena is not onboarded. The actions are real; the model that would choose to call them is not
connected. Copy stays in the present tense of registration.

## 2. Audience & tone (§6, field 2)

A hiring manager with no recruiter, working two open roles at once. Their fear is not being slow —
it is sending the wrong irreversible message to a named person, and rejecting someone for a reason
that was never in the file. They want the whole board in front of them at once and they want to be
physically stopped before anything leaves the building.

Tone: **warm, plain, unhurried about reading and very deliberate at the signature.** Confident
enough to make a claim in the headline; honest enough to say what is not connected yet.

## 3. Mood adjective (§6, field 3)

**Handled.** Every applicant is an object someone is physically holding, moving and setting down.

## 4. Layout family (§6, field 4)

**A strip bay: horizontal swimlanes crossed with ordered state columns, on one scrolling canvas,
inside vertically stacked full-bleed bands.**

Five bands, each a full-bleed slab separated by a 3px ink rule, no two adjacent bands sharing a
ground (the kp band rule, §11 below):

| # | Band | Ground | What it is |
|---|---|---|---|
| 0 | Rail | cream | wordmark, the two lane names, the addressability hint |
| 1 | Masthead | cream | headline, sub-line, the honesty line, the capability register as a ladder |
| 2 | **The Bay** | **ink (inverted)** | 2 role lanes × 4 state columns + the closed terminal; strips |
| 3 | **The Instrument** | **varies by state** — cream / stone / steel / amber | the selected state's apparatus |
| 4 | The Record | stone-200 | the activity log: who dispatched what, when, and whether it can be taken back |

The Bay is the page. Lane labels are `position: sticky; inset-inline-start: 0` so they survive the
horizontal scroll; the bay scrolls left/right with `scroll-snap-type: x proximity` on the state
columns, so the same structure holds at 390 and at 1920 and there is no separate mobile layout. The
state ladder above the bay scroll-snaps it to a state when pressed, which is also the manipulation a
voice command performs.

## 5. Motion signature (§6, field 5)

**The strip advances.** One motion, one story, four beats:

1. The dispatched strip **lifts** — its hard ink shadow grows one rung on the drop ladder and its
   1° rest tilt straightens to 0.
2. A **marching dashed rule** runs along the lane underneath it while the work is actually running
   (`strokeDasharray="6 6"`, `strokeDashoffset` looping, `--hl-dur-6` linear). It is the only
   looping motion on the page and it exists only while a server action is in flight.
3. The strip **travels** to its new column on a shared layout id.
4. The score **stamps** — `scale 2.2 → 1, rotate 10° → −6°`, spring `bounce: 0.45`. Taken directly
   from kp, where the stamp is the verdict language of the whole product.

**And the beat that carries the law:** the marching rule **stops dead at the gate post** before the
Offer column and before any send. It does not slow down or fade; it halts against a drawn stop
plate and stays halted until a human arms and fires. That is `HumanLoopArt`'s thesis borrowed
wholesale — an illustration where the token sailed through would be arguing the opposite claim —
and here it is not an illustration, it is the actual state of the actual pipeline.

Everything else on the page is feedback: press-down on buttons (`--hl-dur-1`), rest-tilt straighten
on hover (`--hl-dur-2`), band ground cross-fade on state change (`--hl-dur-3`, `--hl-ease-entrance`),
numbers settling (`--hl-dur-5`). Nothing fades up 20px on mount.

`prefers-reduced-motion`: `useReducedMotion()` gates the **transition**, never the markup and never
`initial` — the still version is a stopped animation, not a missing element, and every reduced path
resolves to the **end** state at `duration: 0`. The marching rule becomes a static dashed rule; the
stamp appears at rest at −6°; the scan line jumps to its landing slot. (This is kp's rule, learned
there the hard way: dropping server-rendered decorative nodes on the client is a hydration mismatch.)

## 6. Source direction (§6, field 6)

**Structure: the air-traffic-control flight progress strip bay.**
**Material: the owner's own Spark system, from `kiro/kp` — depth drawn, not diffused.**

Naming two sources is deliberate and they answer different questions. The law's §6 asks for one
named tradition; pass 3 asks for both a specific arrangement and a specific finish, and no single
tradition supplies both here.

## 7. Why these sources for this app (§6, field 7)

**Why the strip bay.** In a real control room every aircraft is a physical paper strip in a printed
holder. The strip carries the callsign, the level and the clearance; it lives in a bay of vertical
slots; it is *moved by hand* from slot to slot as the flight progresses; it is annotated in pencil
by whoever currently holds it; and it is **handed off** to the next sector, at which point it is no
longer yours. That is the hirelane schema with the nouns changed — an applicant id, a stage, a
scorecard, a bay of ordered states, notes added by whoever is reading, and a handoff. Two properties
make it the right source rather than a costume:

1. **A strip is a homogeneous object in a bay of peers**, which is exactly what §3's container gate
   demands and what a card grid destroys. The bay arrangement and the row atom are not in tension;
   the bay *is* an arrangement of rows.
2. **Control rooms already draw the distinction this app exists to make.** A pencil annotation on a
   strip is provisional and rubbed out all day. A clearance *issued on the frequency* cannot be
   unsaid — the only remedy is a second transmission correcting it, which is a new act with its own
   record. Provisional mark versus issued clearance is `move_stage` versus `decide_stage`, and the
   tradition gives it to us as **physical handling**, not as a coloured badge. §7's greyscale test
   passes because a stop plate is a shape.

**Why the Spark material.** The owner has rejected eleven directions on visual grounds and has
pointed at one artifact as the standard: his own hiring product. Reading it, the standard is
specific and it is almost entirely about **material**, not layout:

- Depth is a **3px ink outline plus a zero-blur ink offset shadow**, on a ladder from 2px on chips
  to 10px on modals — never a soft blur, never a gradient, never glass. I grepped his landing tree:
  one `linear-gradient` in the entire thing, zero `backdrop-filter`, zero SVG gradients, masks or
  filters. His design doc states it: *"depth is drawn, not diffused."*
- The press is physical: an element **travels exactly into its own shrinking shadow** on hover
  (`translate 2px` + shadow `5px → 3px`). Two properties, and it is unmistakably a material.
- The palette is **warm and semantic and tiny** — one cream ground, one blue-black ink, four earth
  pigments with fixed jobs. The highest-leverage single substitution is that secondary text is
  `#42606f` steel, a blue-green, not a grey; and the neutral border ramp is warmed to `#e6ddcc`, so
  hairlines read as drawn lines rather than as UI chrome.
- **The type is big and heavy**: 48–72px display at weight 800, 17–20px body at 700, and a floor
  below which nothing renders (14px in his system). Only two weights in the entire UI.
- A genuine **handwriting face** carries hints and margin notes, always rotated ±1°, always
  lowercase, never with a terminal period. It is the single strongest "a person made this" signal on
  his page and it is nearly free.
- Cards sit **1–1.5° off-axis at rest** and straighten on hover.
- **No two adjacent full-bleed bands share a ground**, and each band uses a *different container
  model* inside — 3-up, 9-up, two-column editorial, one framed stage. His own note says a band was
  recoloured precisely because a cream section under a cream section meant the boundary did not read
  as a boundary.

Every one of those transfers to a strip bay without modification, and three of them are load-bearing
for this specific domain: a drawn ink outline is what makes a strip read as a physical object you
could pick up; a hard offset shadow is the only depth model where "lifted" is legible at a glance in
a dense grid; and the handwriting note is where an addressable name can be spoken to the reader
(`say "advance Ada Abbott"`) without becoming another badge.

**What I deliberately did not take.** His three faces are kept as a family resemblance, but the
pairing is changed: I add a technical mono for figures and identifiers, which his landing does not
need and this app cannot do without (§1.2's tabular-figure rule — a score column that jitters
between rows is a data-integrity signal). I also do not take his coral-as-CTA convention: here coral
is spent entirely on the gate, because in this app the irreversible act is the thing worth the
loudest colour in the system. And I do not take his raster mascot or any raster asset.

---

## 8. Colour lock (§4.2) — locked before implementation

**Ground / ink pair**

| Token | Value | Sole use |
|---|---|---|
| `--law-cream` | `#fdf8ee` | the page ground |
| `--law-ink` | `#17202a` | all text, all outlines, all drop shadows |

**Five hue-bearing tokens**

| Token | Value | Sole use |
|---|---|---|
| `--law-coral` | `#d65a4a` | **GATE ONLY.** An irreversible act that reaches a person: arming, the armed control, the gate post's stop plate, the fired seal. Nothing else, ever. |
| `--law-moss` | `#526b4f` | **AUTO ONLY.** A reversible act: the auto class mark, the undo affordance, the per-criterion leader tick. Nothing else, ever. |
| `--law-steel` | `#42606f` | commentary — all secondary text, the datum axis, lane structure, the Submitted instrument's band ground |
| `--law-amber` | `#caa54c` | evidence — the highlighter stroke behind a matched keyword, the gap bracket, the hand underline, the Offer instrument's band ground |
| `--law-slate` | `#8c8779` | closed — the rejected terminal and anything whose process has ended |

**Reserved tints** (each usable *only* in its parent hue's contexts, never decoratively)

| Token | Value | Sole use |
|---|---|---|
| `--law-coralwash` | `#f7d4ce` | the armed gate's ground. Gate contexts only. |
| `--law-limewash` | `#dce7d0` | an auto action's completed mark. Auto contexts only. |

**Warm neutrals** (not signals; the drawn-line ramp)

`--law-white #ffffff` raised strip · `--law-stone-100 #f1ebdd` · `--law-stone-200 #e6ddcc` the
hairline · `--law-stone-300 #d6cbb4` · `--law-ink-deep #0d1218` drop shadows on the inverted band ·
`--law-scrim rgba(23,32,42,0.45)`.

No new colour may appear in a component file.

## 9. Type (A1, A2)

Four faces through `next/font/google`, loaded in the variant's own layout, variables on the
variant's wrapper. No runtime font, image or script request.

| Role | Face | Job |
|---|---|---|
| Display | **Bricolage Grotesque** (variable, 800) | headline, band heads, state names, stamped scores |
| Body | **Gabarito** (400/500/700) | everything read as prose, all evidence quotations |
| Figures & ids | **Martian Mono** (400/600) | every compared number, every applicant and slot id, capability names |
| Hand | **Shantell Sans** (400) | margin notes and the spoken-name hints, rotated ±1°, lowercase, no terminal period |

Sizes are the amended `--law-text-*` scale: **13px floor**, 17px reading base, fluid display in
`cqi`. Zero `vw`. Display sizes take `--law-leading-tight` and `--law-track-tight`. Compared figures
are Martian Mono with `font-variant-numeric: tabular-nums`.

## 10. Depth (drawn, not diffused)

`--hl-elev-*` is not used. A drop ladder in ink with zero blur replaces it:

```
--law-drop-1  2px 2px 0 var(--law-ink)   chips, class marks, the gap bracket
--law-drop-2  3px 3px 0 var(--law-ink)   strips at rest, slot chips, stamps
--law-drop-3  4px 4px 0 var(--law-ink)   state column heads, the register ladder
--law-drop-4  5px 5px 0 var(--law-ink)   primary controls
--law-drop-5  6px 6px 0 var(--law-ink)   the lifted strip, the instrument frame
--law-drop-6  8px 8px 0 var(--law-ink)   the armed gate
```

Outlines: `3px` on every object that can be picked up, `2px` on marks, `1px` warm `--law-stone-200`
hairline only where a rule separates rather than encloses. Radius ladder `12 / 16 / 24 / full`.
Rest tilt `−1.5°…1.5°`, assigned per index so no two neighbouring strips match, straightening to 0
on hover and focus. Press-down: `translate(2px, 2px)` with the shadow shrinking by exactly 2px.

## 11. The four states and their agent behaviours

The pipeline's four live states each get their own instrument in band 3, with their own ground,
their own container model, and their own dispatched capability. This is the pass-3 spec.

| State | Ground | The agent behaviour | Container model | Live actions |
|---|---|---|---|---|
| **a) Submitted** | steel | **The fit read.** Pre-evaluates fit into the role area: five criteria drawn against a datum with weight as tick thickness, the gap marked with an open bracket, and the matched sentences quoted verbatim with the matching keyword under an amber highlighter stroke. Runs across the whole lane on a stagger and reorders the cell by fit. | criterion axis set + attributed prose quotations | `score_against_rubric` (AUTO), singly and batched |
| **b) Screened** | stone-100 | **The advance** — the a→b transition, scored. A two-detent track: detent one files the scorecard, detent two advances the strip. The strip travels between columns on a shared layout id and the score stamps on when it lands. | two-detent track + the strip itself | `score_against_rubric` then `move_stage(screening)` (both AUTO, both undoable) |
| **c) Interview** | moss-free steel-dark | **The calendar.** Opens the real slot calendar, sweeps a drawn scan line across it, and lands on the first open slot by start time. Then holds three. Sending the time is where the lane's marching rule stops at the gate post. | interviewer × day slot grid, time-ordered | `propose_slots` (AUTO), then `send_scheduling_email` (**GATED**) |
| **d) Offer** | amber | **The comparison.** Two to four candidates side by side: criteria as rows, candidates as columns, every cell a bar against one shared datum so a row is a real comparison, per-criterion leader ticked, weighted overall in tabular mono. The user picks the winner. One armed press then sends every result. | aligned comparison matrix | `decide_stage(offer)` for the winner + `send_rejection(template)` for each other (**all GATED, one arming**) |

Band 3's ground for Interview is a dark steel `#2f4652`, not moss — moss is AUTO-only and may not be
spent as a decorative ground (§4.2, §9.12).

**The gate, operated (§5 axis 7, §7.2–7.3).** Arming is a physical two-act: press once and the
control **opens** — its ground turns coralwash, its drop shadow steps to `--law-drop-6`, a drawn
stop plate slides aside, and the copy names every person the act reaches, what will be sent, and
what cannot be taken back. Press the now-exposed plate to fire. `useGate()` from
`components/shared/useAction.ts` disarms it after six seconds. There is no `confirm()`.

## 12. Addressable names (A8 / §12)

Everything a voice could aim at carries a visible, speakable name, and the same string is what the
readable or the action parameter uses:

- Lanes: **`Platform`**, **`Product`** (the `role.team` values, verbatim from the DB).
- States: **`Applied`**, **`Screening`**, **`Interview`**, **`Offer`**, **`Rejected`** — the
  `STAGE_LABEL` strings, verbatim. Pass 3 describes the four live states as
  *Submitted / Screened / Interview / Offer*; those are the owner's names for the behaviours, and
  §4.1's exact-string rule wins for the labels on screen, because the label is also the value
  `move_stage` and `decide_stage` take as an enum. Naming the column `Submitted` while the action
  takes `applied` is precisely the drift §4.1 exists to prevent. The four behaviours are built as
  specified; only the words on the column heads come from the enum.
- Strips: the applicant's name, with the `app1_0NN` id in mono beside it.
- Controls: `read`, `read the lane`, `advance`, `find a slot`, `send the time`, `compare`,
  `send the results`, `undo`.

Hand notes in the margin say the sentence out loud — `say "advance Ada Abbott"` — lowercase,
rotated, no terminal period.

## 13. Icon inventory (§4.3) — locked before implementation

**Bespoke inline SVG, drawn for this app.** The lane rule with its marching dashes; the gate post
and its stop plate; the strip's clipped corner; the criterion datum axis with weight-thickened
ticks; the deviation bar; the gap bracket; the amber highlighter stroke (a wobbling path behind a
matched keyword); the hand underline beneath the headline emphasis; the score stamp ring; the
calendar scan line with its chevron head; the fired seal; the wordmark (an ink rounded badge holding
a drawn lane and one coral decision dot, painting `var()` and never a literal, so it themes for
free — kp's rule).

**`lucide-react`, utility only:** `ChevronLeft`, `ChevronRight`, `X`, `Undo2`. Nothing else, and no
lucide glyph stands in for a domain concept.

---

## 14. Diff gate (§2.2) — written before a single component file existed

> **Generic answer.** A white page, `bg-slate-50`. Inter throughout. A sticky top bar with the app
> name on the left and an "Ask AI" button on the right. Under it, a kanban board: five columns,
> `bg-white rounded-xl border border-slate-200 shadow-sm`, each headed "Applied 11" with a grey
> count pill. Inside each column, a vertical stack of `rounded-lg` cards with `gap-4` between them —
> each card an avatar circle of initials, the applicant's name in `font-semibold text-sm`, their
> headline in `text-xs text-slate-500` truncated to one line, a `bg-blue-100 text-blue-700` stage
> pill, a `bg-amber-100 text-amber-700` "Borderline" pill, and a big `3.2` in blue in the corner.
> Five thin grey `h-1.5 rounded-full` progress bars under that. Cards draggable between columns.
> Everything fades up 20px on mount with a 50ms stagger. `border border-slate-200` and `shadow-sm`
> on every surface; uniform `gap-4`; `rounded-xl` on absolutely everything including the page shell.
> A gradient-text headline. Buttons: a blue `Score with AI`, and a red `Reject` behind a
> `window.confirm("Are you sure?")`. A right-hand chat drawer that is the only thing in the app that
> knows an agent exists. Responsive by `md:grid-cols-2 lg:grid-cols-4` media queries.
>
> That is the honest prediction, and it is close to what this app already ships and what got
> rejected. It is also, notably, close to what the *unamended* law would have produced from the
> other direction: a beautiful, austere, correct, monochrome document with 11px caps labels.
>
> **Diff — item by item.**
>
> 1. **The board's atom stops being a card and becomes a strip.** Twenty-four homogeneous
>    applicants with five comparable scalars each is a comparison, and a comparison needs aligned
>    columns and tabular figures (§3). Every applicant in every lane cell is a full-width fixed-height
>    row: name, mono id, years, the weighted score in tabular mono, the gap. The arrangement stays a
>    board — the owner asked for lanes crossed with states and pass 3 overrides §3's blanket ban —
>    but the *atom* obeys the container gate (amendment A3).
> 2. **A second axis the generic answer does not have: the role lane.** Columns alone lose which
>    role someone applied for. Two sticky-labelled horizontal lanes crossed with the ordered states
>    make both facts readable at once, and make "forty applications" a thing you can actually see.
> 3. **The headline number is the gap, not the mean.** The generic answer's big blue `3.2` is the
>    weighted average, which is the one number that hides everything. Here the row's loud mark is the
>    **named missing criterion** with a drawn open bracket, and the mean is a small mono figure next
>    to it. `gapOf()` is the reason to look at all, and §3's rule that the gap must be legible at row
>    level without opening anyone is what forces it onto the strip.
> 4. **Evidence is on the surface, verbatim, with the matched word marked.** The generic answer never
>    shows a single sentence the applicant wrote. Here the fit read quotes them in Gabarito at
>    reading size, clamped to `--law-measure-prose`, with a drawn amber highlighter stroke behind the
>    exact keyword `scoreCriterion` matched — so you can disagree with the machine on the spot.
> 5. **Depth is drawn, not diffused.** No `shadow-sm`, no blur, no glass, no gradient anywhere. 3px
>    ink outlines, a zero-blur ink offset ladder from 2px to 8px, a 1–1.5° rest tilt, and a press
>    that travels into its own shrinking shadow. Taken from the owner's own product, which states the
>    rule outright.
> 6. **The palette is a warm semantic story, not slate-plus-blue.** Cream ground, blue-black ink,
>    and four earth pigments with fixed jobs — and the highest-leverage change of all, secondary text
>    set in steel `#42606f` rather than a grey, with hairlines warmed to `#e6ddcc`.
> 7. **The type gets bigger, not smaller.** The generic answer's `text-sm`/`text-xs` card copy and
>    the unamended law's 11px caps labels are the same defect from opposite directions, and the owner
>    has now rejected it twice. 13px floor, 17px reading base, display to 3.4rem, two weights.
> 8. **No pills.** The generic answer renders every attribute as a bordered badge, so nothing is
>    emphasised. Stage is *position in the bay*. Borderline is a drawn bracket. Class is rule weight
>    and shape. The only badge-shaped things left are the capability class marks, where a badge is
>    the honest form.
> 9. **`window.confirm` becomes a stop plate.** Arm, read who it reaches by name, then press the
>    plate that slid aside. Gated actions are also *spatially* separated: the sends live in the
>    instrument band, never inline in a lane cell, so an irreversible act cannot be fired from the
>    place routine work happens.
> 10. **The gate is drawn into the lane itself.** The generic answer's gating is a red button and a
>     modal. Here the lane carries a marching dashed rule while work runs and it **halts against a
>     stop plate** before anything reaches a person. Greyscale-safe: it is a shape, not a colour.
> 11. **The agent is not the chat drawer.** Delete the CopilotKit rail and this page still knows what
>     Athena will be able to do, what class each capability is in, what is running right now, on
>     which object, and who dispatched it. The eight capabilities are a ladder in the masthead; the
>     provenance is a band of its own.
> 12. **Dispatch has four visible moments, not two** (amendment A5). Idle, working *located on the
>     object*, result settling from the old value, and provenance recorded where the object is. The
>     generic answer's `disabled → toast` is moments one and three only.
> 13. **Motion is one signature.** The strip advances: lift, march, travel, stamp. No uniform
>     fade-up. The only loop on the page is the marching rule, and it exists only while a real server
>     action is in flight.
> 14. **Responsive by container, not by viewport.** `@container` throughout, `container-type:
>     inline-size` on the wrapper, and zero `vw`/`@media (width…)` — because the CopilotKit sidebar
>     makes both of those lie in this repo (amendment A2, re-measured at 800px of app inside a 1280
>     viewport).
> 15. **Everything is speakable.** Lanes, states, strips and controls all carry a visible name, and
>     the hand notes say the command out loud in the margin.

---

## 15. Pre-ship gate (§9 as amended) — to be answered with evidence in the report

System 1–3 · Tells 4–5 (fifteen, plus #16 no type below 13px) · Containers 6–7 ·
Divergence 8–9 (**not applicable: pass 3 builds one direction**) · Gate 10–12 ·
Honesty and craft 13–17 · A2's 18 (no `vw`, no width media queries) · A3's 19 (strips only in lane
cells) · A4's 20 (no `next/link`, no `router.push`) · A5's 21 (four moments named and located) ·
A8's 22 (every addressable name spoken as written).

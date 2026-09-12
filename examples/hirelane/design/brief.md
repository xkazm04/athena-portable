# Hirelane variant briefs

> **REVIEWED OUT (2026-09).** This file is the brief for the `lantern` and `platen` directions,
> which were rejected outright. Neither `components/lantern/` nor `components/platen/` exists in
> this working tree, and neither has a route under `app/v/`; both are in git history. It is kept as
> the brief-before-code record `DESIGN-LAW.md` §2.2 and §6 require, **not as a specification to
> build against.** The binding brief is `design/board-brief.md`.
>
> One part of it is still live and is not history: the shared domain reading below describes
> `lib/scoring.ts`, `gapOf()` and the seeded borderline applicants, which are the code this app
> still runs. Everything from "Variant A — `lantern`" onwards specifies software that is not here.

Produced under `../DESIGN-LAW.md`. §6 forbids generating before these seven fields are answered;
§2.2 forbids code before the diff gate below is written. Both were written before any component
file in `components/lantern/` or `components/platen/` existed.

---

## Shared domain reading (§6, field 1)

Two roles, twenty applicants each. Every applicant carries a `cv_text` and a one-paragraph
`short_answer`. Five weighted criteria per role. `lib/scoring.ts` scores each criterion 0–4 by
counting **distinct sentences that contain one of the criterion's keywords**, and it keeps those
sentences: `CriterionScore.evidence` is verbatim applicant prose. Nothing else is an input — no
schools, no dates, no proxies. That is a deliberate bias mitigation, and it means **every number in
this app can be traced to a sentence a person wrote about their own work.**

`gapOf()` finds the single criterion with zero evidence when the rest of the card is strong. Six
applicants per role are seeded to be exactly this shape. **The gap is the product.** An interface
that averages the five scores into one number has deleted the reason to open the app.

The stakes are asymmetric and the schema says so. `move_stage` writes an undo payload.
`decide_stage`, `send_rejection` and `send_scheduling_email` write none, because there is nothing to
store: those three reach a person. Reversibility is what buys the AUTO class.

Athena is not onboarded. Copy is in the present tense of registration.

---

## Variant A — `lantern`

| Field | Decision |
|---|---|
| Audience & tone | A hiring manager without a recruiter, reading applications after hours. Their fear is rejecting someone for a reason that is not in the file. Formal, unhurried, accountable. |
| Mood adjective | **Deliberative.** |
| Layout family | **Reading spine.** One measure-clamped column, top to bottom: role standard → the cause list (aligned rows) → the open application as a full reading pane → the order bench. No sidebar, no rail, no split. |
| Motion signature | **The lamp warms.** Opening an application blooms a warm radial light field behind the reading pane over `--hl-dur-5`, and the five criterion bars settle to length underneath it. One motion, one place. |
| Source direction | **English law-report typography — the ICLR Weekly Law Reports genre**: high-contrast serif headnote, marginal citation numerals, evidence quoted verbatim and indented without ornament, on warm laid paper under a single desk lamp. |
| Why this source | A law report's entire discipline is that *the finding must be traceable to the passage quoted*, which is precisely what `scoreCriterion` does and what a card-based UI throws away. It also already distinguishes, structurally and not decoratively, between **the record** (amendable, added to, corrected) and **the order** (final, made once). That is AUTO and GATED, and the genre gives it to us as layout rather than as a badge. The marginal numeral gives each evidence quote an attribution to its criterion without a pill. |

### Colour lock (§4.2)

| Token | Value | Sole use |
|---|---|---|
| `--lan-ground` | `#ebe1d3` | page ground (warm laid paper) |
| `--lan-paper` | `#f8f2e7` | raised reading surface |
| `--lan-ink` | `#231a1a` | text |
| `--lan-ink-2` | `#6d5a51` | secondary text |
| `--lan-rule` | `#d7c8b4` | hairlines |
| `--lan-oxblood` | `#7a2230` | structure, brand, headnote rules |
| `--lan-ember` | `#b8451f` | **GATE ONLY** |
| `--lan-moss` | `#3d6b4a` | **AUTO ONLY** |
| `--lan-lamp` | `#ffdca8` | the light field |
| `--lan-gold` | `#a17a2f` | criterion weight marks |

Type: **Instrument Serif** display / **Karla** body / **DM Mono** figures and ids.
Depth: layered light — radial lamp gradient, `--hl-elev-2/3`, an inline-SVG paper-fibre grain.

### Diff gate (§2.2)

> **Generic answer.** A white page. `Inter` throughout, `font-semibold` headings at `text-2xl`
> with `leading-relaxed`. A grid of `rounded-xl` cards, one per applicant, each with an avatar
> circle of initials, the name, a `bg-blue-100 text-blue-700` stage pill, a `bg-amber-100` pill for
> "borderline", and a big blue `3.2` in the corner. Five thin grey progress bars under it. A
> right-hand chat drawer labelled "Ask AI". Slate-50 ground, blue-600 accent, `shadow-sm` and
> `border border-slate-200` on everything, uniform `gap-4`. Every card fades up 20px on mount.
> Buttons: "Score with AI", "Reject" in red, with a `window.confirm`.
>
> **Diff.**
> 1. **Cards become a cause list.** Twenty applicants with five comparable scalars each is a table
>    (§3). Rows, aligned score columns, tabular figures. The card is reserved for the one applicant
>    being read closely — which is what a card is actually for.
> 2. **The average is demoted; the gap is promoted.** The generic answer's headline number is the
>    weighted mean. Here the row's headline is the **named missing criterion** in oxblood small
>    caps, and the mean is a small mono figure beside it. `gapOf()` is the reason to look.
> 3. **Evidence is on the page, not in a tooltip.** Each criterion's matched sentences are quoted
>    verbatim in the serif, indented, with a marginal numeral tying them to the criterion. The
>    generic answer never shows them at all.
> 4. **No pills.** Stage is position on a ruled ladder; borderline is a marginal mark; class is rule
>    weight. `--hl-rule-1/2/3` carries AUTO vs GATED so the greyscale test passes (§9.10).
> 5. **The palette is a colour story, not grey-plus-blue.** Warm laid paper, oxblood, a lamp. Ember
>    and moss are reserved and appear nowhere decorative.
> 6. **`confirm()` becomes a wax seal.** Arm, then press. The seal draws on arm and fills on fire,
>    and the arming copy names the candidate and says what cannot be undone.
> 7. **Motion is one signature, not a uniform fade.** The lamp warms; the bars settle. Nothing else
>    moves on mount.
> 8. **The agent is not a drawer.** The capability register is a ruled section of the page itself,
>    each entry marked with its class by rule weight, in the present tense of registration.

### Icon inventory (§4.3)

Bespoke inline SVG: the wax seal (outline + fill states), the criterion axis with its datum, the gap
mark (an open bracket), the stage ladder rail, the marginal citation bracket, the paper-fibre grain,
the lamp field gradient. `lucide-react`: `ChevronDown`, `X` only.

---

## Variant B — `platen`

| Field | Decision |
|---|---|
| Audience & tone | The same person, in the morning, working at volume. Not reading — comparing. Exacting, impersonal, unsentimental about the process and very careful at the signature. |
| Mood adjective | **Calibrated.** |
| Layout family | **Full-bleed instrument with a fixed specification rail.** Left rail holds the standard being applied (criteria, weights, tolerance). The right runs edge to edge: a dense measurement table, then a full-width inverted specimen block for the selected applicant, then a separate authorisation region. Nothing is centred; nothing is measure-clamped except prose. |
| Motion signature | **The datum sweep.** Writing a scorecard sweeps a vertical datum line left to right across the measurement table over `--hl-dur-5` with `--hl-ease-snap`, and each criterion bar snaps to its measured length as the line crosses it. Mechanical, stepped, no overshoot. |
| Source direction | **A 1960s Swiss metrology calibration certificate** — DIN/ISO test-report typography: specimen identifier, measured values tabulated against declared tolerance as deviations from a datum line, registration marks, and a signature block that is the only part of the document with authority. |
| Why this source | Hirelane measures five declared criteria at declared weights — that *is* a measurement against a specification, and the certificate genre already solved both hard problems. (a) Value-against-tolerance is drawn as deviation from a datum, which renders the **gap** for free: a zero-length bar sitting exactly on the datum is visually louder than a full one. (b) The certificate is worthless without its **signature block** — a physically separate, differently-treated region where a named human takes responsibility. A certificate never mixes measurement with authorisation, and neither does this variant: every GATED action lives in that region and nowhere else. |

### Colour lock (§4.2)

| Token | Value | Sole use |
|---|---|---|
| `--pla-ground` | `#e9e7e0` | page ground (bone) |
| `--pla-panel` | `#f6f5f2` | measurement surfaces |
| `--pla-ink` | `#13161c` | text, inversion ground |
| `--pla-ink-2` | `#5b6270` | secondary text |
| `--pla-rule` | `#c3c1b8` | hairlines |
| `--pla-blueprint` | `#1b3a63` | axes, datum lines, structure |
| `--pla-signal` | `#cc1f22` | **GATE ONLY** |
| `--pla-auto` | `#0b6b52` | **AUTO ONLY** |

Type: **Syne** display / **Archivo** body / **Martian Mono** figures and identifiers.
Depth: **shadowless.** `--hl-elev-0` throughout; depth is rule weight (1/2/3px), full inversion
blocks, and hairline registration marks.

### Diff gate (§2.2)

> **Generic answer.** Identical to `lantern`'s generic answer — that is the point of writing it
> down: with no constraints, both variants converge on the same white card grid with Inter, blue
> pills and a chat drawer. The only likely difference is that this one would be "the dark mode":
> `bg-slate-950`, `text-slate-300`, glowing blue accents, `border-slate-800`, and a kanban board of
> stage columns with draggable cards.
>
> **Diff.**
> 1. **Not dark.** The cold, technical register is achieved on a **bone ground** with blue-black
>    ink, which is where the source tradition actually lives. Darkness is not precision.
> 2. **No kanban.** Stages are five ordered buckets (§3) and stay an ordered rail. Applicants stay a
>    table, edge to edge, with aligned tabular-mono columns.
> 3. **Score becomes deviation.** Every criterion is drawn against a datum line rather than as a
>    left-anchored progress bar, so the **gap sits on the datum** and reads as the loudest mark on
>    the row.
> 4. **Weight is drawn, not written.** A criterion's weight (1–3) is the thickness of its datum
>    tick, so a strong score on a weight-1 criterion cannot masquerade as a strong card.
> 5. **Evidence is a cited record.** `EV-01 · b_dist` in Martian Mono, the sentence in Archivo,
>    tabulated. Not a quotation, not a tooltip — this variant's whole claim is that it is a record.
> 6. **Authorisation is a separate region, not a red button in a row.** Every GATED action is
>    removed from the table and lives only in the inverted signature block. Arming is a mechanical
>    slide; firing is a second, differently-shaped act.
> 7. **Shadowless.** Zero `box-shadow` in the stylesheet, deliberately, so depth has to come from
>    rule weight and inversion — the opposite position from `lantern` on §5 axis 2.
> 8. **Type carries the voice.** Syne's wide, mannered caps against Archivo and a technical mono is
>    a specific voice; Inter is the absence of one.

### Icon inventory (§4.3)

Bespoke inline SVG: the datum axis with weighted ticks, the deviation bar, the gap marker (a hollow
diamond on the datum), the stage rail with detents, registration corner marks, the arming slide
track, the specimen identifier frame. `lucide-react`: `ChevronRight`, `X` only.

---

## Divergence audit (§5) — required before build

| # | Axis | `lantern` | `platen` | Opposite? |
|---|---|---|---|---|
| 1 | Layout family | Measure-clamped reading spine | Full-bleed rail + edge-to-edge table | yes |
| 2 | Depth model | Layered light, gradient, grain, elev-2/3 | Shadowless; rule weight + inversion | yes |
| 3 | Type voice | High-contrast serif display, humanist grotesque body | Mannered wide grotesque display, technical mono figures | yes |
| 4 | Colour | Warm chromatic; oxblood, ember, a lamp field | Cold near-achromatic bone; one signal red | yes |
| 5 | Motion | Organic bloom and settle | Mechanical sweep and snap | yes |
| 6 | Evidence | Verbatim prose quotation, marginal numerals | Numbered cited record, tabulated | yes |
| 7 | Gate metaphor | A wax seal pressed twice | A signature block armed then executed | yes |

7 of 7. §5 requires ≥5.

**Why a reviewer might prefer `lantern`:** it is the only one of the two that makes you read the
candidate's own words before you decide, which is the thing the schema was built to protect.

**Why a reviewer might prefer `platen`:** it is the only one of the two you can work twenty
applicants through in a morning without losing the comparison, and it makes it structurally
impossible to fire an irreversible action from the same place you do routine work.

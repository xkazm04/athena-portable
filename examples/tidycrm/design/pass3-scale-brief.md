# `/v/scale` — the variant brief

> **STATUS — HISTORY, kept for the record.** `scale` was a pass-3 sibling and was never routed. Its
> stylesheet survives at `design/tc-scales.css`, imported by nothing. Nothing in the shipping
> direction depends on either. The register of every direction the repo has held is `DESIGN.md` §11
> and `design/SITE.md`.

**Written before any component code.** Method: rhythm-first. The scales generate the composition;
ranks and steps are assigned first and the content is poured into them afterwards.

Generator: `examples/hirelane/design/hl-scales.css` + `examples/hirelane/DESIGN-LAW.md` §1.
Vendored, corrected copy: `examples/tidycrm/design/tc-scales.css`.

---

## 0. The seven fields (DESIGN-LAW §6 — brief inference)

| Field | Answer |
|---|---|
| **Domain reading** | 800 live contact records, each carrying up to four *stored* defect flags, distributed over 46 email-domain blocks, plus a set of near-duplicate pairs each holding weighted match evidence. Two different kinds of trouble are mixed together in that pile: trouble a reversible pass can clear on its own (a phone not stored as `+1XXXXXXXXXX`, an 18-month-stale record nobody has flagged) and trouble that needs a person's judgement (an undecided identity pair, a company spelled three ways on one domain). A campaign is about to go out over this list. |
| **Audience & tone** | The person who will press send. What they are afraid of is not "errors" in the abstract — it is emailing the same human twice under two spellings of their employer, and it is *not knowing how much of the list nobody has looked at yet*. Tone: counted, plain, unhurried. |
| **Mood adjective** | **Counted.** |
| **Layout family** | **The plate stack.** One full-bleed column of ranked horizontal registers, each register a field of unit marks. Not a bordered sheet, not a rail-anchored dashboard, not a card grid. Rank is carried by register height, rule weight and spacing step before any colour. |
| **Motion signature** | **Re-quantisation.** When the unit changes — one mark = 1 record, or 5, or 25 — the field does not fade and reappear; it re-counts, wave by wave across the grid, at `dur-4`/`ease-snap` with a wave stagger. Nothing else in the variant uses that motion. Everything else is feedback. |
| **Source direction** | **ISOTYPE — the Vienna Method of Pictorial Statistics** (Otto Neurath, Marie Neurath, Gerd Arntz, 1925–1940). Its binding law: *a greater quantity is shown by more signs, never by a bigger sign.* Its second law: the sign is drawn on a strict construction grid and carries no shading. Its third: colour is flat and semantic, never modelling. |
| **Why this source for this app** | The owner's stated defect is that there is no main section to start from — no view of the whole. The reason the rejected surfaces had none is that they showed counts as numerals in boxes, and numerals in boxes do not compose into a whole; four of them side by side are still four separate facts. ISOTYPE exists for exactly the opposite purpose: to make an aggregate perceivable and comparable without reading a number. And it gives the honest treatment of *"percentage of not-yet-analysed data"* that a percentage cannot: an unfilled sign occupies **exactly as much space as a filled one**, so the not-yet-known takes up its true share of the picture. A ring at 38% hides the 62%; a field of 800 marks cannot. The unit rule is also why the same plate survives a density change, which is this variant's operating lever. |

---

## 1. The generic-answer diff gate (DESIGN-LAW §2.2 — written before code)

> **Generic answer.** A dark dashboard. Top row: four KPI cards — Total contacts, Duplicates, Phone
> issues, Stale — each a large number over a grey caption with a lucide icon in the corner, 12px
> gap, 12px radius, 1px `#e5e7eb` border, one soft shadow. Below: a donut chart of "data quality"
> at 72% in Tailwind blue with a legend, next to a horizontal bar chart of defects by type in the
> library default palette. Below that: a paginated table of contacts with a search box, badges in
> the status column, and a right-hand chat rail labelled "Ask Athena" containing an input with the
> placeholder "Ask me anything about your data". Inter throughout, slate-950 ground, one blue
> accent, everything fades up 20px on mount, `@media (max-width: 768px)` collapses the grid to one
> column. Agents appear, if at all, as a spinner and a toast.

**Diff, item by item:**

| Generic | This variant | Why the domain demands it |
|---|---|---|
| Four KPI cards | **One field of 800 unit marks**, one mark per record, coloured by its worst state | Four numbers are four facts. One field is a whole, and the whole is the thing the owner says is missing. |
| Donut at 72% | The unprocessed share is **the count of ochre marks in the field** | The 28% has to occupy 28% of the picture or the number is a claim, not a view. |
| Defect bar chart | Per-block **cause lists** — count, then the exact rule that fired | "Which blocks need attention **and why**" is in the owner's brief. A bar says how many, never why. |
| Badges in a status column | Colour is on the **mark itself**; no pill anywhere in the variant | Pill soup (tell #9): every attribute bordered means nothing is emphasised. |
| Chat rail | **A dispatch bar over the field.** Agents are aimed at selected blocks and their returns land *in the picture*, on the marks they changed | Tell #15: delete the rail and the UI must still know about agents. Here the agents *are* the interaction. |
| Spinner | Marks under a working agent pulse at `dur-6`; each block's return re-colours its own marks as it arrives | Fan-out is the point — "dispatch **agents**", plural. An aggregate spinner erases the fan-out. |
| Slate + one blue | Cool grey ground, ink, and **five flat semantic hues**, locked (§3) | Tell #4. Also the owner asked for green and red used minimally on key data nodes; ISOTYPE's flat semantic colour is the discipline that keeps them minimal. |
| Inter everywhere | **Jost** (geometric grotesque, variable, axis-pinned) + **Azeret Mono** for every figure | Tell #5. Futura is ISOTYPE's face; Jost is its open-source descendant. |
| 12px everything | Four spacing rungs, three density modes, ≥2 steps between adjacent ranks (§4) | Tell #1, and it is this variant's entire method. |
| `@media (max-width)` | `@container` + `cqi` only. Zero viewport units in the file. | Measured: the CopilotKit sidebar makes `body` ~800px at a 1280 viewport. Every `vw` in the generator lies by a third. |
| Fade up 20px | One signature (re-quantisation); everything else is role-assigned feedback | Tell #11. |

---

## 2. Container inventory (DESIGN-LAW §3)

| Concept | Shape of the data | Required container | Forbidden |
|---|---|---|---|
| The estate (800 live records) | one homogeneous population, three states | **unit-mark field**, one mark per unit, worst-state colour | donut, stacked bar, four KPI cards |
| A block (46 email domains) | homogeneous, comparable on the same three scalars | **row**, with its own inline tally strip | card grid, tiles, treemap parcels |
| Why a block needs attention | 1–4 ranked causes, each a count plus the rule that fired | **cause list**, count and rule ident in mono, consensus spelling first | a tooltip; "3 issues"; a prose sentence |
| The unprocessed share | one proportion of a known total | the **unfilled marks themselves**, plus a partial mark for the remainder | a percentage alone; a ring |
| Standing (4 progress lines) | 4 done/total pairs | **tally rows** — filled marks to `done`, outline to `total` | a percentage bar with a gradient |
| A near-duplicate pair | 2 heterogeneous records read closely, with weighted evidence | **field-aligned two-column comparison** + evidence weights drawn as marks | two cards side by side; an averaged confidence with no breakdown |
| One block under investigation | one heterogeneous object read closely | **this is the panel case** — an overlay on the same page | a row; a second route |
| Agent dispatch | 5 named agents × N selected blocks | **ordered agent bar + per-block returns onto the marks** | one aggregate progress bar |
| Activity | time-ordered, mixed types | the demo-kit `.dk-activity` list | a rebuilt feed |

---

## 3. Colour lock — five hue-bearing tokens plus ground/ink

Locked before implementation. No component file may introduce a colour.

| Token | Value | Means, and means nothing else |
|---|---|---|
| `--tc-paper` / `--tc-ink` | `#e6e9ee` / `#15181d` | ground and ink (cool, flat) |
| `--tc-quiet` | ink at 24% | a record with no open deviation — graphite, not a hue |
| `--tc-open` | `#c08608` | **unprocessed** — a reversible pass has not run on it |
| `--tc-dispute` | `#bd1425` | **disputed** — needs a person's judgement |
| `--tc-clear` | `#1c7a58` | a standing line that is **closed**. Nothing else, ever. |
| `--tc-auto` | `#1f5ec4` | a **reversible** act. Nothing else, ever. |
| `--tc-gate` | `#6d2a63` | an **irreversible** act that reaches a record permanently. Nothing else, ever. |

**Revised during implementation, and the revision is the better answer.** The first draft made the
clear state green. At the real proportions — roughly three quarters of 800 records carry no open
deviation — that is six hundred saturated green signs, and a wall of green is not a signal, it is a
background. So the clear state is drawn in graphite and green is demoted to one job: the mark on a
standing line that has closed. That is exactly the owner's note on the Standing ledger — black and
white shades, green and red minimally on key data nodes — arrived at from the other direction, by
counting. Red stays on the disputed signs, where it is about a tenth of the field.

## 4. Rank and step table — assigned before layout

| Rank | Region | Gap to next region | Rule weight |
|---|---|---|---|
| **R0** | The Estate — masthead, the three quantities, the mark field, the controls, the dispatch bar | `--tc-gap-region` | `rule-3` under it |
| **R1** | The Registers — 46 block rows | `--tc-gap-region` | `rule-1` hairline per row |
| **R2** | The Standing — the four counted progress lines | `--tc-gap-region` | `rule-2` above |
| **R3** | The Register of capabilities + activity | — | `rule-2` above |
| **overlay** | The block panel, drawn over R0–R3 | — | `rule-3` frame |

Within a region: `--tc-gap-group` between groups, `--tc-gap-item` between rows, `--tc-gap-pair`
between a label and its value. Adjacent ranks differ by **at least two spacing steps** in every
density mode:

| Mode | region | group | item | pair | sign | and it draws |
|---|---|---|---|---|---|---|
| `compact` | step 7 (48) | step 4 (16) | step 2 (8) | step 1 (4) | step 2 (8px) | marks and counts |
| `normal` | step 8 (64) | step 5 (24) | step 3 (12) | step 1 (4) | step 3 (12px) | and the leading cause |
| `open` | step 9 (96) | step 6 (32) | step 4 (16) | step 1 (4) | step 4 (16px) | and every cause with its stored rule, and every spoken form |

**Density is a spacing and generalisation mode. It never shrinks reading type.** The owner has
complained twice about default-small type; a density control that makes body text smaller would
reintroduce the defect under a different name. Only the two display sizes step with the mode.

**Corrected during implementation: density and quantisation are two levers, not one.** The plan was
to bind the unit to the density rung. The data refused: 800 records over 46 blocks is about
seventeen records per block, so at one sign per 25 records every block collapses to a single partial
sliver and the plate stops saying anything. Quantisation is therefore its own enumerated control —
**one mark = 1 / 2 / 5 records** — and it is the one that carries the signature motion. That
separation turned out to be worth more than the original plan: density answers *how much do I want
to read*, unit answers *how close do I want to stand*, and they are independently speakable.

## 5. Motion, assigned by role and not by feel

| Role | Duration | Easing |
|---|---|---|
| press feedback | `dur-1` | `standard` |
| control state change (density, grouping, selection) | `dur-2` | `snap` |
| mark state change after a dispatch return | `dur-3`, wave stagger | `entrance` |
| overlay in / out | `dur-3` / `dur-2` | `entrance` / `exit` |
| a headline number settling to its value | `dur-5` | `standard` |
| **re-quantisation (the signature)** | `dur-4`, wave stagger | `snap` |
| an agent working | `dur-6` loop | `standard` |

## 6. Icon inventory — every domain mark is drawn for this app

Bespoke inline SVG, all constructed on one 16-unit grid with horizontal, vertical and 45° edges
only (Arntz's construction rule): the **record mark** (the unit sign, in three states and a partial
form), the **pair mark** (two records sharing an edge), the **spelling mark** (three stacked bars of
unequal length), the **phone mark**, the **clock mark** for stale, the **agent chevron** in five
idents, and the **gate seal**. `lucide-react` is used for nothing in this variant.

## 7. What is live and what is presentational

Live, through the app's existing server actions, against the seeded database:

- `MEND` → `normalizeAction` (phone/whitespace/case rules) — AUTO, reversible via the activity log.
- `MARK` → `flagStaleAction` — AUTO, reversible.
- `WEIGH` → `previewMergeAction` — read-only, returns the real weighted evidence.
- `FOLD` → `mergeAction` — GATED, arm-then-fire, irreversible.
- Undo → `undoAction` on the demo-kit activity log.

Presentational, and labelled as such on the surface:

- `SWEEP` re-reads and re-counts; it changes no row. It is the read pass, and the UI says so.
- Voice. There is no microphone and no transcription. Every control carries a spoken form
  (`block 07`, `unit one`, `group by deviation`, `dispatch mend at block 07`) because that is what
  makes it addressable by an agent, but the channel is not built.
- Athena is not connected. The honesty line ships verbatim: *"Athena is not connected yet. Every
  capability below is registered and waiting."*

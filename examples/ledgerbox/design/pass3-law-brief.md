# Ledgerbox — `law` — design law brief

**Method:** `examples/hirelane/DESIGN-LAW.md`, applied to ledgerbox. That document is written for
hirelane; this file ports its *method* — write the law and the brief before any code, including the
generic answer you are diffing against — and generalises or replaces the clauses that do not fit an
invoice inbox. Every deviation is recorded under **Transfer notes** with a reason.

**Written before** any file existed under `components/law/` or `app/v/law/`. §2.2 forbids code before
the diff gate below is written, and a diff written afterwards is a rationalisation.

**Governing brief:** `PASS3.md` overrides `BRIEF.md` and `ROUND2.md`. Where `PASS3.md` and
`DESIGN-LAW.md` disagree, `PASS3.md` wins and the conflict is recorded.

---

## 0. Transfer notes — where the hirelane law does not fit ledgerbox

Recorded first, because §9.4 requires every exception to be written down with a reason.

| Law | Fits? | What I did |
|---|---|---|
| §1 scales | **Partly.** The *shape* transfers; the *values* are wrong here. | Rebuilt as `--law-*`. Two changes below (§1.2, §1.7). |
| §1.2 type scale | **No — it is actively harmful here.** Its floor is `0.6875rem` (11px) and its base is `0.9375rem` (15px). The owner's stated defect on the kept variant is *"Typography size is mishandled with defaults too small."* The audit of `waterline.css` bears him out: its axis labels are 11.5px, its meta text 12px, and **every button in the direction is 13.5px**. | Floor raised by ~2px across the board. Nothing on this page is below 13px, and no interactive control is below 15px. |
| §1.2 `clamp(… vw …)` | **No.** `PASS3.md` measured that the CopilotKit sidebar shrinks `body` to ~800px at a 1280 viewport. Every `vw` in a clamp therefore lies about the space the type actually has. | All fluid clamps use `cqi` against a named container. `@media (width…)` is banned in this variant. |
| §1.4 elevation | Fits. | Kept, renamed. |
| §1.6 `--dk-*` bridge | Fits exactly. | Kept verbatim as a discipline. |
| §2.1 tells | 13 of 15 transfer unchanged. #2 (card grid) and #15 (chat rail) are the diagnosis of this repo. | Two hirelane-specific readings generalised; one ledgerbox tell added (#16). |
| §2.2 diff gate | Fits, and is the part with evidence behind it. | Kept, written below, before code. |
| §3 container gate | The *gate* transfers; hirelane's **inventory** is a different domain's table. | Ledgerbox inventory written fresh (§3). |
| §4.1 copy allow-list | Fits. Rewritten against ledgerbox's schema and honesty line. | §4.1. |
| §4.2 colour lock / §4.3 icon inventory | Fit. | §4.2, §4.3. |
| **§5 divergence rule** | **Does not apply.** It governs *two* variants; `PASS3.md` asks for **one** best attempt. A rule about the distance between A and B is undefined at n=1. | Replaced with a **rejected-direction clause** (§5): name the strongest direction you are *not* taking and why. That preserves what §5 was for — proving the direction was chosen rather than defaulted into — at n=1. |
| §6 brief inference | Fits, and is the strongest clause in the document. | §6, all seven fields answered. |
| §7 "the gate is structural" | Fits; hirelane's action list replaced with ledgerbox's. | §7. |
| §8 data honesty | Fits. | §8. |
| §9 pre-ship gate | Fits, minus the two-variant lines. | §9. |
| **Missing entirely** | DESIGN-LAW has **no clause about the agent doing visible work**, and none about **voice/name addressability** — both are `PASS3.md` law. Its §7.4 only asks that the manifest be *shown*. | Added **§10 — the dispatch law** and **§11 — the addressability law**. These are the two things the method could not give me. |

---

## 1. LAW ONE — the scales. Never type a raw number.

Declared once in `components/law/law.css` under `[data-variant="law"]`. Nothing is declared on
`:root`; nothing outside the wrapper is touched.

### 1.1 Spacing — 10 steps

```
--law-s1 4px    --law-s6 32px
--law-s2 8px    --law-s7 48px
--law-s3 12px   --law-s8 64px
--law-s4 16px   --law-s9 96px
--law-s5 24px   --law-s10 128px
```

Two vertically adjacent regions of different semantic rank differ by **at least two steps**.

### 1.2 Type — floor raised, clamps on `cqi` not `vw`

```
--law-t-2xs  0.8125rem (13px)   — the absolute floor. Lane tick labels only.
--law-t-xs   0.875rem  (14px)
--law-t-sm   0.9375rem (15px)   — the floor for anything interactive.
--law-t-base 1.0625rem (17px)
--law-t-md   1.1875rem (19px)
--law-t-lg   clamp(1.375rem, 1.15rem + 1.1cqi, 1.75rem)
--law-t-xl   clamp(1.75rem,  1.35rem + 2.0cqi, 2.6rem)
--law-t-2xl  clamp(2.4rem,   1.60rem + 4.0cqi, 4.0rem)
--law-t-3xl  clamp(3.2rem,   2.00rem + 6.4cqi, 6.0rem)

--law-lead-tight 1.04  --law-lead-snug 1.22  --law-lead-normal 1.5  --law-lead-relaxed 1.66
--law-track-tight -0.032em  --law-track-normal 0  --law-track-wide 0.05em  --law-track-caps 0.1em
```

Rules, unchanged from §1.2 except the floor:
- Display sizes (`lg` and up) take `--law-lead-tight` and `--law-track-tight`.
- All-caps labels take `--law-track-caps` and sit at `--law-t-2xs`/`--law-t-xs`, **not below 13px**.
- Every compared figure — amount, balance, days late, score — is set in the mono face with
  `font-variant-numeric: tabular-nums lining-nums`. Money that jitters between rows is a
  data-integrity signal, not a style choice.

### 1.3 Motion

```
--law-d1 90ms   --law-d4 420ms    --law-ease-standard cubic-bezier(0.2, 0, 0, 1)
--law-d2 160ms  --law-d5 700ms    --law-ease-entrance cubic-bezier(0.05, 0.7, 0.1, 1)
--law-d3 260ms  --law-d6 1200ms   --law-ease-exit     cubic-bezier(0.3, 0, 0.8, 0.15)
--law-stagger 26ms                --law-ease-snap     cubic-bezier(0.85, 0, 0.15, 1)
```

Press feedback `d1`/`d2`; entrance `d3`; removal `d2`; a value settling `d5`. **One signature motion,
named in §6.** List staggers use `--law-stagger` and are capped by `Math.min(cap, i * step)` so an
unbounded lane can never make an entrance run long. Every motion path has a `prefers-reduced-motion`
branch that lands on the **final state** (`initial={reduced ? false : …}`), not a faster animation.

### 1.4 Elevation — layered, never a single blur

```
--law-e0 none
--law-e1 0 1px 2px rgb(23 20 15 / 5%), 0 1px 1px rgb(23 20 15 / 4%)
--law-e2 0 2px 4px rgb(23 20 15 / 5%), 0 6px 16px -6px rgb(23 20 15 / 10%)
--law-e3 0 4px 8px rgb(23 20 15 / 6%), 0 18px 36px -14px rgb(23 20 15 / 16%)
--law-e4 0 10px 20px rgb(23 20 15 / 8%), 0 44px 80px -30px rgb(23 20 15 / 26%)
```

Plus the three inset idioms lifted from the `waterline` audit, which are the craft the owner kept it
for: **inset-shadow-as-hairline** (`inset 0 0 0 1.5px …`), **inset top light edge**
(`inset 0 1px 0 rgb(255 255 255 / …)`), and **hue-matched ambient shadow** — a shadow tinted with the
element's own hue rather than black.

### 1.5 Rule, radius, measure

```
--law-r1 1px  --law-r2 2px  --law-r3 3px          (rule weight — the AUTO/GATED ladder, §7)
--law-rad-0 0  --law-rad-1 2px  --law-rad-2 4px  --law-rad-3 10px  --law-rad-round 999px
--law-measure-prose 60ch  --law-measure-narrow 42ch  --law-measure-wide 76ch
```

Radius is **not** one value everywhere (tell #7). The board and its lanes are square
(`--law-rad-0`); nodes take `--law-rad-1`; only the modal and the release strip take `--law-rad-3`.

### 1.6 The `--dk-*` bridge — alias, never fork

`--dk-*` is aliased inside `[data-variant="law"]` onto the `--law-*` palette. **Forbidden:**
redefining any `.dk-*` class selector. `grep -n "\.dk-" components/law/law.css` must return only
lines scoped under the variant attribute, and ideally nothing.

### 1.7 Container, not viewport

`[data-variant="law"]` declares `container-type: inline-size; container-name: law`. Every responsive
rule is `@container law (min-width: …)`. **There is no `@media (width…)` in this variant**, only
`@media (prefers-reduced-motion: reduce)`. This is `PASS3.md` law and it overrides the `vw`-based
clamps in DESIGN-LAW §1.2.

---

## 2. LAW TWO — the tell list, and the generic-answer diff gate

### 2.1 The tells (13 carried over, 2 generalised, 1 added)

1. One gap for everything.
2. **Card grid for a comparable set** — see §3.
3. 1px borders as the only depth.
4. Neutral grey plus one accent.
5. The default type voice (Inter/Geist/system as the whole pairing).
6. Emoji or a lucide glyph as the entire visual metaphor for a domain concept.
7. One radius everywhere.
8. Gradient text on the headline; a "gradient" that is a colour fading to a tint of itself.
9. Pill soup.
10. Centred hero, two-button row, 18-word subhead restating the headline.
11. Uniform fade-up-on-mount as the only motion.
12. Numbers that did not come from the database.
13. Library-default chart colours; unlabelled axes.
14. Marketing verbs. Also **any claim that Athena has done, is doing, or will shortly do something.**
15. The agent as a right-hand chat rail and nothing else.
16. **(added, ledgerbox)** **A figure with no attribution path.** Any money shown as certain when the
    schema says it is contested or unattributed. `candidate_count > 0` means cash has landed that
    *might* belong here; `state === 'disputed'` means the client disagrees. A surface that renders
    both as a flat "$X outstanding" has asserted something the books do not support.

### 2.2 The diff gate

> **Generic answer.** A white page. Inter throughout, `font-semibold` headings at `text-2xl` with
> `leading-relaxed`. Above the fold, four `rounded-xl` stat cards in a `grid-cols-4 gap-4` —
> Outstanding, Overdue, Unmatched, Disputed — each with a lucide icon in a `bg-blue-50` rounded
> square, a big `text-3xl font-bold` number, and a green or red `↑ 12%` that is not in the schema.
> Below them a Recharts area chart of receivables over time in the library's default blue, axes
> unlabelled. Below that, "Recent Invoices": a `bg-white rounded-xl border border-slate-200
> shadow-sm` table, 10 rows and a "View all" link, each row ending in a `bg-amber-100 text-amber-700`
> status pill and a `MoreHorizontal` kebab. A left sidebar with Dashboard / Invoices / Bank /
> Reports / Settings, and a right-hand drawer labelled "Ask AI ✨". Slate-50 ground, blue-600 accent,
> `border` + `shadow-sm` on every container, uniform `gap-4`, `rounded-xl` on everything including
> the page shell. Everything fades up 20px on mount. The destructive action is a red button with a
> `window.confirm`. Copy: "AI-powered invoice reconciliation that works seamlessly in the
> background."
>
> **Diff.** Item by item, and why this domain demands it.
>
> 1. **The stat row and the table both die; the whole book becomes one canvas.** Four summary cards
>    plus ten rows of a hundred and twenty is not an overview — it is a sample and a slogan. The
>    owner asked for *"swimlanes overflown with data … manipulate like in canvas."* So: **every
>    invoice in the quarter is on screen at once**, positioned by its due date on a shared horizontal
>    time axis, in a lane per client. Nothing is paged, nothing is "view all". Density is the point.
> 2. **Position replaces the status pill.** In the generic answer, "overdue" is an amber pill. Here
>    lateness is *distance*: the node sits at its due date and a rule runs from it to the `today`
>    ordinate, so ninety days late is physically nine times longer than ten days late. Pills are
>    banned (tell #9); state is position, rule weight and one drawn mark.
> 3. **The chart's fake trend is replaced by the real axis.** No `↑ 12%`. The only axis on the page
>    is the quarter itself, June 1 to September 1, labelled at week ticks — real dates from
>    `issued_at`/`due_at`, not a library's default ordinal scale.
> 4. **"Outstanding" is demoted; the *unattributed* and the *contested* are promoted.** This is the
>    ledgerbox equivalent of hirelane's gap clause. The generic answer's headline figure is the sum
>    of balances, which is the one number a bookkeeper already knows. The interesting datum is the
>    money the books cannot yet place: credits that have landed with no invoice against them, and
>    invoices where two candidates tie for the same credit (`isAmbiguous` — the seed contains these
>    deliberately). **Suspicion is computed on the server from the schema and marked at node level,
>    without opening anything** (§9.7).
> 5. **The suspicion mark is structural before it is coloured.** A suspect node is *cocked* — pushed
>    out of its lane's alignment by `--law-s2`, with a drawn caret beneath it. Turn the page
>    greyscale and the suspects are still the only nodes out of line.
> 6. **The sidebar and the five routes die.** `/bank`, `/reports` and `/activity` are already deleted
>    from this app. One page, one surface, animated transitions between states (`PASS3.md` law 1). A
>    modal is the only second layer.
> 7. **`window.confirm` becomes a release strip.** Every GATED act is *removed from the board* and
>    can only be issued from a single inverted band at the foot of the page that quotes the letter
>    verbatim, names the recipient's actual email address, and must be **armed and then issued** as
>    two separate, separately-named acts. A confirm dialog is a speed bump.
> 8. **The chat drawer dies; dispatch is on the surface.** Deleting a right-hand rail must leave a UI
>    that still knows about agents (tell #15). Here the agent's work *is* the interaction: a
>    dispatched run lands its steps one at a time in the modal, each labelled with the real
>    capability name it called and its class, ending at the GATED step it is not allowed to take.
> 9. **The palette is a colour story.** Warm concrete ground, cobalt structure, and three reserved
>    semantic hues that appear nowhere decorative. Not slate-50 + blue-600.
> 10. **Motion is one signature, not a uniform fade.** Nothing fades up on mount. Values change by
>     **flapping** (§6), and re-laning is a layout animation, not a re-render.
> 11. **Every control has a name, and the names are printed on the page.** The generic answer is
>     mouse-only. This one is built to be driven by speaking, so the board carries a command line and
>     a printed grammar (§11).
> 12. **Type is sized for its container, and its floor is 13px.** The generic answer's `text-xs`
>     (12px) meta everywhere is exactly the defect the owner named twice.

---

## 3. LAW THREE — the container model gate

> **Do not turn table-driven concepts into card grids.**

A card is the right container for a *heterogeneous* object considered on its own. A row — or a
positioned block on a shared axis — is the right container for a *homogeneous* object compared
against its peers. Receivables management is comparison across time. Almost everything in ledgerbox
is a block on an axis.

**Ledgerbox's binding container inventory.** Deviation requires a written reason here.

| Concept | Shape of the data | Required container | Forbidden |
|---|---|---|---|
| The receivables book (~120 invoices, 6 comparable scalars each, each with two dates) | homogeneous, time-anchored | **positioned nodes on a shared time axis, in lanes** — a dense aligned row list is the acceptable degradation | card grid, kanban columns, a 10-row "recent" table |
| One invoice being read closely | one heterogeneous object | this **is** the card / reading-pane case → the modal | a lane node that expands to 600px and destroys the board |
| Unapplied bank credits | homogeneous, time-ordered, awaiting attribution | **its own lane on the same axis**, so unattributed cash is spatially adjacent to the invoices it might belong to | a sidebar list, a separate page, a card grid |
| Match candidates and their evidence | 0–5 per invoice, each carrying a score and 1–4 verbatim evidence clauses from `lib/match.ts` | ranked aligned list with **every evidence clause shown in full** | a confidence pill alone; a tooltip; a truncated one-liner; a score with no clauses |
| Invoice states (7, severity-ordered) | ordered buckets with counts | a filter ribbon that preserves the order, plus structural encoding on the node | an unordered chip row, a donut, a pie |
| The reminder body (prose that will reach a person) | running prose, 8 lines | quoted verbatim at `--law-measure-prose`, **before** the gate, in the release strip | a truncated preview, a "Send" with the body hidden |
| The capability register | 9 tools in 2 classes | a ruled two-column register **in the page's own layout**, read live from `useHostManifest()` | the demo-kit drawer alone; a hand-typed duplicate list |
| Activity log | time-ordered, mixed types | the demo-kit `.dk-activity` list | a rebuilt custom feed |

**The interesting datum (the ledgerbox analogue of hirelane's `gap`).** `Insight.gap` there;
**attribution risk** here. Three schema-derived conditions, computed server-side in
`components/law/model.ts`, nothing invented:

- `state === 'disputed'` — the client has said in writing that they disagree (`dispute_note`).
- `isAmbiguous(candidates)` — two unapplied credits are within 12 points of each other for this
  invoice, so a reconciliation run must stop and ask instead of guessing. `lib/match.ts` says so.
- `days_overdue > 30 && candidate_count === 0 && reminders_sent === 0` — a month late, no money has
  arrived that could be it, and nobody has asked. Silent and late.

**These must be legible at node level, on the board, without opening an invoice** (§9.7). A design
that shows only the outstanding total has deleted the reason to open the app.

---

## 4. LAW FOUR — copy allow-list, colour lock, icon inventory

### 4.1 Copy allow-list

Above the fold, only strings from this list plus values read from the database.

- The app name: `Ledgerbox`.
- Values from the schema: `client.name`, `client.email`, `invoice.number`, `invoice.dispute_note`,
  `bank_line.memo`, `reminder.body`, category names from `CATEGORIES`, period labels from
  `PERIOD_LABEL`, state names from `InvoiceState`, evidence clauses from `lib/match.ts` verbatim.
- Counts and money from `listInvoices()`, `summarize()`, `unappliedLines()`, `lineSuggestions()`.
- Exactly one orienting line, chosen from:
  - `The quarter, every invoice, on one axis.`
  - `Money the books cannot yet place is the only thing worth your morning.`
  - `Nothing here is paged. This is all of it.`
- The honesty line, **verbatim, once, visible without interaction**:
  `Athena is not connected yet. Every capability below is registered and waiting.`
- The dispatch honesty line, **verbatim, at the dispatch control**:
  `Athena is not connected yet. Dispatch runs the same registered capabilities she will call, in the
  same order, against the same books.`
- The two class words, only in their manifest sense: `AUTO`, `GATED`.

**Forbidden anywhere:** any sentence in which Athena has done, is doing, or will shortly do
something. Present tense of registration, never past tense of work. No marketing verbs.

### 4.2 Colour lock — five hue-bearing tokens plus ground and ink

Locked before implementation. No new colour may appear in a component file.

| Token | Value | Sole use |
|---|---|---|
| `--law-ground` | `#e6e1d6` | page ground — warm concrete |
| `--law-rack` | `#dbd4c5` | the recessed rack the lanes sit in |
| `--law-band` | `#f7f4ed` | the lane face, the raised surface |
| `--law-ink` | `#17140f` | text; the inverted ground of the release strip |
| `--law-ink-2` | `#6b6355` | secondary text |
| `--law-rule` | `color-mix(in oklab, var(--law-ink) 13%, transparent)` | hairlines |
| `--law-cobalt` | `#22357a` | **structure only** — the time axis, the `today` ordinate, the brand, the lane top-borders, focus |
| `--law-verdigris` | `#0f6a5c` | **AUTO ONLY** |
| `--law-vermilion` | `#c4321a` | **GATE ONLY** |
| `--law-ochre` | `#a8761c` | **the attribution-risk mark ONLY** (§3) |
| `--law-plum` | `#6b2455` | **disputed and void ONLY** — the states where a person has objected |

If `verdigris` or `vermilion` appears as decoration anywhere, the gate signal is destroyed and the
variant fails §9.12.

**Type.** Display: **Bricolage Grotesque** (wide, mannered, optical — not a system grotesque).
Body: **Public Sans**. Figures, ids, memos and evidence: **Spline Sans Mono**, tabular. None of the
three is used by `waterline` (Archivo/Newsreader) or by the shipped Strip, so the voice is this
variant's own.

**Depth model.** Layered light: the rack is recessed (inset shadow), the lanes are raised bands with
an inset top light edge, the nodes carry `--law-e1`/`--law-e2`, the modal `--law-e4`, and ambient
shadows are hue-matched rather than black. A woven-paper grain is drawn once as an inline SVG
pattern over the ground.

### 4.3 Icon inventory — declared before implementation

**Bespoke inline SVG, drawn for this app:**
- the woven-concrete grain pattern (`<pattern>` over the ground),
- the time axis with week ticks and month rules,
- the `today` ordinate,
- the lateness rule (node → today),
- the attribution-risk caret (the mark under a cocked node),
- the dispute mark (a struck rule),
- the credit chit (the shape of an unattributed bank line in its lane),
- the evidence tie (the bracket linking a credit to a candidate invoice),
- the release seal — an arc that draws on arm and closes on issue,
- the split-flap glyph frame (the hinge rule across a flapping figure),
- the lane density sparkline (per-lane, data-driven, drawn from the lane's own nodes).

**`lucide-react`, utility glyphs only:** `ChevronRight`, `X`, `Search`. Nothing domain-bearing.

No raster assets. No runtime image, script or font request beyond the three faces wired through
`next/font`.

---

## 5. LAW FIVE (replaced) — the rejected-direction clause

DESIGN-LAW §5 governs the distance between two variants. `PASS3.md` asks for one. The clause is
replaced by its purpose: **name the strongest direction you are not taking, and say why**, so the
direction is demonstrably chosen rather than defaulted into.

**Rejected direction: "the statement" — a full-bleed bank-statement reading surface.** Ledgerbox's
other true shape is the reconciliation *document*: two columns, invoices left and credits right,
ruled, in a book face, with each proposed match drawn as a brace across the gutter and its evidence
clauses set as a footnote. Depth from rule weight and inversion, shadowless. Motion: the brace draws.

**Why not.** It is the better surface for *one* reconciliation and the worse surface for a hundred.
It has no time axis, so lateness — the thing the whole app is about — becomes a number in a column
again rather than a length. And it cannot answer the owner's actual brief: there is no lane to label,
nothing to autoscroll, and no canvas to steer. It is `waterline`'s failure repeated in a different
register: beautiful craft, no overview.

The chosen direction is defensible against it on exactly one sentence: **you can see the whole
quarter at once and still read one invoice closely, because the close read is a modal over the board
rather than a replacement for it.**

---

## 6. LAW SIX — brief inference. Seven fields, all answered before generating.

| Field | Answer |
|---|---|
| **Domain reading** | 120 invoices, 15 clients, one quarter, frozen at 2026-09-01. Every invoice has two dates (`issued_at`, `due_at`) and a balance that is the face value minus whatever payments have been applied. Separately, a pool of bank credits has landed that nobody has attributed — and `lib/match.ts` scores each credit against each open invoice on four signals (amount, name, invoice reference, date), keeping **one verbatim clause per signal that fired**. So every proposed match in this app can be traced to a stated reason, and `isAmbiguous()` marks the cases where two credits tie and the app is required to stop and ask. The stakes are asymmetric and the schema says so: `match`, `unmatch`, `categorize` and `draft_reminder` each write an undo payload; `mark_paid`, `send_reminder` and `void_invoice` write none, because there is nothing to store. Reversibility, not harmlessness, buys the AUTO class. |
| **Audience & tone** | A two-person studio's bookkeeper on the first morning of the quarter, with ninety days of books behind them and a decision to make about who gets chased. Their fear is chasing the client who already paid — sending a firm letter to someone whose credit is sitting unattributed three lanes down. Exacting, unsentimental about the process, and very careful at the signature. |
| **Mood adjective** | **Dispatched.** |
| **Layout family** | **The board.** One full-bleed surface: a command bar, then N horizontal lanes sharing a single horizontal scroll axis (June 1 → September 1), each lane a raised band with a subtle cobalt top border and a **sticky label pinned to the inline-start edge**; a `today` ordinate; a rack that overflows deliberately in both directions. The close read is a **modal over the board**, never a replacement for it. Gated acts live only in an inverted release strip at the foot. No sidebar, no second page. |
| **Motion signature** | **The flap.** Every value that changes on this board changes by **flipping through intermediate glyphs**, never by cross-fading or tweening — the split-flap discipline that a public board must never silently mutate a figure, it must show the transit. Located: the lane counters, the command-bar totals, a node's state glyph after a dispatch, and the release strip's countdown. Nothing else on the page has a signature; everything else is feedback. Re-laning (`lane by client → by category`) is a layout animation, which is navigation, not the signature. |
| **Source direction** | **Bob Noorda's 1964 Milan Metro wayfinding, read against the Solari di Udine split-flap board.** Noorda's system is a continuous saturated band running the length of the platform wall with the station names repeated along it at a fixed height, on warm concrete, so a traveller moving past always knows which line they are on. Solari's board is the mechanical departures display where a value changes by flipping through the glyphs between the old value and the new one, in public, in front of the people who will act on it. |
| **Why this source for this app** | Two exact fits, one per half of the brief. **(a)** Noorda solved the sticky-lane-label problem literally: how do you label a band that runs further than the eye, for someone moving along it, without the label ever leaving them. That is the owner's *"top subtle borders with sticky label"* sentence, already solved, in a real system, with a real answer — the band carries its own name at a fixed height and the name travels with the viewer. It is also why the ground is warm concrete rather than white: Noorda's contrast is calibrated against a station wall, not paper, and this board is dense enough that a white ground would make the nodes shout. **(b)** Solari solved the honesty problem an audit surface has. A ledger must never silently replace a figure — the transit between the old value and the new one is itself information, and it is exactly what a bookkeeper needs to see when an agent changes something. A cross-fade hides the change; a flap performs it. That is why the signature motion is mechanical and stepped rather than an organic settle, and it is the discipline that makes an agent's edits to the books watchable rather than merely reported. Both are transport-operations design, where the whole stake is that a person reads the display and *acts*. |

---

## 7. LAW SEVEN — the gate is structural, not a badge

From `app/actions.ts` and `components/HostCapabilities.tsx`, where the flags are the contract:

- **AUTO, reversible** — `categorize`, `match_bank_line`, `unmatch`, `draft_reminder`,
  `export_summary`, `navigate`. Each writes an undo payload. Each can be taken back.
- **GATED, irreversible** — `mark_paid` (money against the books), `send_reminder` (reaches a person
  outside the studio), `void_invoice` (a permanent statement about the books). None writes an undo
  payload, because there is nothing to store.

The laws that follow:

1. The distinction is expressed **structurally before any colour**. GATED acts are not on the board
   at all; they exist only inside the release strip, which is the only **inverted** region on the
   page. Turn the page greyscale: the gated region is still the only black band, and the AUTO/GATED
   rule-weight ladder (`--law-r1` / `--law-r3`) still separates the register's two columns.
2. A gated control is **armed, then issued** — two deliberate, separately named acts, disarming
   itself on a timeout. Not a `confirm()`.
3. Arming states **who it reaches and what cannot be undone**, naming the client and quoting their
   actual email address from the schema, and shows the letter body verbatim first. Not "Are you
   sure?".
4. The capability register is **in the page's own layout**, read live from `useHostManifest()`, both
   classes visible. The demo-kit drawer is a supplement, not the answer.
5. Copy stays in the present tense of registration.

---

## 8. LAW EIGHT — data honesty

- Real seeded data through `lib/db.ts` in a **server** component. No mock arrays in a component file.
- The primary mutating flow uses the existing server actions in `app/actions.ts`, through one
  `useRun()` choke point. `revalidatePath("/")` does not cover `/v`, so the client calls
  `router.refresh()` and the route is `force-dynamic`.
- `lib/`, `components/HostCapabilities.tsx` and `/api/copilotkit` do not change. `app/v/page.tsx`,
  `app/layout.tsx` and `app/globals.css` are shared and owned by the parent session — untouched.
- `components/waterline/`, `components/edge/` and `app/(shipped)/` are reference material — untouched.
- Any control that does not perform its action **says so on the surface**, not only in a report.
- `/` renders the shipped design unchanged.

---

## 9. The pre-ship gate

Answer every line with evidence. A "yes" you did not check is a failure.

**System**
1. Zero raw pixel values in `law.css` outside the token block.
2. `--dk-*` aliased; no `.dk-*` class redefined.
3. ≥4 distinct spacing steps and ≥3 distinct type sizes on the primary surface.
4. **No `@media (width…)` anywhere in the variant.** Container queries only.
5. **Nothing below 13px; no interactive control below 15px.**

**Tells**
6. Walk all sixteen of §2.1 on the rendered page. No tell present, or the exception is written down.
7. The diff gate was written **before** the code, and the shipped result still matches it.

**Containers**
8. Every concept in §3's inventory is in its required container.
9. Attribution risk is legible at node level without opening an invoice.

**Direction**
10. The rejected direction (§5) is named, and the chosen one is defensible against it in one sentence.

**Gate**
11. Greyscale test: gated acts still identifiable with colour removed.
12. Every gated control arms before it issues, names the client, quotes the body, says what cannot be
    undone.
13. `verdigris` and `vermilion` appear nowhere decorative.

**Dispatch and addressability**
14. The dispatch run shows the real capability name and class of each step, and stops at the gate.
15. Every manipulation named in §11 works from the printed grammar.

**Honesty and craft**
16. Both honesty lines present, verbatim, visible without interaction.
17. Every number on screen traces to a query.
18. Checked at 390, 768, 1280 and 1920 — and **looked at**, not inferred from markup.
19. `prefers-reduced-motion` lands on final states.
20. `pnpm --filter ledgerbox typecheck` and `lint` pass; `/`, `/v`, `/v/waterline` and `/v/law` all
    return 200 with real content.

---

## 10. LAW TEN (added) — the dispatch law

DESIGN-LAW has no clause for this and `PASS3.md` makes it the point of the exercise: *"in every app
the demo is Athena being dispatched at something and the UI showing her working on it and changing
state as she goes."*

1. **Dispatch is a first-class control on the surface**, not a chat message. It is reachable from the
   node, from the modal, and by name from the command line.
2. **A run is a visible sequence of named steps**, each landing one at a time, each labelled with the
   **real capability name** it calls and its **class**. A spinner is not a run.
3. **A run stops at the gate.** The last step of the demo path is GATED and the run *cannot* take it;
   it hands the drafted letter to the release strip and says so. This is the whole point of the app
   made kinetic.
4. **A run changes state on the board**, visibly, using the signature motion — the node's glyph flaps
   to its new state and the lane counter flaps to its new count.
5. **The run is honest.** Every step is a real server action against the real books. Athena is not
   connected; the page is orchestrating the same calls she will make. That sentence appears at the
   control, verbatim (§4.1), not only in the report.

**The demo path, fixed:** spot a cocked node on the board → expand it in place → open the modal →
dispatch → `match_bank_line` (AUTO, real) if a strong candidate exists, then `draft_reminder`
(AUTO, real) → the run stops → the drafted letter appears in the release strip → arm → issue →
`send_reminder` (GATED, real) → the node's state flaps on the board.

## 11. LAW ELEVEN (added) — the addressability law

`PASS3.md` law 2: hands-free and voice-first is the intended operating mode, and *"every
manipulation you build should be addressable by name — that is also exactly what makes it
addressable by an agent."*

1. **Every manipulation has a canonical name, and the names are printed on the page.** A grammar the
   user cannot see is not addressable.
2. **A real command line drives all of them**, so addressability is demonstrated rather than claimed.
3. **The grammar is the same vocabulary the host manifest uses** — `CATEGORIES`, `FILTERS`,
   `PERIODS`, client names, invoice numbers. Nothing invented.
4. **Voice input itself is not wired**, and the surface says so rather than implying a microphone.

**The grammar, fixed:**

```
lane by client | category | state
filter all | overdue | unattributed | disputed | suspect
focus <client>              isolate one lane
clear                       drop focus and filter
zoom in | out               1 of 3 axis densities
go to june | july | august | today
scroll left | right
open <invoice number>       expand the node and open the modal
dispatch <invoice number>   run the registered sequence
close                       close the modal
```

---

## 12. As built — what the gate found, written after the code

§9.7 requires the shipped result to still match the diff written in §2.2. It does; all twelve diff
items are on the surface. What follows is the honest remainder: the things the pre-ship gate caught
and what happened to them.

**Corrected after looking at the rendered pixels (not from markup):**

1. **The lane label painted *under* the nodes.** A band that animates its opacity becomes a stacking
   context, so the label's `z-index` was trapped inside it. The labels are now a layer of their own,
   painted after every node. This is the Noorda rule made literal and it was invisible in the markup.
2. **The board opened on empty rack.** The axis starts a week before the quarter, so `scrollLeft: 0`
   showed a fortnight of nothing. It now lands with the `today` ordinate near the right edge, and the
   day at the left edge is preserved across a zoom, a re-lane or a resize.
3. **A five-button segment widened the page by 163px at 390.** It scrolls inside itself now.
   Measured `bodyOverflow` is 0 at 390, 768, 1280 and 1920.
4. **Type inside controls sat on the 13px floor.** The lane meta, the node number and the node amount
   each came up one step. Measured: nothing below 13px anywhere, no control's own label below 15px.
5. **The three counters collided.** They wrap on `auto-fit` now and the figure dropped a step.
6. **Invoice numbers truncated to `LB-2026…`,** which deleted the identity. The node shows the last
   segment; the full number is on the node's `title` and in the modal.
7. **A third container tier.** The CopilotKit sidebar leaves this board a **231px container inside a
   768px window** — measured, not assumed. Under 400px the lane name moves out of a label column and
   into the lane's own head band, so the whole width becomes track. This is the single clearest
   vindication of `PASS3.md`'s container-query law: a viewport query would have sized this board for
   768px and been wrong by a factor of three.

**Deviations from this brief, with reasons:**

- **§3 said the modal fetches nothing; it now fetches nothing.** The first build read
  `/api/invoices/[id]`. That route returns 500 in this checkout (see below), and a request was
  against the one-page law anyway. Every close read is built on the server with the board and
  travels with the page. A server action was tried in between and removed for the same reason.
- **The release strip opens before it can quote the letter.** §7.3 requires the body verbatim before
  arming. `draft_reminder` writes the row but returns only a status, so the body arrives on the next
  render. Rather than reconstruct the letter client-side — which could drift from what
  `send_reminder` actually sends — the strip opens, says it is reading the letter back, and **keeps
  the arm control disabled until the real body is on screen.** A gate that lets you sign something
  you have not been shown is not a gate.
- **§5's divergence rule is replaced, not satisfied.** It governs two variants; this is one.

**Environment faults, present on `/` and `/v/waterline` as well as here, and not caused by this
variant:**

- `/api/copilotkit` and `/api/copilotkit/info` return **500**, so CopilotKit logs a runtime error and
  React hydration completes only after roughly 15–20 seconds. Every interactive claim in this brief
  was verified after hydration.
- `/api/invoices/[id]` returns **500** with `Jest worker encountered 2 child process exceptions` —
  the dev compiler worker has died under memory pressure. `/api/invoices` (the list) still answers.
- A server action round trip takes **15–25 seconds** in this state. The writes land correctly; the
  latency is the dev server's.
- The host registry reported **zero tools** during the slow-hydration window, on every route of this
  app. The register reads `useHostManifest()` when it has tools and otherwise falls back to the
  declarations in `HostCapabilities.tsx`, **saying on the surface which source it read**. In the
  final run it read live: 9 tools, 6 AUTO, 3 GATED.

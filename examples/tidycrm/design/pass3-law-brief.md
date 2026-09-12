# tidycrm `/v/law` — brief, written before the code

> **STATUS — STANDING LAW, not history.** The `law` direction was reviewed out (cut in `7a05743`);
> this brief was not. It is the written design law the one shipping direction, `blocks`, follows:
> the palette, the type system and the polarity in `components/blocks/style/` are what it settles.
> It is cited as the authority by `components/blocks/style/base/tokens.css`,
> `app/v/blocks/layout.tsx`, `app/v/page.tsx`, `README.md`, `DESIGN.md` §0 and §11, and
> `design/SITE.md`. Do not clear it out with the direction it is named after.

**Generator:** `examples/hirelane/DESIGN-LAW.md` (R1, "the written design law") plus its worked example
`examples/hirelane/design/brief.md`. That document's method is: *write the law and the brief before
any code — including the generic answer you are diffing against — then build only what the law
allows, then run the gate.*

This file is that brief. Nothing under `components/law/` or `app/v/law/` existed when it was
written. It is ordered by the law's own sections so each claim can be checked against the clause it
answers.

**Owner's brief (PASS3), which overrides everything below where they differ:** one page; hands-free
and voice-first; the agent does work visibly; container queries, never viewport media queries; type
sized for its container. The stated defect in tidycrm is that it has *"no main section from which we
would start and control the cx."* So this is a **command centre**: data blocks, the percentage of
not-yet-analysed data, errors on deviations, investigation by click or by voice, and Athena
**dispatching agents** — plural — to heal data, start analysis, and surface which blocks need
attention **and why**.

---

## 0. Two resident documents, one imported law — which one won, clause by clause

tidycrm already carries `DESIGN.md` and `design/SITE.md`, produced by a different method
(`google-labs-code/stitch-skills`, `taste-design` format). I read both. They are not merged silently.
Where they collide with the imported law, this is the ruling and the reason.

| Clause | Imported law (hirelane `DESIGN-LAW.md`) | Resident (`DESIGN.md`) | Followed | Why |
|---|---|---|---|---|
| Body type size | §1.2 `--hl-text-base: 0.9375rem` (**15px**) | §3 "Body never below 1rem" | **Resident** | The owner has now complained twice about default-small type, most recently at PASS3 ("Type sized for its container"). The imported scale was calibrated for a different app and ships the exact defect he named. Base is rebased to **17px**. |
| Fluid type | §1.2 clamps on `vw` | §3 "clamp() so they scale continuously" | **Neither, as written** | PASS3's container-query law makes `vw` wrong for the same reason `@media (width…)` is wrong: the CopilotKit sidebar shrinks `body` to ~800px at a 1280 viewport. A `vw` clamp reads the viewport and therefore lies. Every clamp here is on **`cqi`**. See §1 below — this is the sharpest defect the imported law carries. |
| Motion timing | §1.3 fixed durations + easings, stagger 40ms capped at 10 | §8 spring physics `stiffness 100 / damping 20`, stagger ~100ms × index | **Imported, with the resident's spring for interactive state** | §8's 100ms × index over a 46-row ledger is 4.6s to mount, which the imported law's cap exists to prevent and which is plainly a bug. Springs are kept for press/drag feedback only. |
| Serif | (silent) | §3 rejects `taste-design`'s blanket serif ban, permits Fraunces/Instrument Serif, bans default stacks | **Resident** | Literata is a webfont, not a default stack. |
| Inter | (silent) | §9 "No `Inter`" | **Resident** | Also already taken by `signal`. |
| `#000000` | (silent) | §9 "Never `#000000`" | **Resident** | Graphite bottoms out at `#1d1c1a`. |
| Card grids | §3 container-model gate | §6 "three equal cards in a row" banned | **Both, they agree** | Reinforcing, not conflicting. |
| Gate colour | §4.2 reserves a `gate` hue and an `auto` hue, used for nothing else | §2 reserves three governance colours | **Deviated — written down here as §4.2 requires** | The owner's colour instruction for this surface is black-and-white shades with green and red *used minimally to mark key data nodes*. Spending a third hue on the gate breaks that, and spending red on both deviations and the gate destroys the exclusivity both documents demand. **Resolution: the gate carries no colour at all.** It is structural — a physically separate, inverted region (the title block) at `--law-rule-3`. The imported law's own §7.1 prefers this ("expressed structurally… before any colour or badge is applied") and its §9.10 greyscale test passes trivially. `redline` = deviation only. `greenline` = checked/AUTO only. |
| Responsive verification | §9.15 "checked at 390/768/1280/1920 and *looked at*" | §7 same widths | **Both** | Done over CDP; see the report. |
| Divergence | §5 two variants, opposite on ≥5 of 7 axes | §0 dial table generates directions | **Inapplicable** | PASS3 asks for one best attempt, not two. §5 and gate items §9.8/§9.9 cannot be satisfied by a single direction — 3 of 17 gate lines are dead on arrival. Recorded as a limit, not silently skipped. |

One further structural conflict, resolved against both documents: `DESIGN.md` §4 and `SITE.md` §4
assume a direction spans three routes (`/v/x`, `/v/x/contacts`, `/v/x/review`). PASS3 law 1 forbids
that. `law` is **one route**.

---

## 1. LAW ONE — the scales (§1)

The imported law ships `design/hl-scales.css` and imports it from `app/globals.css`. **Two reasons
that cannot be reproduced here**, both recorded as portability findings:

1. PASS3 forbids editing `app/globals.css` — it is shared and the parent session owns it. So the
   scale layer cannot be a `:root` import; it lives inside `components/law/law.css` scoped to
   `[data-variant="law"]`. This is strictly better hygiene (it cannot leak into `/`, `/v/signal` or
   `/v/broadsheet`) and it means the law's §9.1 "outside `hl-scales.css` and the variant's own token
   block" collapses to just "the variant's own token block".
2. The law's fluid sizes are `clamp(…, … + Nvw, …)`. Under the CopilotKit sidebar the viewport is
   not the container, so those clamps mis-size by roughly a third at 1280. **Every fluid value here
   is on `cqi`**, read from a named container. This is a real defect in the artefact I was given,
   not a style preference.

Shipped as `--law-*` in `components/law/law.css`. Structure copied from the law; values rebased.

**Spacing** — ten steps, `4 · 8 · 12 · 16 · 24 · 32 · 48 · 64 · 96 · 128`. Adjacent regions of
different semantic rank differ by ≥ 2 steps.

**Type** — three separate scales, rebased upward:

```
--law-text-2xs   0.6875rem  (11px)   caps labels only, never anything else
--law-text-xs    0.8125rem  (13px)
--law-text-sm    0.9375rem  (15px)
--law-text-base  1.0625rem  (17px)   <- the resident floor, not the law's 15px
--law-text-md    1.1875rem  (19px)
--law-text-lg    clamp(1.40rem, 1.15rem + 1.4cqi, 1.75rem)
--law-text-xl    clamp(1.90rem, 1.40rem + 3.0cqi, 2.75rem)
--law-text-2xl   clamp(2.60rem, 1.70rem + 5.5cqi, 4.25rem)
--law-text-3xl   clamp(3.40rem, 2.00rem + 9.0cqi, 6.00rem)

--law-leading-tight 1.0  --law-leading-snug 1.15  --law-leading-normal 1.5  --law-leading-relaxed 1.65
--law-track-tight -0.025em  --law-track-normal 0  --law-track-wide 0.06em
--law-track-caps 0.14em     --law-track-caps-wide 0.2em
```

**Motion** — the law's durations and easings verbatim (`90/160/260/420/700/1200`, four easings,
`--law-stagger: 40ms`, cap 10). One signature motion, §6 below.

**Elevation** — this direction declares itself **shadowless**: `--law-elev-0` only. Depth is rule
weight (1/2/3px), inversion, and hatch density. A drawing sheet has no drop shadows on it.

**Rule / radius / measure** — `1/2/3px`; radius **0 everywhere** except the `999px` used by nothing;
measures `44ch / 62ch / 78ch`.

**`--dk-*` bridge** — aliased inside `[data-variant="law"]`, fifteen lines, no `.dk-*` class
redefined anywhere.

---

## 2. LAW SIX — Brief inference (§6). Seven fields.

| Field | Answer |
|---|---|
| **Domain reading** | 800 contacts across **46 email domains**. Every defect is a *stored, indexed flag*, not a model score: `phone_ok`, `is_stale`, `stale_flagged`, `conflict`, `in_open_pair`. 60 near-duplicate pairs, 43 confident, and `MergePair.evidence` is a list of **named rules with hand-set weights and a `detail` string saying what the rule saw** — confidence is the sum of those weights, not a prediction. `domainSpellings()` returns the competing company spellings on one email domain: a company-name conflict is literally *a deviation from the consensus spelling of a set*. Nothing in this app is a black box, so nothing on the surface may be. |
| **Audience & tone** | The person who has to hand a contact list to a campaign on Monday and be able to say which parts of it were checked and which were not. Their fear is signing off on a set they never actually looked at. Tone: measured, provisional, accountable. |
| **Mood adjective** | **Surveyed.** |
| **Layout family** | **The drawing sheet.** A single full-bleed sheet with a drafted border and registration ticks. Regions in survey order: sheet head → command line → **the plate** (an area-scaled survey plan of all 46 blocks) → the standing ledger → the dossier, drawn over the sheet when a block is investigated → the dispatch strip → **the title block**, inverted, bottom-right, holding the register of capabilities and every irreversible act. Nothing is centred; only prose is measure-clamped. |
| **Motion signature** | **The pencil draws.** Every arrival is a stroke laid down: `stroke-dashoffset` running to zero on inline SVG. The coverage bars draw; the check marks draw in two strokes; the redline scribbles across a deviant row; the dispatch trace draws from the strip to the parcel it reaches; the arming frame draws around the title block. One grammar, applied in one medium (SVG stroke), nowhere else. Numbers settle at `dur-5`. Everything else is press feedback at `dur-1/2`. |
| **Source direction** | **The drawing-office check print** — a graphite-on-vellum general arrangement drawing returned from the checker: hatched survey blocks, a title block in the corner carrying revision, checker and date, **redline** annotations marking what must change and **greenline** marks confirming what has been verified. Redline/greenline is a real, named, two-colour markup convention with no third colour. |
| **Why this source for this app** | A check print exists for exactly one reason: to record **what has been checked and what has not**, block by block, in a form that survives being handed to another person. That is the owner's "percentage of not-yet-analysed data", and no other genre in common use makes coverage its primary subject — a dashboard shows you totals, a check print shows you the *frontier*. Three further properties map one-to-one. (a) Hatching encodes *unsurveyed*, so an unchecked block is visually **noisier** than a checked one — the opposite of a progress bar, where empty is quiet, and the correct polarity for a surface whose job is to make unfinished work impossible to ignore. (b) Redline is by convention reserved for *deviation from the specification*, which is precisely what a phone outside `+1XXXXXXXXXX`, a company spelled three ways on one domain, or an unadjudicated identity pair each is. (c) The **title block** is a physically separate box, drawn differently from the drawing, and it is the only part of the sheet with authority — a print is not issued until it is signed there. That gives GATED a structural home, so the gate is a *place*, not a badge, and it survives the greyscale test by construction. |

---

## 3. LAW THREE — the container model gate (§3)

The imported law's inventory is hirelane's. tidycrm needs its own; this is it, and it is binding.

| Concept | Shape of the data | Required container | Forbidden |
|---|---|---|---|
| The 46 blocks, as an overview | homogeneous, 3 comparable scalars each (records, coverage, deviations), sizes 5–40 | **area-scaled survey plate** — bespoke SVG, area ∝ records, hatch ∝ unchecked, redline ∝ deviations | equal-size card grid; a donut of totals; a bar chart that throws away which block is which |
| The 46 blocks, for comparison and action | same rows, five comparable columns | **ruled row list**, aligned tabular columns, hairline between rows, no gaps | cards, kanban, tiles |
| Coverage of a block | one fraction with a named denominator | **ruled bar, filled graphite, remainder hatched** — the Standing ledger's device (§7) | a percentage alone; a ring |
| Why a block needs attention | 1–4 named deviation kinds with real counts | a sentence built from the counts, **at row level**, plus the kinds as marks | a tooltip; "3 issues" |
| A pair's confidence | 1–4 named rules, each weight + `detail` | itemised weighted rule list that visibly **sums** to the confidence | a bare percentage; a progress ring |
| Company spellings on one domain | 2–4 competing strings with counts | consensus first, deviants **redlined**, counts aligned | a badge row |
| One block under investigation | one heterogeneous object read closely | **this is the dossier / card case** | a row |
| A pair under adjudication | two records, field by field | two-column field-aligned comparison | two cards side by side |
| Agents in flight | time-ordered dispatch records, each fanning out to N blocks | ordered dispatch list with per-block returns landing individually | a spinner; one aggregate progress bar |
| Activity | time-ordered, mixed action types | the demo-kit `.dk-activity` list | a rebuilt feed |

**The interesting datum.** In hirelane it was the gap. Here it is **the frontier**: which blocks are
unchecked *and* deviant. A surface that renders one aggregate "87% clean" has deleted the reason to
open the app, because the 13% is not spread evenly — it is concentrated in ten conflict domains, and
naming them is the whole job.

---

## 4. LAW FOUR — copy allow-list, colour lock, icon inventory

### 4.1 Copy allow-list

Above the fold, only these strings plus values read from the database.

- The app name: `tidycrm`.
- `SEGMENT_LABELS`, `SEGMENT_HINTS`, `RULE_LABELS`, `RULE_HINTS` — exact strings from `lib/`.
- Evidence `label` and `detail`, company names, domain names, contact names, counts — from the DB.
- Exactly one orienting line, chosen from:
  - `Every deviation names the rule that found it.`
  - `Coverage is what has been checked, not what exists.`
  - `Nothing is merged that a person did not arm.`
- The honesty line, verbatim, once, visible without interaction:
  `Athena is not connected yet. Every capability below is registered and waiting.`
- The two class words in their manifest sense only: `AUTO`, `GATED`.
- **Added to the list, with the reason §4.1 demands:** the drawing-office vocabulary —
  `SHEET`, `PLATE`, `BLOCK`, `LEDGER`, `TITLE BLOCK`, `REVISION`, `CHECKED`, `UNCHECKED`,
  `DEVIATION`, `REDLINE`, `DISPATCH`, `SURVEY`, `HEAL`, `FLAG`, `ADJUDICATE`, `ARM`, `FIRE`.
  Reason: PASS3 law 2 requires every manipulation to be **addressable by name**, because that is
  what makes it addressable by voice and by an agent. A vocabulary is therefore a functional
  requirement here, not decoration, and each of these words is both a term of the source discipline
  and a literal command the command line accepts.

**Forbidden anywhere:** any sentence in which Athena has done, is doing, or will shortly do
something. The dispatch strip is explicit that dispatches are run by the app's own server actions,
by hand, and that Athena is not connected — see the report's live/presentational table.

### 4.2 Colour lock

Two hue-bearing tokens. Everything else is a four-step graphite ramp plus two paper values —
signal's ink-ramp device, which is the part of it the owner rates.

| Token | Value | Sole use |
|---|---|---|
| `--law-vellum` | `#e7e2d6` | the ground the sheet lies on |
| `--law-sheet` | `#f4f1e9` | the drawing sheet |
| `--law-graphite` | `#1d1c1a` | primary ink; the title block's ground when inverted |
| `--law-graphite-2` | `#4f4d48` | secondary ink |
| `--law-graphite-3` | `#7e7a72` | tertiary ink, hatch stroke |
| `--law-graphite-4` | `#a8a49a` | quaternary, faint hatch |
| `--law-rule` | `#c6c1b4` | hairlines |
| `--law-redline` | `#b3261e` | **DEVIATION ONLY.** Never a fill, never a background, never a border on a container. Always a drawn stroke or a mark. |
| `--law-greenline` | `#2e6b40` | **CHECKED / AUTO ONLY.** |

The gate is not in this table on purpose. See §0.

### 4.3 Icon inventory

**Bespoke inline SVG, drawn for this app:** the four hatch patterns (`h0` clear, `h1`, `h2`, `h3`
dense cross-hatch) as SVG `<pattern>` defs; the two-stroke check mark; the redline stroke (a
hand-drawn path with real jitter, not a straight rule); the coverage bar with its tick detents; the
survey plate parcels; the dispatch trace; the sheet border with its drafting ruler ticks and
registration corner marks; the paper tooth (an `feTurbulence` grain on a `pointer-events:none`
layer); the title-block arming frame; the weight bar for an evidence rule.

**`lucide-react`:** `ChevronRight`, `X`. Nothing else.

No raster assets. No runtime font, image or script request beyond the three faces wired through
`next/font`.

---

## 5. Typography — the one thing the owner rates in `wild` and `signal`

He named their typography as the only element of either he can push as a good example, so the
*strategy* is imported deliberately and the *faces* deliberately are not.

**Taken from `wild`:**
- **Variable-axis pinning as an editorial decision.** `wild` sets `font-variation-settings: "wdth"
  88, "opsz" 48` on its h1 and a different pairing on the brand. Every display face here is pinned:
  drafted lettering at `wdth 84`, the brand at `wdth 78`, ledger figures at `wdth 87.5`. It is the
  most distinctive move in that file and it costs nothing.
- **Two tracking values in strict opposition, nothing between them** — negative on display, strongly
  positive on small caps.
- **Uppercase is reserved for labels and never appears above 13px.**
- **Oversized numerals as markers** — the block ident and the coverage figure are set as display.

**Taken from `signal`:**
- **A four-step ink ramp doing the work weight usually does.** All display weight stays 400–500;
  hierarchy comes from size, tracking and which graphite step the type is set in.
- **The display face is reserved for "a heading or a big number", with a hard break.** Below `md`
  nothing is set in the display face.
- **Mono is the machine voice, always small, always uppercase-tracked, never a sentence.**
- **Leading inversely scaled** — 1.0 at display, through 1.15 and 1.5, to 1.65 for annotation prose.
- **Four different measures for four roles**, not one global `max-width`.

**Faces** — three, none of them used anywhere else in tidycrm (the app already spends Bricolage
Grotesque, DM Sans, DM Mono, Inter Tight, Inter, JetBrains Mono, Playfair Display, Source Serif 4,
Work Sans and IBM Plex Mono):

| Role | Face | Deployment |
|---|---|---|
| Drafted lettering | **Archivo** (variable, `wdth` axis pinned) | headings, block idents, section titles, all caps labels. The lettering stencilled on a drawing. |
| Annotation prose | **Literata** (variable `opsz`) | the "why this block needs attention" sentences, evidence `detail`, captions. The surveyor's written remark. Clamped to 62ch / 44ch. |
| Figures and identifiers | **Martian Mono** (variable, `wdth` pinned narrow for dense columns) | every number in the ledger, every ident, every weight. `font-variant-numeric: tabular-nums` without exception. |

The two-voice split — **drafted** versus **written** — is the direction's typographic claim: what
the office prints is set in Archivo caps; what a person noted in the margin is set in Literata.

---

## 6. LAW TWO §2.2 — the diff gate. Written before the code.

> **Generic answer.** *(What an agent with no constraints produces for "a CRM data-quality command
> centre with agents".)* A `bg-slate-50` page, `Inter` throughout. A sticky top bar with the app
> name and an avatar. A row of **four equal KPI cards** — Total Contacts 800, Duplicates 60, Stale
> 110, Data Quality 87% — each `rounded-xl border border-slate-200 bg-white shadow-sm p-6`, each
> with a `lucide-react` glyph in a `bg-blue-50` rounded square and a green `↑ 12%` under the number.
> Below them a two-thirds/one-third split: on the left a **grid of issue cards**, one per defect
> type, each with a coloured pill (`bg-red-100 text-red-700` for critical, amber for warning) and a
> "Fix with AI ✨" button; on the right a Recharts donut of defect distribution in the library's
> default palette with an unlabelled legend. Under that, a "Recent Activity" card with a `<ul>` of
> rows each led by a coloured dot. A right-hand chat drawer titled **"Ask AI"** with a sparkles
> icon, a `Analyzing your data...` shimmer, and three suggested-prompt chips. Headline: *"AI-Powered
> Data Quality, Effortlessly"* over an 18-word subhead restating it. Every card fades up 20px on
> mount with a 60ms stagger. Destructive actions are red buttons with `window.confirm`. Uniform
> `gap-4` everywhere, `rounded-xl` on everything including the page shell, one blue accent on a
> slate ramp, and a purple-to-blue gradient on the primary CTA.

> **Diff — item by item, and why the domain demands it.**
>
> 1. **The four KPI cards become one plate.** Four aggregate numbers in four equal boxes is the
>    exact failure the owner rejected all four apps for, and it answers no question: 87% clean does
>    not tell you *which* records. Forty-six blocks at area ∝ record count, hatched by coverage,
>    is the same information with the identity kept — and it is the "main section from which we
>    start and control the cx" whose absence is the stated defect. §3, row 1.
> 2. **Hatch polarity is inverted against every progress bar in the generic answer.** Unchecked is
>    *noisy*; checked is quiet. A dashboard rewards you visually for the work already done; a check
>    print makes the remaining frontier the loudest thing on the sheet. This is the single decision
>    the source direction contributes that a KPI card cannot.
> 3. **The donut dies.** Defect distribution as a pie throws away which domain, which record, and
>    which rule. It becomes the standing ledger: 46 ruled rows, aligned tabular columns, sortable,
>    filterable, each with its coverage bar and its named deviations. §3, row 2.
> 4. **"3 issues" becomes a sentence built from the data.** Every row states *why*, in the
>    annotation serif, from real counts and real rule names: `Four numbers are not stored as
>    +1XXXXXXXXXX; "Northwind Traders" is spelled three ways on this domain; two identity pairs have
>    never been adjudicated.` The owner asked for "which blocks need attention **and why**" — the
>    "why" is a clause, at row level, not a tooltip.
> 5. **Confidence is never a bare percentage.** It decomposes into the named matching rules with
>    their hand-set weights, visibly summing. `MergePair.evidence` carries a `detail` string saying
>    what the rule saw; it is printed verbatim. Both the imported law (§3) and the resident
>    `DESIGN.md` (§4) demand this independently, which is the strongest signal in either document.
> 6. **No pills, anywhere.** Deviation kind is a drawn mark; class is rule weight; coverage is a
>    hatched bar; state is position on the sheet. Nine of the generic answer's fifteen visual
>    elements are bordered badges, which is why nothing in it is emphasised.
> 7. **"Fix with AI ✨" becomes a dispatch with named agents.** Five agents, each bound to a real
>    registered capability, each classed: `SURVEY` (read-only, `previewNormalizeAction`), `HEAL`
>    (AUTO, `normalizeAction`), `FLAG` (AUTO, `flagStaleAction`), `ADJUDICATE` (read-only,
>    `previewMergeAction`), `FOLD` (GATED, `mergeAction`). Dispatch fans out across the selected
>    blocks concurrently and each block's return lands on its own row as it arrives — that is what
>    "dispatch agents, plural" has to look like, and a single aggregate progress bar would hide it.
> 8. **The chat drawer becomes a command line, and the drawer is not the agent story.** Tell #15:
>    if deleting the rail leaves a UI that knows nothing about agents, the agent is not a first-class
>    inhabitant. Here the sheet is addressed by a small typed grammar — `survey blk-07`,
>    `heal blk-03`, `open blk-12`, `filter conflict`, `clear` — which is stated on the surface to be
>    the **text channel of the grammar a voice channel would speak**. No fake microphone, no fake
>    transcription. Every block carries a speakable ident (`BLK-07`) and every agent a speakable
>    name, because PASS3 law 2 makes addressability the design requirement.
> 9. **`window.confirm` becomes the title block.** Irreversible acts are removed from the sheet
>    entirely and exist only inside the inverted title block, which arms then fires, names the exact
>    records, states what cannot be undone, and disarms itself on a timeout. A confirm dialog is a
>    speed bump; a signature block is a place you have to go.
> 10. **The palette is two hues, not a slate ramp with a blue.** Graphite in four steps on vellum,
>    with redline and greenline spent only on data nodes. This is the owner's own instruction for
>    the Standing ledger, generalised to the sheet.
> 11. **Motion is one signature, not a uniform fade-up.** Strokes are drawn. Nothing translates on
>    mount.
> 12. **Every number traces to a query.** No invented uptime, no `↑ 12%` — there is no prior period
>    in this database to compare against, so a trend arrow would be fabricated. Tell #12 and the
>    resident `DESIGN.md` §9 agree and this is repo law, not taste.

---

## 7. The Standing ledger, developed — the owner's specific instruction

> *"Broadsheet has one specific section for Standing ledger which can be developed into style
> 'pencil on paper' and be developed further with black and white color shades, using minimally
> green and red to point out key data nodes."*

What is there now (`components/broadsheet/BroadsheetFigures.tsx:126–155`,
`broadsheet.css:292–326`): four rows, each a label + a `done/total` mono fraction + a 10px ruled bar
whose fill is solid `#1a1a1a` and whose remainder is a 45° `repeating-linear-gradient` at 3px/1px,
50% opacity. `gap: 0`, hairlines between rows, `border-radius: 0`, no shadow, no colour at all —
the block uses only `#1a1a1a`, `#000000`, `#4a5568`, `#757575`, `#ffffff`. Rows animate with
`scaleX` from 0 over 420ms.

It is already most of the way to pencil on paper. The four things developed here:

1. **Four fixed rows become forty-six data rows.** The existing block is a static summary of the
   whole database; the ledger here is the block list itself, sortable, filterable, addressable, and
   the ledger *is* the working surface rather than a figure beside a histogram.
2. **The hatch stops being mechanical.** `repeating-linear-gradient` is a machine rule. It is
   replaced by SVG `<pattern>` hatching in four densities bound to coverage quartiles, with a paper
   tooth layer over the sheet, so the remainder reads as pencil rather than as a screen texture.
   Hatch density now carries data — in broadsheet it was decoration on a fixed remainder.
3. **Green and red enter, minimally, and only on data nodes.** A block at full coverage takes a
   drawn greenline check in the ident column and nothing else. A block carrying deviations takes a
   redline stroke — hand-drawn, jittered, never a fill — through the deviation column only. No row
   background, no border, no pill. The rest of the ledger stays in the graphite ramp exactly as
   broadsheet has it.
4. **`scaleX` becomes a drawn stroke.** `transform: scaleX()` stretches the bar's own texture, which
   is why broadsheet's hatch had to be a separate `::after`. A `stroke-dashoffset` path draws the
   graphite in at its true weight, and the hatch is simply revealed beneath — which is what a pencil
   does and what the signature motion is.

---

## 8. LAW SEVEN, adapted — the gate is structural (§7)

From `components/shell/HostCapabilities.tsx`, unmodified:

- **AUTO, reversible** — `normalize_fields`, `flag_stale` and `resolve_pair` write `revisions` or
  `merge_pairs` rows and store an undo payload `undoActivity` replays backwards; `navigate`,
  `export`, `preview_merge`, `preview_normalize` and `read_state` have `sideEffects: "none"`
  (`export` excepted: it is `data`, and reversible, so still AUTO).
- **GATED, irreversible** — `merge_contacts` (two histories become one), `delete_contacts` (gone
  from every segment) and `undo` itself. The first two store no undo payload because there is
  nothing to store; `undo` stores none because `undoActivity` writes its own row
  `reversible: false` — an undo cannot be undone, so the rule gates it whatever it feels like.

Reversibility buys the AUTO class. Not harmlessness.

1. The distinction is **structural before it is anything else**: GATED acts exist only inside the
   inverted title block, at `--law-rule-3`, physically separated from the sheet. Greyscale the page
   and they are still the only inverted region on it.
2. **Arm then fire**, two deliberate acts, auto-disarming on a timeout, with the arming frame drawn
   on. Not a `confirm()`.
3. Arming **names the records and states what cannot be undone** — the two contact names, the
   surviving id, and the sentence that the two histories become one.
4. The **register of capabilities is on the sheet**, in the title block: all seven, each with its
   class. The demo-kit drawer is a supplement.
5. Copy stays in the present tense of registration.

---

## 9. Pre-ship gate — answered with evidence

The imported law's §9, run at the end. Three lines cannot be answered by a single direction and are
recorded as inapplicable rather than skipped.

| # | Line | Result |
|---|---|---|
| 1 | No raw pixel outside the token block | **Pass with three named exceptions**, written at the foot of `law.css`: `44px` touch minimum (`DESIGN.md` §4 accessibility floor), `1px` press nudge (same section), `3px` underline offset. SVG pattern geometry stays in the components as screen texture. |
| 2 | `--dk-*` aliased, no `.dk-*` redefined | **Pass.** `grep -nE '^\s*\.dk-' components/law/*.css` → empty. Fifteen-line alias block only. |
| 3 | ≥4 spacing steps, ≥3 type sizes on the primary screen | **Pass.** Eight spacing steps and seven type sizes in use. |
| 4 | The fifteen tells, on the rendered page | **Pass.** Walked against the screenshots, not the markup. No card grid, no pills, no gradient text, no fade-up, no library chart colours, no marketing verbs, no chat-rail-as-agent-story. Tell #6 (a lucide glyph as a domain metaphor) is avoided by construction: `lucide-react` supplies `X` and nothing else in the shipped tree. |
| 5 | The diff gate was written before the code | **Pass.** §6 above was on disk before `components/law/` existed. |
| 6 | Every concept in its required container (§3) | **Pass.** Plate for the overview, rows for the comparison, dossier only for the one block being read, itemised weighted rules for confidence, ordered per-block returns for dispatch, demo-kit `.dk-activity` for the log. |
| 7 | The interesting datum legible at row level | **Pass.** Each ledger row states *why* in a clause built from real counts, plus the named deviation marks. Not a tooltip. |
| 8 | Two variants opposite on ≥5 of 7 axes | **Inapplicable.** PASS3 asks for one best attempt. |
| 9 | A reason to prefer A, a different reason to prefer B | **Inapplicable**, same cause. |
| 10 | Greyscale test: gated still identifiable | **Pass, measured.** Computed `border-inline-start-width` over CDP: `read: 2px`, `auto: 2px`, `gated: 3px`, and every GATED act lives only inside the inverted title block — the one inverted region on the sheet. |
| 11 | Gated control arms, names the record, says what cannot be undone | **Pass, exercised in the browser.** Armed copy read back: *"Kira Chan (kira.chan60@ashfield-supply.example) survives. Kira Chan (kira.chan@personal.invalid) is folded in. The two histories become one and no undo payload is stored, because there is nothing to store. 3 field values on the dropped record are lost from the live list: email, phone, …"* Arm → `data-armed=true`, self-disarms after 12s, separate Disarm and Clear controls. |
| 12 | `gate` and `auto` hues nowhere decorative | **Pass.** The gate has no hue at all (§0). Greenline appears only on AUTO class marks, the consensus spelling, a cleared check and a clear block. Redline only on deviations. |
| 13 | Honesty line present, verbatim, without interaction | **Pass.** Twice: sheet head and title block. |
| 14 | Every number traces to a query | **Pass.** All figures derive from `segmentRows`, `listOpenPairs`, `domainSpellings`, `listActivity` and the two preview actions. No trend arrows, no invented totals — there is no prior period in this database to compare against. |
| 15 | Checked at 390 / 768 / 1280 / 1920, and *looked at* | **Pass.** Driven over CDP; screenshots read back as images, which is how four real bugs were found (see the report). Zero elements overflow the sheet at the tightest container (260px). |
| 16 | `prefers-reduced-motion` lands on final states | **Pass, measured.** With the media feature emulated: `animation-name: none` on the ink wipe and every drawn stroke; strokes at `stroke-dashoffset: 0`; bars at their true coverage (`33% → inset(0 66.7% 0 0)`, `64% → inset(0 36% 0 0)`). Not a faster animation — the end state. |
| 17 | typecheck, lint, routes 200 with real content | **Pass.** Both clean; `/`, `/v`, `/v/signal`, `/v/broadsheet`, `/v/law` all 200. |

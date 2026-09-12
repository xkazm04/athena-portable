# Hirelane Design Law

**Status:** binding for everything under `app/v/` and `components/` in this app.
**Audience:** an agent or a person about to design or build a hirelane surface.
**Precondition:** none. You do not need to read any external skill, article or repo to follow this
document. Everything it depends on is written down here.

---

## 0. Why this document exists instead of a fifth generator

Three published surveys of AI design skills agree on one test, and disagree about almost nothing
else:

- *Best UI/UX Design Skills for AI Coding Agents (2026)* (getclaudeskills.com) states the bar
  directly: a skill earns its place by "encoding a specific design system or tool workflow that the
  agent would otherwise improvise badly, or supplying a checklist and vocabulary that turns 'make it
  look nice' into something checkable." Its ten entries are ranked by what they *bundle* — a
  searchable database of 84 styles and 192 palettes; a five-dimension scored critique with a radar
  chart; a set of anti-slop tells. The entries that bundle nothing are marked as such.
- *Trending AI Design Skills to Watch in 2026* (awesomeskill.ai) maps skills to jobs-to-be-done and
  argues the useful ones are the ones that **reduce ambiguity**: they supply "inspection routines and
  visual constraints", "existing patterns to match", and "protection against generic aesthetics".
  The useless ones lack "real product context and constraints" and "specific visual rules".
- *Best AI Tools for UI Design in 2026* (agensi.io) draws the line between standalone generators and
  agent setups: "Standalone tools generate isolated components or mockups. Agent-based tools
  generate UI code that fits into your actual project," and then: "If your team has a design system,
  a skill that encodes it replaces the need for any external design tool."

Read together, the claim is narrow and testable: **the value is in the encoded constraints and the
project's own system, not in the generator.** This repo ran four generators in parallel in round 1.
All four were kept only for their constraints; all four generative pipelines were discarded. And the
third article's precondition — "if your team has a design system" — was measured false here:
`examples/demo-kit/src/ui/demo-kit.css` is **15 custom properties, one radius, one gap, one shadow,
and zero spacing, type or motion scales.** It is a theming hook, not a design system.

So this document does the two things the articles say actually work, and nothing else:

1. **Section 1 supplies the missing system** — real spacing, type, motion, elevation, rule and
   measure scales, shipped as code at `design/hl-scales.css`.
2. **Sections 2–8 are the checklist and vocabulary** — seven laws, each falsifiable, each with a
   named failure it exists to prevent.

Section 9 is the pre-ship gate. If you cannot answer every line of section 9 with evidence, the work
is not done, regardless of how it looks.

---

## 1. LAW ONE — The scales exist. Use them. Never type a raw number.

The hole round 1 measured is filled by `examples/hirelane/design/hl-scales.css`, imported once from
`app/globals.css`. It defines `--hl-*` properties on `:root` and **overrides nothing** — it adds no
`.dk-*` rule and changes no existing property, so the shipped design at `/` is bit-identical with or
without it. Variants consume it and alias `--dk-*` from it (§1.6).

### 1.1 Spacing — 10 steps, geometric with a flat head

```
--hl-space-1   4px      --hl-space-6    32px
--hl-space-2   8px      --hl-space-7    48px
--hl-space-3   12px     --hl-space-8    64px
--hl-space-4   16px     --hl-space-9    96px
--hl-space-5   24px     --hl-space-10   128px
```

**Rule:** any two vertically adjacent regions of different semantic rank must differ by **at least
two steps**. Header→content is `space-7` or more; label→value is `space-1`. A page whose every gap is
`space-3` is the uniform-12px failure by definition, and §2 tell #1 catches it.

### 1.2 Type — size, leading and tracking are three separate scales

```
--hl-text-2xs   0.6875rem      --hl-text-lg   clamp(1.25rem, 1.10rem + 0.6vw, 1.50rem)
--hl-text-xs    0.75rem        --hl-text-xl   clamp(1.60rem, 1.30rem + 1.4vw, 2.25rem)
--hl-text-sm    0.8125rem      --hl-text-2xl  clamp(2.20rem, 1.60rem + 2.8vw, 3.50rem)
--hl-text-base  0.9375rem      --hl-text-3xl  clamp(3.00rem, 2.00rem + 5.0vw, 5.50rem)
--hl-text-md    1.0625rem

--hl-leading-tight 1.05   --hl-leading-snug 1.2   --hl-leading-normal 1.5   --hl-leading-relaxed 1.7
--hl-track-tight -0.03em  --hl-track-normal 0     --hl-track-wide 0.06em    --hl-track-caps 0.12em
```

**Rules.**
- Display sizes (`xl` and up) take `--hl-leading-tight` and `--hl-track-tight`. A 3rem headline at
  1.5 line-height is the single most reliable amateur tell in this repo's rejected apps.
- All-caps labels take `--hl-track-caps` and never exceed `--hl-text-2xs`.
- Numbers that are compared to each other (scores, counts, weights) are set in the variant's mono or
  a tabular-figure face with `font-variant-numeric: tabular-nums`. Non-negotiable: a score column
  that jitters between rows is a data-integrity signal, not a style choice.

### 1.3 Motion — durations, easings and one stagger

```
--hl-dur-1  90ms    --hl-dur-4   420ms      --hl-ease-standard cubic-bezier(0.2, 0, 0, 1)
--hl-dur-2  160ms   --hl-dur-5   700ms      --hl-ease-entrance cubic-bezier(0.05, 0.7, 0.1, 1)
--hl-dur-3  260ms   --hl-dur-6  1200ms      --hl-ease-exit     cubic-bezier(0.3, 0, 0.8, 0.15)
--hl-stagger 40ms                           --hl-ease-snap     cubic-bezier(0.85, 0, 0.15, 1)
```

**Rules.**
- Feedback on a press: `dur-1`/`dur-2`, `ease-standard`. Entrance of new content: `dur-3`,
  `ease-entrance`. Removal: `dur-2`, `ease-exit`. A number settling to its value: `dur-5`.
- **One signature motion per variant, named in its brief.** Everything else is feedback. A page where
  every element fades up 20px on mount has no signature; it has a default.
- List staggers use `--hl-stagger` and cap at 10 items — beyond that the last item is late enough to
  read as a bug.
- Every motion path has a `prefers-reduced-motion` branch that lands on the **final state**, not on a
  faster version of the animation. `motion/react` components read `useReducedMotion()` themselves;
  CSS animation is already neutralised globally in `app/globals.css`.

### 1.4 Elevation — five steps, layered, never a single blur

```
--hl-elev-0  none
--hl-elev-1  0 1px 2px rgb(0 0 0 / 4%), 0 1px 1px rgb(0 0 0 / 3%)
--hl-elev-2  0 2px 4px rgb(0 0 0 / 5%), 0 4px 12px rgb(0 0 0 / 5%)
--hl-elev-3  0 4px 8px rgb(0 0 0 / 6%), 0 12px 28px rgb(0 0 0 / 8%)
--hl-elev-4  0 8px 16px rgb(0 0 0 / 8%), 0 32px 64px rgb(0 0 0 / 12%)
```

A variant may declare itself **shadowless** and build depth from rule weight, inversion and colour
instead — that is a legitimate direction (§5 requires the two variants to disagree about this). What
is not legitimate is 1px borders everywhere as the only depth in the file.

### 1.5 Rule weight, radius, measure

```
--hl-rule-1 1px   --hl-rule-2 2px   --hl-rule-3 3px
--hl-radius-0 0   --hl-radius-1 3px   --hl-radius-2 6px
--hl-radius-3 10px  --hl-radius-4 18px  --hl-radius-round 999px
--hl-measure-prose 62ch   --hl-measure-narrow 44ch   --hl-measure-wide 78ch
```

Rule weight is a **semantic ladder in this app** — see §7. Any block of running prose (a CV extract,
an evidence quote, a rejection template body) is clamped to `--hl-measure-prose` or narrower.

### 1.6 The `--dk-*` bridge — alias, never fork

The demo-kit's shared components (activity log, toasts, manifest drawer) read `--dk-*`. A variant
gets them for free by aliasing inside its own `[data-variant]` block, roughly fifteen lines:

The example below is written for `lantern`, a round-1 direction that was reviewed out. It is kept
as the SHAPE of the block rather than as a live reference; `components/board/style/base/tokens.css`
is the one in the tree.

```css
[data-variant="lantern"] {
  --dk-accent: var(--lan-ember);
  --dk-accent-contrast: var(--lan-paper);
  --dk-surface: var(--lan-card);
  --dk-surface-2: var(--lan-ground);
  --dk-ink: var(--lan-ink);
  --dk-ink-soft: var(--lan-ink-2);
  --dk-line: var(--lan-rule);
  --dk-radius: var(--hl-radius-3);
  --dk-gap: var(--hl-space-3);
  --dk-font: var(--font-karla), ui-sans-serif, system-ui, sans-serif;
  --dk-font-display: var(--font-instrument), Georgia, serif;
  --dk-font-mono: var(--font-dm-mono), ui-monospace, monospace;
  --dk-shadow: var(--hl-elev-2);
  --dk-gated: var(--lan-gate);
  --dk-auto: var(--lan-auto);
}
```

**Forbidden:** redefining any `.dk-*` class selector in a variant stylesheet. Round 1 found six
genuine `.dk-*` overrides between the kit and one app; every one of them was a variant reaching past
the token seam. If a `.dk-*` component looks wrong in your direction, you have the wrong token
values, or you should not be using that component.

---

## 2. LAW TWO — The tell list, and the generic-answer diff gate

### 2.1 The tells

Before you write a component, and again before you ship, check the surface against this list. Each
line is a specific, observable defect, not a matter of taste.

1. **One gap for everything.** Every vertical rhythm in the file is the same value.
2. **Card grid for a comparable set.** See §3 — this is the container-model failure and it gets its
   own law.
3. **1px borders as the only depth.** No layered light, no gradient, no inversion, no rule ladder.
4. **Neutral grey plus one accent.** Slate/zinc ramp with a single blue or violet. No colour story.
5. **The default type voice.** Inter/Geist/system as the whole pairing, no display face, or a display
   face used at body sizes only.
6. **Emoji or a lucide glyph as the entire visual metaphor** for a domain concept that deserves a
   drawn mark.
7. **One radius everywhere**, usually 12px, usually on everything including the page shell.
8. **Gradient text on the headline.** Related: a gradient that runs from a colour to a lighter tint
   of itself, which is a fade, not a gradient.
9. **Pill soup.** Every attribute rendered as a bordered badge, so nothing is emphasised.
10. **Centred hero, two-button row, 18-word subhead** that restates the headline in weaker words.
11. **Uniform fade-up-on-mount** as the only motion in the app.
12. **Numbers that did not come from the database.** Any figure on screen must be traceable to
    `lib/queries.ts` or be visibly labelled as an example.
13. **Library-default chart colours**, or a chart whose axes are unlabelled because the library did
    not label them.
14. **Marketing verbs.** "AI-powered", "seamlessly", "beautiful", "effortless", "supercharge",
    "revolutionise". Also any claim that Athena is doing something — she is not onboarded (§4).
15. **The agent as a right-hand chat rail** and nothing else. If deleting the rail leaves a UI that
    knows nothing about agents, the agent is not a first-class inhabitant (§7).

### 2.2 The diff gate — mandatory, written, before code

For each variant, before writing a single component, write into the variant's brief:

> **Generic answer.** *(What an agent with no constraints would produce for this screen — state it
> plainly, in specifics: the layout, the palette, the fonts, the containers, the motion.)*
>
> **Diff.** *(What this variant does instead, item by item, and why the domain demands it.)*

This gate is the only mechanism in this document that has been demonstrated to change output rather
than merely describe it. It works because writing the generic answer down makes it unavailable —
you cannot unknowingly produce the thing you just described. **Do not skip it and do not write it
after the fact.** A diff written after the code is a rationalisation, and it will read like one.

---

## 3. LAW THREE — The container model gate

> **Do not turn table-driven concepts into card grids.**

This is the direct diagnosis of why all four of this repo's example apps were rejected on sight: they
read as badge-and-card-grid admin panels. A card is the right container for a *heterogeneous* object
you consider on its own. A row is the right container for a *homogeneous* object you compare against
its peers. Recruiting is comparison. Almost everything in hirelane is a row.

**Hirelane's binding container inventory.** Do not deviate without writing the reason in the
variant's brief:

| Concept | Shape of the data | Required container | Forbidden |
|---|---|---|---|
| The applicant longlist | 20+ homogeneous rows, 5 comparable scalars each | table / row list with aligned score columns | card grid, kanban tiles |
| A scorecard (5 criteria × score × weight × evidence) | small fixed set, one per applicant | aligned bar/axis set with the weight visible | 5 separate badges; a single averaged number with no breakdown |
| Evidence sentences | 0–4 verbatim quotes per criterion | quotation, attributed to the criterion that matched | a tooltip; a truncated one-liner |
| Pipeline stages | 5 ordered buckets with counts | ordered ladder/rail preserving the order | an unordered chip row, a pie chart |
| Slots and messages | time-ordered records | list ordered by time | cards |
| Activity log | time-ordered, mixed action types | the demo-kit `.dk-activity` list | a rebuilt custom feed |
| A single applicant under consideration | one heterogeneous object being read closely | this **is** the card / reading pane case | a row |

**The gap is the interesting datum.** `Insight.gap` names the one criterion an application carries no
evidence for. A design that renders a scorecard as an average and drops the gap has deleted the only
thing a hiring manager actually needs. The gap must be visible **at row level**, without opening the
applicant.

---

## 4. LAW FOUR — Copy allow-list, colour lock, icon inventory

### 4.1 Copy allow-list

Above the fold, a variant may use only strings drawn from this list, plus values read from the
database. Anything else must be added to the list here first, with a reason.

- The app name: `Hirelane`.
- The role's own words: `role.title`, `role.team`, `role.brief`, `role.question` — from the DB.
- Stage labels from `STAGE_LABEL`, score labels from `SCORE_LABEL`. Exact strings, no synonyms.
- Counts and scores from the counts on the board payload (`lib/board/`) and the stored scorecards.
- Exactly one orienting line, chosen from:
  - `A hiring manager without a recruiter.`
  - `Every score points at the sentence that earned it.`
  - `Decisions that reach a candidate stop here first.`
- The honesty line, verbatim, once per variant, visible without interaction:
  `Athena is not connected yet. Every capability below is registered and waiting.`
- The two class words, used only in their manifest sense: `AUTO`, `GATED`.

**Forbidden anywhere:** any sentence in which Athena has done, is doing, or will shortly do
something. She is not onboarded. Present tense of registration, never past tense of work.

### 4.2 Colour lock

Each variant declares **at most five** hue-bearing tokens plus a ground/ink pair, in its brief,
before implementation. After that the palette is locked: no new colour may be introduced in a
component file. Two of the five are spoken for by law:

- **`gate`** — the colour of an irreversible act that reaches a person. Used for nothing else, ever.
- **`auto`** — the colour of a reversible act. Used for nothing else, ever.

If those two hues appear as decoration anywhere in the UI, the gate signal is destroyed and the
variant fails §9.

### 4.3 Icon inventory

List every icon the variant uses, in its brief, before implementation. `lucide-react` is available
for genuinely utility glyphs (chevron, close, external link, search). Every **domain** mark —
the gate, the seal, the criterion axis, the gap, the stage ladder, the evidence citation — is
**bespoke inline SVG** drawn for this app. No raster assets. No runtime font, image or script
requests beyond the faces already wired through `next/font`.

---

## 5. LAW FIVE — The divergence rule

> **Three variants that differ in spacing, colour and radius are one variant.**

Two hirelane directions are only two directions if they take **opposite positions on at least five**
of these seven axes, and the positions are written into the briefs before either is built:

1. **Layout family** — what is the primary organising structure of the page, and does the second
   variant use a different one? (Reading spine vs. full-bleed instrument; asymmetric split vs. single
   column; rail-anchored vs. header-anchored.)
2. **Depth model** — layered light/gradient/grain vs. shadowless rule-weight-and-inversion.
3. **Type voice** — high-contrast serif display vs. grotesque/technical; and whether figures are
   mono or proportional.
4. **Colour temperature and role** — warm chromatic field vs. cold near-achromatic with one signal.
5. **Motion character** — organic settle/bloom vs. mechanical step/tick.
6. **How evidence is rendered** — as prose quotation vs. as a cited numbered record.
7. **How the gate is operated** — the physical metaphor for arming an irreversible act.

Palette, radius and spacing values differing is necessary and nowhere near sufficient. If a reviewer
cannot articulate a reason to prefer one over the other, you built one variant twice.

**When only one direction exists in the tree** — which is the case today — §9.8 and §9.9 are
answered "not applicable, single direction", and the seven axes are recorded as positions in the
surviving brief for the next direction to diverge FROM. That is a sanctioned answer, not a waived
gate: the difference is that the positions have to be written down either way.

---

## 6. LAW SIX — Brief inference: name a real source direction, or regress to the mean

You may not begin generating until the variant's brief answers all seven fields. Deriving a palette
from first principles reliably reproduces Tailwind grey plus blue; naming a real, specific direction
is what produces a point of view.

| Field | What counts as an answer |
|---|---|
| Domain reading | What is actually true about the data and the stakes, in two or three sentences, from the schema — not from the app's name |
| Audience & tone | Who is at the keyboard and what they are afraid of getting wrong |
| Mood adjective | **One word.** The whole direction must be arguable from it |
| Layout family | Named, and different from the other variant's (§5.1) |
| Motion signature | The one motion that is this variant's, named and located |
| Source direction | A **named, real** visual tradition, publication, instrument or discipline. "Modern and clean" is not an answer. "A 1960s Swiss metrology specification sheet" is |
| Why this source for this app | One paragraph tying a specific property of the source to a specific property of the domain. If you cannot, the source is decoration and you have picked the wrong one |

---

## 7. LAW SEVEN — The gate is structural, not a badge (hirelane-specific)

This app exists to make one distinction visible. From `app/actions.ts` and `lib/constants.ts`:

- **AUTO, reversible** — `score_against_rubric`, `add_note`, `move_stage` (to `screening` or
  `interview` only), `propose_slots`. Each writes an undo payload. Each can be taken back.
- **GATED, irreversible** — `decide_stage` (to `offer` or `rejected`), `send_scheduling_email`,
  `send_rejection`. Each stores **no** undo payload, because there is nothing to store. You cannot
  un-send a decision to a person.

Reversibility buys the AUTO class. Not harmlessness — reversibility.

**The laws that follow from that:**

1. The AUTO/GATED distinction is expressed **structurally**: through the rule-weight ladder
   (`--hl-rule-1/2/3`), surface treatment, or spatial placement — before any colour or badge is
   applied. Turn the page greyscale: the gated actions must still be identifiable.
2. A gated control is **armed then fired** — two deliberate acts, disarming itself on a timeout.
   `useArm()` in `components/board/useRun.ts` implements this contract for the board direction:
   one armed gate at a time, an 8-second self-disarm, and the fired state carried by a `data-fire`
   attribute so it survives the greyscale test. Reuse it or reimplement the same contract; a
   `confirm()` dialog is not a gate, it is a speed bump. (This used to name
   `components/shared/useVariantAction.ts`, which went with the directions that were reviewed out.)
3. An armed gate is void the moment the thing it approved is not the thing about to happen. If the
   surface can change WHO an armed control reaches — a peer rail, a list that refreshes — the panel
   is keyed by that identity so arming starts over. Two deliberate acts for the wrong person is one
   deliberate act.
4. Arming shows **who it reaches and what cannot be undone**, naming the candidate. Not "Are you
   sure?".
5. The manifest is not a drawer nobody opens. Each variant shows, in its main layout, which
   capabilities exist and which class each is in — the demo-kit drawer is a supplement, not the
   answer. It shows the capabilities **that route registers**, derived from the registration itself:
   a hand-typed register is a claim, not a manifest, and it will be wrong within one refactor.
6. Copy stays in the present tense of registration (§4.1).
7. Every precondition the surface states is enforced in the server action, not only on the control.
   A disabled button is a projection of a rule; an agent calling the same action never sees it, so
   its option set would otherwise be a strict superset of a person's.

---

## 8. LAW EIGHT — Data honesty

- Variants read real seeded data through `lib/queries.ts` and the per-direction builder beside it
  (`lib/board/` for the direction that ships) in **server** components. No mock arrays in a
  component file. (`lib/scope.ts` used to be named here. It served the `/applicant`, `/rubric`,
  `/scheduling` and `/activity` routes, which were reviewed out; nothing imported it and it is
  gone.)
- The primary mutating flow uses the existing server actions in `app/actions.ts`. Client refresh goes
  through the direction's own run hook — `useRun()` in `components/board/useRun.ts` for the board —
  which wraps the call in a transition and reports the result. (This used to name
  `useVariantAction()`, which no longer exists.)
- `lib/` schemas, seeds and contracts and `components/HostCapabilities.tsx` are out of scope and
  must not change. (The `/api/copilotkit` route this rule used to name is gone: the app hosts no
  chat, and what it offers an agent is registered on `document.modelContext`.)
- Any control that does not perform its action must say so on the surface, not only in a report.
- `/` redirects to `/v`, the direction index. The shipped `prime` design it used to render was
  reviewed out, so the comparison baseline is now the previous round of the surviving direction, in
  git history, named in that direction's brief.

---

## 9. The pre-ship gate

Answer every line with evidence. A "yes" you did not check is a failure.

Lines 1, 2 and §4.2's colour lock are checked by `pnpm --filter hirelane design:check`
(`design/check-law.mjs`), which the app's `lint` script chains, so CI runs them. Everything else on
this list is read by a person.

**System**
1. Zero raw pixel values in variant CSS outside `hl-scales.css` and the variant's own token block.
   A value that is genuinely not a scale value — a blur radius, a box-shadow's ring geometry, a
   viewport clamp — is exempted by writing `§9.4 exception: <reason>` on its line or just above it.
   The check honours that marker, so §9.4's escape is the same escape in prose and in code.
2. `--dk-*` aliased, no `.dk-*` class redefined.

   ```
   grep -rnE '(^|[^-a-zA-Z0-9_`])\.dk-[a-zA-Z0-9_-]+[^{]*\{' components/<slug>/   # → empty, exit 1
   ```

   Recursive, unanchored, and brace-terminated, and all three were earned. The previous form —
   `grep -n "^\s*\.dk-" components/<slug>/*.css` — globbed a flat directory, so once a direction
   kept its stylesheet in subdirectories the glob matched nothing and grep exited **2** rather
   than reporting clean; a reviewer reading "empty" as a pass recorded a pass. It also anchored at
   the start of the line, so `:root:has([data-variant="x"]) .dk-toast { … }` could not match it
   even pointed at the right files. Four real violations stood behind that gate. Requiring the
   `{` is what keeps a *prose mention* of `.dk-toast` in a comment from failing the check, so the
   rule can still be explained in the file that obeys it.

   A check nobody can fail is worse than no check.
3. At least four distinct spacing steps and three distinct type sizes in use on the primary screen.

**Tells** — walk §2.1, all fifteen, on the rendered page.

4. No tell present, or the exception is written down with a reason.
5. The diff gate was written **before** the code, and the shipped result still matches it.

**Containers**
6. Every concept in §3's inventory is in its required container.
7. The gap criterion is legible at row level without opening an applicant.

**Divergence**
8. The two variants take opposite positions on ≥5 of §5's seven axes. *(Single direction in the
   tree: answer "not applicable" per §5, with the axes recorded in the brief.)*
9. A one-sentence reason a reviewer might prefer A over B, and a different one for B over A.
   *(Same.)*

**Gate**
10. Greyscale test: gated actions still identifiable with colour removed.
11. Every gated control arms before it fires, names the candidate, and says what cannot be undone.
12. `gate` and `auto` hues appear nowhere decorative.

**Honesty and craft**
13. The honesty line is present, verbatim, visible without interaction.
14. Every number on screen traces to a query.
15. Checked at 390, 768, 1280 and 1920 — and *looked at*, not inferred from markup.
16. `prefers-reduced-motion` lands on final states.
17. `pnpm --filter hirelane typecheck`, `lint` and `test` pass; `/`, `/v` and every `/v/<slug>`
    in the tree return 200 with real content.

---

*Sources for §0: getclaudeskills.com, "Best UI/UX Design Skills for AI Coding Agents (2026)";
awesomeskill.ai, "Trending AI Design Skills to Watch in 2026"; agensi.io, "Best AI Tools for UI
Design in 2026 (With Agent Skills)". Laws 2–6 are the round-1 constraints from this repo's own
experiment, restated so that this document stands alone.*

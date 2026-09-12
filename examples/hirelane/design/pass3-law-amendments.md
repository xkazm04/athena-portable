# Amendments to `DESIGN-LAW.md`, pass 3

> **REVIEWED OUT (2026-09) — and never folded into the law.** The Status line below makes this file
> binding for `app/v/law/` and `components/law/`, both of which were removed in the board rework.
> The amendments were also never merged into `DESIGN-LAW.md` itself: the law as it stands in this
> directory is the un-amended text, so nothing here is in force. Kept as the record of what pass 3
> argued, **not as binding text.** The binding documents are `DESIGN-LAW.md` and
> `design/board-brief.md`.
>
> One target of it is still live: `design/hl-scales.css`, which A1 and A2 argue against, is
> imported by `app/globals.css` and bound by `DESIGN-LAW.md` §1 and §9.1. Its values are unchanged
> — the amendment was proposed and not adopted.

**Status:** binding for `app/v/law/` and `components/law/`. Everything in `DESIGN-LAW.md` that is
not amended here still stands, and most of it stands unchanged — §1's existence, §2's tell list and
diff gate, §4's colour lock and icon inventory, §7's structural-gate law and §8's data honesty are
all kept verbatim and were followed.

The law was written for hirelane by the agent whose two hirelane variants (`lantern`, `platen`) were
then rejected outright. That is the situation this file addresses. Read as an artifact, the law is
unusually good at one job — **forbidding known-bad output** — and has a specific, diagnosable blind
spot: it has no theory of what the *good* output is, only of what the bad one is. Seven of its nine
sections are negative. A document composed almost entirely of prohibitions will reliably produce a
disciplined, austere, correct-looking page, and that is exactly what got cut.

Each amendment below is a diff with a reason. Amendments 1, 2, 6 and 7 are corrections of things
the law gets *wrong*. Amendments 3, 4, 5 and 8 are holes it leaves open.

---

## A1 — §1.2: the type scale codifies the defect the owner has now rejected twice

**The defect.** `design/hl-scales.css` sets `--hl-text-base: 0.9375rem` (15px), `--hl-text-sm`
13px, `--hl-text-xs` 12px, `--hl-text-2xs` 11px, and §1.2 then rules that *"All-caps labels take
`--hl-track-caps` and never exceed `--hl-text-2xs`"* — an 11px hard ceiling on every label in the
app. The owner's verbatim complaint about the one variant kept from round 1 was *"Typography size is
mishandled with defaults too small to fit better in components"*, and PASS3 restates it as a hard
requirement: *"Type sized for its container. The owner has now complained twice about
default-small type."*

The law's own §2.1 tell list has fifteen entries about type voice, pairing, leading and tracking,
and **not one about type size**. It cannot catch its own scale.

**Diff.**

```diff
-  --hl-text-2xs: 0.6875rem;   /* 11px */
-  --hl-text-xs:  0.75rem;     /* 12px */
-  --hl-text-sm:  0.8125rem;   /* 13px */
-  --hl-text-base:0.9375rem;   /* 15px */
-  --hl-text-md:  1.0625rem;   /* 17px */
+  --law-text-2xs: 0.8125rem;  /* 13px — the label floor. Nothing in the UI is smaller. */
+  --law-text-xs:  0.875rem;   /* 14px */
+  --law-text-sm:  0.9375rem;  /* 15px */
+  --law-text-base:1.0625rem;  /* 17px — reading size */
+  --law-text-md:  1.1875rem;  /* 19px */
```

- §1.2 rule replaced: **"All-caps labels take `--law-track-caps` and never go below
  `--law-text-2xs` (13px)."** The ceiling becomes a floor.
- New §2.1 tell **#16: any type below 13px anywhere on the surface.** Falsifiable by grep and by
  looking.

**Reason.** The scale was derived from nothing — it is a geometric ramp with a plausible-looking
base. A reading size is not a free parameter; it is set by the reading distance and the container.
15px was the shipped design's size and the shipped design was rejected.

---

## A2 — §1.2 and §1.5: `vw` units are forbidden; the scale must size on the container

**The defect.** Four of the nine sizes in `hl-scales.css` are `clamp(…vw…)`. PASS3:

> Container queries, not viewport media queries. Three independent agents in round 2 measured that
> the CopilotKit sidebar shrinks `body` to roughly 800px at a 1280 viewport and 288px at 768, so
> every `@media (width…)` rule in this repo lies.

`vw` lies in exactly the same way and for exactly the same reason. I re-measured it: a headless
screenshot of `/` at a 1280×900 viewport shows the CopilotKit sidebar occupying 480px, leaving the
app 800px — while `--hl-text-2xl` at that moment resolves against 1280. **The law's flagship
contribution, the scale layer, is built on the unit PASS3 declares invalid.** This is the single
most consequential error in the document, because §1's whole claim is "the scales exist, use them".

**Diff.** Every fluid step is re-expressed in `cqi` (container inline size), and the variant root
declares a container:

```diff
-  --hl-text-xl:  clamp(1.6rem, 1.3rem + 1.4vw, 2.25rem);
-  --hl-text-2xl: clamp(2.2rem, 1.6rem + 2.8vw, 3.5rem);
-  --hl-text-3xl: clamp(3rem,   2rem   + 5vw,   5.5rem);
+  --law-text-xl:  clamp(1.5rem,  1.15rem + 1.6cqi, 2.30rem);
+  --law-text-2xl: clamp(2.0rem,  1.35rem + 3.2cqi, 3.40rem);
+  --law-text-3xl: clamp(2.6rem,  1.55rem + 5.4cqi, 5.00rem);
+
+  /* and on the variant wrapper, without which cqi silently falls back to the viewport: */
+  .law-root { container-type: inline-size; container-name: law; }
```

- New §9 gate line **18: zero `vw`, `vh`, `vmin`, `vmax` units and zero `@media (width…)` rules in
  the variant stylesheet.** `grep -nE '[0-9](vw|vh|vmin|vmax)|@media[^{]*width' components/<slug>/*.css`
  must be empty.

**Reason.** A scale that measures the wrong box is worse than no scale, because it is trusted.

---

## A3 — §3: the container gate confuses *arrangement* with *container*, and as written it forbids the structure the owner asked for

**The conflict.** §3's binding inventory rules `Pipeline stages → ordered ladder/rail`, forbids
`kanban tiles` for the longlist, and `platen`'s brief makes the prohibition explicit: *"No kanban.
Stages are five ordered buckets and stay an ordered rail."* PASS3 asks for the opposite, in the
owner's own words:

> Visualize pipeline of candidates with swimlanes per role or area, column per state in the
> pipeline. In each state of pipeline the dynamic UI can behave differently.

A lane per role crossed with a column per state **is** a board. Followed literally, §3 forbids the
brief. PASS3 overrides, so the law is amended rather than obeyed — but the amendment is narrow,
because §3's underlying insight is correct and is the best paragraph in the document.

**What §3 got right and what it conflated.** Its real finding is that *comparison needs alignment*:
scores you compare must sit in aligned columns with tabular figures, and a card destroys that. Its
error is inferring from this that the **page-level arrangement** must be a list. Those are two
different levels. A board whose cells contain aligned comparison rows keeps every property §3
actually wants; a board whose cells contain 240px rounded tiles with avatar circles and pills does
not. §3 outlawed the arrangement when the defect was in the atom.

**Diff.** §3 gains a preamble and two rows:

```diff
+**The gate applies to the atom, not to the arrangement.** Name the smallest repeated unit that
+carries comparable scalars; that unit obeys the table below. How those units are grouped on the
+page — lanes, columns, a board, a canvas — is a separate decision, governed by what the user is
+steering rather than by what they are comparing.
+
 | Concept | Shape of the data | Required container | Forbidden |
+| The pipeline as a whole | 2 role lanes x 4 ordered states | swimlane x state grid, lane order and state order both preserved and labelled | a single flat list that hides which state an applicant is in |
+| One applicant inside a lane cell | homogeneous, compared against the others in that cell | a **strip**: one full-width row, fixed height, aligned name / id / score / gap columns, tabular figures | a tile, a rounded card, an avatar-and-pill block |
```

- §9 gate line 6 is re-read against the amended table.
- New §9 gate line **19: no lane cell renders its applicants as anything but strips.** Colour and
  elevation may vary by state; the column grid inside a strip may not.

**Reason.** Both documents are right about different things and the law had no vocabulary to say so.

---

## A4 — a missing law: ONE PAGE

`DESIGN-LAW.md` mentions routes throughout (`app/v/<slug>/`, §9.17 checks four URLs) and has no
position on navigation at all. PASS3 law 1 is absolute:

> Single page. On one page we can achieve anything through animated transitions and dynamic UI. No
> route-level navigation between top-level views. A modal or an overlay is fine; a second page is not.

**New §10.**

> **LAW TEN — one surface.** A variant is one route. Every top-level view is a state of that route,
> reached by an animated transition. No `<Link>` or `router.push` to another top-level view inside a
> variant. State that a user would expect to be able to return to is held in component state, not in
> the URL. Overlays, drawers and inline expansions are the whole navigation vocabulary.
>
> §9 gains line **20: `grep -n "next/link\|router.push" components/<slug>/` is empty.**

---

## A5 — a missing law: the agent must be seen working, not merely registered

This is the deepest hole, and it is where I think `lantern` and `platen` were actually lost.

§7 is the law's centrepiece and it is entirely about **classification**: which acts are AUTO, which
are GATED, that the distinction must survive greyscale, that the gate arms before it fires, that the
capability register belongs in the layout. Every one of those is a statement about the agent *at
rest*. §7.4's remedy for "the agent is not a first-class inhabitant" is *a list of capabilities on
the page* — which is a menu, not an inhabitant. Meanwhile §4.1 forbids, correctly, any copy in
which Athena has done something. Between them, the two laws produce a page where the agent is a
static, correctly-labelled inventory. The owner's requirement is the opposite:

> The agent does work, visibly. In every app the demo is Athena being *dispatched* at something and
> the UI showing her working on it and changing state as she goes.

There is no tension with honesty here, and the law missed it: **the work is real.** Every capability
in the register is a real server action against the seeded database. What is not yet connected is
the *model that decides to call them*. So the surface may show dispatched work at full fidelity as
long as the dispatcher is the user, and says so.

**New §11.**

> **LAW ELEVEN — dispatch is a visible process with four moments.** For each capability the surface
> can dispatch, the design owns all four and gives each its own treatment:
>
> 1. **Idle** — the capability is named and addressable, and its class is legible.
> 2. **Working** — the work is located *on the object it is changing*, not in a global spinner, and
>    it takes visible time proportional to what it is doing.
> 3. **Result** — the changed value arrives by settling from the old value, and what changed is
>    marked on the object for long enough to be read.
> 4. **Provenance** — who dispatched it, at what time, and whether it can be taken back, recorded
>    where the object is, not only in the activity log.
>
> A capability whose whole visual life is `disabled → toast` fails this law.
>
> **Honesty clause, replacing nothing in §4.1:** the dispatcher is named on the surface. While
> Athena is not onboarded the dispatcher is the user, the honesty line says so verbatim, and the
> work still runs and still shows all four moments. Copy stays in the present tense of registration.
>
> §9 gains line **21: name the four moments for each dispatched capability, and point at where each
> is drawn.**

---

## A6 — §4.1: the copy allow-list has a one-line budget and cannot produce a landing page

**The defect.** §4.1 permits, above the fold, the app name, database values, stage and score
labels, **exactly one** orienting line from a list of three, and the honesty line. That budget can
produce a document. It cannot produce what the owner asked for:

> The goal is to create frontends of the future … with landing-page like visual quality.

A landing page's quality is substantially a *writing* quality: a headline that makes a claim, and a
sub-line that says what the thing does and for whom. §4.1's real target — marketing verbs, and any
sentence in which Athena has already done something — is caught by tell #14 and by the forbidden
clause, both of which are kept in full. The allow-list is a second, blunter instrument aimed at the
same thing, and it removes the headline as collateral.

**Diff.**

```diff
-- Exactly one orienting line, chosen from: [three fixed strings]
+- One headline making a claim about the pipeline, and one sub-line of at most two clauses saying
+  what the surface does and for whom. Both must be checkable against the schema: every noun in them
+  names something that exists in `lib/types.ts`, and no verb in them appears on tell #14's list.
+  Write both into the brief before the code, so they are reviewable rather than improvised.
```

The forbidden clause, the honesty line, the exact-string rule for `STAGE_LABEL` / `SCORE_LABEL` and
tell #14 are all unchanged.

---

## A7 — §7.2 and §8 cite a file that does not exist

**The defect.** §7.2: *"`useArm()` in `components/shared/useVariantAction.ts` implements this; use
it."* §8: *"Client refresh goes through `useVariantAction()`."*

There is no `components/shared/useVariantAction.ts` in this app and there is no `useArm`. The real
module is **`components/shared/useAction.ts`**, exporting `useAction()`, `useGate(ttlMs = 6000)` and
`useBatch()`. `useGate` is precisely the arm-then-disarm-on-timeout primitive §7.2 describes.

**Diff:** every reference to `useVariantAction.ts` / `useVariantAction()` / `useArm()` is replaced by
`components/shared/useAction.ts`, `useAction()` and `useGate()`.

**Reason, and it generalises.** A law that names an API without opening it is a law that was written
from memory. This is the one place the document is checkably false about the codebase it governs,
and it is worth recording because it is the failure mode of every "constraints" artifact: the
constraints are cheap to write and expensive to verify, so they drift. §9 is a gate for the *design*;
there is no gate on the *law*.

---

## A8 — a missing law: every object and control is addressable by name

PASS3 law 2:

> Hands-free and voice-first is the intended operating mode … Every manipulation you build should be
> addressable by name — that is also exactly what makes it addressable by an agent.

The law has nothing on this, which is a real omission for a document whose central subject is an
agent-operated UI: §7 makes the agent's *permissions* legible and leaves its *targets* anonymous.

**New §12.**

> **LAW TWELVE — nameable targets.** Every lane, state, applicant strip and dispatchable control
> carries a stable, human-speakable name that is visible on the surface (not only in a `data-`
> attribute or an `aria-label`), and the same name is what the corresponding readable or action
> parameter uses. If a user cannot say the name out loud and be unambiguous, rename it. Enumerated
> values come from the existing enums in `lib/constants.ts`; no view invents a synonym.
>
> §9 gains line **22: list every addressable name on the surface and confirm each is spoken exactly
> as it is written.**

---

## What is kept, unchanged, and why

- **§2.2, the generic-answer diff gate.** The strongest mechanism in the document, and the one thing
  I would keep if I kept one thing. It was written before any code in `components/law/` existed and
  is in `design/law-brief.md`.
- **§2.1's fifteen tells**, plus new #16 (type below 13px) from A1.
- **§4.2 colour lock and §4.3 icon inventory.** Both cheap, both binding, both worked.
- **§7's structural-gate laws.** Rule-weight ladder, greyscale test, arm-then-fire, no `confirm()`,
  present-tense copy. Nothing here needed changing; the amendment in A5 is additive.
- **§8 data honesty** in full.
- **§1's existence.** The scale layer is the right idea badly calibrated. A1 and A2 recalibrate it
  rather than discard it; `components/law/law.css` declares a `--law-*` block in the same shape,
  scoped to the variant so `hl-scales.css` and the shipped design are untouched.

## What was dropped as out of scope

- **§5, the divergence rule.** Pass 3 builds one direction, so there is nothing to diverge from. The
  rule is still correct and should return the moment a second direction is built.
- **§9.17's four-URL check**, superseded by A4: there is one route.

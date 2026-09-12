# Ledgerbox — `token` — brief inference and token derivation

> **STATUS — RETIRED, kept for the record.** The `token` direction was reviewed out with the other
> cut variants. There is no `app/v/token/` route, no `components/token/` tree, no npm script and no
> emitted CSS: the `components/token/token.tokens.css` named in §3 below is a path that was never
> written, and every reference in this brief is to what the pass *proposed*, not to anything that
> ships. Its DTCG input survives at `design/tokens/token.tokens.json` and `design/build-tokens.mjs`
> still reads it, so the three are readable together. **The live value authority for the app is
> `components/edge/edge.css` (direction `edge`) and `components/lanes/style/base/tokens.css`
> (direction `lanes`); the `/v` index has its own set in `app/globals.css`.** Same disposition the
> sibling apps gave their own cut `token` pass — `examples/hirelane/design/build-tokens.mjs`,
> `examples/tidycrm/design/pass3-token-brief.md`.

**Method:** R3 — the DTCG token pipeline vendored from `examples/tidycrm/design/build-tokens.mjs`,
run under the `plugin87/ux-ui-agent-skills` two-half discipline: **(1) Brief Inference — name a real
source direction before generating anything; (2) primitive → semantic → component derivation,
validated, built to CSS.**

Round 2 measured that half (2) alone reproduces Tailwind gray-plus-blue. So half (1) is written
here, in full, **before** `components/token/` or `app/v/token/` existed. Nothing below was
back-filled.

---

## 1. Brief Inference — the six fields

| Field | Answer |
|---|---|
| **Domain** | Accounts receivable for a two-person studio, books frozen at 2026-09-01. 124 invoices, 15 clients, 6 categories, one quarter (Jun–Aug 2026). $1,791,703 outstanding, $1,365,523 of it past due. Separately, **18 incoming bank credits worth $307,500 that nobody has attributed** — and `lib/match.ts` scores every credit against every open invoice on four named signals, keeping one verbatim clause per signal that fired. Three cases in the seed are deliberately unresolvable: two identical $4,800 Kestrel retainers against one $4,800 credit (`isAmbiguous` — the top two score within 12 points), a Quarry House invoice short-paid by $35, and a Solstice job that stopped at 80%. |
| **Audience** | The bookkeeper on the first morning of the quarter. Ninety days of books behind them, one decision in front of them: **who gets chased.** Their specific fear is chasing a client who already paid — sending a firm letter to someone whose credit is sitting unattributed three bands away. |
| **Mood adjective** | **Serene.** Aicher's own word for Munich 1972 was *die heiteren Spiele*, the serene Games — a deliberately calm, unmilitary, high-legibility system for an enormous, dense, fast-moving event. That is the exact tension here: a field carrying 124 objects and $1.8M, which must not feel like an alarm panel. |
| **Motion depth** | **Mid-high, and structural rather than decorative.** One signature — *the 45° wipe* — plus one continuous behaviour — *the reflow*. Everything else is feedback. |
| **Layout family** | **The proportional band field.** Full-bleed. N horizontal bands sharing **one horizontal money scale**, where a segment's *length is its outstanding balance*. Not a time axis and not a per-lane track. |
| **Source direction** | **Otl Aicher's visual system for the Games of the XX Olympiad, Munich 1972** (Erscheinungsbild der Spiele der XX. Olympiade), read together with its published construction rules for the pictogram set. |

### Why this source, for this app

Aicher's system is the answer to a problem structurally identical to this one: **make an enormous,
dense field of heterogeneous objects legible to a person who is moving past it, without shouting.**
It gives me four transferable rules that a generic token pass cannot:

1. **A restricted spectrum with a stated exclusion.** Aicher built the Games on light blue, silver,
   light green, dark green, orange and violet, and **excluded red and gold on principle** — the
   colours of the 1936 Games. For a receivables app that exclusion is a real constraint with real
   consequences: *lateness may not be red.* I have to encode urgency some other way, which forced
   the orange-reserved / tint-vs-chroma rule below. Left alone I would have reached for red at
   step one. This is the single largest thing the method changed.
2. **Colour identifies place; form identifies activity.** In Munich, colour told you which venue you
   were in and the pictogram told you which sport. Ported: **hue identifies the band** (which client
   or area you are in) **and never the state**; state is carried by pictogram, weight and position.
3. **A generative geometry.** The Munich pictograms are constructed on a fixed grid using only 0°,
   45° and 90°, one uniform stroke, no free curves. That is a rule, not a taste — every piece of
   bespoke SVG on this page is drawn under it, so the icon set, the field map, the evidence diagram
   and the dispatch trace are coherent by construction rather than by fiddling.
4. **One family, differentiated by weight and width.** Univers only, across the entire Games.
   Ported as a hard constraint: **one superfamily** (Chivo / Chivo Mono), no display-serif pairing.
   The other three directions in this app use two or three families each; this is a real divergence
   and it comes from the source, not from preference.

### The generic answer I am diffing against (round-1 gate)

Left to my own defaults I would have built: dark slate `#0f172a` ground, one indigo accent, red for
overdue / amber for due-soon / green for paid, Inter, 12px uppercase labels, invoices as rounded
cards in a vertical list, 12px gaps throughout, `lucide-react` for every glyph, `@media` widths.
Concretely changed by the source: **no red at all**; light ground; one superfamily, no Inter;
segments whose *length is the money*; hue meaning band-identity rather than severity; all bespoke
SVG on a 45° grid; `cqi` and `@container` throughout; type floor 13px and base 17px.

### The strongest direction I am *not* taking

A cash-flow **timeline** — every invoice pinned to its due date on one Jun→Sep axis. It is the
obvious reading of "swimlanes overflowing with data" and it is already built: `/v/law` is exactly
that, with packing and a today ordinate. Taking it again would have produced a second law.

---

## 2. What the field is, and why length is money

One horizontal scale, shared by every band: **`--field-scale` pixels per dollar.** A segment's
width is its `balance_cents` at that scale, floored at the 44px touch target so a $500 invoice is
still clickable. Consequences, all of them deliberate:

- **The field overflows because the money overflows.** The default scale is **1 px = $200**, at
  which the longest band (Halcyon Works, $309,067) is about 1,550px against a container that is
  785px inside a 1280 viewport. Nothing is paged, virtualised or summarised away: all 124 invoices
  are in the DOM at every zoom.
- **Band length is directly comparable.** Kestrel's band is longer than Marlow's because Kestrel
  owes more. That is the overview `/v/waterline` was faulted for not having, and it costs no
  chrome — it *is* the layout.
- **Filtering is physical.** A segment that stops matching animates its width to zero and the band
  re-flows; the band visibly shortens by exactly the money that left. Filtering in `/v/scale`
  collapses a node to a tick in place to preserve rhythm — the opposite choice, on purpose.
- **Zoom is a real manipulation.** Changing `--field-scale` re-lays the entire field continuously.
  It is addressable by name (`"zoom in"`, `"fit the field"`), which is what makes it steerable by
  voice and by an agent.

Honesty note carried into the UI: the 44px minimum keeps every segment a real touch target, which
means anything below **$8,800** at the default scale is drawn wider than its money. The field
states its own scale and prints that threshold, recomputed at every zoom, rather than hiding it.
The zoom ladder is deliberately round — $800 / $400 / $200 / $100 / $50 per pixel — because a
scale a person cannot hold in their head is not a scale.

---

## 3. Token derivation — primitive → semantic → component

Source of record: `design/tokens/token.tokens.json`. Built by `design/build-tokens.mjs` to
`components/token/token.tokens.css`, scoped to `[data-variant="token"]`. Primitive colours are
never emitted, so no component has a name with which to reference one.

### 3.1 The palette, and the exclusion

Six hues, as readings of the published Munich spectrum (these are my renderings; I do not claim
they are the exact specified inks):

| Aicher name | Role in this app |
|---|---|
| Hellblau | **Athena, and AUTO work.** The lead colour of the system is the lead actor of the app. |
| Violett | **GATED.** Irreversible acts, and only those. |
| Orange | **Attention — a human is required.** Reserved; never decorative, never a band identity. |
| Dunkelgrün | Settled, and the darkest ink on the page. There is no `#000000`. |
| Hellgrün | Within terms. |
| Silber | Inert — voided, drafts, quiet bands. |

**No red is emitted by the token file at all.** Overdue is drawn as an orange *attention* mark plus
length and position, never as a red fill. If the field ever shows red, a token has been bypassed.

**Tint vs chroma rule.** Band identity uses low-chroma *tints* (a hue mixed to ≤18% over the
ground); status uses full chroma. So a band's hue can never be mistaken for a status, and turning
the page to greyscale leaves every status legible while band identity correctly disappears.

### 3.2 The numeric ladder — the correction the brief asked me to test

Measured first, on the pipeline as it ships (`node build-tokens.mjs signal …`):

> **125 custom properties: 50 colour, 12 spacing, 11 size, 9 type, 7 duration, 6 radius, 5 shadow,
> 5 leading, 4 weight, 4 tracking, 3 each of z / font / easing / border-width.**

So the premise handed to me is **half wrong and half exactly right**, and the difference matters:

- *Wrong:* it is not "50+ colour and zero spacing". Spacing is there, and it is already numeric
  (`--space-0 … --space-11`), which is the good case.
- *Right:* **type is nine unrelated role names** — `micro, caption, body, feature, sub, section,
  display, hero, nano` — with no ordering. `nano` (0.625rem) is *smaller* than `micro` (0.75rem)
  but sorts last. There is no expression for "one rung up from body". Relational operations are
  inexpressible **for type**, not for space.
- *Also right, and worse:* **nothing is a pointer.** DTCG aliases are resolved at build time, so
  `{primitive.void.900}` becomes `#050507` in the output and the *relationship is erased*. Every
  emitted property is a literal. You cannot re-point a role at runtime, so "shift the whole surface
  one rung" cannot be done in CSS at all, however the token tree is shaped.

**What I did about it**, and it is two changes, one to the tree and one to the builder:

1. **The tree.** `primitive.ladder.space.01…12` and `primitive.ladder.type.01…12` are dense numeric
   rungs with neighbours. Role tokens do not *alias* them — aliasing would resolve to a literal —
   they carry the literal string `var(--ladder-type-06)`. The builder passes unknown strings
   through untouched, so the pointer survives into CSS. Roles become one indirection away from the
   ladder, and "two steps apart" is now a thing you can write and check.
2. **The builder.** Vendored with two additions, both marked in the file: a `ladder` entry in
   `GROUPS` so the rungs are emitted, and support for a top-level **`$modes`** block that emits
   extra scoped selectors. The upstream builder emits exactly one `:root`-equivalent block and has
   no concept of a mode, so `[data-density="compact"]` — the entire point of having a ladder — had
   to be hand-written CSS in every prior pass. Now `$modes` declares it and the build emits it.

Result: `data-density` on the wrapper re-points nine type roles and twelve spacing roles at once,
and the floors hold (nothing can fall below 13px, nothing interactive below 15px) because the
compact mode re-points to rungs that are themselves floored. Verdict on the correction, for the
report: **the ladder works, but only because the builder was changed. On the pipeline as it ships
it cannot work at all, for the reason in the third bullet above.**

### 3.3 Type — one superfamily, floors first

Chivo and Chivo Mono, per the Univers-only rule. Rungs 01–12; roles bound by reference.
`--text-body` is **17px**, the floor is **13px**, nothing interactive is below **15px** — the owner
has rejected small default type twice, most recently on the variant that was kept.

Display rungs are `clamp()` on **`cqi`, never `vw`**. This repo measured `body` at ~800px inside a
1280 viewport and ~288px inside 768 because of the CopilotKit sidebar, so every `vw` lies by about
a third. There are **zero `@media (width…)` rules** in this direction.

`container-type` is declared on the inner regions (`.tk-field`, `.tk-mast`, `.tk-sheet`) and
**not** on the token wrapper — layout containment would make the wrapper a containing block for
`position: fixed` descendants and drop the modal at the bottom of the document.

### 3.4 Motion

`--duration-*` and `--ease-*` from the ladder. One signature, one behaviour:

- **The 45° wipe.** Every state change enters and leaves along the grid's diagonal, as a `clip-path`
  polygon sweep. Nothing on this page cross-fades. Located on: segment expansion, dispatch stage
  completion, the gate arming, modal entry.
- **The reflow.** Bands re-lay continuously when the filter, the grouping or the scale changes.
  This is the only continuous motion, and it is caused by the user or the agent — nothing loops
  forever, because a thing that pulses forever reads as "Athena is working" and she is not
  connected.

Every path has a `prefers-reduced-motion` branch that lands on the **final state**, not a faster
animation.

---

## 4. Governance — structural before chromatic

From `app/actions.ts`, where the flags are the contract:

- **AUTO, reversible** (each writes an undo payload): `categorize`, `match_bank_line`, `unmatch`,
  `draft_reminder`, `export_summary`.
- **GATED, irreversible** (none writes an undo payload, because there is nothing to store):
  `mark_paid`, `send_reminder`, `void_invoice`.

Reversibility buys the AUTO class, not harmlessness. The distinction is expressed **structurally
before any colour**: a gated act is drawn with a **stop bar** — a solid 45° hatch across the
control — which survives greyscale, and it must be *armed* by a separately named act before it can
be issued. Arming states who it reaches, quotes the client's real address from the schema, and
shows the letter body verbatim first.

---

## 5. Addressability

Every manipulation on this surface has a spoken name published on the control itself
(`data-say`), because a control that can be named is a control an agent can drive:

`band by client` · `band by area` · `band by state` · `show me the flagged ones` ·
`show me what is unattributed` · `zoom in` · `zoom out` · `fit the field` · `compact` · `roomy` ·
`sweep left` · `sweep right` · `open the worst one` · `arm the letter` · `issue it`.

---

## 6. Provenance and honesty

- The palette values are **my renderings** of the Munich spectrum from published reproductions, not
  transcriptions of specified inks. Stated as such above and in the token file.
- **Univers is not available**; Chivo is the closest freely-licensed neo-grotesque with a matching
  monospace in the same superfamily, which is what the one-family rule needs.
- Athena is **not onboarded** in Ledgerbox. Every capability is described in the present tense of
  the manifest. No activity feed claims she did anything.
- Every number on the page comes from `lib/db.ts`. There are no invented figures anywhere.


---

## 7. Measured, after the build

Run against the live dev server on 3011 with headless Chrome over CDP.

| Check | Result |
|---|---|
| `pnpm --filter ledgerbox typecheck` / `lint` | both pass, no warnings |
| `/`, `/v`, `/v/token`, `/v/waterline`, `/v/law`, `/v/scale` | all 200, all render |
| Horizontal page overflow at 390 / 768 / 1280 / 1920 | none at any width; the only scrollers are the field, the control strip and the sheet |
| `body` width vs viewport | 375 / 273 / **785** / 1425 — the sidebar measurement holds, and it is why there is not one `@media (width…)` in this direction |
| Modal after scrolling 1400px | scrim top 0, height = viewport: the `container-type` trap is avoided |
| Modal width | clipped by the sidebar until `--tk-app-w` was measured off `body`; the same class of bug, same cause |
| `prefers-reduced-motion: reduce` | modal lands at opacity 1 / transform none, figures land on the final value, no frame is scheduled |
| Dispatch, end to end | `draft_reminder` ran for real, the run **stopped at the gate**, arming produced Issue / Stand down, `send_reminder` fired and returned "Sent to Copperline Industries. This one cannot be taken back." |
| Database | snapshotted before, restored after, verified identical: 124 / 65 / 65 / 3 / 2 / 12 / 16 / $1,335,422 |
| Red pixels | none. No red token is emitted, and nothing in the CSS or the components names one. |

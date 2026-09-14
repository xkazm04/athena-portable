# The layered-UI formula

What the three example apps (`examples/ledgerbox`, `examples/hirelane`, `examples/tidycrm`) teach
about a single-page app that reads at three depths — L0 the whole population, L1 one group, L2 one
item — with a videogame's sense of place and a tool's sense of control. This document grows one
round at a time. Each round has a theme, a baseline, a set of ideas the user chose, and the rules
that survived review. A rule enters §1 only after it has been built in at least one app and has
moved a rubric score without lowering another.

The apps share one navigation model (`@athena/demo-kit/zoom`: the reducer, `emphasis()`, the
Escape ownership rule). The formula is about how a surface *renders* that model, not about the
model itself.

## 0. The rubric

Five axes, scored 1–5 per app, before and after every round. The same path is driven every time:
L0 → open group → L1 → open item → L2 → Escape → L1 → Escape → L0, plus one interrupted open.
The capture script is `examples/journey/shots/round1-baseline/baseline.mjs` (run from
`examples/journey`); it writes settled stills, a frame strip at 0/120/250/400/650/1000/1600 ms
after each level change, a video, long-task and frame counts, and the focus state after Escape.

| Axis | What it asks |
|---|---|
| Composition per level | Does each depth read at a glance, with one clear next action? |
| Transition choreography | Is a level change a *move you can follow* — a zoom, a grow, a reveal — rather than a cut? Does it reverse? |
| User control | Escape, back, arrows, focus, interruptibility. Can the user always change their mind, including mid-move? |
| Continuity | What visibly persists across depths: chrome, the selected object, counts, the place you came from. |
| Motion cost | Frame drops, long tasks, work done while nothing is visible, `prefers-reduced-motion` behaviour. |

Guardrails that apply to every axis: a level change is interruptible, never blocks input, has a
duration budget (≤ 400 ms for a DOM level change; a canvas arrival may stage longer but must be
abortable), lands on its final state under reduced motion (not a faster animation), and animates
`transform`/`opacity`/colour only.

## 1. Rules that survived

Each rule names the round that earned it and the app(s) it was proven in.

1. **The level you leave carries the camera; the level you arrive at carries the continuity.**
   Only the leaving level may hold a transform. Render the outgoing level once more as an inert,
   id-free echo, put the whole zoom/recede on it, and let the live layer mount at its final size, so
   shared-element morphs never animate inside an animating ancestor. *(R1, ledgerbox and hirelane,
   arrived at independently.)*
2. **One claimant per shared id.** The outgoing layer drops its `layoutId`s in the same commit the
   arriving one claims them, and an id must be present at mount or the morph never runs. *(R1, all
   three; tidycrm's L1→L2 morph had silently never played.)*
3. **Box, then ink.** Containers move first; text arrives after the box has landed, and leaves before
   the box travels back. Both directions. *(R1, hirelane; ledgerbox's masthead is the same rule.)*
4. **One clock per level change, in one module.** Durations and easings live in a single exported
   map that the CSS tokens alias and a test compares against; JS reads tokens and never types a
   millisecond. A spring has no budget, so a level change uses a duration. *(R1, all three.)*
5. **An overlay owns its own Escape and returns focus to its opener.** A modal pane that takes focus
   must handle Escape itself; the shared rule correctly declines to. Every path back (Escape, close,
   scrim, back button, agent tool) restores focus through one place. *(R1, all three.)*
6. **A move in flight is abortable.** Any nav action mid-flight lands on a clean level; controls are
   never disabled while a transition plays. *(R1, tidycrm's arrival; interrupt probe on all three.)*
7. **Presence comes from the model.** Apps map `emphasis()` to opacity/scale; they never re-derive
   what recedes. *(R1, ledgerbox and hirelane.)*
8. **Reduced motion lands on the final state at frame zero.** Not a `0.01ms` animation. *(R1, all
   three.)*
9. **What is no longer seen stops costing.** A canvas under a DOM level renders on demand only; a
   settled scene draws zero frames. *(R1, tidycrm: 793 draw calls/s at rest → 0.)*

## 2. Round log

### Round 1 — transitions and continuity (2026-09-14)

**Baseline**

| Axis | Ledgerbox | Hirelane | Tidycrm |
|---|---|---|---|
| Composition per level | 4 | 4 | 4 |
| Transition choreography | 2 | 2 | 3 |
| User control | 2 | 2 | 1 |
| Continuity | 3 | 3 | 3 |
| Motion cost | 4 | 4 | 3 |

**Cross-app findings**

- Escape was dead at L2 in all three apps. Every L2 pane is `aria-modal`, the kit's Escape rule
  defers to modals, no pane handled Escape itself, and each pane moved focus into itself on open.
  The footers advertised `Esc` regardless.
- L0 → L1 was a cut in both DOM apps (unmount one level, mount the next, same frame). Both files
  carried comments describing a measured transform-origin zoom that did not exist, and both
  shipped dead spring exports.
- `emphasis()`, the kit's one shared presence rule, was imported by none of the apps.
- Reduced motion was implemented as `0.01ms` durations everywhere, which every law document in the
  repo names as the wrong branch.
- No focus management on L0 → L1, no focus restore on the way back, no URL sync anywhere.
- Tidycrm's arrival was the only real choreography (four beats) and also the biggest control
  failure: 2.9 s, zone keys disabled, Escape swallowed until it finished.

**Ideas chosen** (all twelve): LB1–4, HL1–4, TC1–4 — Escape and focus return at L2 in every app;
a real move for L0 → L1 (ledgerbox lane → spread, hirelane the documented zoom); ledgerbox masthead
crossfade and the raw 700 ms flatten timer; hirelane's dossier as a staged grow and motion tokens
into JS with the law checker extended; tidycrm's abortable and shorter arrival, dossier morph, and
cube hand-off cost.

**Outcome** — commits `cb7a4b2` (ledgerbox), `8f753d7` (hirelane), `71bad3b` (tidycrm). All gates green in all three apps (typecheck, lint incl. design checks, tests: 19 / 45 /
50). Re-scored on the same path:

| Axis | Ledgerbox | Hirelane | Tidycrm |
|---|---|---|---|
| Composition per level | 4 | 4 | 4 |
| Transition choreography | 2 → 4 | 2 → 4 | 3 → 4 |
| User control | 2 → 4 | 2 → 4 | 1 → 4 |
| Continuity | 3 → 4 | 3 → 4 | 3 → 4 |
| Motion cost | 4 | 4 → 3 | 3 → 4 |

What moved: Escape now walks L2 → L1 → L0 with focus following in every app; L0 → L1 is a
followable move in all three (ledgerbox lane → spread ~330 ms, hirelane zoom 350 ms, tidycrm
arrival ~1.2 s and abortable); L1 → L2 grows box-first everywhere; JS motion is tokenized and
tested in all three; reduced motion lands on final state. Hirelane's cost score dropped one point:
a 90–125 ms long task on open-group in the dev server, predating the round but now visible
because the transition is real. Re-measure against a production build before treating it as a
regression.

**Carried to the next rounds** (observed in review, not fixed):
- Hirelane: the L1 heading overprints the board's column headers in the first frames, before the
  echo has receded. Rule 3 applies to headings too.
- Tidycrm: the cell's figures scale with the box mid-morph (ink travelling at 3×). Rule 3 again.
- Level-change long tasks (85–125 ms) in all three under `next dev`; unknown under `next build`.
- No arrow-key navigation at L1 in ledgerbox or tidycrm; no URL sync anywhere.

**Wanted shared** (the consolidation round's shopping list, named by all three agents):
- `useLevelFlight(nav)` → `{ from, to, moving }` plus a completion signal; every app re-derived it
  from `flight`.
- A presence → `{ opacity, scale }` mapper beside `emphasis()`, so apps stop inventing the mapping.
- A one-claimant `layoutId` helper (`useSharedIdentity(owns)`) and written guidance that ids must
  exist at mount.
- A token reader (`cssMs` / `useTokens(el, names)`) for `--*` durations into JS.
- A focus-return helper for L2 overlays, and the kit rule for "a transition to level N is in flight
  and may be abandoned" — the half of the Escape rule the kit does not have.

### Round 2 — consolidation, the fourth app, and the owner's review (2026-09-14)

**Why this theme.** All three round-1 agents asked for the same five shared primitives, so the
consolidation round moved forward. And the formula needs an objective test: a fourth app built
on the kit alone, rebuilt whenever the kit changes, whose count of "had to write it myself" is
the distance from a reusable formula.

**Baseline** is the round-1 after-state (the tables above; captures in
`examples/journey/shots/round1-verify-*`).

**Scope**

- *Kit (wave A, first):* `useLevelFlight`, `presenceStyle`/`presenceOf`, `useSharedIdentity`,
  `cssMs`/`useTokens`, `useOverlayEscape`, the in-flight abort half of the Escape rule, the
  template on the formula, and a README section mapping the nine rules to primitives.
- *Atlas (wave B, new, port 3006):* the repo's own Athena architecture (README §3 layers, the
  packages, the six invariants as concepts) explored at three altitudes — concept, system,
  component — one direction, built only through the kit; every local workaround logged as a kit gap.
  The old `athena-everywhere/examples/atlas` is discarded; only its concept survives.
- *Ledgerbox (owner's notes):* L0 fills large monitors, legible marks and type, a reading line per
  lane, attention by default (quiet marks semitransparent); L1 status glyph instead of id, footer
  legend doubles as filter, the open lane's timeline folded into the head's right half and the other
  lanes' rails removed; L2 footer selects styled, the AUTO/GATED bars replaced by one CTA opening a
  decision dialog with a conversation slot for Athena.
- *Tidycrm (owner's notes):* L0 remodelled from four zones of records to nine databases of tables,
  one dot per table, cell fill by state, subtle red where a fault sits inside. Three prototypes behind
  a tab switcher on `/` — plate (2.5D, tilt only), slab (WebGL 3×3×1, snap rotation), octants (cube
  2×2×2 + core, snap rotation) — so the owner picks from live builds. Plus ink-waits on the dossier
  morph and arrow keys at L1.
- *Hirelane (carry-overs only):* heading waits for the echo, cards fly back to their faces, carousel
  keeps its centre after a dossier, board brief amended, and a production-build measurement of the
  level-change long task.

**Decisions taken by the owner:** L1 timeline folds into the head's right half; L2 acts become one
CTA into a decision dialog; tidycrm prototypes all three L0 shapes; atlas models this repo's
architecture.

**Kit gaps found by migration** (running list; the consolidation review closes them):

- *hirelane:* `useOverlayEscape` always prefers the opener; a pane that grew out of a card wants
  the card to win. Needs a `prefer` option or `focusReturnTarget` reachable separately.
- *hirelane:* `fallbackToken` cannot read a `calc()` token (unregistered custom properties come back
  unresolved); either sum a list of tokens or document "declare the budget as one step".
- *hirelane:* `presenceOf` returns a shape motion rejects as a `Target`; a `presenceTarget()` typed
  for `animate=` is needed for the template to compile as written.
- *hirelane:* `settle()` has no "this move had no camera" spelling; an unclaimed flight should count as
  settled within a frame, or apps re-find the double-Escape-aborts-into-the-overlay bug.
- *hirelane, useful surprise:* `useTokens` caught Turbopack minifying `--bd-dur-2` to `.16s`; the old
  TS map never saw the cascade.
- *ledgerbox (round 2 build):* a portal-inside-token-scope helper; a presence→opacity mapper that
  survives motion's inline `opacity` writes; `useRoving(selector)` for arrow-key grids (third copy).
- *hirelane (round 2 build):* `useLevelInk(nav)` → wait / leave / null; a "highlight for one beat"
  helper, since `nav.highlight` has no expiry.

- *ledgerbox (migration):* `presenceStyle` assumes the surface owns no transform — a lane carrying
  `translateZ` as data cannot take the returned `scale`; needs a "no scale key" option. The kit knows
  one presence channel (navigation) and has no vocabulary for a second, domain-owned one (the
  books' "wants a decision"). `fallbackToken` needs an element that does not exist on first render.
- *tidycrm (migration):* `emphasis()` has no answer for hover, so WebGL cells keep their own weight;
  `presenceStyle` needed both `depth` and `floor` overridden for a legend rail (a preset would do);
  same opener-preference bite as hirelane.
- *atlas (13 logged in `examples/atlas/KIT-GAPS.md`):* the three that matter — `Presence` is an
  interface motion rejects as a `Target`, so the kit's own template does not typecheck as written;
  there is no echo container, so rule 1, the headline rule, is still ~30 lines of app code plus CSS
  in every app; focus does not follow an L0↔L1 change, only L2 is covered. Also `read_view` at L1
  hands an agent a flat list of 68 component ids with no system structure.

**Outcome** — commits `350cd22` (kit), `bed7a3e` + `48e4482` (hirelane), `a8200ae` + `3857381`
(ledgerbox), `9b64d2f` + `ef008fd` (tidycrm), `37b5784` (atlas). All gates green everywhere (kit
69, ledgerbox 29, hirelane 50, tidycrm 63, atlas 30 tests). Four apps run: 3001, 3002, 3004, 3006.

| Axis | Ledgerbox | Hirelane | Tidycrm | Atlas (first) |
|---|---|---|---|---|
| Composition per level | 4 → 5 | 4 | 4 → 4* | 4 |
| Transition choreography | 4 | 4 → 5 | 4 | 3 |
| User control | 4 → 5 | 4 | 4 → 5 | 3 |
| Continuity | 4 | 4 → 5 | 4 | 4 |
| Motion cost | 4 | 3 → 4 | 4 → 5 | 5 |

\* held at 4 until the owner picks one of the three L0 prototypes; the plate reads clearest.

What moved: ledgerbox's L0 now fills a 2560 display and reads at arm's length, quiet marks recede
by default, L1 carries glyphs, a folded timeline and the legend-as-filter, L2 has one decision
dialog. Hirelane's heading waits for the echo and the row you return to stays lit; its long task is
proven dev-only (52 ms once cold in production, then zero). Tidycrm is nine databases of tables
with three L0 shapes to choose from, all costing nothing at rest, the arrival abortable through the
kit. Atlas exists, built on the kit alone, and its gap count is the first reading of the distance
to a reusable formula: **13 gaps on a fresh app, 10 more from three migrations, 7 distinct themes.**

**The migrations paid for themselves twice.** Hirelane's `useTokens` caught Turbopack minifying
`--bd-dur-2` to `.16s`, which the old TypeScript map never saw. Hirelane's `nav.abort()` exposed
that an echo-less flight was never settled, so a second Escape aborted back into the dossier.
Ledgerbox removed 275 lines and tidycrm 159, both verified pixel-identical.

**Facts about the data worth knowing:** none of tidycrm's 46 tables is clean in this seed, so the
quiet-database fill cannot be judged from real data; a test now fails the day that changes.

**Round-3 kit work, consolidated from every gap above (one bullet per theme):**
1. An echo container that carries rule 1: the inert, id-free outgoing copy, the camera move through
   a measured origin, the direction, and which level changes get one.
2. Presence made composable: a `type` motion accepts, a "no scale key" option for surfaces whose
   transform is data, a rail preset, a hover channel, and a documented way to nest a domain-owned
   channel under the navigation one.
3. Focus follows every level change, not only L2: a focus-follow rule for L0↔L1, `useRoving` for
   arrow-key grids and rows, and `useOverlayEscape` gains a `prefer` between opener and origin.
4. Flight ergonomics: `fallbackToken` accepts a list or a `calc()`, works without an element on
   first render, and an unclaimed flight settles itself within a frame.
5. Ink on its own clock: `useLevelInk(nav)` → wait / leave / null, plus a highlight-for-one-beat.
6. A portal that stays inside the token scope.
7. `read_view` at L1 with group structure for agents.

**Carried to later rounds:** URL sync (still nowhere); tidycrm L0 pick; atlas at 68 components is
over the brief's density and L2 does not fit a 900 px viewport; the L0 column heads in hirelane still
arrive at full ink on the first frame of a zoom-out.

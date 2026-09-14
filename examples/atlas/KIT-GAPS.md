# KIT-GAPS — the distance from a reusable formula

Atlas is round 2's objective test of the layered-UI formula (`docs/layered-ui-formula.md` §2): an
app built **only** through `@athena/demo-kit`'s primitives, whose count of "I had to write this
myself" measures how far the kit is from a formula somebody can just *use*. This file is the
measurement, and it is the deliverable as much as the app is.

**One bullet per thing written locally that the kit should have provided**, or per place a
primitive's API fought back. Each says what, why the kit did not cover it, the file it was written
in, and a one-line proposal. Nothing in `examples/demo-kit` was edited to make Atlas work; every
workaround is here instead.

**Score for round 2, first build: 13 gaps** — 5 that cost real code (#1, #2, #3, #4, #7), 3 that
cost a workaround (#5, #6, #8), 5 that are documentation or ergonomics (#9–#13). Nothing in the
nine rules was *impossible*; rules 1, 3 and 5-adjacent focus were the expensive ones.

---

## 2026-09-14 — gaps found building Atlas

### 1. `Presence` is an `interface`, so it cannot be handed to motion at all

**What.** `presenceOf()` returns `Presence`, declared as an `interface`. TypeScript does not give
an interface an implicit index signature, and motion's `Target` requires one
(`` `--${string}` `` keyframes). So `animate={presenceOf(focus, group)}` — **which is exactly what
the kit's own `template/components/Levels.tsx` writes, twice** — does not compile under
`motion@13.2.0` with `strict`. Atlas spreads it: `animate={{ ...presenceOf(...) }}`.

**Why the kit didn't cover it.** The three round-1 apps all built their own object literal from
`emphasis()` and never passed a `Presence` straight in, so the template's line was never
typechecked against a real app's tsconfig. `scripts/check-template.mjs` runs `tsc` over the
template, so this is presumably live there too.

**Written in.** `components/atlas/level0/Index.tsx`, `components/atlas/level1/Layer.tsx`.

**Proposal.** Declare `Presence` as a `type` alias (`type Presence = { opacity: number; scale: number }`)
— a type alias gets the implicit index signature an interface does not — or export
`presenceTarget(): Record<string, number>` beside it. One-line change; unblocks the template.

---

### 2. There is no echo container, and rule 1 is the kit's headline rule

**What.** Rule 1 — "the level you leave carries the camera" — is the first rule in §1 and the one
two apps arrived at independently, and the kit ships *nothing* for it. `useLevelFlight` gives
`from` / `to` / `moving`, which is the hard half; the other half is written by hand in every app:
an absolutely-positioned, `inert`, `aria-hidden`, id-free copy of the outgoing level; the
`AnimatePresence` around it keyed on `flight`; the decision of *which* level changes deserve an
echo at all (Atlas: L0↔L1 yes, L1↔L2 no, because L2 grows out of a row that stays on screen); the
zoom direction (in or out); and a whole `echo` prop threaded through every level component so it
can render itself inert and without `layoutId`s.

That last part is the bit that actually generalises and it is nowhere written down. The template's
`dk-echo` is an inline duplicate of three lines of list markup, which does not survive contact with
a real level component.

**Written in.** `components/atlas/Atlas.tsx` (~30 lines), `components/atlas/style/base/sheet.css`
(`.at-echo`), plus the `echo?: boolean` branch in `level0/Index.tsx` and `level1/Layer.tsx`.

**Proposal.** Ship `<LevelEcho flight={flight} when={(from, to) => boolean}>{(from) => ...}</LevelEcho>`
— it owns `AnimatePresence`, the key, `inert`, `aria-hidden`, the direction and the one-screenful
clip — plus a written rule that a level component takes an `echo` prop and drops every `layoutId`
when it is set. At minimum, export `echoing(flight, focus)`.

---

### 3. Focus does not follow a level change; the hook only covers L2

**What.** `useOverlayEscape` returns focus from an overlay to its opener, which is rule 5 and is
excellent. But a plain L0 → L1 change unmounts the button the reader's focus was on, and focus
falls to `<body>` — the reader is at the top of the document with the level they just opened three
hundred pixels down. Round 1 named this ("no focus management on L0 → L1, no focus restore on the
way back") and the consolidation round fixed only the overlay half.

Atlas wrote a landing effect: remember the level, on change find `[data-arrival]` in the live layer
and focus it. It then needed a second guard — *skip when the previous level was 2* — because
`useOverlayEscape`'s restore and this effect both reach for the caret in the same commit, and which
one wins is a frame-ordering accident (the hook's restore is in a `requestAnimationFrame`, so it
happens to win; that is not something an app should be relying on).

**Written in.** `components/atlas/Atlas.tsx`, the `landed` ref effect (~12 lines) and a
`data-arrival` attribute on the L0 stack's first band and the L1 head.

**Proposal.** `useLevelFocus(nav, { arrival?: () => HTMLElement | null })` in the kit, which knows
about `useOverlayEscape` and yields to it on any change that leaves L2 — so the two halves of
"focus follows the reader" are one rule in one place instead of two that race.

---

### 4. Rule 3 ("box, then ink") has no primitive, and it is two transitions every time

**What.** The kit README says rule 3 is app-side and that the kit "gives it the clock and the
completion signal". True, but the *shape* is identical in every app: an `inkIn` that is the ink
duration delayed by a whole move, an `inkOut` that is the ink duration with no delay, and — for
the echo — a way to fade the secondary ink faster than its box. Atlas wrote all three, and got the
third wrong on the first try (one fading wrapper around the whole echo faded the boxes with the
text, and the echo vanished a third of the way through its own move; found by reading the 120 ms
frame of the capture strip, fixed by scoping a CSS animation to `.at-echo` descendants).

Beside it: every app also writes `useReducedMotion() === true` (the hook returns `boolean | null`)
and its own `INSTANT = { duration: 0 }`.

**Written in.** `components/atlas/motion.ts` (the whole file, ~60 lines),
`components/atlas/style/base/sheet.css` (`@keyframes at-ink-out` and its selector list).

**Proposal.** `useStagedMotion({ move, ink, ease }, el?)` returning `{ reduced, move, inkIn, inkOut, moveSecs }`
from token names — the four things every surface on the formula needs, read off the cascade, with
the reduced branch already taken.

---

### 5. `bounded()` does not return the footer the kit's README says it returns

**What.** `demo-kit/README.md` states: "`bounded` / `boundedPage` are the one truncation shape:
`{ showing, of, items }` **plus a `(showing N of M)` footer**." `bounded()` returns no `footer`
field. AGENTS.md requires the sentence, so Atlas wrote `announce()` / `announced()` around the
kit's helper to add it. Every app that reads the README and trusts it will write the same wrapper.

**Written in.** `components/atlas/tools/read.ts`, `announce()` and `announced()`.

**Proposal.** Add `footer: \`(showing ${showing} of ${of})\`` to `Bounded<T>` — one line — or delete
the claim from the README. The first is better: the sentence is a repo invariant (README §2, #4)
and an invariant should not be re-implemented per app.

---

### 6. Every member of `ZoomNav` changes identity on every nav state change

**What.** `useWorldNav` builds the whole `Nav` object inside one `useMemo` whose deps include
`state`. So `nav.highlight`, `nav.openGroup`, `nav.up` and the rest are new functions after every
hover, every highlight and every level change. Anything that wants to call one from an effect
either mirrors it into a ref or loops: Atlas's lens is expressed downward through `nav.highlight`
in an effect keyed on the lens, and putting `nav` in that effect's deps would re-dispatch a
highlight on every render caused by the highlight.

**Written in.** `components/atlas/Atlas.tsx`, the `highlight` ref plus its mirroring effect
(5 lines that exist only to work around this).

**Proposal.** Hoist the dispatch-only members into `useCallback`s outside the state-dependent
memo — `dispatch` is already stable, so `openGroup`, `openItem`, `up`, `home`, `abort`, `hover`
and `highlight` can all be stable. Only `state` needs to change.

---

### 7. The level rail is written from scratch in every app, including its state logic

**What.** `zoom/index.ts` says, deliberately: "No chrome and no stylesheet: the level rail, the
breadcrumb and the back affordance are where a direction earns its identity." Agreed about the
*drawing*. But the state behind it is not identity, it is arithmetic — which steps exist at this
focus, which one is current, which are behind you and therefore clickable, what each is called,
and what clicking each dispatches — and it is the same arithmetic in four apps now.

**Written in.** `components/atlas/Mast.tsx`, the `<ol className="at-rail">` block (~55 lines, most
of it `aria-current` / `disabled` / `nav.up()` vs `nav.home()` branching).

**Proposal.** A headless `useLevelRail(nav, levels, names?)` returning
`{ label, level, current, disabled, onSelect }[]`. State, not chrome; the direction still draws it.

---

### 8. `useZoomTools` has exactly two tiers, and a real model often has three

**What.** The zoom model is population → group → item, and Atlas's model is layer → **system** →
component. The middle tier is the whole argument of L1 (one layer, its systems laid out to
compare), and there is nowhere to put it: `items(group)` had to flatten every system's components
into one list, so an agent calling `read_view` at L1 gets sixty-eight flat ids and no idea that
they are grouped. Atlas re-exposed the middle tier as a hand-written `read_system` tool with its
own bounded projection.

**Written in.** `components/atlas/tools/AtlasTools.tsx` (`read_system`), `components/atlas/tools/read.ts`
(`systemRead`).

**Proposal.** Optional `subgroups?: (group: string) => ZoomGroup[]` in `ZoomToolsSpec`, folded into
`read_view`'s payload and accepted by `open_item`'s lookup — or, if two tiers is a deliberate
constraint, say so in the docstring so the next app does not look for the third.

---

### 9. `presenceOf()` has no answer for a middle tier either

**What.** Same shape as #8, one layer down. `emphasis(focus, group, item)` can say how present a
layer is and how present a component is, but not how present a *system* is, and composing the two
(dim the column *and* dim its rows) multiplies the fade. Atlas applies presence to component rows
only and leaves the system columns at rest, which is right here but is a decision the app made
because the model could not express the alternative.

**Written in.** `components/atlas/level1/Layer.tsx` (by omission — the columns have no `animate`).

**Proposal.** Document the two-tier limit beside `emphasis()`, or take an optional path
(`emphasis(focus, [group, sub, item])`).

---

### 10. `useTokens` reads an unknown token as `0`, which is indistinguishable from reduced motion

**What.** The SSR-safe default (`raw: ""`, `ms: 0`) is the right call and is well argued in
`tokens.ts`. The consequence is that a typo'd token name produces a `0 ms` transition — which is
exactly the reduced-motion branch — so the mistake looks like a feature and never throws. Atlas
wrote a lint-time check that every `var(--at-*)` in the app is declared in the token file, because
the runtime cannot tell you.

**Written in.** `design/check-tokens.mjs` (check 2). Also catches raw `px` / `ms` outside the token
block, which is a design rule rather than a kit gap.

**Proposal.** In development only, `console.warn` from `useTokens` naming any token that read `""`
on a mounted element. The production path is unchanged.

---

### 11. `settle()` needs a zero-size keyed element, and you can only learn that by copying

**What.** `useLevelFlight`'s docstring shows `<motion.span key={flight} transition={move} onAnimationComplete={settle} />`
and explains why, but the element itself — absolutely positioned, zero width and height,
`aria-hidden`, animating a property nobody sees — is a trick, and an app that does not copy it
falls back to the timeout and its level change ends at a number rather than at the motion. Atlas
copied it verbatim, including the CSS class.

**Written in.** `components/atlas/Atlas.tsx` (`.at-flight` span), `style/base/sheet.css`.

**Proposal.** Export it: `<FlightSignal flight={flight} transition={move} />`. Three lines in the
kit, deleted from every app, and the fallback stops being the common case by accident.

---

### 12. There is no stylesheet for the level scaffold, so it is copied as text

**What.** The template declares `.dk-levels`, `.dk-level`, `.dk-echo`, `.dk-flight` and
`.dk-overlay` inside `app/globals.css`. They are structural (positioning, clipping, pointer-events)
rather than decorative, so every new app copies those rules by hand and then renames them — Atlas
has `.at-echo`, `.at-flight`, `.at-levels`, `.at-live` for precisely the template's reasons, with
one real fix (`inset: 0` clipped the echo to the *arriving* level's height, which cropped it to a
strip; it needs one screenful).

**Written in.** `components/atlas/style/base/sheet.css`, the `.at-levels` / `.at-echo` /
`.at-flight` / `.at-live` block.

**Proposal.** Ship `@athena/demo-kit/zoom/zoom.css` with the four structural classes and no colour,
no type and no spacing — the kit's "no chrome" rule is about appearance, and `position: absolute`
is not an appearance.

---

### 13. Nothing tells the surface that a flight was *aborted* rather than completed

**What.** `escapeAbortsFlight` + `nav.abort()` work, and the interrupt probe lands cleanly (Atlas
returns to L0 with focus on the band). But `useLevelFlight` reports the abort as just another
flight, so a surface that wanted to stage "you came back" differently from "you arrived" cannot
tell the two apart. Atlas does not need this today; it is logged because the half of rule 6 the
kit *does* now have made the other half visible.

**Written in.** Nowhere — no workaround was needed, which is why this is last.

**Proposal.** Add `aborted: boolean` to `LevelFlight`, derived from the reducer (an `abort` action
is the only one that sets `focus` to `prev`).

---

## What the kit got right, for the record

Because a gap list read alone is a misleading document. Five primitives did the job with no local
code at all, and three of them are the ones round 1 got wrong in all three apps:

- **`useLevelFlight`** — `from` known on the frame the level changes is the whole reason rule 1 is
  implementable. Atlas never re-derived it, and `nav.setMoving` came for free, so the interrupt
  probe passed on the first run.
- **`useOverlayEscape`** — Escape at L2 and focus back to the opener worked on the first try, with
  no `stopPropagation` anywhere and no second window listener. The capture shows
  `at-pane → at-l1-head → at-band` across two Escapes.
- **`sharedIdentity` / `useSharedIdentity`** — both morphs (band → L1 head, row → pane) played
  first time. The key-flip rule is the thing three apps got wrong in round 1 and it is now one
  call.
- **`escapeLeavesLevel` / `escapeAbortsFlight`** — untouched, and the aria-modal deferral is
  correct: Atlas's pane owns its key and the nav's listener stays out of the way.
- **`useZoomTools`** — four verbs, no arguing, and the generated descriptions read well enough to
  ship. Within its two tiers (#8) it is the least-effort part of the whole app.

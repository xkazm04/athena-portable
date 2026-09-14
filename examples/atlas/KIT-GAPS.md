# KIT-GAPS — the distance from a reusable formula

Atlas is the objective test of the layered-UI formula (`docs/layered-ui-formula.md` §2): an
app built **only** through `@athena/demo-kit`'s primitives, whose count of "I had to write this
myself" measures how far the kit is from a formula somebody can just *use*. This file is the
measurement, and it is the deliverable as much as the app is.

**One bullet per thing written locally that the kit should have provided**, or per place a
primitive's API fought back. Each says what, why the kit did not cover it, the file it was written
in, and a one-line proposal. Nothing in `examples/demo-kit` was edited to make Atlas work; every
workaround is here instead.

**Round 2's score, first build: 13 gaps** — 5 that cost real code (#1, #2, #3, #4, #7), 3 that
cost a workaround (#5, #6, #8), 5 that are documentation or ergonomics (#9–#13). Nothing in the
nine rules was *impossible*; rules 1, 3 and 5-adjacent focus were the expensive ones.

**The running score: 13 (round 2, first build) → 11 (round 3, the machine) → 10 (round 4, the
blueprint).** The count falls slowly and the *composition* is what moved: round 2's expensive gaps
were the formula's own rules (the echo, staged ink, focus); round 4's are all about things the kit
has no concept for — a second axis, a composable binding, focus after a move nobody clicked. Five
of round 4's ten are unchanged repeats from earlier rounds, which is the more useful number: **the
gaps that survive three rounds are the ones worth the kit's time.**

---

## Round 4 — the blueprint (2026-09-14)

Round 4 rebuilt Atlas as a **2D drawing**: one ruled sheet, nineteen system blocks with ports,
orthogonal runs, four switchable arrangements of the same blocks, and three bands of detail driven
by the camera. The owner's verdict retired the machine and the three renderers; `three`,
`@react-three/*` and the whole `scene/` directory went with them.

**Score for round 4: 10 gaps.** Four cost real code (#R4-1, #R4-2, #R4-3, #R4-5), three cost a
workaround (#R4-6, #R4-7, #R4-10), three are documentation or a rule the formula does not yet have
(#R4-4, #R4-8, #R4-9). Five of the ten are round 2's or round 3's, unchanged, and they say so.

**The three that matter**, before the list:

*(a)* **The kit has a level axis and no vocabulary for a second, orthogonal one** (R4-1). A view is
not a level: the reader stays exactly where they are in the model and the drawing re-arranges under
them. That one missing concept opens three holes at once — a camera move that must not bump the
flight, a choice that needs a URL, a snapshot and a fallback, and a tool the four level verbs know
nothing about. Every surface in `examples/` has now grown one of these (three renderer switches, a
prototype switcher, a view switcher) and all four wrote it themselves.

*(b)* **`rig.bind` is a prop bag that cannot be composed** (R4-2). On any surface where the canvas is
*also* a focus container, two of its eight members need wrapping — `ref` (to measure the element)
and `onKeyDown` (to decide whether the arrows are the camera's or the drawing's) — so the surface
explodes the bag by hand and re-types the other six. The kit's one real safety, the non-passive
wheel listener, rides on the member most likely to be dropped.

*(c)* **Focus still does not follow a level change nobody clicked** (R4-4). Fourth round. An agent
tool opening a component lands the pane correctly and Escape returns focus to *whatever was focused
before*, which in the capture is the view switcher in the mast — a control on the other side of the
screen from the thing the reader just closed.

**And the good news, stated first because a gap list read alone is misleading:** the camera is
*orthographic*, which is exactly what a blueprint needs, and round 3's single biggest finding —
that `resolveItem` has no honest answer — **is not a kit gap at all.** It was a fact about a
container scene. On a sheet the items are laid out in the plane, "which item is under the camera"
has an answer, and the wheel walks all three levels. The contract's headline claim is true here,
and it took a 2D surface to show that.

---

### R4-1. There is no second axis: a view switch is three holes in a row

**What.** The nav model is `level x group x item` and nothing else. Atlas's fourth axis — which of
four arrangements is on the sheet — is orthogonal to all three, and the kit has no place to put it,
so the app wrote:

- **the camera move.** A view switch re-frames the SAME focus in the new arrangement, so it must fly
  the camera without bumping `nav.state.flight` — a flight would make it a level change, would arm
  an abort, and would make Escape mean "undo the view switch". `useSemanticZoom` only flies when the
  nav moves, so the app calls `rig.flyTo(poseFor(focus, nextView, frame))` itself
  (`canvas/useCanvasCamera.ts`, `refit`), and must also keep the view in a ref because the hook holds
  the three resolve callbacks across renders.
- **the choice.** `?view=`, `localStorage`, `replaceState`, and — the part that is genuinely fiddly —
  the value is not knowable on the server, so a lazy `useState` initialiser is a hydration mismatch
  and an effect chasing it is a cascading render the lint rule correctly refuses. The answer is
  `useSyncExternalStore` with a server snapshot, which is about forty lines nobody should write
  twice (`canvas/useView.ts`).
- **the tool.** `useZoomTools` generates four verbs and cannot be told a fifth exists, so `set_view`
  is hand-written and `read_view`'s payload had to be hand-extended to name the arrangement — an
  agent reading `read_view` alone would otherwise describe a drawing it cannot see the shape of.

Round 3's gap 4 named `useChoice(key, param, values)` as "a switcher hook in three copies". This is
the fourth copy and it is now clear the hook is the smallest part of the problem.

**Written in.** `canvas/useView.ts` (whole file), `canvas/useCanvasCamera.ts` (`refit` + the view
ref), `tools/AtlasTools.tsx` (`set_view`), `tools/read.ts` (`viewDetail`'s `view` block).

**Proposal.** `useChoice(key, { param, values, fallback })` returning `[value, set]` with the
`useSyncExternalStore` shape already right; a `rig.reframe(pose)` that flies without claiming a
flight; and `ZoomToolsSpec.axes` — a list of `{ name, values, read, set }` the kit registers as
tools and mentions in `read_view`.

---

### R4-2. `rig.bind` cannot be composed, so a real surface takes it apart

**What.** Round 3 logged this as "`bind.ref` is a deviation that fails silently" (R3-3) and proposed
`composeRefs`. Round 4 shows it is bigger than the ref. Atlas's canvas is the camera's element AND
the drawing's focus container, so:

- `bind.ref` must be composed with the app's own ref (to measure the frame and to answer "is the
  canvas itself focused") — `composeRefs` again, second round running, still ~6 lines;
- `bind.onKeyDown` must be *conditional*: the camera's arrows only when the canvas itself has focus,
  the drawing's roving arrows otherwise, and `+`/`-`/`Home` always the camera's.

Neither can be done through a spread, so the app writes out all eight members of `bind` by hand,
including `tabIndex`, `style` and `data-camera`, and any member the kit adds later is silently
missing. The failure mode is the round-3 one: everything still works and the page also scrolls.

**Written in.** `canvas/Canvas.tsx` — `composeRefs` (~6 lines) plus the explicit eight-prop spread
and the `onKeyDown` router (~15 lines).

**Proposal.** `rig.bind` should be a function, not an object: `rig.bind({ ref, onKeyDown })` returns
the merged props, composing what it is given with what it owns. Or, minimally, `rig.attach(el)` and
`rig.keys(event)` as two methods the surface calls from its own handlers, so there is nothing to
collide with.

---

### R4-3. Two kit hooks return `{ onKeyDown }` and there is no way to run both

**What.** `useRoving(ref, { selector, columns })` and `useCameraRig(...).bind` both hand back an
`onKeyDown` for the same element, and a surface that wants both must decide the precedence itself.
The precedence is not obvious and it is not the same on every surface — Atlas's rule ("arrows move
focus unless the canvas itself is focused; `+`/`-`/`Home` are always the camera's") is a design
decision the app should be making, but *how* to express it is plumbing the kit should own.

`useRoving` helpfully declines to `preventDefault` a key that moved nothing, which is what makes the
fall-through possible at all — so the ingredients are there and the recipe is not.

**Written in.** `canvas/Canvas.tsx`, the `onKeyDown` router.

**Proposal.** `composeHandlers(...handlers)` in the kit, documented with exactly this case: run in
order, stop at the first `defaultPrevented`. Three lines, and it makes "who owns the arrow keys" a
one-line declaration instead of a paragraph in a docstring.

---

### R4-4. Focus does not follow a level change nobody clicked. Fourth round

**What.** Round 1 named it, round 2 fixed only the overlay half (#3), round 3 named it again as
"written for the third time". Round 4's evidence is in the capture: `open_item` from an agent tool
opens the pane, Escape closes it, and `useOverlayEscape` returns focus to the opener — which, for a
tool-driven open, is whatever the reader last touched. In `shots/round4-atlas/log.txt` that is
`at-view-btn`, the view switcher in the mast, three hundred pixels from the block that just closed.

The pane names a `returnFocusTo` (`[data-component="..."]`, which exists and is on screen), and it
is only consulted when the opener is gone. There is no way to say "prefer the origin over the opener
when the opener was never a control the reader pressed".

**Written in.** Nowhere — no workaround was attempted this round, deliberately, so the gap is
measured rather than papered over. Round 2's Atlas wrote a twelve-line landing effect and then
needed a second guard because it raced `useOverlayEscape`'s restore; that race is the reason not to
write it a second time.

**Proposal.** `useLevelFocus(nav, { arrival })` in the kit, which knows about `useOverlayEscape` and
yields to it, plus an `origin` preference on the overlay hook that wins when the opener is not a
focusable the reader chose. Two halves of one rule, in one place, instead of two that race.

---

### R4-5. The resolve callbacks get a pose and no frame

**What.** Round 3's consolidated gap 5, unchanged and now load-bearing. `poseFor(focus)` has to
answer "the zoom that fits the whole sheet", which depends on the canvas's size; the contract hands
it a pose and nothing else. Atlas measures the element with a `ResizeObserver` and reads the size
through a ref inside the callback — which works, and which means the callback is no longer pure and
no longer testable without faking a frame. The test therefore calls a `poseFor(focus, view, frame)`
that the app wrapped around it.

There is a second consequence: the first paint has no measured frame, so the home pose fits nothing,
and the app needs a one-shot re-fit on the first animation frame after the observer answers — with a
guard so it never fires after the reader has moved.

**Written in.** `canvas/useCanvasCamera.ts` (the observer, the ref, the one-shot re-fit — ~25 lines),
`canvas/poses.ts` (the `frame` parameter threaded through `poseFor` and `homeZoom`).

**Proposal.** `SemanticZoomOptions`' three callbacks take `(pose, frame)`, and the rig exposes the
frame it already measures for `zoomAt` (`rig.frame()`). It has the number; it is the only thing that
does.

---

### R4-6. `emphasis()` still has two tiers, and this is the third round of saying so

**What.** Round 2 #9, round 3 #7, unchanged. The model is layer -> **system** -> component; the kit
answers for a group and for an item and has nothing to say about the tier between them. Atlas gives
a block its LAYER's presence with a floor, so a receding layer's blocks stay drawn rather than
vanishing and a lit part inside one is not taken down with it.

`presenceStyle`'s `{ scale: false }` option, added after round 2, worked first time and is the
reason this is a workaround rather than real code: a block's transform is its POSITION, which is
data, and the navigation channel must not write a `scale` into it.

**Written in.** `canvas/Block.tsx`, the `presenceStyle(emphasis(focus, block.layer, null), ...)`
line.

**Proposal.** As rounds 2 and 3: an optional path, `emphasis(focus, [group, sub, item])`.

---

### R4-7. `read_view` at L1 still has to be nested by hand

**What.** Round 2 #8 and round 3 #9, unchanged: `useZoomTools` has exactly two tiers, so `items()`
flattens sixty-eight components into one list and an agent at L1 is handed a flat array with no hint
that they are grouped by system. Round 4 closes it *in the app* — `viewDetail` now answers `systems`
with each system's own bounded component list nested inside, and a test asserts the nested and flat
answers name exactly the same set — but `useZoomTools` still generates the flat one beside it, so
the payload carries the same components twice.

**Written in.** `tools/read.ts` (`viewDetail`'s L1 branch), `test/tools.test.ts` (the agreement
test).

**Proposal.** Optional `subgroups?: (group: string) => ZoomGroup[]` in `ZoomToolsSpec`, folded into
`read_view` and accepted by `open_item`'s lookup.

---

### R4-8. Nothing in the kit knows the difference between a band and a level

**What.** A rendering band is not a navigation level — formula rule 13 says so — and
`useSemanticZoom` returns both (`level` from the zoom, and the nav's own `focus.level`) without ever
saying that they can disagree, or for how long. They disagree on every frame of a fly: the camera
crosses the band before it arrives, so `[data-band]` flips a class while `[data-level]` is still
behind it, which is *exactly what you want* (the detail crossfades while the camera is still moving)
and is nowhere written down.

Atlas leans on it deliberately: the parts fade in on the band, the pane opens on the level. A surface
that assumed the two were the same would either remount the world mid-fly or hold the detail back
until the camera stopped. The capture shows the two apart in three separate frames.

**Written in.** Nowhere — no workaround was needed. Logged because the formula has the rule and the
kit's own API is silent about its consequence.

**Proposal.** Document `SemanticZoom.level` as "the rendering band, which leads the nav during a
fly", and say that a surface should drive detail from it and structure from `nav.state.focus`.

---

### R4-9. `useTokens` reads an unknown or unmounted token as `0`

**What.** Round 2 #10, round 3 #10, unchanged. The SSR-safe default is right and the consequence is
that a typo'd token name produces a `0 ms` transition, which is indistinguishable from the
reduced-motion branch. Atlas still carries a lint-time check that every `var(--at-*)` in the app is
declared in the token file, because the runtime cannot tell you.

Round 3's second half of this gap is **closed by the redesign**: `FALLBACK_BEAT` and the lint check
that kept it equal to `--at-dur-beat` are both gone, because the turn no longer has a clock. One
fewer number to keep in two places, for a reason that had nothing to do with the kit.

**Written in.** `design/check-tokens.mjs` (check 2).

**Proposal.** In development only, `console.warn` from `useTokens` naming any token that read `""`
on a mounted element.

---

### R4-10. Every member of `ZoomNav` still changes identity on every nav state change

**What.** Round 2 #6, unchanged. `useWorldNav` builds the whole `Nav` inside one `useMemo` keyed on
`state`, so `nav.highlight` is a new function after every hover and every level change. Atlas's lens
is expressed downward through `nav.highlight` in an effect keyed on the lens; putting `nav` in that
effect's deps would re-dispatch a highlight on every render the highlight caused.

**Written in.** `Atlas.tsx`, the `highlight` ref and its mirroring effect (5 lines that exist only
for this).

**Proposal.** Hoist the dispatch-only members into `useCallback`s outside the state-dependent memo.
`dispatch` is already stable, so `openGroup`, `openItem`, `up`, `home`, `abort`, `hover` and
`highlight` can all be.

---

### What the kit got right this round, for the record

- **The rig is orthographic, and that is the whole camera.** Drag-pan, wheel-at-pointer, pinch,
  keys, `Home`, bounds, inertia and the token-read fly are all the kit's; `useCanvasCamera.ts` is a
  hundred lines of which about fifteen are camera. Pinning `yaw` and `pitch` to `[0, 0]` is how the
  owner's "no 3D" verdict is expressed to a hook that does not need to know about it.
- **`useSemanticZoom` walks all three bands here**, which it could not in round 3, and the `driving`
  marker worked first time again: a wheel that crosses a band dispatches, a tool that opens a
  component flies, and neither echoes the other.
- **`presenceStyle({ scale: false })`** — round 2's ledgerbox gap, fixed in round 3, used in anger
  in round 4. It is the only spelling of "this channel does not speak for the transform", and a
  surface whose layout IS a transform needs it.
- **`useRoving`'s refusal to `preventDefault` a key that moved nothing** is what makes composing it
  with the camera possible at all. It is a small decision in a small file and it is the reason gap
  R4-3 is a missing helper rather than a redesign.
- **The four structural classes are no longer copied.** Round 2 logged that every app hand-copies
  `.dk-levels` / `.dk-echo` / `.dk-flight` / `.dk-overlay` (#12). This round has none of them: one
  continuous space needs no level stack, no echo and no flight signal, so the gap simply does not
  arise. That is worth knowing about the shape of the gap as much as about the gap.

---

## Round 3 — the camera contract, and the machine (2026-09-14)

Round 3 rebuilt Atlas as a **scene**: six strata as planes, systems as blocks, components as parts,
edges as pipes, and README §3.2's turn as a light that travels them. The kit landed
`docs/kit-camera-contract.md` in parallel. So this round measures two things at once — how far the
kit is from a reusable formula, and **how far the camera contract is from the surface it was
written for**.

**Score for round 3: 11 gaps.** Four cost real code (#R3-1, #R3-2, #R3-4, #R3-9), three cost a
workaround (#R3-3, #R3-5, #R3-7), four are documentation or a rule the formula does not yet have
(#R3-6, #R3-8, #R3-10, #R3-11).

**The three that matter**, before the list: *(a)* the contract's `resolveItem` assumes "which item
is under the camera" is a question with an answer, and for a scene whose items live inside a
container it is not — so semantic zoom is a two-band hook in a three-level app (R3-1). *(b)* `snap`
as a list of poses silently defeats semantic zoom, because a snap that carries `zoom` un-zooms the
reader and the level then never changes; nothing errors (R3-2). *(c)* rules 1, 2 and 3 of the
formula all assume a 2D layout, and none of them says so — in a scene, `layoutId` measures the wrong
rectangle, the echo has nothing to echo, and "box then ink" needs a third beat for a camera (R3-6).

---

### R3-1. `resolveItem` has no honest answer in a container scene

**What.** Contract §3 asks for `resolveItem(pose, group)`, and the hook opens L2 when the camera
crosses the second band. Atlas's items are parts standing inside a block: at the distance where that
band is crossed, *every* part of the block in frame is under the camera. There is no "the one under
the pointer", because the crossing is a zoom and not a point. Returning an arbitrary one flies the
reader somewhere they did not choose; returning `null` — which the docstring allows — means the
wheel stops at L1 and the third level is unreachable by camera.

Atlas returns `null` and opens parts by click and by tool. That is the right answer for this
surface, but it means **semantic zoom is a two-band hook in a three-level app**, and the contract's
headline claim ("camera distance is the level") is two thirds true here.

**Written in.** `components/atlas/scene/rig.ts`, `resolveItem: () => null` plus the comment
explaining why.

**Proposal.** Either accept a pointer (`resolveItem(pose, group, pointer?: { x, y })`) so a surface
can answer "the part under the cursor at the moment of crossing", or document that the third band is
for surfaces whose items are laid out in the plane, and give the two-band case a name.

---

### R3-2. `snap` as a list of poses silently defeats semantic zoom

**What.** The contract offers `snap?: readonly CameraPose[]`, and a list is the obvious thing to
pass. But a `CameraPose` is four numbers and only two of them are about where the reader is
*standing*; the other two are where they are *looking*. In a direction where **distance is the
level**, a snap whose poses carry `zoom: 1` pulls the reader back to `zoom: 1` the instant they stop
turning the wheel — so the band is never crossed, the level never changes, and the symptom is "the
wheel does nothing". No error, no warning, and the cause is three files from the effect. It took a
scripted browser probe reading the world transform frame by frame to find.

Atlas passes a **function** that keeps `zoom` and `pan` untouched, snaps yaw and pitch to the
nearest of three orientations, and declines entirely once the camera is inside a level.

**Written in.** `components/atlas/scene/poses.ts`, `snapPose()` (~20 lines) and its test.

**Proposal.** Ship `snapOrientation(snaps)` beside `nearestSnap`, and say in the contract that a
snap list is for surfaces whose zoom is not semantic. This is an interaction between two features of
the same document; only the kit can own it.

---

### R3-3. `bind.ref` is a deviation that fails silently

**What.** `rig.bind` carries a `ref` (for the non-passive wheel listener), which contract §2 does not
list. Spreading `bind` over a JSX element that already has a `ref` drops one of them — which one
depends on the order somebody typed the attributes in — and the failure is invisible: the camera
still orbits, the wheel still zooms, and the page *also* scrolls underneath. Atlas composes them.

The kit's own docstring warns about this, which is the right thing to do and is not the same as it
not being a hazard: a prop spread is the one place a reader does not look for a collision.

**Written in.** `components/atlas/render/useFrameSize.ts`, `composeRefs()` (~12 lines), used by both
scene renderers.

**Proposal.** Export `composeRefs` from the kit — every consumer of `bind` needs it — or have `bind`
expose `attach(el)` as a method the consumer calls from its own ref, so there is no prop to collide
with.

---

### R3-4. There is no `poseFor` helper, and getting it wrong is invisible

**What.** `poseFor(focus)` is the whole nav-to-camera half of the contract and every surface has to
write it. For a scene it means: resolve the target's offset from the orbit centre onto the camera's
own right and up axes, negate, and hand that back as `pan`. That derivation is eleven lines of cross
products, it is the most breakable thing in the camera, and **its failures do not look like
failures** — one sign flipped in the right vector and the camera flies to the *mirror image* of the
thing that was opened. Nothing throws, nothing logs, and the surface looks like a camera aimed
badly. Found by eye, in a screenshot, after the code had been green for an hour.

**Written in.** `components/atlas/scene/aim.ts` (the whole module, ~90 lines), plus two tests in
`test/scene.test.ts` asserting that `poseFor` lands its target within a pixel of the frame's centre
for every stratum and every part in the model.

**Proposal.** `aimPose(target, pose, { centre })` in the kit, pure and tested — the contract already
owns the pose, and "the pan that centres a world point" is arithmetic, not identity. At minimum, say
in §3 that `poseFor` needs a test and what that test should assert.

---

### R3-5. `useSemanticZoom` needs the flight, and the contract does not say so

**What.** The kit's `SemanticZoomOptions.flight` is marked "NOT IN THE CONTRACT" in its own
docstring, and it is load-bearing: without it a camera-driven level change never claims a flight, so
`flight.moving` is false during a wheel-opened move, an interrupt has nothing to abort, and rule 6
holds for a click but not for a wheel. A surface built from the contract alone would ship that
asymmetry and never see it.

**Written in.** Nowhere — the coordinator's message named it, and Atlas passes `flight` from the
first line. Logged because the gap is in the document rather than in the code, and the next app gets
the document.

**Proposal.** Fold `flight` into contract §3.

---

### R3-6. Rules 1, 2 and 3 of the formula assume a 2D layout, and none of them says so

**What.** This is the round's biggest finding, and it is about the formula rather than the kit's API.

- **Rule 1** ("the level you leave carries the camera") and its new `useEcho` / `Echo` primitive
  have nothing to do here. The camera IS the level change: `rig.flyTo(poseFor(focus))` moves the
  reader through one continuous space, so there is no outgoing level to render inert — the thing you
  left is still on screen, further away. Atlas mounts no echo at all, and is not worse for it.
- **Rule 2** ("one claimant per shared id") cannot be used. The part a pane grows out of is a face
  carrying a `matrix3d`, and `getBoundingClientRect` on it returns the axis-aligned bounding box of a
  projected quadrilateral — a rectangle the reader can see is not where the part is. Atlas grows the
  pane from a **projected point** instead, which is the same idea with the right measurement.
- **Rule 3** ("box, then ink") needs a third beat: the box moves, *the camera arrives*, then the ink.
  A label on the box's clock arrives while the camera is still flying.

**Written in.** `components/atlas/motion.ts` (the note where the two shared ids used to be),
`components/atlas/machine/Pane.tsx` (the projected origin), and the absence of an echo in
`Atlas.tsx`.

**Proposal.** §1 of the formula should say which rules are about a DOM layout and what their
equivalent is when the level change is a camera move. Rule 1 in particular has a strictly better
form in a scene, and the kit now ships a primitive for the weaker one.

---

### R3-7. `emphasis()` still has two tiers, and now the middle one is a solid object

**What.** Round 2's #9, unchanged and now more expensive. `emphasis(focus, group, item)` can say how
present a stratum is and how present a part is, and has nothing to say about a **block** — which in
a scene is not a column of rows but a box with a volume, standing between them. Atlas derives a
block's presence as the strongest presence among its parts, floored at its stratum's own, so a
receding block that still holds a lit part does not take that part down with it.

**Written in.** `components/atlas/render/contract.ts`, `weightsFor()`.

**Proposal.** As round 2: an optional path, `emphasis(focus, [group, sub, item])`.

---

### R3-8. `presenceStyle` has no vocabulary for a scene

**What.** It returns `{ opacity, scale }`, which is the right pair for a DOM layer and the wrong pair
for a machine. A block does not recede by shrinking — it recedes by losing its fill and keeping its
edge, or by dropping out of the lighting. Atlas maps presence to opacity only and lets each renderer
decide what "less present" looks like in its own vocabulary (a fill mix in css3d, material opacity
and emissive in webgl).

**Written in.** `components/atlas/render/contract.ts` (`Weight`), and the renderers' materials.

**Proposal.** Keep `presenceStyle` for DOM, and document beside `presenceOf` that the *number* is the
model's answer while the *mapping* is the direction's — which is already true and is written down
nowhere a scene author would find it.

---

### R3-9. `useZoomTools` still has two tiers, and the turn needed three tools of its own

**What.** Round 2's #8, unchanged: `read_view` at L1 hands an agent a flat list of the layer's
components with no system structure, so `read_system` is still hand-written. New this round: the
turn is the app's hero and the four verbs have no idea it exists, so `read_turn`, `set_turn` and
`play_turn` are written by hand. That is correct — a transport is not a level model — but it means
an agent must learn two vocabularies for one surface, and nothing in the kit's generated
descriptions tells it the second one exists.

**Written in.** `components/atlas/tools/AtlasTools.tsx` (three tools),
`components/atlas/tools/read.ts` (`turnRead`).

**Proposal.** `useZoomTools` should accept an `also` list of tool names to mention in `read_view`'s
payload, so one call tells an agent everything this surface can do.

---

### R3-10. `useTokens` reads an unknown or unmounted token as `0`, and a zero clock is not a clock

**What.** Round 2's #10, with a new consequence. The turn's beat is a duration read from the cascade;
during the server render and the first client frame `useTokens` answers `0`, and a turn on a zero
clock completes instantly and invisibly. Atlas carries a `FALLBACK_BEAT` constant and a lint check
that asserts it equals `--at-dur-beat`, because the alternative is two clocks.

**Written in.** `components/atlas/motion.ts` (`FALLBACK_BEAT`), `design/check-tokens.mjs` (check 5).

**Proposal.** `useTokens(names, { fallback })` — one option, and the app stops needing a lint rule to
keep two numbers equal.

---

### R3-11. Nothing in the kit knows about a clock that is content

**What.** Every duration the kit reasons about is a transition: it is zeroed under reduced motion,
and that is right for a level change. The turn is not a transition — it is twelve stops that
together are README §3.2, and a reader who asked for no motion should get them as **stills**, not as
an empty machine. Atlas keeps `--at-dur-beat` out of the reduced block and has the transport snap
stop to stop instead of interpolating.

That distinction — a *transition* versus a *sequence a reader is reading* — is a real rule, and the
formula does not have it.

**Written in.** `components/atlas/style/base/tokens.css` (the reduced block's comment),
`components/atlas/scene/useTurn.ts` (the stills branch).

**Proposal.** Rule 8 should read: "reduced motion lands a *transition* on its final state at frame
zero, and turns a *sequence* into stills on the same clock".

---

### What the camera contract got right, for the record

- **`useCameraRig` is the whole camera.** Drag, wheel-at-pointer, inertia, keyboard, `Home`, bounds
  and the fly — none of it is written in this app, and all three renderings share one pose, which is
  the only reason "three drawings of one machine" is a true sentence rather than an aspiration.
- **`flyToken` / `easeToken`.** The camera's move reads the app's own `--at-dur-move` out of the
  cascade, so rule 4 holds for the camera without the app passing it a number.
- **`useSemanticZoom`'s `driving` marker** worked first time: a wheel that crosses a band dispatches,
  a tool that opens a group flies, and neither echoes the other. That loop is the hard part of the
  contract and it is correct.
- **`subscribe` firing once immediately** is what lets a renderer be one `useEffect` with no
  initial-paint special case — in all three variants, unchanged.
- **`poseToTransform`** went unused (the css3d scene needs a `perspective` and a world scale that
  agree with the same pinhole the WebGL camera uses), but the pose it consumes is unchanged, which is
  the point: the kit owns four numbers, not the picture.

---

## Round 2 — the first build, on the kit alone (2026-09-14)

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

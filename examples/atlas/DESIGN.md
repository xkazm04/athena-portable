# Atlas — the blueprint

Round 4. Atlas is a **2D drawing**, on one ruled sheet, that you pan, zoom and re-arrange. The
owner's verdict on round 3 is the premise:

> *"The structure design does not make sense — designing app architecture as a 'building' is not the
> right direction; looking at it as a 2D diagram of components in a canvas with switchable views in
> blueprint structure would fit much better. For 3D we don't have any good practice or idea what to
> invent; we should not chase it."*

And, still standing from round 3: Atlas is a **visual multi-layer model of the solution**; text is
secondary. Everything below follows from those two sentences. There is no `three`, no CSS 3D, no
perspective, and no renderer switch: **one direction, built once.**

---

## 0. What is on the screen

This repository's architecture, drawn the way an architecture has been drawn since long before
anybody had a GPU:

| README §3.1 says | Atlas draws |
|---|---|
| six layers, surfaces on top, contracts at the bottom | six **regions** — ruled bands down the sheet |
| the systems that realise a layer | **blocks**: a titled rectangle with four port stubs |
| the modules inside a system | **parts**: cells inside the block, each a component |
| an edge between two modules | a **run**: an orthogonal polyline with an arrowhead |
| README §3.2, "how a turn flows" | a numbered **path** across the sheet, twelve stops, the gate marked |

**+Y is down.** A run that leaves a block's foot is a dependency; one that leaves its head reaches
back up toward the surfaces. Round 3 built that sign as a vertical axis in a volume; here it is the
axis a reader's eye actually travels, which is the same claim at a tenth of the cost.

**The geometry is two pure modules** — `canvas/geometry.ts` (sizes, packing, orthogonal routing) and
`canvas/plan.ts` (the four arrangements) — in world units, tested under `node --test`. Nothing in
them knows about React, the DOM or a pixel.

---

## 1. One canvas: DOM blocks, SVG runs, one transform

The sheet is **one element** (`.at-world`) carrying the camera's transform. Under it, siblings in
one coordinate system:

| Layer | Made of | Why |
|---|---|---|
| the ruled sheet | one `<div>`, two CSS gradients | a fine rule and a heavy one every fifth, in WORLD units, so the ruling zooms and pans like paper |
| the runs | one `<svg>`, one `<path>` per edge, `marker-end` | a polyline with an arrowhead is one element in SVG and five in the DOM, and the arrowhead follows the last segment for free |
| the regions and blocks | `<div>`s and `<button>`s | a block is TEXT AND CONTROLS — a title, a count, sixty-eight focusable parts, an accessibility tree, a roving tabindex. In SVG that is `foreignObject`, which lays out differently in every engine and loses focus rings in two of them |

**Both, inside one transformed element**, which is the part that matters: the SVG and the block layer
are siblings under the world, so they share a coordinate system exactly and no run can drift from
the port it is drawn to. Round 3's `css3d` variant had this bug in reverse — a screen-space SVG over
a transformed scene, with no registration and no depth — and it is the entire reason a third
"hybrid" prototype had to exist.

The world's `transform-origin` stays at its centre, because `zoomAt` solves for a pan about the
middle of the box; any other origin and the wheel stops closing in on the pointer.

---

## 2. The atmosphere

A **cyanotype**: blueprint blue, one pigment family, no warm/cool fluctuation, no light variant
owed. Distinct from the other three apps by construction — ledgerbox, hirelane and tidycrm have no
blue ground and no white line.

**Depth is rule weight, not shadow.** A plotted line does not round and does not blur; there is no
radius token, no blur token, and no elevation token that is not `none`.

| Role | Treatment |
|---|---|
| the sheet | `--at-plate` with two rules of ruling; it is the only ground |
| a region | a hairline rectangle and an opaque heading strip. A shelf region is dashed |
| a block | the only **solid** thing on the sheet — `--at-plate-2`, a `--at-line-2` rule, four port stubs |
| a part | a cell inside the block, one rule weight quieter |
| a run | `--at-line-3` at rest, `--at-line-2` when it runs down, `vector-effect: non-scaling-stroke` so a drawn line is a drawn line at every distance |
| the turn's current stop | `--at-cyan` — the one weight of the ink family that means "live" |

**One accent, `--at-mark`, and it means one thing: the lens.** Not a hover, not a selection, not a
count, not an error, and — new this round — not the turn either. Round 3 let the accent mean the
lens *and* the light; two meanings for one colour is one meaning too many, so the turn now takes a
cyan that is a weight of the ink rather than a second accent. Focus rings are the white line.

**Status is drawn, not coloured.** A `planned` block or part has a dashed rule and no fill. An atlas
that silently omits what was designed and not built is a sales brochure.

---

## 3. Four views: the same blocks, re-arranged

A view is an **arrangement** of the same nineteen blocks and a set of runs between them. That is
only true if a block is the same rectangle everywhere, so `plan.ts` sizes a block from the model
alone and every view builder may choose its x and y and nothing else.

| View | Arrangement | Runs mean |
|---|---|---|
| **Layers** (default) | six bands, surfaces at the top, contracts at the floor, five blocks per row | `depends on` |
| **Turn** | README §3.2's twelve stops in order, on-path blocks in first-visit order, everything the request never touches on a shelf below | `then` (numbered) |
| **Trust** | the six invariants of README §2 as regions | `enforces` (a tether to an invariant a block also serves) |
| **Packages** | the tree on disk, as nested rectangles. Runs hidden until asked for | `imports` |

**THE SIGNATURE MOTION** is the switch: nineteen `transform` transitions on one duration
(`--at-dur-view`, 560 ms), interruptible by the next switch at any point, landing on the final state
at frame zero under reduced motion. It is longer than `--at-dur-move` on purpose — a level change is
a move toward one thing and gets the rubric's 400 ms; a view switch is nineteen blocks each going
somewhere different, and a reader has to be able to *follow* the one they were looking at.

It is only a `transform` because every plan is centred on the world origin and the world element is
as big as the biggest arrangement needs. If the world changed size with the view, its middle would
move and every block would jump by half the difference on the frame the view changed — and width is
not a transform, so no transition could hide it.

**Trust's assignment rule is a share, not a count.** Ranking a system by how many components it has
carrying an invariant puts every large system in invariant 3 (nineteen of sixty-eight components
carry it) and leaves invariants 2 and 6 as empty regions — which draws "nothing enforces
provenance" when the truth is "two components do". A system is placed by the *share* of an
invariant's carriers it holds, which answers the question the view is asking: which promise is this
system most responsible for keeping?

`?view=` carries the choice, `localStorage` remembers it, `replaceState` keeps Back meaning what
Escape means. Four rounds of the formula have carried "URL sync, still nowhere"; this is it.

---

## 4. Three bands of detail, and they are not three screens

The level model is the kit's — L0 the population, L1 one group, L2 one item — and the group is
always a **layer**, in every view, because `open_group` has to mean one thing to an agent on every
surface in `examples/`.

```
zoom < 0.85   L0   the whole sheet: layers as regions, systems as blocks, system runs,
                   labels are SYSTEM NAMES
zoom ≥ 0.85   L1   the region under the camera is the open layer: its blocks show their
                   components as parts with ports, component runs inside the layer and stubs
                   where an edge leaves it, labels are COMPONENT NAMES
zoom ≥ 2.3    L2   the component under the camera opens its pane: what it enforces, the claims
                   it carries, who calls it, what it reaches, its ADRs. THE ONLY PROSE
```

A band change is a **class flip and a tokenized crossfade**, never a remount: the parts are in the
DOM at every band, laid out, at zero or low opacity, so a reader crossing a band watches detail
arrive on a drawing that holds still.

**At band 0 the parts are a texture and the part numbers are gone.** A block drawn as an empty
rectangle reads as a placeholder; the same block with its modules showing as unlabelled cells reads
as a component with five things inside it, which is true. And the part number (`S-12`) takes a third
of a title bar that is ~130 screen pixels wide at the whole-sheet zoom, which is how "The
composition root" became "The co…". Far away, a block says its name; closer, it says its number
too. That is semantic zoom applied to a label rather than to a shape.

**Type is screen-space, geometry is world-space** (formula rule 13). `.at-world` carries `--at-cs`,
the **quantised** inverse of the zoom, and every label scales by it — so a title is the same size in
pixels at every distance while the drawing it names is not. The quantisation is a cube root of two
(~26% steps): an un-quantised counter-scale re-lays-out every label on every wheel tick, which
round 3 measured at 1,400 elements a frame in ledgerbox.

---

## 5. The camera, and why a blueprint is what the rig was always for

**The kit's rig is orthographic** — `screen = centre + zoom · (world + pan)` — which was the wrong
arithmetic for round 3's perspective machine (the first of that round's kit gaps) and is exactly
right here. `pan` is the negative of the world point under the middle of the frame and `zoom` is
world units per pixel. That is the whole camera.

Drag pans. The wheel zooms **at the pointer**. Pinch, `+`/`-` and `Home` all work. `yaw` and `pitch`
are bounded to `[0, 0]` — the owner's verdict, expressed as two numbers the kit already understands.

**There is no snap list**, and that is round 3's gap 2 obeyed rather than rediscovered: a snap that
carries `zoom` un-zooms the reader the instant they stop turning the wheel, the band is never
crossed, and the symptom is "the wheel does nothing".

**`poseFor` and `resolveGroup`/`resolveItem` are exact inverses** (formula rule 14) — *by
construction*, not by tuning: `poseFor` centres the camera on a rectangle, `resolve*` answers the
rectangle containing the centre, and a rectangle contains its own centre. `test/plan.test.ts`
asserts the round trip for every layer and every component in all four views.

**Round 3 could not answer "which item is under the camera" and round 4 can.** In a container scene
every part of the block in frame was under the camera at the distance where the band was crossed, so
the third band was unreachable by wheel. On a sheet the items are laid out in the plane and the
question has an answer: the part the middle of the frame is over. The wheel now walks all three
levels, which is the contract's headline claim finally being true.

**Arrows move focus, not the camera — unless the canvas itself is focused.** A drawing with nineteen
blocks is a thing a keyboard reader traverses, so `←↑→↓` with a block focused move to the
neighbouring block (`useRoving`, five columns, walls at the edges). The camera's arrows are reached
the way a canvas is reached in any drawing tool: by focusing the canvas (Tab to it, or click empty
sheet). `+`/`-`/`Home` always belong to the camera, because no block wants them.

---

## 6. Where text is allowed

| Level | What text exists |
|---|---|
| **L0** | six region names and their source line; nineteen system names and their counts. Nothing else |
| **L1** | the above, plus the open layer's component names — short names, not sentences |
| **L2** | **prose**, and this is the only place it exists: what the module enforces, the claims it carries, who calls it, what it reaches, the ADRs that decided it, its path |
| hover / focus | the name of the thing under the pointer, one line, in the reading line |
| chrome | the mast (where you are, which view), the claims rail (what you can ask), the legend (what a line means), the step control (the turn, in twelve short sentences) |

**Every claim cites its source.** A hand-extracted model is an argument, and an argument that does
not show its source is decoration. Each stop of the turn carries the README section it was read
from; each component carries its file.

---

## 7. Motion

**One clock, in `components/atlas/style/base/tokens.css`, and no JavaScript in this app types a
millisecond.** `design/check-tokens.mjs` fails lint on a raw `px` or `ms` anywhere else — including
in a comment, which it has already caught once.

| Token | What it is for |
|---|---|
| `--at-dur-hair` 90ms | a rule changing weight under the pointer |
| `--at-dur-ink` 150ms | the second beat of a staged move; a band's detail arriving |
| `--at-dur-lens` 220ms | the accent spreading through the drawing |
| `--at-dur-move` 320ms | the level change, and the camera's flight to a focus |
| `--at-dur-view` 560ms | the view switch — the signature motion |

**Box, then ink** (rule 3). The pane grows from the part's measured position and fills after it has
landed; a band's parts fade in after the class has flipped.

**Reduced motion lands on the final state at frame zero.** Every duration goes to zero, the view
switch included — the blocks are simply in their new places.

**Round 3's exception is gone and that is a finding.** The turn was a light on a clock scored in
beats, so `--at-dur-beat` was deliberately *not* zeroed: a turn is content, not a transition. The
turn is now a path drawn all at once with a twelve-step control, which has no duration to exempt. A
sequence a reader steps through should not have been a transition in the first place.

**Transform, opacity and colour only.** A block's position is a `translate`; a band change is an
`opacity`; the lens is a `border-color`.

**What is no longer seen stops costing.** The camera's loop stops when the pose settles; the only
thing that ever moves is one `transform` on one element; there is no render loop of any kind. A
settled Atlas draws nothing.

---

## 8. The claims rail

Seventeen claims — six invariants, four rungs, four acts, three standing decisions. Choosing one is
not navigation and does not change level: it is a **light**. The concept names the components that
carry it, those name their systems, those name their layers (`lensFor`, one derivation, memoised),
and the whole set goes to `nav.highlight`, so the rail, the blocks, the parts and the `set_lens`
tool all read the same three sets.

The count on each row is the answer before you click. Invariant 3 lights nineteen modules; a claim
that lit one would be a claim this repository is not really making.

A rail and not a thing on the sheet, because the drawing is the subject and a claim is a question
asked *about* the drawing — beside it, secondary, never occluding it.

---

## 9. The rules this surface is a test of

`docs/layered-ui-formula.md` §1, and where each one lives here.

| Rule | Here |
|---|---|
| 1 / 10. the level you leave carries the camera | **Inverted, as rule 10 says it inverts.** One continuous space: the level you left is still on screen, further away. No echo is mounted and the app is not worse for it |
| 2. one claimant per shared id | No `layoutId` anywhere; see rule 11 |
| 3. box, then ink | §7 |
| 4. one clock | §7 |
| 5. an overlay owns its Escape | `useOverlayEscape` in the pane |
| 6. a move in flight is abortable | every flight is `rig.flyTo`; any input cancels it |
| 7. presence comes from the model | `presenceStyle(emphasis(…), { scale: false })` in `canvas/Block.tsx` — `scale: false` because a block's transform is its POSITION, which is data |
| 8. reduced motion lands on final state | §7 |
| 9. what is no longer seen stops costing | §7 |
| 11. one owner of a transform | the world owns the camera's, a block owns its position's, and the pane is **measured** out of a part rather than morphed through it |
| 12. a pose is where you stand and where you look | `zoom` is the level, `pan` the framing. No snap list. And `resolveGroup` branches on `zoom` — past the second band "which layer" means the layer of the block you are inside, not the region you are over |
| 13. type is screen-space, quantised | §4 |
| 14. `poseFor` and `resolveGroup` are exact inverses | §5, asserted for every layer and component in every view |
| 15. a place needs a floor size | `homeZoom` is clamped to `[0.2, 0.72]`: on a 2560 display the reader gets more sheet, not a bigger sheet |

---

## 10. Two things that were nearly invisible

Written down because both cost real time and neither looked like a bug.

**A class name is a namespace.** The L2 pane called its sections `.at-block` / `.at-block-head` —
names round 3 had to itself. On the blueprint those mean *a system block on the sheet* and carry
`position: absolute`, so on the first capture the whole pane's contents stacked on one line, with
the ADR citations where the title should be. Nothing threw. It was found by reading the screenshot.

**`overflow: hidden` plus body leading crops the tops of letters.** A screen-space label is laid out
at `100% / --at-cs` and scaled back; with `line-height: 1.55` the line box is half again as tall as
the strip it sits in, and the clip takes the ascenders. Every folder name in the packages view was
shaved, which reads as a font-rendering fault rather than as a tight label. One declaration:
`line-height: var(--at-leading-tight)` on the scaled box.

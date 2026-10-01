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

**Where this document stands after round 7.** Round 5 put three drawings behind one switcher and
the owner kept the **archify** grammar (§R5.2). Round 6 asked the narrower question that implied —
*which archify?* — put three archify-derived drawings on the same switcher, and the owner ruled:
**`archify-lanes` is the winner; delete the other two.** *"Lanes are a step forward."* Round 7
keeps that drawing and mounts it three times: classic, signal (wow), editorial (clarity) (§R7).
Every section below about a deleted drawing is kept and marked, because what each of them found is
still true and reverting the document would lose the reasoning. §R5.3 is round 5's verdict; §R6 is
round 6's; §R7 is the current comparison.

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

---

## W. Round 5, the wildcard: the structure matrix

> **Deleted after round 5** (owner's verdict, §R5.3). `variants/wildcard/` and its two tests are
> gone. This section is kept as the record of what the form proved — chiefly that headers pinned
> outside the world are legible at every band by construction, which is a relocation answer to
> rule 13 and survives the drawing it was found in.

**The idea, and the three sentences it is defended in.** This variant draws the model as a **design
structure matrix**: both axes are the same ordered list of all 68 modules, and a relationship is a
*mark at a position* rather than a line between two places. (1) A node-link drawing of 68 modules
and 120 edges is a drawing of edges nobody traces; a matrix puts every one of those edges in exactly
one place, with nothing crossing, nothing routed and nothing hidden behind anything, so **L0 is
complete rather than a summary**. (2) Ordering both axes by README §3.1's stack turns the
architecture's central claim — dependencies run down — into a geometric fact: everything right of
the diagonal is lawful, the fifteen blocks left of it are hatched and must stay empty, and the field
says the promise is currently kept in a way no arrangement of boxes can, because **a matrix gives
the absence of a relationship a position on the page**. (3) It is the one form whose three bands are
the same object at three grains — 6×6 layer blocks, 19×19 system blocks, 68×68 component cells — so
semantic zoom is *aggregation* rather than a change of drawing, and `poseFor`/`resolve*` are exact
inverses by construction because an item is a coordinate, not a thing inside a container.

**What each band shows.** L0: the 6×6 grain, each block filled by how much crosses between two
layers and printing the figure; the six layer blocks on the diagonal, sized by how much code is in
them; the empty hatched triangle. L1: one layer's row band and column band tinted straight across
the field, the 19×19 grain, both rails turned to system names. L2: one module's **crosshair** — its
row is everything it asks of, its column is everything that asks it — with the kind glyph
(`c i g s r`) inside every mark, the marks on the cross in full ink, and the shell's pane grown out
of the module's own diagonal cell.

**The signature interaction is the crosshair.** Point at a mark and *both* of its modules light —
the row of the one that asks and the column of the one asked — one hop and no further. Commit to
one (click, Enter on a rail entry, or the wheel) and the cross stays, and reading the architecture
becomes reading two orthogonal strips instead of following a line through a diagram.

**The headers are not in the world.** A row header inside a scaled world is unreadable at the far
band and absurd at the near one, and counter-scaling it only moves the problem into the gutter,
which scales too. So the two rails are pinned to the frame's edges and every entry is positioned
each frame by projecting its span through the camera (`projectY`/`projectX`, the kit's own
orthographic line written out and pinned in the test). Three things follow: every label is the same
size in pixels at every band with no `--cs` and no quantisation (rule 13, satisfied by relocation);
the rail changes *grain* with the band, so the header is itself a reading of the semantic zoom; and
a name is drawn only where its span has room for one, which is archify's shrink-then-reject turned
into a per-frame test. The world is therefore exactly the field — a square, centred on the origin,
with the diagonal through it — and one zero-sized element carries the camera.

**Rule 12, sharpened by the form.** On this field the split between "where you stand" and "where you
look" falls on an *axis*: the row is the subject and the column is the object, so `pan.y` says which
module the reader is reading and `pan.x` says only how far along its row they have got. `resolveGroup`
and `resolveItem` read `y` alone, which is both the honest answer and the one that makes the inverse
exact with no containment branch — round 4's sheet needed one because a layer's frame was a bounding
box of scattered blocks that could overlap; an axis cannot overlap itself.

**Rule 15, inverted.** A sheet can be *sparse* and the rule's answer is a floor size. A matrix has no
sparse region, because every position on it is defined whether or not it carries a mark; the failure
available to it is the opposite one — a field too **fine** to resolve, since 68 rows in a 690 px
stage is 10 px a row whatever the cell size. The answer is not a bigger drawing (the fit is bounded
by the frame's height either way) but the rails: at L0 they say six words, at L1 nineteen, at L2
sixty-eight.

**The honest weakness.** An item here is a row that spans the whole drawing, so "closer" and "see
all of it" pull in opposite directions: at L2 a module's own marks are often outside the frame and
have to be reached by panning along the row. The first capture at `L2_ZOOM = 2.6` put twelve columns
on screen and all four of `ledger.py`'s marks outside them; 2.0 puts seventeen columns and eleven
rows in frame, the legend prints both degrees so the reader knows what is off-screen, and the marks
on the cross are the darkest thing in the picture. It is mitigated, not solved.

**Files.** `components/atlas/variants/wildcard/` — `matrix.ts` (the axis, the geometry, the marks,
the two grains, the fifteen zones), `poses.ts` (bands, `poseFor`, `resolveGroup`, `resolveItem`, the
projection), `useMatrixCamera.ts` (the kit's rig and semantic zoom, and the measured frame),
`Field.tsx` (the world), `Rails.tsx` (the screen-space headers), `Legend.tsx` (the key and the one
number), `index.tsx`, `wildcard.css`. Tests: `test/wildcard.matrix.test.ts`,
`test/wildcard.poses.test.ts`. Captures: `examples/journey/shots/round5-atlas/wildcard-*.png`.

## R5. Round 5: three variants behind one switcher

Round 4 was one drawing. It scored well and that is exactly the problem the owner named after round
2: *"our adjustments are too careful and do not try any major design upgrades, leading us into
polishing versions we are stuck with."* A single direction cannot tell you whether it is the right
direction. So round 5 builds **three drawings over one model**, behind a segmented switcher in the
mast, and the reader compares them by pressing a key.

The line between them is `components/atlas/variants/contract.ts`, frozen before any of the three was
written. **The shell** (`variants/Shell.tsx`) owns the nav, the flight, the lens and the `lit` set,
reduced motion, the claims rail, the L2 pane — the one details destination for the whole app — and
the `?variant=` choice. **A variant** owns everything inside its stage: layout, camera, bands,
views, legend, story. A variant mounts by existing: `variants/<slug>/index.tsx` with a default
export taking `VariantProps`, imported lazily through a template specifier so a folder that is not
written yet costs a placeholder card rather than a build error. A variant's own second axis — its
views, if it has any — is published through `variants/viewBus.ts`, so the mast draws whatever is
mounted and `set_view` delegates to it rather than knowing about four arrangements.

### R5.1 Blueprint — round 4's sheet, evolved

> **Deleted after round 5** (owner's verdict, §R5.3). `variants/blueprint/`, `test/plan.test.ts`,
> `test/route.test.ts` and `style/canvas/canvas.css` are gone. Kept as the record: intent should
> advance the detail tier one step rather than replace the band, and a run may cross a rectangle
> but never a word. Its two tools, `read_turn` and `set_turn`, moved to the archify variant, which
> tells the same twelve-stop turn.

Same grammar: one ruled sheet, nineteen system blocks with ports, orthogonal runs, four
arrangements, three bands of detail, prose only at L2. Five things changed, each of them visible.

**The near band frames the whole layer.** Round 4 stood at a fixed zoom of 1.3 whatever it opened,
which on the six-system `surfaces` stratum showed about half a band — the round-4 carry-over, and
rule 15 in its second form. Regions now balance their rows (`balancedCols`: three across, not five
and one) and the L1 pose *fits* the open layer's frame, clamped into the band's interior so
`poseFor`/`resolveGroup` stay exact inverses. L0 legibility did not pay for it: the sheet got
narrower and taller in one move, so the whole-sheet zoom barely changed and a block is still about
145 px wide at L0. `test/plan.test.ts` asserts the framing in the layers view and asserts that a
layer scattered by another arrangement is either fitted or pinned at the band floor — never at some
third number nobody chose.

**Runs route around words.** `variants/blueprint/route.ts` replaces round 4's formula with a search:
nine candidate families (facing-straight, the two mid-corridors, two L-shapes, the four outside
channels, the two gap corridors), a hard feasibility filter, and a lexicographic cost vector —
*crossings → block intrusions → label clearance → shared corridor → length → bends → port
displacement → a stable ordinal*. The hard rule is the round: **a drawing may put a line across a
rectangle; it may not put a line across a word.** Region headings and block title bars are absolute;
block bodies are a cost. Every run label sits on an opaque mask and becomes an obstacle for the runs
routed after it. `test/route.test.ts` fails the build if a run ever crosses a heading or a title, in
any of the four views, at either tier. A region's heading is capped at 30% of its own top edge,
because an uncapped one made fourteen of the layers view's runs unroutable — a region whose top edge
is four fifths sentence is a region nothing can enter from above.

**The legend counts, and it filters.** Only the kinds present, each with its count, and pressing one
dims the rest to spatial reference rather than hiding it. It is not a second lens: the lens is the
claims rail and owns the one accent; the filter takes ink weight.

**The turn is a story.** Twelve stops with `past` / `active` / `next` beat states, everything off the
beat dimmed, and the Story Trail drawn as an *overlay* over the authored runs, which are never
restyled. The play is finite — one pass, no loop — and under reduced motion it lands on the final
beat at frame zero with every past state shown, which is rule 8 rather than an exception for content.

**Detail is a tier, and intent advances the band by one step.** `data-detail="context|fine"` on every
piece of type; a hover, a focus, the lens or the story sets `data-reveal` and pulls the next tier
forward. Not *all* tiers at any distance, which is how the study words it: at the whole-sheet band a
part cell is thirty screen pixels wide, and revealing module names there printed `wir…` `cli…` in
nine blocks at once. Detail a reader cannot read is not detail.

**One details destination.** A hover is a one-hop preview — it lights the block and what it touches,
writes one line in the reading line, and opens nothing. Pointer-fine only, and suppressed whenever
the filter or the story is doing something stronger. The L2 pane, the shell's, stays the only panel.

### R5.2 Archify — the archify grammar, transposed

The study (`docs/archify-study.md`) is of a tool that turns a typed JSON IR into a self-contained
interactive SVG map. What is worth taking from it is not its output but its **grammar**: a closed
seven-kind enum with one colour per meaning, a node with no title bar, boundaries derived from
membership, orthogonal labelled runs with one style per relationship, presets as pure CSS-variable
layers, and a viewer that reads only the DOM's semantic attributes. This variant transposes that
grammar onto six layers, nineteen systems, sixty-eight modules and a hundred and twenty edges, and
in doing so makes one claim the blueprint cannot.

**Rows are layers; columns are kinds.** Our model has no `type` field — it has a layer, which is
*where a thing sits*, and a layer is not a kind. So `variants/archify/kinds.ts` states the rule once
and applies it nineteen times: **a system's kind is the role it plays in one turn** (README §3.2) —
frontend a human looks at, messagebus carries a turn across a process boundary, backend runs it,
security decides whether something may run, database owns durable state, cloud reaches a service we
do not own, external is not behaviour at all. Five modules override their system's kind, each with
its reason on the line. Put those seven on the other axis of the grid and the drawing says
something: **the gate is one column, four rows tall**, and the rose `security-group` derived from
its four members crosses four amber layer regions. `core` spans backend to cloud; `contracts` is one
narrow external box that reaches nothing. The ragged right edge is the model's own shape. The second
view, `stack`, is archify's literal four-column `DEFAULT_GRID` with the kind axis taken away — the
control, one keystroke to the left, because an axis that carries meaning is only worth claiming if
the version without it is next to it.

**Layout is fixed cell math with a constraint pass; routing is generate-and-rank with a complete
fallback.** Columns are solved by a difference-constraint relaxation (node widths, label widths, and
a span constraint so the security-group's corner label fits its own frame). Runs are archify's
candidate families filtered by a hard feasibility predicate and ranked lexicographically —
*reverse travel → crossings → shared corridor → clearance deficit → bends → length → port
displacement → a stable family ordinal*. **The families are not complete and that is the round's
finding**: six rows deep, 27 of 52 system runs had no feasible family, so the last resort is a
Dijkstra over the drawing's free lanes with a bend penalty. `test/archify.routing.test.ts` then
asserts, with no exceptions and at every band, that no run crosses a node. The same test found that
spacing is a routing constraint before it is a rhythm: a gap narrower than twice the router's
clearance contains no lane, so three modules in the middle of `sys-studio` were unreachable.

**A node reserves the space its modules need, at every distance.** One plan, one geometry, three
bands — which is what makes `poseFor` and `resolve*` exact inverses by construction (rule 14, rule
16). An empty box that size would be a lie about how much is inside it, so band 0 draws the modules
as unlabelled **ghost cells** in their own kinds' colours; a reader counts a system's modules from
across the sheet, and the band change is the moment they gain names, not the moment they appear.
Opening a node takes away its fill and its mask: at band 1 a system is the space its modules are in,
and the runs between them are drawn through it.

**PATH / MAP / LENS live in the stage, not the mast.** A control that changes what *this* drawing
means belongs to the drawing. PATH is a BFS over authored edges with a four-line receipt and the
answer "no authored route" when the model has none — never inferred from geometry. LENS is the
counted legend, bridged: one kind reveals its relationships, two compare the ones that cross between
them, capped at 24, the rest dimmed as spatial reference. MAP is built at runtime from the same
boxes the sheet draws. The story is the twelve-stop turn as four chapters with a printed
enter/stay/leave delta, a Story Trail drawn *over* the authored runs, and one honest distinction the
round-4 turn could not make: **five of the eleven hops are authored module edges and six are not**,
so a hop README asserts and the edge list does not carry is drawn dotted and counted in the bar.

### R5.2a What was deliberately not taken from archify

The diagnostic protocol and `supportedFixes`, delivery receipts and hashes, revision-pinned sources
and brand marks, the export pipeline and the clean-clone step, the CLI, the diff view, and
author-coordinates-as-the-only-layout-path. Two more were dropped on purpose: **glow** (the Signal
Flow preset's radial gradients and scan sweep — this app's motion budget has one owner and a sweep
is a second one), and **a second details panel** (the Semantic Passport is exactly the shell's L2
pane, so there is one details destination for all three variants and archify's own §7.13 says so).
The `editorial` preset was costed and cut: paper, vermilion and a serif heading is a fourth palette
to keep contrast-correct, and two presets already prove the "CSS-variable reskin of identical
geometry" claim.

### R5.3 The verdict: archify survives, the other two are deleted

The owner ruled the day round 5 landed:

> *"Keep archify for the next rounds, delete the other two. The degradation from visual archify is
> significant in grouping, component strategy and style."*

That sentence compares **our archify variant to the archify tool itself**, not to its two siblings —
the siblings were simply not the direction. So the finding is not "archify won on points"; it is
that the archify grammar is the only one of the three worth being wrong about, and we are still
wrong about it in three named ways:

- **grouping** — the abstraction ceiling. Our sheet carries nineteen system nodes at L0 and
  archify's carries a handful; a drawing that shows everything at the far band has not abstracted,
  it has shrunk.
- **component strategy** — the node as a unit. Archify's node is a fixed card whose *text tiers*
  absorb the detail our ghost cells spend geometry on.
- **style** — the finish. Stroke weights, chips, arrowheads, grid rhythm, and fitting at 100%.

**What was deleted:** `components/atlas/variants/blueprint/**`, `components/atlas/variants/wildcard/**`,
`components/atlas/style/canvas/canvas.css` (the blueprint's stage, imported by nothing else),
`test/plan.test.ts`, `test/route.test.ts`, `test/wildcard.matrix.test.ts`, `test/wildcard.poses.test.ts`,
and the two round-5 capture scripts. `KIT-GAPS.md` is untouched: every gap those two builds found is
a fact about the kit, not about a drawing, and deleting the finding with the folder would be the one
unrecoverable mistake available here.

**What was kept, and why the shell did not shrink with them.** `variants/contract.ts`,
`variants/Shell.tsx`, `variants/useChoice.ts` and `variants/viewBus.ts` stay exactly as they were.
Round 6 builds **two more archify-derived variants**, so `VARIANTS` now lists the built one and two
announced slugs — `archify-density` ("coming: hard abstraction, cards") and `archify-lanes`
("coming: the turn as lanes and phases"). Asking for one of those (`?variant=archify-density`)
mounts the shell's honest placeholder, which names the file that would make it appear. That is the
same mechanism that let the shell ship before its siblings existed in round 5, exercised again
rather than rebuilt — and it is the reason deleting two thirds of the round cost one edit to one
list. `set_variant`'s enum is `VARIANTS`, so the tool surface followed by itself.

**The tool surface after the verdict.** Unchanged in shape: the four level verbs, `set_variant`,
`set_view`, `read_concepts`, `read_system`, `read_component`, `set_lens` from the shell, and
`read_turn` / `set_turn` from whichever variant tells the turn — now `variants/archify/Tools.tsx`
rather than the deleted blueprint's. Archify's answer says one thing the blueprint's could not:
which of the eleven hops an authored module edge actually carries, and which README asserts alone.

> **Superseded by §R6.** `variants/archify/Tools.tsx` was itself deleted at the end of round 6.
> `read_turn` / `set_turn` moved on again, to `variants/archify-lanes/Tools.tsx`, by the same rule:
> the drawing that tells the turn registers them. `set_variant` is gone from the surface entirely.

---

## R6. Round 6: which archify — and the answer

Round 5's verdict kept a grammar and named three things we were still wrong about: **grouping** (the
abstraction ceiling), **component strategy** (the node as a fixed unit), and **the finish**. Round 6
took a second reading of the archify tool aimed at exactly those three (`docs/archify-study.md`
Part 2), and its finding was that archify's limits are QUANTITIES, not techniques — no example
exceeds twelve nodes or fourteen edges, boundaries run one to four, nesting depth is one, a node is
a fixed 120×60 whose text shrinks to a floor and never truncates, and the home pose is scale 1 with
zoom-out disabled. Two more variants were built to those numbers and mounted beside the round-5
sheet through the same contract:

| Measured at L0, 1440×900 | `archify` (R5 sheet) | `archify-density` | `archify-lanes` |
|---|---|---|---|
| nodes / boundaries / runs | 19 / 7 / 52+ | 12 / 2 / 14 | 12 / 0 / 14 |
| home scale | 0.28 | 1.00 | 1.00 |
| labels under 9 px on screen | many | 0 | 0 |
| ellipses | yes | 0 | 0 |
| run stroke on screen | 0.42 px | 1.5 px | 1.5–1.8 px |

### R6.1 The verdict: lanes survived

The owner ruled:

> ***"Lanes are a step forward."***

**Why it is the one that survived, and the density variant is not.** Both met the quantities; only
one of them made the quantities MEAN something. Density reached twelve nodes by abstracting *harder*
— the same spatial map with fewer, larger cards — so it answered the ceiling and left the other two
findings where it found them: the reader still has to be told what the arrangement is about, and the
grouping is still a frame drawn around a set.

Lanes reached twelve nodes by changing what the sheet is a drawing OF. A workflow diagram has two
spatial axes that carry meaning — **lanes** (who owns the step) and **columns** (when it happens),
gathered into **phases** (which act it belongs to) — so reading order comes from position, and
archify's own answer to grouping turns out not to be a better boundary rectangle but a second axis
that makes boundary rectangles unnecessary. There are **no boundary frames anywhere in this drawing,
and no boundary type in its IR**: the thesis is enforced as a type, and `test/lanes.model.test.ts`
asserts it. The amber dashes round 5 was criticised for did not get better; they got deleted.

And the turn stopped being an overlay. In rounds 3, 4 and 5 the twelve stops of README §3.2 were a
light travelling over a static map — the drawing said where things are, and a scrubber said when.
Here **the drawing IS the turn**: the columns are its clock and the lanes are its owners, so eight
of the ten drawn hops are already on the sheet as authored edges (round 5's sheet carried five of
eleven). The two that are not are the round's sharpest finding rather than a gap: stop 7 → 8 reaches
into the CONTRACTS and stop 8 → 9 comes back out — a hop into a thing that has no behaviour to put
in a column, which `kinds.ts` already paints slate for exactly that reason. The Story Trail draws
those two dotted and the chapter receipt counts them.

### R6.2 What the app draws now

**One direction. The turn, in lanes, at three levels.** Four lanes, six columns, three phases,
twelve nodes, fourteen runs, on a 1180-unit world whose home pose is scale 1.

| Level | Is | Shows |
|---|---|---|
| **L0** | the whole lane grid | phase headers on top, twelve nodes with sigil / label / sublabel / tag, fourteen labelled runs, five roles |
| **L1** | one **phase** | its columns widened by `planFor`, the run labels a 52-unit column gap could not hold revealed, the other two phases receded through the kit's `presenceOf` |
| **L2** | one **node** | the shell's pane, grown out of the node's own screen rect — still the one details destination for the whole app |

Two arrangements remain, and they are the variant's own: **lanes** (the grid) and **turn** (the same
twelve nodes with the turn's path made the primary reading order). They are published through
`variants/viewBus.ts`, so the mast's second switcher and `set_view` both follow the drawing.

### R6.3 What was deleted, and what moved rather than dying with it

**Deleted:** `components/atlas/variants/archify/**`, `components/atlas/variants/archify-density/**`,
`test/archify.layout.test.ts`, `test/archify.model.test.ts`, `test/archify.routing.test.ts`,
`test/density.camera.test.ts`, `test/density.routing.test.ts`, `test/density.sheet.test.ts`.
`KIT-GAPS.md` is untouched, for the third round running: every gap those builds found is a fact
about the kit and not about a drawing, and deleting the finding with the folder would be the one
unrecoverable mistake available here. The round-6 capture scripts and their PNGs stay too.

**Moved, not deleted.** The lanes variant had been importing three pure modules from its sibling —
which the contract forbids, and which was only ever tolerable while both drawings were on the table.
With the sibling gone they moved INTO `variants/archify-lanes/`, each keeping its own header and
carrying one line saying where it came from:

| Now | Was | Why it is not the sheet's to take with it |
|---|---|---|
| `archify-lanes/kinds.ts` | `archify/kinds.ts` | the closed seven-kind enum and the rule that assigns it — *a system's kind is the ROLE it plays in one turn*. A fact about the model, not about a drawing. |
| `archify-lanes/script.ts` | `archify/story.ts` | the twelve stops read off README §3.2 and the four chapter cuts, as cited data. Renamed because this folder's own `story.ts` is the lane grid's trail; the script is what the trail reads. |
| `archify-lanes/primitives.ts` | the bottom of `archify/routing.ts` | the rhythm floors (`MIN_SEG`, `MIN_TURN`, `CLEAR`), `segRectDistance`, `segmentsOf`, `crosses`, `runPath` — the measurements every orthogonal run is validated against, at archify's own values. |

`primitives.ts` is the one partial copy, and it says so in its header. The rest of
`archify/routing.ts` was a generate-and-rank SOLVER — nine candidate families, a lexicographic cost
vector, a Dijkstra fallback over a lattice — written for a six-row sheet whose long dependencies
named no corridors. **A lane diagram names them all**: fourteen edges pin their own corridors in
`workflow.ts` and `archify-lanes/routing.ts` resolves the names. The solver had no caller here and
its only test was the deleted sheet's, so carrying it would have meant seven hundred lines of
untested dead code for a drawing that no longer exists. It went with the sheet.

The guards came across too. `test/archify.model.test.ts` was the only thing pinning the kind mapping
and the twelve-stop script; those assertions are now in `test/lanes.model.test.ts`, because a module
carried across a deletion and left untested is a module nobody is answerable for. Only the probe's
assertions were dropped — their subject, `archify/path.ts`, was the sheet's own PATH tool.

### R6.4 The shell keeps the mechanism; the mast and the tool surface do not pretend

`variants/contract.ts`, `Shell.tsx`, `useChoice.ts` and `viewBus.ts` are unchanged apart from
`VARIANTS`, which is now the single entry `{ slug: "archify-lanes", label: "Lanes" }`. **The lazy
template import, the error boundary, the "not built yet" placeholder, the retry and `?variant=` all
survive on purpose** — that is what round 7's drawing mounts through, and going three → one cost one
edit to one array, exactly as it did in round 5. That measurement is the argument for having had a
contract at all.

Two things did follow the count, because leaving them would have been a lie the surface tells:

- **The mast hides the variant switcher.** A radio group with one radio is a control that cannot be
  operated, and drawing it says there is a choice where there is none. It is conditional on
  `VARIANTS.length > 1`, which is the rule the view switcher already ran on — one rule, two axes,
  and no edit needed the day a second drawing lands.
- **`set_variant` left the tool surface.** This is the honest one of the two options, and it is
  round 4's `play_turn` rule applied again: *a tool whose subject no longer exists is worse than a
  missing one, because an agent will call it.* A one-value enum is not a capability — it is a
  sentence, and `read_view` already says that sentence, naming the variant before it names anything
  else in every projection (`tools/read.ts`). Keeping it would advertise a choice an agent cannot
  make and charge a call to discover that. The mechanism underneath is untouched, so the tool comes
  back with a real enum the day there is something to choose.

**The tool surface now:** `read_view`, `open_group`, `open_item`, `zoom_out` (the kit's level
verbs), `set_view`, `read_concepts`, `read_system`, `read_component`, `set_lens` from the shell, and
`read_turn` / `set_turn` from `variants/archify-lanes/Tools.tsx`. Ten tools, all AUTO. The lanes
answer says three things the sheet's could not: which LANE and which PHASE a stop happens in, which
of the twelve nodes it stands on, and whether an authored run **of this drawing** carries the hop
into it and in which role.

> **Superseded by §R7.** The mast draws the switcher again and `set_variant` is back: round 7
> mounts two more finishes of this drawing, so there is a choice. The engine did not move; the
> list grew.

---

## R7. Round 7: wow against the ability to present the solution

Round 6 left the right *drawing*. Round 7 asks the next question: **can that drawing carry a visual
wow without losing the ability to present the architecture as a solution you can read?** Two more
finishes of the same twelve nodes sit beside the baseline in the mast (`?variant=`), and a reader
compares them by pressing a key. There is still no `three`, no CSS 3D, no perspective, and no
second geometry — the contract's lazy import mounts `Drawing.tsx` three times with a `preset`.

| Finish | Slug | What it tests |
|---|---|---|
| **Lanes** (baseline) | `archify-lanes` | Round 6, unchanged. Classic dark, cards under the sheet, TURN behind a toggle. |
| **Signal** (wow) | `archify-signal` | Archify's Signal Flow preset on the lane geometry: deeper ground, a radial wash, glow on the main path, one finite scan that parks itself. The still frame has to carry the meaning (study §7.9); if a reader can still name the happy path and the one exception in under fifteen seconds, the wow did not cost the solution. |
| **Editorial** (clarity) | `archify-editorial` | Archify's Editorial preset — paper, vermilion, a serif heading, a ruled margin — plus two things classic hides: the four lane owners pinned in *screen space* over the gutter (the round-6 carry: L1 frames three of four lanes and the in-world labels leave), and the twelve stops of README §3.2 as a reading list under the sheet, clickable. The architecture is an argument; the drawing is the illustration. |

**What did not change.** Twelve nodes, fourteen runs, four lanes, six columns, three phases, the
two arrangements, `poseFor`/`resolve*` as inverses, shrink-to-fit text, one clock, one details
destination. `test/lanes.*.test.ts` still pins all of that. The new file is `test/presets.test.ts`:
three slugs, one default, copy that does not collide, twelve stops and four lanes in every finish.

**What the shell did.** `VARIANTS` grew from one to three, which is the one edit the contract was
built to take. The mast's switcher reappears because `VARIANTS.length > 1`. `set_variant` returns
with a three-value enum. Signal and Editorial import the engine through `components/atlas/lanes.ts`,
never from the sibling folder.

**The motion budget.** Signal's scan is a second motion owner (`data-motion-owner="scan"`), finite,
one-shot, parked under reduced motion and displaced the moment the story starts playing. There is
still only one owner at a time. Editorial adds no motion.

**The honest weakness of each.** Signal's glow is a filter on fourteen strokes; it is atmosphere,
and atmosphere can become texture the way round 5's amber dashes did. Editorial's first board
stole two columns from the sheet and cropped the drawing at 1440 — the opposite of clarity —
so the twelve stops now sit *under* the sheet (archify's own card slot) and the lane owners
overlay the gutter in screen space. The argument is still on the page; the illustration is
whole again.

# Atlas — the machine

Round 3. Atlas is a **scene**, not a set of pages. The owner's correction, verbatim in spirit:
*"the goal is not to compose a bunch of documentation into the website, but creating a visual
multi-layer model representing the app solution, and use text as a secondary informative
element."* Everything below follows from that one sentence.

---

## 0. What is on the screen

This repository's architecture, built as an object you can walk around:

| README §3.1 says | Atlas draws |
|---|---|
| six layers, surfaces on top, contracts at the bottom | six **planes** stacked in depth, forty scene units apart |
| the systems that realise a layer | **blocks** standing on that plane, with volume and edges |
| the modules inside a system | **parts**, small boxes on the block's lid |
| an edge between two modules | a **pipe** routed between two blocks |
| README §3.2, "how a turn flows" | a **light** that travels the pipes, stops twelve times, and waits at the gate |

Up the stack is `+Y`. An edge that runs up **reaches**; an edge that runs down **depends**. That
sign is why the machine is built vertically at all: *"packages depend on ports, never on concrete
classes"* is a direction, and a direction wants an axis. A pipe crossing two strata or more rides
a **riser** outside the plane's edge — the left riser for reaches, the right for depends — so
"everything on the right-hand riser is a dependency" is true by construction.

**The geometry is one pure module** (`components/atlas/scene/layout.ts`), in scene units, tested
under `node --test`. All three renderings draw that object. A renderer's only freedom is how a
scene unit becomes a pixel.

---

## 1. The atmosphere

A **cyanotype**: blueprint blue, one pigment family, no warm/cool fluctuation, no light variant
owed. The sheet's grid sits under the machine so the reader has a fixed reference the camera moves
relative to, and one radial vignette puts the machine in a room rather than on a page.

**Depth is rule weight, not shadow.** A plotted line does not round and does not blur; there is no
radius token, no blur token, and no elevation token that is not `none`. What is near is *drawn
more*, not lit more:

| Role | Treatment |
|---|---|
| a stratum plane | faint fill, a real edge. Six translucent sheets become one fog; the plane says where it is with its rule and almost nothing else |
| a block | the only **solid** thing in the machine — the lightest surface, and what the eye lands on |
| a part | a plate on the block's lid, one rule weight quieter |
| a pipe | a line, quiet at rest, bright when its stratum is open |
| the turn's light | the one moving thing, and the one emissive thing |

**One accent, `--at-mark`, and it means two things and no more:** the lens (a claim you chose) and
the turn (where the light is now). Not a hover, not a selection, not a count, not an error. Focus
rings are the white line, never the accent — a pane that takes focus programmatically must not look
permanently lit.

**Status is drawn, not coloured.** A `planned` block or part has a dashed rule and no fill. An
atlas that silently omits what was designed and not built is a sales brochure.

---

## 2. Where text is allowed

This is the design rule of the round, and the one the previous round got wrong.

| Level | What text exists |
|---|---|
| **L0** | six stratum names, their part numbers and counts, in the margin of each plane. The turn's one stop label, at the light. Nothing else. |
| **L1** | the above, plus the open stratum's block names — short names, not sentences |
| **L2** | **prose**, and this is the only place it exists: what the module enforces, the claims it carries, who calls it, what it reaches, the ADRs that decided it, and its path in this repository |
| hover / focus | a part's own name, one line, and only while it is under the pointer |
| chrome | the mast (where you are), the claims rail (what you can ask), the transport (the turn in twelve short sentences) |

Sixty-eight part names on screen at once is the density round 2 was told about. A part says its
name when you point at it and says everything else in the pane.

**Every claim cites its source.** A hand-extracted model is an argument, and an argument that does
not show its source is decoration. Each stop of the turn carries the README section it was read
from; each component carries its file.

---

## 3. The camera, and why distance is the level

The three depths are three **distances**, not three screens.

```
zoom < 1.55   L0   the whole machine, six planes in frame
zoom ≥ 1.55   L1   one stratum, its blocks open and their parts lifted
zoom ≥ 3.6    L2   one part, and the pane risen out of it
```

A reader who turns the wheel does not change page; they walk toward the machine, and the level
changes because they did. The kit's `useSemanticZoom` owns that loop: crossing a band **dispatches**
to the nav, and a nav change from anywhere else — a click, a tool, Escape, the level rail —
**flies** the camera. So a tool call and a reader's wheel produce the same move.

Drag orbits, shift-drag pans, the wheel zooms at the pointer, the arrows orbit, `+`/`-` zoom,
`Home` resets. Yaw is free; pitch is clamped short of the poles, where the view basis degenerates
and the stack collapses into a line.

**The idle snap is an orientation, never a distance.** Three good poses, and a snap keeps the
reader's zoom and pan exactly as they left them. A snap that carried `zoom` un-zooms the reader the
moment they stop turning the wheel — which, in a direction where distance is the level, means the
level silently never changes.

**The camera never opens an item.** At the distance where the L2 band is crossed, every part of the
block in frame is under the camera; picking one would be picking arbitrarily. The wheel stops at
L1; a part is opened by clicking it or by a tool.

---

## 4. Motion

**One clock, in `components/atlas/style/base/tokens.css`, and no JavaScript in this app types a
millisecond.** `design/check-tokens.mjs` fails lint on a raw `px` or `ms` anywhere else — including
in a comment, which it has already caught once.

| Token | What it is for |
|---|---|
| `--at-dur-hair` 90ms | a rule changing weight under the pointer |
| `--at-dur-ink` 150ms | the second beat of a staged move |
| `--at-dur-lens` 220ms | the accent spreading through the machine |
| `--at-dur-move` 320ms | the level change — and, in this direction, the camera's flight |
| `--at-dur-beat` 620ms | **one beat of the turn** |

The turn is scored in **beats** (`scene/beats.ts`), not seconds: twelve stops and eleven legs on
one monotonic parameter a slider can hold. Reasons, in order — the design law bans a raw `ms`
outside the token file and a turn script full of `1400` would be its largest violation; the reduced
branch is then one branch; and the owner can slow the whole turn down with one token.

**Box, then ink** (formula rule 3). A block that opens lifts its parts before their names arrive; a
pane grows from the part's projected position and fills after it has landed; a block's name waits a
whole `--at-dur-move` before it fades in.

**Reduced motion lands on the final state at frame zero.** Flights are instant, the camera has no
inertia, and the turn becomes **a sequence of stills**: the beat snaps to the middle of each stop's
dwell and steps one stop at a time. `--at-dur-beat` is deliberately *not* zeroed in the reduced
block — the turn is content, not a transition, and zeroing it would show the reader an empty machine
and call that accessibility.

**Transform, opacity and colour only**, in every renderer.

**What is no longer seen stops costing.** `frameloop="demand"`: the WebGL canvas renders only when
the pose or the beat changes. The camera's loop stops when the pose settles. The transport's stops
when it is paused. A settled Atlas on L0 draws nothing.

---

## 5. Three renderings, one machine

`/` mounts one of three at a time, behind a segmented control in the mast (`?render=`, remembered
in `localStorage`). They share the model, the layout, the turn, the lens, the pane, the tools, the
camera and the bands. **The only thing that differs is how a scene unit becomes a pixel.**

| | What it is | What it gives | What it costs |
|---|---|---|---|
| **css3d** | transformed DOM per stratum, five `<div>`s per block, one screen-space SVG for the pipes | selectable, searchable, screen-readable text everywhere; no GPU needed | the SVG overlay has no depth, so a pipe behind a block is drawn over it |
| **webgl** | three.js: slabs, boxes with volume, tubes swept along the routed polylines, the turn as an emissive core with a point light inside it | true occlusion, and the light actually illuminates the block it stands on | labels are canvas-texture sprites: bitmaps, not selectable, not in the accessibility tree |
| **hybrid** | the WebGL scene with `labels="dom"`, plus DOM labels placed by `project()` from the rig's pose | occlusion *and* real text | labels float in front with no depth of their own; a far label can overprint a near block |

Labels in the WebGL variant are **canvas-texture sprites**, not drei `Text` and not drei `Html`.
`Text` is troika, whose default font is fetched from a CDN at runtime, and this repository's law is
that there is no runtime font request; `Html` is what the hybrid variant *is*, and using it here
would make two of the three prototypes the same prototype. A sprite's texture is drawn with the 2D
canvas API in the app's own face, costs one texture per distinct label, always faces the reader,
and occludes correctly.

The switch is **temporary furniture**. Two of the three go after the review, and it goes with them.

---

## 6. The claims rail

Seventeen claims — six invariants, four rungs, four acts, three standing decisions. Choosing one is
not navigation and does not change level: it is a **light**. The concept names the components that
carry it, those name their systems, those name their strata (`lensFor`, one derivation, memoised),
and the whole set goes to `nav.highlight`, so every renderer asks the same question and a block
cannot be lit in one variant and dark in another.

The count on each row is the answer before you click. Invariant 3 lights nineteen modules; a claim
that lit one would be a claim this repository is not really making.

A rail and not a scene object, because the machine is the subject and a claim is a question asked
*about* the machine — beside it, secondary, never occluding it.

---

## 7. The rules this surface is a test of

`docs/layered-ui-formula.md` §1, and where each one lives here.

1. **The level you leave carries the camera** — literally: the camera *is* the level change.
2. **One claimant per shared id** — no `layoutId` survives. A shared-element morph out of a
   `matrix3d` face measures a rectangle that is not where the reader sees the part.
3. **Box, then ink** — §4 above.
4. **One clock** — §4 above, the turn included.
5. **An overlay owns its Escape** — `useOverlayEscape` in the pane.
6. **A move in flight is abortable** — every flight is `rig.flyTo`; any input cancels it.
7. **Presence comes from the model** — `weightsFor` maps the kit's `emphasis()`; nothing re-derives it.
8. **Reduced motion lands on the final state** — §4 above.
9. **What is no longer seen stops costing** — §4 above.

---

## 8. Two things that were nearly invisible

Written down because both cost real time and neither looked like a bug.

**`transform-origin: 50% 50%` adds half the element's own size in world coordinates.** A transform
is applied as `translate(O) · M · translate(-O)`, so with the default origin every face picked up a
leftover `+O` term: the floors sank a stratum below the blocks standing on them and the whole
machine sat right of centre. It looked like a camera aimed wrong. Every face in the css3d scene now
carries `transform-origin: 0 0`, and the chain means exactly what it reads as.

**A sign in the camera's right vector.** `poseFor` resolves a target's offset onto the camera's
right/up axes to compute the centring pan; the projection derives the same basis independently. One
sign disagreed, and the camera flew to the *mirror image* of the stratum that had been opened.
Nothing threw. `test/scene.test.ts` now asserts that `poseFor` puts its target within a pixel of the
frame's centre, for every stratum and every part in the model.

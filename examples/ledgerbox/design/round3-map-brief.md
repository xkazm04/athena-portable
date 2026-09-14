# Round 3 — the timeline map

Brief before code. What the surface becomes, what the camera does, what recedes, what is HUD.

The owner's note on round 2 was that the apps are not growing: the adjustments are careful and
conceptually small. So round 3 does not polish the three levels. It **removes the levels as
places** and keeps them only as depths of one continuous thing.

## 1. The claim

The six lanes stop being a page you leave. They become **one map**: lanes stacked vertically,
time running left to right from June to October, the now-line standing in the world where it
falls. There is exactly one scene element, it is never unmounted, and everything the reader
does — drag, wheel, pinch, arrow keys, Home, a click, an agent's `open_group` — is a **move of
the camera over that one scene**.

The three levels survive as the model (`@athena/demo-kit/zoom` still owns Escape, the focus, the
flight and the tools), but they are now **read off the camera's distance** rather than dispatched
as a change of page. `useSemanticZoom` is the wire: cross a band by wheel and it dispatches
`open_group`/`open_item`/`up`, so a wheel and a tool call end in the same reducer, which is the
one thing that has to stay true.

## 2. The four bands

A band is a *rendering* state of the world, switched by a `data-band` attribute on the scene
root. A band change is a class flip and a tokenised crossfade of ink. It is never a remount:
the same `<article>` for invoice `inv_0042` is on the page at every band, at the same world
coordinates, carrying more or less detail.

| Band | Zoom | Nav level | What the reader sees |
|---|---|---|---|
| **far** | 0.75 – 1.75 | L0 | The whole quarter. Every invoice is a bar at its due date, width is the balance, the tail is the lateness. Lane names and figures in the gutter, month ticks on the axis, the now-line. Attention-by-default holds: quiet invoices are semitransparent. The legend is still the filter. |
| **mid** | 1.75 – 3.2 | L0 | Still the whole population — this is a *rendering* band, not a level. The bars thicken, every lit invoice prints its amount, and each lane's own reading (its blurb, its late share) appears in the gutter. Nothing about navigation changed. |
| **near** | 3.2 – 7.5 | L1 | The lane under the camera is the open group. Its invoices stop being bars and are **the cards** — status glyph, client, amount, number, the waiting-on clause — laid along the same time axis, in the same cells the bars occupied. The five other lanes recede through `presenceOf` but stay in the world above and below, so the reader can see where they are and drag to a neighbour. |
| **closest** | 7.5 – 14 | L2 | The invoice under the camera is the open item. The round-2 card opens as a DOM pane over the world — box first, ink after — with its evidence, its aside and the one CTA into the decision dialog. The camera holds where it was; the world is still behind the pane and still the same world. |

Only two of those four thresholds are navigation. `[3.2, 7.5]` is what `useSemanticZoom` is given
as its `bands`; `1.75` is local, and the reason it is local is the point of the round — **more
detail is not another level.**

## 3. The camera

- **Drag** pans. **Wheel** zooms, anchored at the pointer, so wheeling over Reimbursable closes
  in on Reimbursable and not on the middle of the screen. **Pinch** is the same zoom with two
  fingers. **Arrow keys** pan, `+`/`-` zoom, **Home** resets to the far band.
- **A click still works and lands in the same place.** Clicking a lane's name or its track is
  `open_group`; clicking an invoice is `open_item`. Both go through the nav, and the nav's change
  makes the hook fly the camera to `poseFor(focus)` — the same pose the wheel would have reached.
  There is one set of poses and two ways to ask for them.
- **Escape flies out one band**, through the kit: the nav's own listener dispatches `up`, the
  hook sees the focus change and flies. From the card that is back to the lane; from the lane
  back to the whole quarter.
- **A move in flight is abortable** (rule 6): `flyTo` returns its cancel, and the next
  interaction — including a drag — takes the camera off the flight mid-move.
- **Reduced motion** lands on the final pose at frame zero and turns inertia off, through the
  rig's own `reducedMotion: "user"`.

## 4. What recedes

`presenceOf(focus, laneId)` decides, exactly as it did in round 2, and the world reads it rather
than re-deriving it: at L0 every lane is fully present; inside a lane the other five fall to
0.22; at L2 they fall further and the lane you are in holds. The mark's own channel —
`markPresence(mark, filter)`, the filter times "does this invoice want a decision" — multiplies
underneath it in the DOM, unchanged. Two channels, composed by nesting, neither knowing the
other exists.

Nothing is ever removed from the world. A receding lane is dimmer and still draggable to.

## 5. What is HUD

The head is **not** a page any more. At the near band the lane's name, its three figures and its
blurb are a fixed panel over the world, crossfaded in with the band. It does not move with the
camera and it is not re-mounted when the reader drags from one lane to the next — the text
changes, the box does not.

Beside it, bottom right, a small readout says which band the camera is in, what date is under
it, and how to drive: *drag to pan, wheel to zoom, Home resets.* A map that does not say it is a
map is a picture.

The masthead, the crumbs and the legend-as-filter stay where round 2 put them, above and below
the stage.

## 6. Legibility: the one decision

**Type is screen-space; geometry is world-space; detail is per band.**

The scene writes one custom property, `--ln-inv` = 1/zoom, on the same commit it writes the
transform. Every piece of text in the world sizes itself as `calc(<token> * var(--ln-inv))`, so a
lane name is the same number of pixels tall at every band. Everything that is *data* — a bar's
width, a card's box, the distance between two due dates — is in world units and grows with the
zoom, because that is what zooming is for.

The alternative considered and rejected was counter-scaling nothing and swapping label sets
alone. It fails at both ends: the labels that must persist across bands (the lane names, the
month ticks, the now-line) are either unreadable at far or absurd at near, and no set-swap fixes
a single label that has to exist in three bands at once.

The alternative also considered and rejected was counter-scaling *everything*, with no per-band
sets. That freezes the surface: if every glyph is the same size at every zoom, zooming in buys
the reader nothing but a bigger bar, and semantic zoom stops being semantic. So the two are used
for the two different jobs: **`--ln-inv` keeps every glyph at a human size, `data-band` decides
how many glyphs there are.**

Three-quarters of the ink on this surface is inside a card that does not exist until the near
band, so the crossfade is cheap: one attribute on the scene root, transitions on opacity and
nothing else.

## 7. What this costs, and what it buys

It costs the two-layer architecture. There is no outgoing level, so there is no echo, no
measured transform-origin, and no `layoutId` handed from a mark to a card — because the mark and
the card are the same element. `Swarm.tsx`, `swarm/Lane.tsx`, `Spread.tsx` and
`spread/Head.tsx` go, and so do the L0 and L1 stylesheets and the stage's two-layer rules.

It buys the thing the levels could never have: **the reader never loses the place.** There is no
frame in which the lane they came from is not on the screen. A level change is not a transition
any more, it is a distance.

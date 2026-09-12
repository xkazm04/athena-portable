# pass 3 — `dials` / The Limb

> **STATUS — HISTORY, kept for the record.** `dials` was a pass-3 sibling and was never routed;
> nothing in the shipping direction depends on this file. It is kept because `DESIGN.md` §0 surveys
> the dial corners this app has occupied and this is where that survey lives. The register of every
> direction the repo has held is `DESIGN.md` §11 and `design/SITE.md`.

Method: the **dials** of `google-labs-code/stitch-skills` › `stitch-utilities/taste-design`, as codified in
this app's own `DESIGN.md` §0 by the round-2 agent whose `/v/signal` and `/v/broadsheet` the owner kept.

The dials are the only mechanism in any reference evaluated across three rounds that *generates a
direction* rather than describing one. The procedure is literal: **survey which corners of the
Creativity / Density / Variance / Motion space are already occupied, then deliberately take an
unoccupied one, and let everything else follow from that setting.** This file does the survey first
and the design second, in that order, because that order is the method.

---

## 1. Survey — every occupied corner

Eight directions have existed in this app. Three were deleted (`daylight`, `lattice` in round 2; the
round-1 cuts before them). Five are live, and three more landed in this pass alongside me.

### 1.1 The dial table as it stands

`DESIGN.md` §0 owns the dial values for the first five. **None of `law`, `scale` or `token` adopted
the table** — `token` declares a lone "Motion depth 7/10" and the other two decline the machinery
entirely, substituting hirelane's `DESIGN-LAW.md` brief-inference fields. So three of the eight
squares below are estimates I derived from reading their code, and they are marked.

| Direction | Route | Live | Creativity | Density | Variance | Motion | Depth grammar |
|---|---|---|---|---|---|---|---|
| `wild` | `/` | yes | 6 | 4 | 5 | 4 | warm paper, flat |
| `signal` | `/v/signal` | yes | 6 | 8 | 6 | 3 | border weight (1/2/3px ladder) |
| `broadsheet` | `/v/broadsheet` | yes | 7 | 6 | 5 | 2 | hairline rules + inversion |
| `daylight` | — | **deleted** | 10 | 3 | 9 | 7 | layered light |
| `lattice` | — | **deleted** | 8 | 8 | 7 | 9 | glass over a lit field |
| `law` | `/v/law` | yes | *8* | *8* | *7* | *4* | rule weight + inversion + hatch; **shadowless** |
| `scale` | `/v/scale` | yes | *8* | *8* | *6* | *5* | hard offset planes + ambient |
| `token` | `/v/token` | yes | *8* | *8* | *7* | 7 | blurred elevation + gradient texture |
| **`dials`** | `/v/dials` | **new** | **9** | **6** | **8** | **10** | **concentric occlusion + rotation** |

*Italic = my estimate from their source, not their declaration.*

### 1.2 What is occupied, by axis

**Canvas.** Warm light paper (`wild`; `law` `#e7e2d6`), white paper (`broadsheet` `#ffffff`), cool
light plate (`scale` `#e6e9ee`), void black (`signal`), indigo-black (`token` `#12131f`). Two lights
and two darks, and both darks are **cool**. There is no warm dark anywhere in the app's history.

**Hue.** Every direction without exception is a near-monochrome ground carrying two to five hues,
each locked to exactly one meaning. Red-for-deviation is claimed three times (`#b3261e`, `#bd1425`,
`#c0392f`); green-for-healed three times (`#2e6b40`, `#1c7a58`, `#2f8f72`). Value ramps and
gradients-as-meaning are explicitly banned by all three pass-3 siblings.

**Typeface genre.** Grotesque or geometric sans display three times over (Archivo, Jost, Familjen
Grotesk); mono figures three times (Martian, Azeret, Spline Sans). Eighteen families are already
spent app-wide. Exactly one serif exists (Literata) and it is a supporting annotation face — **no
direction has ever used a serif as its primary display voice except `broadsheet`**, whose Playfair
is a fashion didone rather than an instrumental one.

**Depth.** Flat/hairline, border-weight, hatch, hard offset planes, blurred elevation + texture,
layered light, glass. **All seven are ways of drawing a line or stacking a plane.** Every direction
this app has ever had builds depth from *edges*.

**Layout metaphor.** Area-scaled treemap plate + ruled ledger (`law`), ranked horizontal registers
of unit marks (`scale`), warp/weft matrix with a cloth line (`token`), graph (`lattice`), single
column trail (`wild`), broadsheet columns. All six are **flat rectilinear plates**. Nothing has ever
used a circle, an arc, a ring, a radial layout, a polar plot or a curved path — and `law`, `scale`
and `token` each **ban the donut/ring by name**.

**Named lineage.** Drawing-office check print, ISOTYPE (Neurath/Arntz), Bauhaus weaving (Albers),
WIRED, VoltAgent. The first three are one continuous family — 20th-century European reductive
information design — and `token`'s own brief records that it had to **throw away an Otl Aicher /
Munich 1972 brief because it collided with a lineage already present**. That is a live, demonstrated
constraint, not a hypothetical one.

**Motion.** The three pass-3 siblings sit at 3–7. Each has exactly one signature, and all three
signatures are the same *kind* of thing: **a spatial sweep of ink or marks across a rectilinear
field** (`law-draw` the pencil drawing, `tc-count` the re-quantisation wave, `tk-shuttle` the weft
pass). All three explicitly **demote springs to press feedback**. Nothing in the app's history has
ever run above 9, and nothing has ever made physics the signature.

**Command centre.** `law` a typed command line with a grammar; `scale` a dispatch bar with printed
spoken forms under each control; `token` a slot-filling sentence of three closed enums. All three
solve the owner's stated defect in the *same register*: a **text instrument for issuing an order**.

### 1.3 The unoccupied corners

Ranked by how much room is actually free:

1. **Curvature.** Rings, arcs, radial layouts, polar geometry, rotation. Zero prior use, and banned
   by name three times over in this pass alone.
2. **Motion 9–10 with physics as the signature.** Vacated when `lattice` was deleted; never
   re-entered; explicitly declined by all three siblings.
3. **Depth from something other than an edge.** Every prior grammar is a line or a plane.
4. **A warm dark ground.** Both existing darks are blue-black.
5. **A serif as the primary instrumental voice**, not as annotation and not as fashion.
6. **A non-European, non-modernist lineage** — instrument-making, cartography, navigation.
7. Density 1–3 (sparse). Vacated with `daylight`, and the honest note is that I am **not** taking
   this one; see §2.

Corners 1, 2 and 3 are the same corner. **A circle is the only geometry with no end, which is why
it is the only one continuous motion can live on** — a sweep across a rectilinear plate has to stop
at the right-hand edge and restart, which is precisely why all three siblings' signatures are
one-shot animations rather than a state the surface can hold. Take Motion 10 seriously and the
geometry follows; take the geometry and the depth grammar follows, because concentric rings occlude
one another and that is a depth grammar made of no edges at all.

That is the dial method doing the thing it claims to do, and it is the reason this direction exists.

---

## 2. My dials

| Dial | Value | Why this number and not the neighbouring one |
|---|---|---|
| **Creativity** | **9** | The live set clusters at 6–8. 9 buys the untaken lineage and the banned geometry. It is not 10 because 10 is what licensed `daylight` to render one decision per screen, which the owner cut. |
| **Density** | **6** | The three siblings are all at ~8 and all three are cockpit-dense. 6 is the deliberate choice: 46 blocks, four agents, a ledger and a dossier must be on one page, so this cannot be sparse — but at 6 **the centre of the instrument stays empty, and the empty centre is the command centre**. The owner's stated defect is that there is no main section to start and control from. Density is the dial that buys that room. |
| **Variance** | **8** | A polar plate, a linear limb and a centred command core cannot share a grid, so §6's "no two adjacent sections share a column structure" is satisfied by construction rather than by effort. |
| **Motion** | **10** | The highest ever set in this app. Motion is one of three things the owner keeps saying is missing, and the spring spec is the **one genuinely concrete asset** this method bundles. Setting anything lower would be declining to test the method's best claim. |

### 2.1 What the dial settings then *force*, mechanically

These are rules from `DESIGN.md` that fire on my numbers. I did not choose them; the dials chose them.

- **§3 density override — "at Density > 7 all numbers are monospace."** I am at 6, so this rule does
  **not** bind, and it is the single most consequential thing the dials did to this design. All three
  siblings are at ~8 and all three therefore set every figure in mono. I am released to set the
  coverage figure in the **display face at display size**, which is both a visual separation from the
  siblings and a direct answer to the owner's twice-repeated complaint about default-small type. A
  rule that did nothing to me changed the design by not applying.
- **§5 — "centred entry layouts are banned at Variance > 4."** I am at 8. The instrument therefore
  sits off-axis against the limb rather than centred on the page, which is also what makes the
  ledger legible beside it.
- **§4 — "at Density > 7, cards are replaced by dividers, negative space or glass planes."** At 6 I
  am permitted cards. I decline them anyway; see §4 below. That is my judgement, not the method's.
- **§8 — spring `stiffness: 100, damping: 20`, stagger ≈ `100ms × index`, `transform` and `opacity`
  only, no linear easing anywhere.** At Motion 10 this stops being a garnish and becomes the
  substrate.

---

## 3. The direction the dials generated

### `dials` / The Limb

**Named source direction:** the **astrolabe and the armillary** — the pre-modern astronomical and
navigational instrument. Nested rings at different radii, each ring answering a different question,
read by turning them against one another; a fixed engraved *limb* around the outside carrying the
scale, a *rete* that rotates over a *plate*, and a centre where the whole thing is held and set.

Chosen against the collision rule that `token` had to obey when it threw away Otl Aicher. This is
not graphic design at all: it is instrument-making, it is substantially Islamic and medieval rather
than European-modernist, and it is the only lineage available that is **natively polar, natively
about alignment rather than proportion, and natively a control device** — you do not read an
astrolabe, you *set* it. That last property is the owner's stated defect stated as a lineage.

**Atmosphere.** Warm dark — oxidised bronze near-black, not blue-black and not paper. Marks are
engraved light: a warm bone-to-brass value ramp. Depth comes from **concentric occlusion and
rotation**, never from a shadow, a border or a glow. No metal textures, no bevels, no
skeuomorphism — the instrument's *logic* and its *value palette*, not a picture of brass.

**Colour discipline.** Shades of one warm neutral carry the entire surface. Exactly two hues exist,
and only on key data nodes: **verdigris** for healed/analysed, **oxide** for deviation. This is the
owner's own instruction for the Standing ledger — "black and white shades, using minimally green and
red to point out key data nodes" — honoured through light on a dark ground rather than through
graphite on paper, so it does not collide with `law`, which took the pencil-on-paper reading of the
same sentence.

### 3.1 How the instrument carries the owner's spec

The metaphor is load-bearing or it is decoration. Each of the owner's seven asks maps to one part:

| Owner's ask | The instrument |
|---|---|
| visualise data blocks | **the plate**: 46 blocks as radial ticks at 46 equal angular steps; radial **length** = record count |
| % of not-yet-analysed data | each tick is split — analysed inward and bright, **unanalysed outward and dark**, so the not-yet-analysed share reads as a **ragged dark outer band around the whole ring, as a shape, before any number** |
| errors on deviations | a deviation is a **red spike past the rim**. The circle is otherwise unbroken, so *the only things that leave the instrument are defects* |
| investigate by click **or voice** | the limb opens on a block; every block has a speakable ident and every control a speakable name |
| Athena **dispatches agents**, plural | four agents are four **pointers sweeping the plate at different rates**, each raising a block's bright segment as it passes. Fan-out is not a progress bar; it is four things moving at once over the same ring |
| which blocks need attention | the ledger on the limb ranks by deviation weight, synchronised to the plate |
| **and why** | the dossier decomposes the named causes with their counts, and every pair carries its evidence rules and weights — never a bare percentage |
| a main section to start and control from | **the empty centre**, bought by Density 6 |

**Angle encodes identity and position; it never encodes proportion.** That is the honest reading of
the donut ban the three siblings imposed: what is wrong with a donut is that a human cannot compare
angles. Equal angular steps with length as the quantity channel is a polar bar chart, and it is
sound. I am taking the geometry the ban protects and leaving the error the ban was written about.

**Degradation.** Below a narrow container the ring **unrolls into a linear strip** carrying the
identical encoding — length = records, bright/dark split = analysed share, red spike = deviation.
Same data, same channels, no shrinking to illegibility.

---

## 4. The ban list, judged

`taste-design` ships ~25 bans. `DESIGN.md` §9 already carries them plus this app's own. The method
says apply them; this repo has already demonstrated once that they need judging, when the owner kept
serif-led `/v/broadsheet` and falsified the blanket "serif banned in dashboards".

**Adopted without argument:** no emojis; no Inter; no default serif stacks; no `#000000`; no neon
glows or oversaturated accents; no gradient text; no custom cursors; no overlapping content; no
three-equal-card feature rows; no centred hero above Variance 4; no filler chrome; no AI copy
clichés; no `LABEL // YEAR`; no circular spinners; no `h-screen`; no fabricated data or metrics; no
fake "by the numbers" grids; no claim that Athena did anything; no bare confidence without its
evidence; no governance colour spent on decoration; no inlined mock arrays.

**Broken, deliberately, with the reason:**

- **"No rings, no donuts, no radial."** Not in `taste-design` itself — this is the three siblings'
  addition, arrived at independently. Broken as argued in §3.1: the ban is really against
  angle-as-proportion, and I encode angle as position. Reported as a disagreement because that is
  what the brief asks for when a reference and an accumulated constraint collide.
- **"Perpetual micro-loops on every active component"** (`taste-design` §8, as amended by
  `DESIGN.md` §8 to "only on the async lane while a real job is running"). I keep the app's
  amendment, not the skill's original. At Motion 10 the temptation is a permanently rotating
  instrument, and a surface that turns forever reads as "Athena is working" — which would be a lie,
  because she is not connected. **The instrument is still when nothing is running.** Motion 10 buys
  amplitude when something happens, not perpetual animation. This is the sharpest place where the
  method's own advice had to be overruled by repo law.
- **§4 "cards where elevation communicates hierarchy."** Permitted at Density 6; declined anyway.
  Cards are edges, and this direction's whole claim is depth without edges.

**Kept but noted as weak:** "no gradients". A radial value falloff is how light behaves and how the
unanalysed band reads. I use value falloff on the plate and no gradient anywhere else, and I accept
that a strict reading of the ban would forbid it.

---

## 5. Motion spec — the concrete part

The one thing this method bundles that is a real specification rather than exhortation. Implemented
as tokens, prefixed to avoid Tailwind v4's ownership of `--ease-*`, `--text-*`, `--radius-*`,
`--shadow-*`, `--leading-*` and `--tracking-*` on `:root`.

- **Spring, `stiffness: 100, damping: 20`** — the default feel for every interactive state change:
  agent pointers settling on a block, the limb opening, the gate arming, the ring unrolling.
- **Stagger `calc(var(--dl-index) * 100ms)`**, capped so 46 blocks do not take 4.6s to arrive —
  capped at index 18, then held.
- **`transform` and `opacity` only.** No `top`/`left`/`width`/`height`. Radial length changes are
  `scale` on a rotated group or `pathLength`, never a geometry rewrite per frame.
- **No linear easing anywhere.**
- **No perpetual loop except on a lane with a real job running** (repo amendment, above).
- Everything degrades through `useReducedMotion` / `MotionConfig reducedMotion="user"`, landing on
  final states rather than on nothing.

---

## 6. Hard constraints inherited from earlier waves

Recorded here so the build cannot forget them.

- **`vw` lies.** The CopilotKit sidebar shrinks `body` to ~800px inside a 1280 viewport and ~288px
  inside 768. Size everything on `cqi` with `@container`. Zero `@media (width…)`.
- **`container-type` makes an element a containing block for `position: fixed` descendants.** Declare
  containers on inner regions, never on the variant wrapper. A fixed scrim escapes its pane unless
  handled; a sticky overlay is the working pattern.
- **Type floor: nothing under 13px, no control under 15px.** Base body 17px, matching the siblings.
- **Tailwind v4 owns `--ease-*`, `--text-*`, `--radius-*`, `--shadow-*`, `--leading-*`,
  `--tracking-*` on `:root`.** Every token here is `--dl-*`.
- **The demo-kit `ActivityLog` renders at 11–12px** and cannot legally be fixed from a variant.
- One page. No route-level navigation. `app/v/page.tsx`, `app/layout.tsx` and `app/globals.css` are
  the parent session's and are not touched.

---

## 7. Typefaces

Eighteen families are already spent. None of these three is used by any live direction.

| Role | Family | Why |
|---|---|---|
| Display | **Fraunces** (variable `opsz`, `SOFT`, `WONK`) | The serif-as-primary-instrument corner, which is free. Its optical-size axis is a real instrument idea, not a garnish: the axis tracks size so the big coverage figure and the small limb markings are genuinely different cuts of one face. Named in `taste-design` as a permitted serif; chosen once before by the deleted `daylight`, so nothing live collides. |
| Body / UI | **Figtree** | Unused; quiet; stays out of the display face's way. |
| Figures | **Geist Mono** (tabular) | Unused. Figures are mono only where alignment does work — the ledger and the evidence weights. The headline coverage figure is **not** mono, per §2.1. |

---

*Written before any component. `SITE.md` §6 listed two unoccupied dial corners; this direction takes
neither of them, because the survey found a third the file had not noticed — the one where Motion,
curvature and edgeless depth turn out to be a single corner.*

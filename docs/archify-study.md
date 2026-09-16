# Archify — a design study for the atlas

Source: https://github.com/tt-a1i/archify (MIT), studied 2026-09-16 for the layered-UI program
(docs/layered-ui-formula.md, round 5). Archify turns a typed JSON IR of a system into a
self-contained interactive HTML/SVG map with five diagram types and four presets. We copy no
code; this records the practices for ABSTRACTING and VISUALIZING architecture that the round-5
atlas variants draw on. File paths refer to the archify repository as cloned.

## 1. The abstraction model

Five separate schemas (`archify/schemas/{architecture,workflow,sequence,dataflow,lifecycle}
.schema.json`) share one vocabulary in `common.schema.json`, with `additionalProperties: false`
everywhere. Shared definitions: `componentType`, a closed seven-set
`frontend|backend|database|cloud|security|messagebus|external`; `variant`
`default|emphasis|security|dashed`; `visualPreset` `classic|signal-flow|blueprint|editorial`;
`guidedViews` (stories, max five, each `{id, label, focus: [nodeId], note ≤ 140 chars}`); `cards`
as the side-panel escape hatch for detail that would otherwise become edges.

Per type, nothing is a generic "node": architecture has `components[]` (`id,type,label`
required; `sublabel,tag,brand,sources,row/col,pos,size` optional), `boundaries[]` with
`kind: region|security-group` and `wraps: [id]` — **groups derived from membership, never from
authored rectangles** — and `connections[]`. Workflow has `nodes[]` on `lane × col`, `lanes[]`
(`normal|exception`), `groups[]`, `phases[]`, and `edges[]` with `role:
main|branch|async|return|error`. Dataflow has `stages[]` (2–5 columns) and `flows[]` with a
`classification`. Lifecycle has its own eight-value state enum. **There is no recursive
containment in the IR**; level of detail is a viewer concern (§4). Abstraction is editorial:
"one obvious main path; side branches leave the nearest main-path node; remove low-value edges
before adding routing controls; put supporting detail in cards instead of more edges."

Validation is two-layer: AJV schema errors rewritten for a machine reader (`annotatedPath`,
`supportedFixes`), then **geometric legibility** in `renderers/shared/geometry.mjs`: crossing
problems, ambiguous shared corridors, border runs, route rhythm (no segment under 8 px, no
interior turn under 16 px), label/route clearance, endpoint-side contracts (first and last
segment leave and enter perpendicular to the declared side), plus suggested pixel fixes.
`text-fit.mjs` shrinks node text to a floor and rejects what shrinking cannot save.

## 2. Visual grammar

All four presets are **CSS-variable reskins of identical geometry**, keyed by
`[data-preset][data-theme]` on the root (`viewer/template.source.html` ~150–520); the exported
SVG carries the same two attributes and restyles itself.

Invariant grammar: semantic classes `.c-frontend … .c-external` (fill and stroke pairs), text
tiers `.t-primary/.t-muted/.t-dim`, arrow classes `.a-default/.a-emphasis/.a-security (dash
5,5)/.a-dashed (dash 4,4)` with matching markers, boundary classes `.c-region` (amber, dash 8,4),
`.c-security-group` (rose, dash 4,4), `.c-lane` (dash 6,6), a 40×40 background grid pattern.

Node anatomy (`render-architecture.mjs: renderComponent`): **no title bar**. An opaque mask rect
so runs never show through, a kind-coloured rect with `rx=6`, an 11 px stroked **semantic
sigil** top-left (screen, chevrons, cylinder, cloud, shield, bus, external box), optional brand
mark top-right on a neutral plate, centred label 11 px/600 shrink-to-fit, `sublabel` 9 px muted,
`tag` 7 px in the kind accent. The three text tiers carry `data-detail="context"` /
`data-detail="fine"` — the semantic-zoom hooks.

Presets: **Classic** `#020617` canvas, `#0f172a` panels, 1 rem radius, cyan/emerald/violet/
amber/rose/orange/slate. **Signal Flow** deeper ground, brighter strokes, radial gradients, a
one-shot scan sweep, glow. **Blueprint** `#06131f` with a 32 px drafting grid on the body,
squared radii, drafting corner ticks, chain-dash regions `12 4 2 4`, all glow removed, square
line caps, a flat drop-shadow for focus. **Editorial** paper `#f2eee5`, vermilion emphasis, a
ruled margin, serif for headings only. One typeface everywhere: JetBrains Mono, inlined;
scale: headline 1.5 rem/700, title .875/600, body .75/400/1.55, label .625/700/0.12 em caps.

Legend (`renderers/shared/legend.mjs`): `auto` shows only kinds present, with counts; one pure
footprint measurement is shared by view-box sizing and placement so geometry and validation
cannot disagree; it wraps deterministically and dodges routes and labels.

## 3. Layout and routing

Architecture: **no auto-layout**, fixed cell math (`grid.mjs`, `DEFAULT_GRID = {origin:[40,80],
cols:4, gapX:30, gapY:40, cellW:130, cellH:64}`) or authored `pos`. Boundaries are the bounding
box of their members padded 30 top/left/right and 50 bottom, with an opaque mask under the label.

Workflow is the real solver (`workflow-compiler.mjs`): spacing is a **1-D difference-constraint
system** over column ranks (baseline pitch 120, minimums from node widths and label widths),
iterated up to three rounds with **routing failures fed back into spacing**. Routing is
orthogonal only, generate-and-rank over nine candidate families (`facing-straight`,
`horizontal-then-vertical`, `vertical-then-horizontal`, `lane-gap-corridor`,
`column-gap-corridor`, `outside-left/right`, `top/bottom-corridor`), filtered by a hard
feasibility predicate (orthogonal, honours endpoint sides, rhythm floors, clears unrelated nodes,
labels, the legend, scene labels, frame borders), then ranked by a **lexicographic cost vector**:
forward/reverse px → proper crossings → shared corridor px → label clearance deficit → interior
28 px deficit → bend count → stretch → canvas growth → port displacement → a stable ordinal
tiebreak that makes output byte-deterministic. Shared ports on one side are fanned apart
(`automaticPortSpread`, spacing `min(14, (extent−32)/(n−1))`); near-parallel doglegs are swapped
for a full outside channel; corners are quadratic fillets. Every edge label has a mask rect and
becomes an obstacle for later routes; the repair order is move label → adjust route → shorten
wording, never delete a label.

## 4. Interaction

Viewer modules read **only the DOM's semantic attributes** (`data-node-id`, `data-node-kind`,
`data-edge-from/-to`), never a parallel graph, which makes every feature composable and export
safe.

- **Camera** (`viewer-camera.js`, ~500 lines, no library): `{scale,x,y}` as one CSS transform on
  the SVG, ±0.25 steps from 1 to 3, clamp keeps content on screen, an interrupted animated move
  commits where it actually is by sampling the live matrix.
- **Semantic zoom bands**: `scale ≥ 1.75 → full`, `≥ 1 → read`, else `map`, written as
  `data-detail-level` on the container; CSS hides `[data-detail="context"]` and `"fine"` per
  band with a 160 ms nudge. **Intent overrides the band**: focus, reach, lens, route, story and
  hover re-reveal detail at any scale.
- **Search** indexes id, label, sublabel, tag, sources; selecting resets the viewport and focuses.
- **Hover** is a one-hop preview, pointer-fine only, suppressed while any stronger mode is active.
  Committed focus opens one **Semantic Passport** (kind, id, relationships, deep link, Escape) —
  the single details destination; the design rule is "don't create another permanent panel".
- **Upstream/downstream** is a BFS over authored relationships; the receipt states nodes, links
  and max hops; upstream violet, downstream green; never called "blast radius".
- **Route probe**: shortest directed path over authored edges, ties stable by DOM order; never
  inferred from geometry.
- **Guided story** (`guided-views.js`): chapters from `meta.views`; a Story Trail overlay is drawn
  on top of the authored edge, which keeps its own style; beats carry
  `data-story-beat-state=past|active|next` at opacity 0.72/1/0.5; interval 3200 ms, follow dwell
  1100 ms, follow move 320 ms; chapter handoff computes enter/stay/leave and anchors on a shared
  node; a static preview shows the coming delta.
- **Lens**: a counted legend over kinds; one kind reveals its relationships, two kinds compare
  direct cross-kind relationships, capped at 24 edges, the rest dimmed as spatial reference; the
  static legend is bridged to it so the legend is a filter.
- **Minimap** built at runtime so the canonical SVG stays single.
- **Keyboard**: every node `tabindex=0 role=button`, Enter/Space, roving arrows over relationship
  lists and edge targets, Escape unpins, a guide panel lists shortcuts.
- **Finite motion** (`motion-governor.js`): one reader switch and one motion budget. Ambient trace
  runs once; only the strongest semantic action owns motion (`data-motion-owner`); still/embed/
  hidden/reduced-motion park everything with `animation: none` so **the static frame carries the
  full meaning**. UI state 140–200 ms; overlays 140–180 ms `cubic-bezier(.22,1,.36,1)`; pulses
  0.78–1.35 s; ambient edge trace 2.4 s with a 160 ms per-step delay.

## 5. Diff view

`delta/architecture-delta.mjs` compares two validated snapshots, not images. Canonical
key-sorted JSON; identity by explicit ids (connections must carry ids; boundaries by kind and
label; no shared component id → refuse). Changes are classified by **field group** —
semantic / evidence / geometry for components, topology / semantic / geometry for connections,
scope / geometry for boundaries — into `added | removed | changed | evidence-changed | moved |
rerouted | geometry-changed`, with presentation and provenance reported separately so a restyle
never reads as a topology change. The Delta view is the After SVG with Before "phantoms" spliced
in at the right z-order, ids namespaced; encoding is **colour + dash + glyph** (`+ − ~ ↔ E`),
never colour alone; unchanged drops to opacity .38. A receipt sidecar states proof level,
hashes and an explicit `limitations[]`.

## 6. Export

One self-contained HTML (~810 KB): inlined fonts, CSS, viewer JS, one canonical inline SVG, JSON
islands for stories and evidence. PNG at 4× by scaling the SVG's own size; a dual-theme
standalone SVG with a `prefers-color-scheme` rule; WebM; 1200×630 share cards. A clean-clone
step strips every transform, clip, focus, lens, route and story attribute before export.

## 7. What to adopt in a hand-built React explorer

1. A closed semantic kind enum, one colour per meaning, no decorative accents.
2. Presets as pure CSS-variable layers over identical geometry, keyed on the root.
3. Semantic zoom via `data-detail="context|fine"` on text tiers, with intent overriding the band.
4. Groups derived from membership, never authored rectangles.
5. Orthogonal routing as candidate families, a hard feasibility filter, a lexicographic cost
   vector and a stable tiebreak.
6. Spacing as constraints, fed back from routing failures.
7. An opaque mask under every node and edge label; labels are obstacles for later routes.
8. Shrink-to-fit text with a legibility floor; reject rather than overflow.
9. One motion owner and strictly finite animation; the static frame carries full meaning.
10. Interactions read stable DOM attributes, not a parallel model.
11. Overlays for derived paths; the authored edge is never mutated.
12. Diff by field-group classification on stable ids, encoded with colour, dash and glyph.
13. One details destination, never a new panel per feature.
14. A clean-clone step before export.

Specific to archify's agent workflow, skip: the diagnostic and `supportedFixes` protocol,
author-coordinates-then-validate as the only layout path, delivery receipts and hashes,
revision-pinned sources and brand capture, the CLI, update checks, i18n.

## 8. Reference artifacts (in the clone, for the builders while it exists)

- `archify/examples/production-deployment.architecture.json` — the richest IR: blueprint preset,
  three guided views, nested region and security-group boundaries, all four connection variants.
- `examples/checkout-platform-delta.html` with its receipt and the two inputs
  `archify/examples/checkout-platform.{base,head}.architecture.json` — the full before/delta/after.
- `docs/gallery/artifacts/agent-tool-call.workflow.html` — workflow v2: constraint layout,
  corridor routing, lanes, groups, phases, story playback.
- `examples/rag-pipeline.html` for Signal Flow; `generated/*.visual-check.*` for how evidence is
  captured at 1440×900 and 2048×1320 in both themes.

Screenshots of five example artifacts at 1440×900 are in the session scratchpad under
`archify-shots/` for as long as the session lasts.

---

# Part 2 — what the first study missed (2026-09-16, after the owner's verdict on round 5)

The first study recorded archify's mechanisms and none of its editorial limits. Every gap below
is a quantity, not a technique.

## 1. Grouping: the abstraction ceiling is hard and low

Across all 19 example JSONs no diagram exceeds **12 nodes** (distribution 8–12); edges track
nodes about 1:1 (6–14); boundaries are **1–4, never more**; nesting depth is **1**. This is
authored policy: `SKILL.md:21` "at most 12 primary nodes"; `references/authoring-contract.md:152`
"prefer 6–12 primary components and group only real ownership, trust, process or deployment
boundaries; boundaries do not replace relationships"; `SKILL.md:77` "remove low-value edges
before adding routing controls"; `PRODUCT.md:30` "one spatial narrative first".

Sublabel and tag absorb what would otherwise be nodes: every architecture example sublabels
~100% of components and tags 17–100% (`Redis / multi-AZ cache / platform`); three S3 buckets are
one node with a three-item bullet list inside it. Edge labels are sparse: `maka` labels 3 of 12.
Cards are the third grouping axis: 1–3 cards, 2–3 bullets each, below the canvas. Lanes, phases
and stages are the second spatial axis in workflow and dataflow (4 lanes × 6 cols × 3 phases,
12 nodes; 5 stages × 2 rows, 10 nodes), so reading order comes from position.

**Why ours reads worse:** 19 systems + 68 components + 120 edges is 7× the node ceiling and 8.5×
the edge count with six boundaries, double archify's maximum, so no boundary is distinctive and
the amber dashes become texture. L1 "opens every system into components", turning 12 boxes into
68 exactly where reading should get easier.

**The archify-faithful abstraction of our model:** L0 carries 10–12 nodes and 2–3 boundaries.
Merge studio + journey + modules → Desktop surfaces, daemon + mcp + voice → Channels, seams +
vocabulary → Contracts; keep shell, bridge, browser lane, runner, hooks, brain, catalog, record as
the main path because the gate and the ledger are the argument. One region (Athena runtime) plus
one security group (the trust boundary); drop the per-layer frames, the row already encodes the
layer. The 68 components become the directory in the sublabel, the part id and status in the
tag, and three cards of three bullets naming the clusters we lose. Of 120 edges keep the ~14 that
form the turn; the rest live in the pane. L1 does not show every component: it reveals sublabel
and tag on the same 12 boxes and opens one system's card.

## 2. Component strategy: the node is a fixed unit

`render-architecture.mjs:65-66`: `defaultW: 120, defaultH: 60`, fixed; `rx=6`; stroke 1.5; an
opaque mask underneath; sigil 11 px at (6,6); brand mark top-right; label 11/600 centred with
floor 8; sublabel 9 with floor 6 at cy+14; tag 7 at the bottom in the kind accent. `text-fit.mjs`
shrinks then **rejects** over-long text, never clips. Variants: emphasis stroke 1.8, security
dash 5,5, dashed 4,4. Edge labels: 14 px mask, rx 3, 8 px text, every label an obstacle.

Our divergences, each with its fix: ghost module cells (no precedent; the sanctioned form is a
bullet list, which is text) → fixed 140×60; fitted widths from `⌈√n⌉ × 96` giving 378×214 nodes
→ fixed width and shrink-to-fit; `text-overflow: ellipsis` → shrink to a floor; a 24 px title
strip → none; tag top-right competing with the sigil → bottom-centre in the accent; arrowheads
7×7 → 10×7 with refX 9; no emphasised spine (maka marks 8 of 12 connections emphasis) → the
turn's path in green 1.8; labels on nearly every run → labels earn their place.

## 3. Style: the finish

Classic dark: `--bg #020617`, `--grid #1e293b`, `--mask #0f172a`, `--panel rgba(15,23,42,.5)`,
`--arrow #64748b`, `--arrow-emphasis #34d399`, fills at 0.4 alpha, strokes `#22d3ee #34d399
#a78bfa #fbbf24 #fb7185 #fb923c #94a3b8`. Light: `--bg #f8fafc`, `--grid #e2e8f0`, fills
0.15–0.2. Our CSS reproduces these hexes exactly — the palette was never the problem. Runs 1.5
px, emphasis 1.8; boundaries stroke 1, region fill `rgba(251,191,36,.05)` dash 8,4, security
group dash 4,4, label 9/600 on an opaque mask; grid 40×40; `h1` 1.5 rem/700/-0.025 em with a
.875 rem subtitle; cards `auto-fit minmax(280px,1fr)`; Present mode hides the cards and the
canvas is the slide.

What reads cheaper in ours: runs at 1.5 world units × 28% = 0.42 px on screen; no emphasis
spine; grid pitch 11 px on screen (moiré); nodes 378×214; ghost cells; ellipses; six frames; a
floating legend instead of one inside the canvas footprint; no cards; no title band; 7×7
arrowheads; 7 px boundary labels.

## 4. Scale and framing

`viewer-camera.js` starts at scale 1 and **disables zoom-out below 1**. There is no fit pass:
the authored viewBox fills a reading column (`max-width 1440px`, `svg width 100%`), and the
authoring contract forces the author to make it fit at 1440×900, 1600×1000 and 1920×1080 —
"repair overflow by removing content, never with overflow hidden, a scroller or smaller type".
Typical viewBox 1080×520. Ours defines the home pose as a heavy zoom-out (`HOME_MIN 0.16`), which
is the single ratio behind the thin lines, dense grid and unreadable labels.

## 5. Two variants for round 6

**A — the editorial sheet (`archify-density`).** Twelve nodes, two boundaries, at most fourteen
edges, one emphasised spine, no node ever opens. L0 is the sheet at 100%; L1 is the same boxes
with sublabel and tag revealed plus the hovered node's pane; L2 is the card rail, not a new
graph. The one change that matters: fixed 140×60 nodes and an authored world of about 1180×720
that fills the reading column at scale 1, zoom-out disabled below 1. Success: at 1440×900 zero
horizontal scroll, scale ≥ 1, every label ≥ 9 px on screen, zero ellipses, runs ≥ 1.5 px, and a
reader can name the turn's path from the still frame.

**B — the turn in lanes (`archify-lanes`).** Archify's workflow type: four lanes (Surface /
Runtime / Policy and recovery / Tools and evidence), six columns, three phases (Arrive / Compose
and gate, emphasis / Run and record, dashed), twelve nodes on lane×col, edges with `role:
main|branch|async|return|error`. L0 the lane grid with phase headers; L1 one phase's columns
widened with edge labels revealed; L2 one lane as a five-stage dataflow (Signal → Compose →
Gate → Execute → Record). The one change: lane and phase chrome replaces the boundary frames, so
reading order comes from position and the amber dashes disappear. Success: a reader with no
legend states the happy path and the one exception branch in under fifteen seconds, and error
and return runs never enter the main corridor (zero crossings between main and error runs).

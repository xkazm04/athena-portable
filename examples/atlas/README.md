# atlas

**This repository as a blueprint you pan, zoom and re-arrange.** Port 3006. Ships without Athena,
like the other three.

One ruled sheet. Nineteen **blocks** — the systems of README §3.1 — each a titled rectangle with
four port stubs and its modules as **parts** inside it. **Runs** between them are orthogonal
polylines with arrowheads, going *down* when they depend and *up* when they reach. Four
**arrangements** of the same blocks are on `/` behind a segmented control (`?view=layers|turn|trust|packages`),
and a switch is a layout transition, not a new drawing. Three levels are three zoom bands.

Round 4 replaced round 3's 3D machine. The owner's verdict: *"designing app architecture as a
'building' is not the right direction; a 2D diagram of components in a canvas with switchable views
in blueprint structure would fit much better. For 3D we don't have any good practice or idea what to
invent; we should not chase it."* There is no `three`, no CSS 3D and no perspective in this app.

```bash
pnpm dev:atlas                   # or: pnpm --filter atlas dev
pnpm --filter atlas typecheck && pnpm --filter atlas lint && pnpm --filter atlas test
```

## The four views

| View | Arrangement | Runs mean |
|---|---|---|
| **Layers** (default) | README §3.1's six strata as bands, surfaces at the top, contracts at the floor | `depends on` |
| **Turn** | README §3.2's twelve stops in order, numbered, the gate and the ledger marked; everything the request never touches on a shelf below. A step control walks the stops | `then` |
| **Trust** | README §2's six invariants as regions. A block stands in the one it is most responsible for and tethers to the others it also serves | `enforces` |
| **Packages** | the tree on disk — `src/athena/**`, `apps/desktop`, `packages/**`, `examples` — as nested rectangles. Runs hidden until you ask | `imports` |

## The three bands

| Level | Zoom | Shows |
|---|---|---|
| **L0** the whole sheet | < 0.85 | layers as regions, systems as blocks, system runs. Labels are **system names**; the parts are an unlabelled texture. Choosing one of the seventeen claims in the rail sets the **lens** and lights every block and part that carries it. |
| **L1** one layer | ≥ 0.85 | the region under the camera is the open layer: its blocks show their components as parts with ports, component runs inside the layer, and stubs where an edge leaves it. Labels are **component names**. |
| **L2** one component | ≥ 2.3 | a pane rises out of the part: what it enforces, the claims it carries, who calls it, what it reaches, the ADRs that decided it. **The only place prose lives.** |

The wheel and the level are the same gesture (`useSemanticZoom`); so are a click, the level rail and
a tool call — everything ends at the same nav and therefore at the same flight. `poseFor` and
`resolveGroup`/`resolveItem` are exact inverses, asserted for every layer and every component in all
four views (`test/plan.test.ts`).

**Arrows move focus, not the camera** — unless the canvas itself is focused. Tab to the sheet (or
click empty paper) and `←↑→↓` pan; with a block focused they step to the neighbouring block.
`+`/`-`/`Home` are always the camera's.

## Why it exists

Atlas is the **objective test of the layered-UI formula** (`docs/layered-ui-formula.md` §2).
Ledgerbox, hirelane and tidycrm each *arrived at* the rules; Atlas is the app built on them, only
through `@athena/demo-kit`'s primitives, and its count of "I had to write this myself" is the
distance between the kit and a formula somebody can simply use.

That count lives in **[`KIT-GAPS.md`](./KIT-GAPS.md)**, which is the deliverable as much as the app
is: **13 gaps (round 2) → 11 (round 3) → 10 (round 4)**, five of the current ten unchanged from
earlier rounds. Nothing in `examples/demo-kit` was edited to make Atlas work.

## The model

Hand-extracted into `data/`, by reading `README.md`, `docs/adr/*`, `AGENTS.md`, the package READMEs
and the first docstring line of each module (README §7 guarantees every module has one). **`data/`
is unchanged from round 3** — the drawing changed, the argument did not.

| | |
|---|---|
| concepts | 17 — six invariants (README §2), four ladder tiers and four demo acts (README §1), three standing decisions |
| layers | 6 — README §3.1, surfaces at the top and contracts at the bottom |
| systems | 19 |
| components | 68, of which 1 is `planned` |
| edges | 120, component to component; the system and layer runs are derived from these |
| ADRs cited | 25 |

**Nothing is fetched.** No database, no network, no server action, no runtime font request. The
model is a TypeScript module compiled into the bundle, and `test/model.test.ts` pins its integrity:
every edge endpoint exists, every component belongs to exactly one system, every concept lights at
least one component, every part number is unique, and no edge runs back up the stack.

**Every entry cites its source.** A model extracted by hand is an argument, and an argument that
does not show its source is decoration.

`planned` is not a hedge. README §3.1 and §6 both list an `mcp` channel and there is no
`src/athena/channels/mcp.py`; Atlas draws it dashed and says so.

## What an agent gets

Registered on `document.modelContext` through `@athena/demo-kit/webmcp`. **Every tool is AUTO** —
Atlas has no database, writes nothing and reaches nobody, so `reversible: true` and
`sideEffects: "none"` are the honest flags. Every list announces `(showing N of M)`.

| Tool | From |
|---|---|
| `read_view`, `open_group`, `open_item`, `zoom_out` | the kit's `useZoomTools`. `read_view` answers the current arrangement, the open layer or component, and — at L1 — the components **grouped by system**, which closes round 2's gap 8 in the app |
| `set_view` *(new in round 4)* | choose one of the four arrangements, or read the current one. The level and the open layer are kept |
| `read_concepts` | the seventeen claims, each with the section it was read from and how many components enforce it |
| `read_system` | one system, with every component in it and the ids `open_item` takes |
| `read_component` | one module at full depth: enforces, claims, both directions of its edges, its ADRs |
| `set_lens` | mark up the whole sheet with one claim; call again to change it, `none` to clear, no arguments to read it |
| `read_turn` | the twelve stops of README §3.2 in order, each with its module, system, layer, its one label and the section it was read from |
| `set_turn` | put the step at one stop |

`play_turn` is **gone**. Round 3's turn was a light on a clock and the tool ran it; the turn is now a
path drawn all at once with twelve discrete stops, so there is nothing to play. A tool whose subject
no longer exists is worse than a missing one, because an agent will call it.

## Design

`DESIGN.md` is the law. The direction is **`blueprint`** — a cyanotype: white and cyan line on deep
blue, no shadows, no rounded corners, depth by rule weight, one accent (vermilion) that means the
lens and nothing else. The values are `components/atlas/style/base/tokens.css`, and
`design/check-tokens.mjs` runs in `lint` to fail the build on a raw `px` or `ms` anywhere else —
which is how "one clock per level change" (formula §1 rule 4) is enforced rather than intended.
Round 4 removed the one exemption that file used to carry: the drawing's geometry lives in a tested
pure module, so there is no stylesheet full of scene units to excuse.

## Captures

`examples/journey/shots/round4-atlas/` — per view: L0, L1, L2 and the lens; plus a wheel-zoom strip
(coming closer IS opening a level), a view-switch strip (the same blocks travelling), the turn at
four stops including the gate, the two Escapes, and the frame count at rest. `round3-atlas/` and
`round2-atlas/` keep the previous rounds for comparison. Re-run with the dev server up:

```bash
cd examples/journey && node shots/round4-atlas/atlas.mjs           # all four views
cd examples/journey && node shots/round4-atlas/atlas.mjs trust     # or one
```

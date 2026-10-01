# atlas

**This repository's turn, drawn as a lane diagram you pan, zoom and walk.** Port 3006. Ships
without Athena, like the other three.

**One direction, one drawing, three finishes, three levels.** Four **lanes** (who owns the step),
six **columns** (when it happens) and three **phases** (which act it belongs to), carrying
**twelve nodes** and **fourteen labelled runs**. Reading order comes from position, so there is
not one boundary rectangle in the picture — and no boundary type in the drawing's IR, which is
the thesis stated as a type and asserted in `test/lanes.model.test.ts`. The twelve stops of
README §3.2 are not an overlay on this map: **the columns are the turn's clock and the lanes are
its owners**, so the drawing *is* the turn.

Round 6 closed with the owner's verdict on three archify-derived variants:

> *"Lanes are a step forward."*

So `archify` (round 5's nineteen-node sheet) and `archify-density` (twelve cards on a spatial map)
are deleted. Round 7 puts **two finishes of that winner** beside it in the mast, to test wow
against the ability to present the solution: **Lanes** (the baseline), **Signal** (glow, a
one-shot scan), **Editorial** (paper, the twelve stops listed under the sheet). Switch with
the tab control, `?variant=archify-lanes|archify-signal|archify-editorial`, or `set_variant`.

Round 4's verdict still stands underneath all of it — *"designing app architecture as a
'building' is not the right direction; a 2D diagram of components in a canvas with switchable views
in blueprint structure would fit much better. For 3D we don't have any good practice or idea what to
invent; we should not chase it."* There is no `three`, no CSS 3D and no perspective in this app.

```bash
pnpm dev:atlas                   # or: pnpm --filter atlas dev
pnpm --filter atlas typecheck && pnpm --filter atlas lint && pnpm --filter atlas test
```

## The three levels

| Level | Is | Shows |
|---|---|---|
| **L0** the whole grid | home, at **scale 1** | the phase headers on top, twelve nodes with sigil / label / sublabel / tag coloured by kind, fourteen labelled runs in five roles. Choosing one of the seventeen claims in the rail sets the **lens** and lights every node that carries it. |
| **L1** one **phase** | a phase under the camera | its columns widened by `planFor`, so the run labels a 52-unit column gap could not hold are revealed here; the other two phases recede through the kit's `presenceOf`. |
| **L2** one **node** | a pane out of the node | what it enforces, the claims it carries, who calls it, what it reaches, the ADRs that decided it. **The only place prose lives**, and the one details destination for the whole app. |

Two **arrangements** of the same twelve nodes are behind a segmented control
(`?view=lanes|turn`), and a switch is a layout transition, not a new drawing: **lanes** is the grid,
**turn** makes the turn's own path the primary reading order.

The wheel and the level are the same gesture (`useSemanticZoom`); so are a click, the level rail and
a tool call — everything ends at the same nav and therefore at the same flight. The poses and the
resolvers are exact inverses, asserted for every phase and every node in both arrangements
(`test/lanes.poses.test.ts`), and every run is re-measured against archify's own floors in
`test/lanes.routing.test.ts` — orthogonal, no segment under `MIN_SEG`, no interior turn under
`MIN_TURN`, clears every unrelated node by `CLEAR`, and no `main` run crosses the `error` run.

**Arrows move focus, not the camera** — unless the canvas itself is focused. Tab to the sheet (or
click empty paper) and `←↑→↓` pan; with a node focused they step to the neighbouring node.
`+`/`-`/`Home` are always the camera's.

## The abstraction, and where it came from

Nineteen systems become **twelve nodes** by four authored merges, each with its reason in
`variants/archify-lanes/workflow.ts`; the sixty-eight components become the nodes' sublabels.
`test/lanes.model.test.ts` asserts that every system of the model lives in exactly one node — a
system added to `data/systems.ts` with no home here fails the build rather than silently vanishing
from the drawing.

Twelve nodes and fourteen edges are **archify's own ceilings**, read off the tool a second time in
`docs/archify-study.md` Part 2: no archify example exceeds either number, nesting depth is one, a
node is a fixed unit whose text shrinks to a floor and never truncates, and the home pose is scale 1
with zoom-out disabled. This drawing meets all of them, with tests that pin each one. Nothing is
under 9 px on screen at home and nothing ellipsises.

## Why it exists

Atlas is the **objective test of the layered-UI formula** (`docs/layered-ui-formula.md` §2).
Ledgerbox, hirelane and tidycrm each *arrived at* the rules; Atlas is the app built on them, only
through `@athena/demo-kit`'s primitives, and its count of "I had to write this myself" is the
distance between the kit and a formula somebody can simply use.

That count lives in **[`KIT-GAPS.md`](./KIT-GAPS.md)**, which is the deliverable as much as the app
is: **13 gaps (round 2) → 11 (round 3) → 10 (round 4)**, plus what rounds 5 and 6 found building
five more drawings over the same model. Nothing there is ever deleted when a drawing is — a gap is a
fact about the kit and not about a picture. Nothing in `examples/demo-kit` was edited to make Atlas
work.

## The model

Hand-extracted into `data/`, by reading `README.md`, `docs/adr/*`, `AGENTS.md`, the package READMEs
and the first docstring line of each module (README §7 guarantees every module has one). **`data/`
is unchanged since round 3** — the drawing has changed four times, the argument has not.

| | |
|---|---|
| concepts | 17 — six invariants (README §2), four ladder tiers and four demo acts (README §1), three standing decisions |
| layers | 6 — README §3.1, surfaces at the top and contracts at the bottom |
| systems | 19, drawn as 12 nodes |
| components | 68, of which 1 is `planned` |
| edges | 120, component to component |
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
| `read_view`, `open_group`, `open_item`, `zoom_out` | the kit's `useZoomTools`. `read_view` answers the arrangement, the open phase or node, and — at L1 — the components **grouped by system**, which closes round 2's gap 8 in the app. It also names the **drawing**, first, in every projection |
| `set_view` | choose one of the two arrangements, `lanes` or `turn`. The level and the open phase are kept |
| `read_concepts` | the seventeen claims, each with the section it was read from and how many components enforce it |
| `read_system` | one system, with every component in it and the ids `open_item` takes |
| `read_component` | one module at full depth: enforces, claims, both directions of its edges, its ADRs |
| `set_lens` | mark up the whole drawing with one claim; call again to change it, `none` to clear, no arguments to read it |
| `read_turn` | the twelve stops of README §3.2 in order, each with its module, its **node, lane, column and phase**, its one label, the section it was read from, and whether a run of this drawing carries the hop into it and in which role |
| `set_turn` | put the step at one stop; the camera follows to the phase it lives in |

One tool is **gone**, by the round-4 rule. `play_turn` went then — the turn is drawn all at once
with twelve discrete stops, so there is nothing to play. `set_variant` left in round 6 (one
drawing, a one-value enum) and **came back in round 7** with three finishes, which is a choice
an agent can make. `read_view` still names the drawing first in every projection.

The shell mounts the three finishes through the same lazy import (`components/atlas/variants/`):
classic, signal and editorial are three folders, one engine (`Drawing.tsx` behind
`components/atlas/lanes.ts`), and the mast's tab switcher is the comparison.

## Design

`DESIGN.md` is the law, and **§R6 is the current round**. The palette is archify's classic family,
hex for hex, in light and dark: one colour per meaning, seven kinds, five roles, and no decorative
accent anywhere. The values are `components/atlas/style/base/tokens.css` and the variant's own
`lanes.css`, and `design/check-tokens.mjs` runs in `lint` to fail the build on a raw `px` or `ms`
anywhere else — which is how "one clock per level change" (formula §1 rule 4) is enforced rather
than intended.

## Captures

`examples/journey/shots/round6-atlas/` — `final-L0/L1/L2` are the app as it ships after the verdict;
`lanes-*` and `density-*` are the two round-6 builds as they were compared, and `archify-L0.png` is
the round-5 baseline they were compared against. `round5-atlas/`, `round4-atlas/`, `round3-atlas/`
and `round2-atlas/` keep the earlier rounds. Re-run with the dev server up:

```bash
cd examples/journey && node shots/round6-atlas/lanes.mjs
```

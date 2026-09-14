# atlas

**This repository as a machine you can walk around.** Port 3006. Ships without Athena, like the
other three.

Six planes stacked in depth are README §3.1's layers; the blocks standing on them are the systems;
the parts inside a block are the modules; the pipes between them are the edges, running **up** when
they reach and **down** when they depend. A **light** travels those pipes and stops twelve times —
that is README §3.2's turn, and it waits at the gate. Three levels are three camera distances.
Three renderings of the same machine are on `/` behind a switch (`?render=webgl|css3d|hybrid`)
while the owner picks one.

```bash
pnpm dev:atlas                   # or: pnpm --filter atlas dev
pnpm --filter atlas typecheck && pnpm --filter atlas lint && pnpm --filter atlas test
```

| Level | Zoom | Shows |
|---|---|---|
| **L0** the whole machine | < 1.55 | six planes, nineteen blocks, the plumbing between them, and the turn. Choosing one of the seventeen claims in the rail sets the **lens** and lights every part that carries it. |
| **L1** one stratum | ≥ 1.55 | the camera flies to that plane, the others recede, its blocks open and lift their parts, and its pipes to the rest of the stack come forward. |
| **L2** one module | ≥ 3.6 | a pane rises out of the part: what it enforces, the claims it carries, who calls it, what it reaches, the ADRs that decided it. **The only place prose lives.** |

The wheel and the level are the same gesture (`useSemanticZoom`); so are a click, the level rail and
a tool call — everything ends at the same nav and therefore at the same flight.

## Why it exists

Atlas is the **objective test of the layered-UI formula** (`docs/layered-ui-formula.md` §2).
Ledgerbox, hirelane and tidycrm each *arrived at* the nine rules; Atlas is the first app built on
them, only through `@athena/demo-kit`'s primitives, and its count of "I had to write this myself"
is the distance between the kit and a formula somebody can simply use.

That count lives in **[`KIT-GAPS.md`](./KIT-GAPS.md)**, which is the deliverable as much as the app
is. Nothing in `examples/demo-kit` was edited to make Atlas work; every local workaround is a dated
bullet there instead.

## The model

Hand-extracted into `data/`, by reading `README.md`, `docs/adr/*`, `AGENTS.md`, the package READMEs
and the first docstring line of each module (README §7 guarantees every module has one).

| | |
|---|---|
| concepts | 17 — six invariants (README §2), four ladder tiers and four demo acts (README §1), three standing decisions |
| layers | 6 — README §3.1, surfaces at the top and contracts at the bottom |
| systems | 19 |
| components | 68, of which 1 is `planned` |
| edges | 120, component to component; the system and layer edges L1 draws are derived from these |
| ADRs cited | 25 |

**Nothing is fetched.** No database, no network, no server action, no runtime font request. The
model is a TypeScript module compiled into the bundle, and `test/model.test.ts` pins its integrity:
every edge endpoint exists, every component belongs to exactly one system, every concept lights at
least one component, every part number is unique, and no edge runs back up the stack.

**Every entry cites its source.** A model extracted by hand is an argument, and an argument that
does not show its source is decoration. The rule caught a real modelling error during the build:
the composition root (`wiring.py`, `cli.py`) was first filed under `contracts` and the "no edge
runs up the stack" test failed, because a composition root by definition reaches into everything.
It is a surface.

`planned` is not a hedge. README §3.1 and §6 both list an `mcp` channel and there is no
`src/athena/channels/mcp.py`; Atlas draws it dashed and says so.

## What an agent gets

Registered on `document.modelContext` through `@athena/demo-kit/webmcp`. **Every tool is AUTO** —
Atlas has no database, writes nothing and reaches nobody, so `reversible: true` and
`sideEffects: "none"` are the honest flags. Every list announces `(showing N of M)`.

| Tool | From |
|---|---|
| `read_view`, `open_group`, `open_item`, `zoom_out` | the kit's `useZoomTools`, so the four verbs mean here what they mean on every other surface |
| `read_concepts` | the seventeen claims, each with the section it was read from and how many components enforce it |
| `read_system` | one system, with every component in it and the ids `open_item` takes |
| `read_component` | one module at full depth: enforces, claims, both directions of its edges, its ADRs |
| `set_lens` | mark up the whole machine with one claim; call again to change it, `none` to clear, no arguments to read it |
| `read_turn` | the twelve stops of README §3.2 in order, each with its module, its one label and the section it was read from |
| `set_turn`, `play_turn` | put the light at one stop, or run it. Both AUTO: they change what is moving on screen and nothing else |

## Design

`DESIGN.md` is the law, written before the code, in the 9-section `taste-design` format. The
direction is **`plate`** — a cyanotype: white line on Prussian blue, no shadows, no rounded
corners, depth by rule weight, one accent (vermilion) that means the lens and the turn and nothing
else. Round 3 rewrote it for the machine: the atmosphere, the scene, the turn, the camera, and
**where text is allowed** — short names at L0 and L1, prose only at L2. The
values are `components/atlas/style/base/tokens.css`, and `design/check-tokens.mjs` runs in `lint`
to fail the build on a raw `px` or `ms` anywhere else — which is how "one clock per level change"
(formula §1 rule 4) is enforced rather than intended.

## Captures

`examples/journey/shots/round3-atlas/` — per rendering: the rubric path driven through the tools,
the lens, the turn at five stops including the gate's wait, a wheel-zoom strip (coming closer IS
opening a level), a drag strip, the two Escapes, and the frame count at rest.
`round2-atlas/` keeps the previous round for comparison. Re-run with the dev server up:

```bash
cd examples/journey && node shots/round3-atlas/atlas.mjs          # all three
cd examples/journey && node shots/round3-atlas/atlas.mjs webgl    # or one
```

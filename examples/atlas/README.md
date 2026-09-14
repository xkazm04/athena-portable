# atlas

**This repository, read at three altitudes.** Port 3006. Ships without Athena, like the other three.

```bash
pnpm dev:atlas                   # or: pnpm --filter atlas dev
pnpm --filter atlas typecheck && pnpm --filter atlas lint && pnpm --filter atlas test
```

| Level | Shows |
|---|---|
| **L0** the plate | the six layers of README §3.1 as a stack, and the seventeen claims this repository makes as an index. Choosing a claim sets the **lens**: every layer marks up with how many of its components carry it. |
| **L1** one layer | its systems laid side by side to compare, each a column of components with the file each one lives in; edges to the other layers in the margin rails. |
| **L2** one component | what it enforces, the claims it carries, who calls it, what it reaches, and the ADR that decided it. |

## Why it exists

Atlas is round 2's **objective test of the layered-UI formula** (`docs/layered-ui-formula.md` §2).
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
| systems | 18 |
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
| `set_lens` | mark up the whole atlas with one claim; call again to change it, `none` to clear, no arguments to read it |

## Design

`DESIGN.md` is the law, written before the code, in the 9-section `taste-design` format. The
direction is **`plate`** — a cyanotype: white line on Prussian blue, no shadows, no rounded
corners, depth by rule weight, one accent (vermilion) that means the lens and nothing else. The
values are `components/atlas/style/base/tokens.css`, and `design/check-tokens.mjs` runs in `lint`
to fail the build on a raw `px` or `ms` anywhere else — which is how "one clock per level change"
(formula §1 rule 4) is enforced rather than intended.

## Captures

`examples/journey/shots/round2-atlas/` — settled stills at all three levels, frame strips at
0/120/250/400/650/1000/1600 ms after each level change, a video, long-task and frame counts, the
focus state after each Escape, an interrupt probe, and a `reduced/` set proving rule 8 lands on the
final state at frame zero. Re-run with the dev server up:

```bash
cd examples/journey && node shots/round2-atlas/atlas.mjs shots/round2-atlas
```

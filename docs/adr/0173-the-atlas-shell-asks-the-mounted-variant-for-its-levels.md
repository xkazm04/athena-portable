# 0173. The atlas shell asks the mounted variant for its levels

Date: 2026-10-25

## Context

Atlas claims "one model, one level semantics, one details destination, N drawings"
(`examples/atlas/components/atlas/Atlas.tsx`). The level SEMANTICS are the shell's (three levels,
one group, one item, `useZoomNav`), but the shell also hard-coded what a GROUP is: the data model's
layers (layer > system > component). The only drawing it mounts, in all three finishes, groups by
PHASE (arrive, compose, record) over twelve nodes, and its stage dispatches `openGroup(phase)`. So
every shell surface that named a group spoke a vocabulary the stage does not have:

- `read_view` at L1 answered `{ error: "No layer arrive." }`: an agent could not read L1 at all.
- `open_group` advertised and accepted the six layer ids, so a successful `open_group("core")` put
  the drawing into a group its plan has no box for: a success the screen contradicts.
- The mast rail resolved the group as a layer and printed the generic "One layer" over a phase.
- The pane's edge links opened `nav.openItem(layer.id, ...)`; 39 of the 67 edges touching a drawn
  node lead to a component no node draws, and every one left the drawing on a layer id.

## Decision

1. **A variant declares its levels.** `VariantMeta.levels?: LevelMap` (`variants/contract.ts`):
   three level names, the group and item nouns, and the groups, each `{ id, label, note, items }`
   where `items` are component ids.
2. **One pure module resolves them**, `variants/levels.ts`: `DATA_LEVELS` (the layers, the
   vocabulary the shell spoke before), `LANES_LEVELS` (derived from the lane workflow's `PHASES`
   and `NODES`, never retyped; an item is the component a node's pane opens), and `groupsFor`,
   `itemsFor`, `railLabel`, `targetFor`. `LANES_LEVELS` lives there rather than in
   `components/atlas/lanes.ts` because that module re-exports `Drawing.tsx`, which `node --test`
   cannot load; `lanes.ts` re-exports the map for the Signal and Editorial finishes.
3. **The shell reads `meta.levels` in the same lazy effect that reads `meta.views`**, discards a
   stale slug's answer the same way, and hands one map to the zoom tools, the mast and the pane.
   No map, or an answer not yet in, means `DATA_LEVELS`.
4. **`read_view` at L1 answers the open group** (`viewDetail(..., levels)`): its id, noun, label,
   note and the components its items are, bounded and announced. With the data map it answers the
   layer, its nested systems and the flat list exactly as before. L0 and L2 do not depend on it.
5. **A pane link opens in a group the stage has.** A component a group holds opens in that group
   (the camera flies); one no group holds keeps the current group and swaps the pane.

## Consequences

- An agent can read and open every level of the drawing that is mounted, and `open_group` refuses
  the layer ids the drawing cannot fly to (with the phase ids as `available`).
- `open_item` now offers the twelve drawn components, not all sixty-eight; any component is still
  readable through `read_component` and reachable from a pane link.
- A future variant that groups differently declares it once in `meta`; the shell needs no edit.
- `test/levels.test.ts` pins the eight acceptance cases, including the parity that every node is
  in the map once, under its column's phase.

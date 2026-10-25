# 0187. The tidycrm dossier walks the sheet worst first, across databases

Date: 2026-10-25

Builds on ADR 0174 (the agent reads every act target the dossier fires on). Registry: hitl-approval
(review-queues), table (sorting), mcp-tools (tool-schema-design).

## Context

A person clearing the Blocks sheet works one table at a time, but the dossier could only be closed.
The next table worth their attention was usually in another database: Escape, a database jump with
its 1,120 ms flight and dress (`beats.ts`), then a visual search among five to seven cards, where the
L0 colour cannot help because 43 of 46 tables touch an open pair. The order that answers "which
next" already existed - the tables a person is waiting on, then the most outstanding deviations - as
a private comparator inside `tools/search.ts`, so only an agent's `search_blocks` could walk it.
That comparator was also not total: tables of equal rank kept the order the databases happened to
be dealt in, and the seed has many such ties.

## Decision

1. **The order is the model's.** `components/blocks/model/worklist.ts` (pure, client-safe) owns
   `worstFirst`, adds `ident` as the last tie-break, and builds `worklistOf(sheet)`: every table
   with work on it (deviations outstanding or a pair awaiting a person), worst first across all
   databases. `search_blocks` imports the same comparator, so the agent's search, the person's walk
   and `next_table` cannot disagree.
2. **A step is pure and does not wrap.** `stepWorklist(list, from, direction)` returns the next
   focus `{group, item, at, of}` or null at either end; the surface says the end was reached rather
   than jumping back to a table already cleared. When the open table has left the refreshed list (a
   repair cleared it), the step continues from the slot it held, not the head. `placeOf` keeps that
   last place; `Blocks.tsx` remembers it across server refreshes.
3. **The dossier steps through the nav's own door.** `]` / `[` (and two buttons in a walk bar with a
   "Worst first · 4 of 43" line) call `nav.openItem(group, item)`. A step into another database
   flies and dresses exactly as an agent's `open_item` does. The old card hands focus to the new one
   on unmount rather than back to a cell under the scrim.
4. **`next_table` is the agent's `]`.** Read-and-move like `open_item`: `readOnlyHint`, no
   `consequentialHint`, description under the 240-char cap (ADR 0070). It returns the table's
   `tableRead`, its place, and `arrives_in_ms` (`ARRIVAL_MS` when the database changes, 0 inside one).

## Consequences

- `search_blocks` keeps every table at the rank it held; within a run of equal rank its order is
  now by ident instead of deal order. Pinned by the guard in `test/worklist.test.ts` (rank sequence
  and run membership unchanged), which is a deviation from the challenge card's literal "same ids in
  the same order": that and "entry 0 is search_blocks' first" cannot both hold on this seed while the
  worklist's order is total, and a total order is the one the person's walk needs.
- The Blocks register nine tools (tidycrm's manifest stays far under `MAX_TOOLS_PER_MANIFEST`).
- The walk bar is a third fixed row under the gate, built from existing classes; no new CSS.

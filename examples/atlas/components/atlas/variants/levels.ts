/**
 * THE LEVEL VOCABULARY BELONGS TO THE DRAWING THAT IS MOUNTED.
 *
 * Atlas claims "one model, one level semantics, N drawings" (`Atlas.tsx`). The SEMANTICS are the
 * shell's (three levels, Escape, one group and one item, `useZoomNav`); what a GROUP is, is not.
 * The data model groups by layer (layer > system > component), and the only drawing the shell
 * mounts groups by PHASE (arrive, compose, record) over twelve nodes. A shell that names groups in
 * the model's words therefore speaks a vocabulary the stage does not have: `read_view` at L1
 * answered "No layer arrive.", `open_group` accepted six ids the drawing has no box for, the rail
 * printed "One layer" over a phase, and a pane link flew the camera into a layer id.
 *
 * So a variant DECLARES its levels in `meta.levels` (`contract.ts`), and every shell surface that
 * names a group resolves through the map: the zoom tools (`groupsFor`, `itemsFor`), the rail
 * (`railLabel`), the pane's links (`targetFor`) and `read_view` at L1. With no map the shell falls
 * back to `DATA_LEVELS`, which is exactly the layer vocabulary it spoke before. ADR 0173.
 *
 * Pure and React-free, so `test/levels.test.ts` pins it under `node --test`.
 *
 * WHY `LANES_LEVELS` IS HERE AND NOT IN `components/atlas/lanes.ts`. That module re-exports the
 * drawing (`Drawing.tsx`), which `node --test` cannot load, and the parity case has to import the
 * map the variants actually publish. It is derived from the lane workflow's PHASES and NODES and
 * never retyped; `lanes.ts` re-exports it for the Signal and Editorial finishes.
 */
import type { ZoomGroup, ZoomItem } from "@athena/demo-kit/webmcp";
import type { Focus } from "@athena/demo-kit/zoom";

import { LAYERS, componentById, componentsOf, systemsOf } from "@/data";
import { LEVELS, NOUNS } from "@/lib/constants";

import { NODES, PHASES, phaseOfCol } from "./archify-lanes/workflow";

/** One group as the drawing has it: an id `open_group` takes and the stage can fly to. */
export interface LevelGroup {
  id: string;
  label: string;
  /** One line: what this group is. */
  note: string;
  /** The component ids this group's items are — the ids `open_item` takes. */
  items: readonly string[];
}

/** What a variant calls its levels and what its groups are. */
export interface LevelMap {
  /** The three level names, L0 first: the rail's and `read_view`'s words. */
  levelNames: readonly [string, string, string];
  /** Singular nouns for a group and an item, for the zoom tools' descriptions. */
  nouns: readonly [group: string, item: string];
  groups: readonly LevelGroup[];
}

/** The fallback: the data model's own vocabulary, one group per layer. */
export const DATA_LEVELS: LevelMap = {
  levelNames: LEVELS,
  nouns: NOUNS,
  groups: LAYERS.map((l) => ({
    id: l.id,
    label: l.name,
    note: l.blurb,
    items: systemsOf(l.id).flatMap((s) => componentsOf(s.id).map((c) => c.id)),
  })),
};

/**
 * The lanes drawing's levels: three phases, each holding the nodes of its two columns. An item is
 * the component a node's pane opens (`WNode.item`), because the pane takes a component.
 */
export const LANES_LEVELS: LevelMap = {
  levelNames: [LEVELS[0], "One phase", LEVELS[2]],
  nouns: ["phase", "component"],
  groups: PHASES.map((p) => ({
    id: p.id,
    label: p.label,
    note: p.note,
    items: NODES.filter((n) => phaseOfCol(n.col).id === p.id).map((n) => n.item),
  })),
};

/** The map a variant's module declared, if it has the shape of one; otherwise null. */
export function asLevelMap(value: unknown): LevelMap | null {
  const v = value as Partial<LevelMap> | null | undefined;
  if (!v || !Array.isArray(v.groups) || !Array.isArray(v.levelNames) || !Array.isArray(v.nouns)) {
    return null;
  }
  return v as LevelMap;
}

export const groupOf = (map: LevelMap, id: string | null): LevelGroup | undefined =>
  id === null ? undefined : map.groups.find((g) => g.id === id);

/** `open_group`'s population. */
export const groupsFor = (map: LevelMap): ZoomGroup[] =>
  map.groups.map((g) => ({ id: g.id, label: g.label, count: g.items.length }));

/** `open_item`'s population, for one group or (null) all of them. */
export function itemsFor(map: LevelMap, group: string | null): ZoomItem[] {
  const groups = group === null ? map.groups : map.groups.filter((g) => g.id === group);
  return groups.flatMap((g) =>
    g.items.map((id) => {
      const c = componentById(id);
      return { id, label: c ? `${c.part} · ${c.name} · ${c.file}` : id, group: g.id };
    }),
  );
}

/** The rail's middle step: the open group's label, or the map's name for the level. */
export const railLabel = (map: LevelMap, focus: Focus): string =>
  groupOf(map, focus.group)?.label ?? map.levelNames[1];

/**
 * Where a link to a component should open it.
 *
 * A component one of the map's groups holds opens in THAT group (`drawn: true`), so the camera
 * flies to it. One no group holds keeps the current group and only swaps the pane
 * (`drawn: false`) — rather than inventing a group the stage has no box for.
 */
export function targetFor(
  map: LevelMap,
  id: string,
  focus: Focus,
): { group: string; item: string; drawn: boolean } {
  const home = map.groups.find((g) => g.items.includes(id));
  if (home) return { group: home.id, item: id, drawn: true };
  const kept = groupOf(map, focus.group) ?? map.groups[0];
  return { group: kept?.id ?? focus.group ?? "", item: id, drawn: false };
}

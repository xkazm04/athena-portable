"use client";

/**
 * The ingest layer: a three-level direction, offered to an outside agent.
 *
 * A direction built on `@athena/demo-kit/zoom` has one shape — a population, a
 * group inside it, an item inside that — and an agent driving it needs exactly
 * four verbs: say where you are, go into a group, go into an item, come back
 * out. Written once here, because the point of the shared nav model is that
 * "open a group" means the same thing everywhere, and three copies of these
 * four tools would let that drift the moment one of them was edited.
 *
 * What is NOT here is anything a direction has to answer for itself: what its
 * groups are called, what a mark on screen is, how you search its fixtures.
 * Those are handed in, and each app's own tools file adds its search and its
 * filters beside them.
 *
 * EVERY TOOL HERE IS A READ OR A MOVE. Nothing it registers writes app data or
 * reaches a person, so all four carry `readOnlyHint` and none carries
 * `consequentialHint`: navigating is not an act that needs a gate, and a
 * direction's real capabilities are registered by whoever owns them. An agent
 * that can only drive this layer can look anywhere and change nothing.
 */
import { useMemo } from "react";

import type { Level, Nav } from "../zoom/nav";
import { bounded } from "./bounded";
import { useWebMCPTool } from "./hooks";

/** One group, as an agent picks it: an id it can pass back, and a name it can read. */
export interface ZoomGroup {
  id: string;
  label: string;
  /** How many items are in it, so an agent can tell a queue from an empty room. */
  count: number;
}

/** One item, as an agent picks it. */
export interface ZoomItem {
  id: string;
  label: string;
  /** The group it belongs to, so `open_item` can be called with the id alone. */
  group: string;
}

export interface ZoomToolsSpec {
  nav: Nav;
  /**
   * What the three levels are called on this surface, L0 first. The same three
   * words the level rail prints, so an agent and a reader are talking about the
   * same thing.
   */
  levels: readonly [string, string, string];
  /** Singular nouns, for the tool descriptions: e.g. `["area", "invoice"]`. */
  nouns: readonly [group: string, item: string];
  /** Every group on the surface right now. */
  groups: () => ZoomGroup[];
  /** Every item in one group, or all of them when no group is named. */
  items: (group: string | null) => ZoomItem[];
  /**
   * What the current level actually shows, beyond the ids — the figures a
   * reader would see. Kept separate from `groups` so `read_view` can be honest
   * about depth without every level paying for the deepest one's payload.
   */
  detail: () => unknown;
  /**
   * How this direction opens a group, when that is not simply `nav.openGroup`.
   *
   * A tool has to walk the same path a click walks. Where a direction stages
   * the move itself — the Blocks spends about three seconds turning a cube of
   * records into the grid before the level changes at all — calling the nav
   * straight would skip the whole thing and leave the surface mid-way through a
   * move it never started. Supply the opener and say what it costs, and the
   * tool tells its caller to wait rather than reading a level that is still
   * assembling.
   */
  openGroup?: (id: string) => void;
  openItem?: (group: string, id: string) => void;
  /** Milliseconds `open_group` takes to land, when it is not immediate. */
  openGroupMs?: number;
}

export function useZoomTools(spec: ZoomToolsSpec): void {
  const { nav, levels, nouns } = spec;
  const [groupNoun, itemNoun] = nouns;

  // The nouns are in every description, so the schema changes only when they do
  // — which is never, at runtime. Memoised so a re-render does not churn the
  // registration.
  const text = useMemo(
    () => ({
      read: `Where the view is now: which of the three levels is open (${levels.join(" / ")}), which ${groupNoun} and which ${itemNoun} are focused, every ${groupNoun} on the surface, and the figures the current level shows.`,
      openGroup: `Zoom from the overview into one ${groupNoun}, the way clicking it does. Call read_view first for the ids.`,
      openItem: `Open one ${itemNoun} at full depth. The ${groupNoun} is optional: without it the ${itemNoun} is looked up wherever it lives.`,
      out: `Go back out one level: from an ${itemNoun} to its ${groupNoun}, from a ${groupNoun} to the overview.`,
    }),
    [levels, groupNoun, itemNoun],
  );

  useWebMCPTool({
    name: "read_view",
    description: text.read,
    reversible: true,
    sideEffects: "none",
    handler: () => {
      const { level, group, item } = nav.state.focus;
      return {
        level,
        level_name: levels[level],
        [`${groupNoun}_open`]: group,
        [`${itemNoun}_open`]: item,
        // Bounded like every other listing, and `detail` rather than `showing`: `showing` is a
        // count in the one envelope this kit uses, so it cannot also name a detail object.
        [`${groupNoun}s`]: bounded(spec.groups()),
        detail: spec.detail(),
      };
    },
  });

  useWebMCPTool({
    name: "open_group",
    description: text.openGroup,
    parameters: [
      { name: "id", type: "string", required: true, description: `The ${groupNoun}'s id, from read_view` },
    ],
    reversible: true,
    sideEffects: "none",
    handler: ({ id }) => {
      const wanted = String(id);
      const found = spec.groups().find((g) => g.id === wanted);
      if (!found) {
        return {
          ok: false,
          error: `No ${groupNoun} with id ${wanted}.`,
          available: spec.groups().map((g) => g.id),
        };
      }
      (spec.openGroup ?? nav.openGroup)(found.id);
      return {
        ok: true,
        level: 1 as Level,
        opened: found,
        ...(spec.openGroupMs
          ? {
              settles_in_ms: spec.openGroupMs,
              note: "This surface animates the move. Wait before reading the view, or read_view will describe a level that is still assembling.",
            }
          : {}),
      };
    },
  });

  useWebMCPTool({
    name: "open_item",
    description: text.openItem,
    parameters: [
      { name: "id", type: "string", required: true, description: `The ${itemNoun}'s id` },
      { name: "group", type: "string", description: `Optional ${groupNoun} id to look in` },
    ],
    reversible: true,
    sideEffects: "none",
    handler: ({ id, group }) => {
      const wanted = String(id);
      const within = group === undefined || group === null ? null : String(group);
      const found = spec.items(within).find((i) => i.id === wanted);
      if (!found) {
        const near = bounded(spec.items(within).map((i) => i.id));
        return { ok: false, error: `No ${itemNoun} with id ${wanted}.`, available: near };
      }
      (spec.openItem ?? nav.openItem)(found.group, found.id);
      return { ok: true, level: 2 as Level, opened: found };
    },
  });

  useWebMCPTool({
    name: "zoom_out",
    description: text.out,
    reversible: true,
    sideEffects: "none",
    handler: () => {
      const from = nav.state.focus.level;
      if (from === 0) return { ok: false, error: "Already at the overview." };
      nav.up();
      const to = (from - 1) as Level;
      return { ok: true, level: to, level_name: levels[to] };
    },
  });
}

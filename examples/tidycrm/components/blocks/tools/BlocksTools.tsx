"use client";

/**
 * The Blocks on WebMCP: the ingest layer for this direction.
 *
 * Four of the tools are the shared ones every three-level direction gets from
 * `useZoomTools` — read the view, open a zone, open a block, come back out. The
 * three below are what only this sheet can answer: a search over the blocks, a
 * search over the example rows they carry, and the deviation breakdown the
 * sheet head can be asked to show.
 *
 * OPENING A ZONE IS NOT INSTANT HERE, and the tool says so. The cube spends
 * about three seconds turning its records into the grid, and an agent that
 * called `open_group` and then immediately `read_view` would be reading a level
 * that is still assembling. `open_group` therefore reports the level it is
 * heading to and how long the move takes.
 *
 * NOTHING HERE CHANGES THE DATABASE. Normalising, flagging, merging and
 * deleting are registered by `components/shell/HostCapabilities.tsx`, where
 * `merge_contacts` and `delete_contacts` come back GATED — merging destroys a
 * record and no rule may decide it. This layer looks and moves, so every tool
 * in it is `readOnlyHint` and none is `consequentialHint`.
 */
import { useZoomTools, useWebMCPTool } from "@athena/demo-kit/webmcp";
import type { ZoomNav } from "@athena/demo-kit/zoom";

import { BK_LEVELS, tableOf, zoneOf, ZONE_IDS, type BkSheet } from "../model";
import { dossierRead, sheetRead, tableRead, zoneRead } from "./read";
import { searchBlocks, searchRecords, type BlocksQuery } from "./search";

/**
 * Roughly what the four-beat arrival costs, in milliseconds.
 *
 * Reported to a caller by `open_group` so it waits rather than reading a level
 * that is still assembling. Deliberately a little longer than the beats add up
 * to: the cube's flatten is a duration and the frame it starts on is not.
 */
const ARRIVAL_MS = 2900;

function num(v: unknown): number | undefined {
  const n = Number(v);
  return v === undefined || v === null || Number.isNaN(n) ? undefined : n;
}

export function BlocksTools({
  sheet,
  nav,
  onOpenZone,
  showKinds,
  setShowKinds,
}: {
  sheet: BkSheet;
  nav: ZoomNav;
  /** The same opener a click on a quadrant uses, so the cube actually flattens. */
  onOpenZone: (id: string) => void;
  showKinds: boolean;
  setShowKinds: (next: boolean) => void;
}) {
  useZoomTools({
    nav,
    levels: BK_LEVELS,
    nouns: ["zone", "block"],
    openGroup: onOpenZone,
    openGroupMs: ARRIVAL_MS,
    groups: () =>
      sheet.zones.map((zone) => ({
        id: zone.id,
        label: `Zone ${zone.id} · ${zone.span}`,
        count: zone.tables.length,
      })),
    items: (group) =>
      (group === null ? sheet.zones : sheet.zones.filter((z) => z.id === group)).flatMap((zone) =>
        zone.tables.map((t) => ({ id: t.ident, label: `${t.ident} · ${t.name}`, group: zone.id })),
      ),
    detail: () => {
      const { level, group, item } = nav.state.focus;
      if (level === 2) {
        const table = tableOf(sheet, item);
        return table ? dossierRead(table) : { error: `No block ${item}.` };
      }
      if (level === 1) {
        const zone = zoneOf(sheet, group);
        if (!zone) return { error: `No zone ${group}.` };
        return { ...zoneRead(zone), blocks: zone.tables.map(tableRead) };
      }
      return { ...sheetRead(sheet), zones: sheet.zones.map(zoneRead) };
    },
  });

  useWebMCPTool({
    name: "search_blocks",
    // The size of the sheet is read off the sheet, not written down here: a
    // merge or a delete can empty a domain, and a description that teaches a
    // count the dispatcher can compute is a count that goes stale silently.
    description:
      `Search all ${sheet.tableCount} blocks across ${sheet.zones.length} zones at once, at any level, without opening a zone first. Every result carries the zone it lives in, so its id can be passed straight to open_item. Sorted worst first: the blocks a person is waiting on, then the most outstanding deviations. A block awaiting a person is counted separately from its deviations and never folded into them — a rule may repair a deviation, but only a person may settle an identity pair.`,
    parameters: [
      { name: "text", type: "string", description: "Matched against the block's id, name, domain and why-clause" },
      { name: "zone", type: "string", enum: [...ZONE_IDS], description: "One zone, or omit for all four" },
      { name: "deviations_over", type: "number", description: "Only blocks with at least this many outstanding" },
      { name: "coverage_under", type: "number", description: "Only blocks checked this percentage or less" },
      { name: "awaiting_a_person", type: "boolean", description: "Only blocks holding an unadjudicated identity pair" },
    ],
    reversible: true,
    sideEffects: "none",
    handler: (args) => {
      const q: BlocksQuery = {
        ...(args.text === undefined ? {} : { text: String(args.text) }),
        ...(args.zone === undefined ? {} : { zone: String(args.zone) }),
        ...(num(args.deviations_over) === undefined ? {} : { deviations_over: num(args.deviations_over) }),
        ...(num(args.coverage_under) === undefined ? {} : { coverage_under: num(args.coverage_under) }),
        ...(args.awaiting_a_person === undefined
          ? {}
          : { awaiting_a_person: Boolean(args.awaiting_a_person) }),
      };
      return searchBlocks(sheet, q);
    },
  });

  useWebMCPTool({
    name: "search_records",
    description:
      "Find a contact by name, email, company, title or city among the example rows the sheet carries, and get back the block and zone it sits in. Each block sends a sample of its rows rather than all of them, so the result says how many rows it could not see: an absence here is not proof of an absence in the database.",
    parameters: [
      { name: "text", type: "string", required: true, description: "What to look for" },
      { name: "zone", type: "string", enum: [...ZONE_IDS], description: "One zone, or omit for all four" },
    ],
    reversible: true,
    sideEffects: "none",
    handler: ({ text, zone }) =>
      searchRecords(sheet, String(text ?? ""), zone === undefined ? undefined : String(zone)),
  });

  useWebMCPTool({
    name: "show_breakdown",
    description:
      "Open or close the deviation breakdown in the sheet head, which splits the outstanding total into duplicate, conflict, phone and stale. Call with no argument to read whether it is open.",
    parameters: [{ name: "open", type: "boolean", description: "Open it, or close it" }],
    reversible: true,
    sideEffects: "none",
    handler: ({ open }) => {
      if (open === undefined) return { open: showKinds, by_kind: sheetRead(sheet).by_kind };
      setShowKinds(Boolean(open));
      return { ok: true, open: Boolean(open), by_kind: sheetRead(sheet).by_kind };
    },
  });

  return null;
}

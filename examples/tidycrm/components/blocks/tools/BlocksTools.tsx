"use client";

/**
 * The Blocks on WebMCP: the ingest layer for this direction.
 *
 * Four of the tools are the shared ones every three-level direction gets from
 * `useZoomTools` — read the view, open a database, open a table, come back out.
 * The three below are what only this sheet can answer: a search over the tables,
 * a search over the example rows they carry, and the deviation breakdown the
 * sheet head can be asked to show.
 *
 * THE NOUNS MOVED, AND THE TOOL NAMES DID NOT. Round 2 replaced the four
 * lettered zones with nine named databases, so `open_group` now takes `billing`
 * or `crm-eu` where it used to take `A`. The kit builds every description in
 * this layer out of `nouns`, so changing the pair below is what changes what
 * `open_group`'s `id` parameter says it wants — the tool's NAME, its class and
 * its shape are untouched, which is the rule this repo holds tools to.
 *
 * OPENING A DATABASE IS NOT INSTANT HERE, and the tool says so. The picture
 * spends about four hundred milliseconds turning its table dots into the grid,
 * and the arrival takes about as long again, so an agent that called
 * `open_group` and then immediately `read_view` would be reading a level that is
 * still assembling. `open_group` therefore reports the level it is heading to
 * and how long the move takes.
 *
 * NOTHING HERE CHANGES THE DATABASE — the SQLite one, that is. Normalising,
 * flagging, merging and deleting are registered by
 * `components/shell/HostCapabilities.tsx`, where `merge_contacts` and
 * `delete_contacts` come back GATED. This layer looks and moves, so every tool
 * in it is `readOnlyHint` and none is `consequentialHint`.
 */
import { useZoomTools, useWebMCPTool } from "@athena/demo-kit/webmcp";
import type { ZoomNav } from "@athena/demo-kit/zoom";

import { ARRIVAL_MS } from "../beats";
import { BK_LEVELS, DATABASE_IDS, databaseOf, tableOf, type BkSheet } from "../model";
import { databaseRead, dossierRead, sheetRead, tableRead } from "./read";
import { searchBlocks, searchRecords, type BlocksQuery } from "./search";

/*
 * What the four-beat arrival costs is NOT written here any more. It was 2900,
 * typed, beside a clock that said 1960 and tokens that said something else
 * again; it is now derived from `../beats.ts` with the rest of the move, so an
 * agent is told what the sheet will actually do. See that file for the pad.
 */

function num(v: unknown): number | undefined {
  const n = Number(v);
  return v === undefined || v === null || Number.isNaN(n) ? undefined : n;
}

export function BlocksTools({
  sheet,
  nav,
  onOpenDatabase,
  showKinds,
  setShowKinds,
}: {
  sheet: BkSheet;
  nav: ZoomNav;
  /** The same opener a click on a cell uses, so the picture actually flattens. */
  onOpenDatabase: (id: string) => void;
  showKinds: boolean;
  setShowKinds: (next: boolean) => void;
}) {
  useZoomTools({
    nav,
    levels: BK_LEVELS,
    nouns: ["database", "table"],
    openGroup: onOpenDatabase,
    openGroupMs: ARRIVAL_MS,
    groups: () =>
      sheet.databases.map((db) => ({
        id: db.id,
        label: `${db.name} · ${db.blurb}`,
        count: db.tables.length,
      })),
    items: (group) =>
      (group === null ? sheet.databases : sheet.databases.filter((d) => d.id === group)).flatMap(
        (db) => db.tables.map((t) => ({ id: t.ident, label: `${t.ident} · ${t.name}`, group: db.id })),
      ),
    detail: () => {
      const { level, group, item } = nav.state.focus;
      if (level === 2) {
        const table = tableOf(sheet, item);
        return table ? dossierRead(table) : { error: `No table ${item}.` };
      }
      if (level === 1) {
        const db = databaseOf(sheet, group);
        if (!db) return { error: `No database ${group}.` };
        return { ...databaseRead(db), tables: db.tables.map(tableRead) };
      }
      return { ...sheetRead(sheet), databases: sheet.databases.map(databaseRead) };
    },
  });

  useWebMCPTool({
    name: "search_blocks",
    // The size of the sheet is read off the sheet, not written down here: a
    // merge or a delete can empty a domain, and a description that teaches a
    // count the dispatcher can compute is a count that goes stale silently.
    description:
      `Search all ${sheet.tableCount} tables across ${sheet.databases.length} databases at once, at any level, without opening a database first. Every result carries the database it lives in, so its id can be passed straight to open_item. Sorted worst first: the tables a person is waiting on, then the most outstanding deviations. A table awaiting a person is counted separately from its deviations and never folded into them — a rule may repair a deviation, but only a person may settle an identity pair.`,
    parameters: [
      { name: "text", type: "string", description: "Matched against the table's id, name, domain and why-clause" },
      {
        name: "database",
        type: "string",
        enum: [...DATABASE_IDS],
        description: "One database, or omit for all nine",
      },
      { name: "deviations_over", type: "number", description: "Only tables with at least this many outstanding" },
      { name: "coverage_under", type: "number", description: "Only tables checked this percentage or less" },
      { name: "awaiting_a_person", type: "boolean", description: "Only tables holding an unadjudicated identity pair" },
    ],
    reversible: true,
    sideEffects: "none",
    handler: (args) => {
      const q: BlocksQuery = {
        ...(args.text === undefined ? {} : { text: String(args.text) }),
        ...(args.database === undefined ? {} : { database: String(args.database) }),
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
      "Find a contact by name, email, company, title or city among the example rows the sheet carries, and get back the table and database it sits in. Each table sends a sample of its rows rather than all of them, so the result says how many rows it could not see: an absence here is not proof of an absence in the database.",
    parameters: [
      { name: "text", type: "string", required: true, description: "What to look for" },
      {
        name: "database",
        type: "string",
        enum: [...DATABASE_IDS],
        description: "One database, or omit for all nine",
      },
    ],
    reversible: true,
    sideEffects: "none",
    handler: ({ text, database }) =>
      searchRecords(sheet, String(text ?? ""), database === undefined ? undefined : String(database)),
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

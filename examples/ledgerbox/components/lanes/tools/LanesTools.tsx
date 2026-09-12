"use client";

/**
 * The Lanes on WebMCP: the ingest layer for this direction.
 *
 * Four of the tools are the shared ones every three-level direction gets from
 * `useZoomTools` — read the view, open an area, open an invoice, come back out.
 * The two below are what only the books can answer: a search across all 124
 * invoices at once, and the filter the swarm is actually lit by.
 *
 * NOTHING HERE CHANGES THE BOOKS. Recording a payment, sending a reminder and
 * voiding an invoice are registered beside this file by `BooksTools.tsx`, where
 * they carry their gates. This layer looks and moves, which is why every tool
 * in it is `readOnlyHint` and none is `consequentialHint`: an agent that has
 * only this layer can read the whole practice and change nothing in it.
 *
 * The two files are mounted TOGETHER on the one shipped route and their union
 * is `lib/manifest.ts`, which is where the parameters below come from and where
 * the foot's register reads the class of each. There is no name collision: the
 * verbs here move the view, the verbs there move the money.
 */
import { useZoomTools, useWebMCPTool } from "@athena/demo-kit/webmcp";
import type { ZoomNav } from "@athena/demo-kit/zoom";

import { registration } from "@/lib/manifest";

import {
  laneById,
  markById,
  type LnFilter,
  type LnSheet,
} from "../model";
import { detailRead, laneRead, markRead, totalsRead } from "./read";
import { filterState, searchLanes, type LanesQuery } from "./search";

const LEVELS = ["The books", "One area", "One invoice"] as const;

function num(v: unknown): number | undefined {
  const n = Number(v);
  return v === undefined || v === null || Number.isNaN(n) ? undefined : n;
}

export function LanesTools({
  sheet,
  nav,
  filter,
  setFilter,
}: {
  sheet: LnSheet;
  nav: ZoomNav;
  filter: LnFilter;
  setFilter: (next: LnFilter) => void;
}) {
  useZoomTools({
    nav,
    levels: LEVELS,
    nouns: ["area", "invoice"],
    groups: () =>
      sheet.lanes.map((lane) => ({ id: lane.id, label: lane.label, count: lane.count })),
    items: (group) =>
      (group === null ? sheet.lanes : sheet.lanes.filter((l) => l.id === group)).flatMap((lane) =>
        lane.marks.map((m) => ({ id: m.id, label: `${m.number} · ${m.clientName}`, group: lane.id })),
      ),
    detail: () => {
      const { level, group, item } = nav.state.focus;
      if (level === 2) {
        const mark = markById(sheet, item);
        return mark ? detailRead(sheet, mark) : { error: `No invoice ${item}.` };
      }
      if (level === 1) {
        const lane = laneById(sheet, group);
        if (!lane) return { error: `No area ${group}.` };
        return { ...laneRead(lane), invoices: lane.marks.map(markRead) };
      }
      return { ...totalsRead(sheet), areas: sheet.lanes.map(laneRead) };
    },
  });

  useWebMCPTool({
    name: "search_invoices",
    description:
      "Search every invoice in the books at once, at any level, without opening an area first. Every result carries the area it lives in, so its id can be passed straight to open_item. Sorted worst first: most days overdue, then most money still owed.",
    ...registration("search_invoices"),
    handler: (args) => {
      const q: LanesQuery = {
        ...(args.text === undefined ? {} : { text: String(args.text) }),
        ...(args.area === undefined ? {} : { area: String(args.area) }),
        ...(args.state === undefined ? {} : { state: String(args.state) }),
        ...(num(args.overdue_by) === undefined ? {} : { overdue_by: num(args.overdue_by) }),
        ...(num(args.balance_over) === undefined ? {} : { balance_over: num(args.balance_over) }),
        ...(args.unmatched === undefined ? {} : { unmatched: Boolean(args.unmatched) }),
      };
      return searchLanes(sheet, q);
    },
  });

  useWebMCPTool({
    name: "set_filter",
    description:
      "Light a subset of the swarm by state, by client, or both. This dims rather than removes: every invoice stays on the sheet. Call with no arguments to read the filter without changing it.",
    ...registration("set_filter"),
    handler: ({ state, client }) => {
      if (state === undefined && client === undefined) return filterState(sheet, filter);
      const next: LnFilter = {
        state: state === undefined ? filter.state : (String(state) as LnFilter["state"]),
        client: client === undefined ? filter.client : String(client),
      };
      if (next.client !== "all" && !sheet.clients.some((c) => c.id === next.client)) {
        return {
          ok: false,
          error: `No client with id ${next.client}.`,
          clients: sheet.clients.map((c) => ({ id: c.id, name: c.name, invoices: c.count })),
        };
      }
      setFilter(next);
      return { ok: true, ...filterState(sheet, next) };
    },
  });

  return null;
}

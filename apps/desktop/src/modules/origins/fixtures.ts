/**
 * The Origins module's fixtures — view-models, no store, no shell.
 *
 * `degraded` is this module's own degradation and not "some fields are empty": the `origins`
 * table could not be read, so the page can show nothing and change nothing, and it says so with
 * the store's own reason. `heavy` is twelve origins because the table's whole design question is
 * whether twelve rows and their two date columns still sit inside one fold — and because the
 * detail rail has to be checked against an origin whose page is *not* open, which is the state
 * every row but one is in at any moment.
 */
import type { OriginRow as StoredOrigin, ToolClass } from "@/lib/store";
import type { ToolRow } from "@/stores/run";

import { INERT_ACTIONS, selectOrigins, type OriginsModel, type OriginsSources } from "./model";

function stored(
  origin: string,
  over: Partial<Omit<StoredOrigin, "origin">> = {},
): StoredOrigin {
  return {
    origin,
    enabled: true,
    overrides: {},
    first_seen: "2026-02-11T09:14:02Z",
    last_seen: "2026-03-04T18:20:41Z",
    ...over,
  };
}

const INVOICES = "https://invoices.example.test";
const SUPPORT = "https://support.example.test";

function tool(
  name: string,
  declaredCls: ToolClass,
  over: Partial<ToolRow> = {},
): ToolRow {
  return {
    name,
    origin: INVOICES,
    description: "",
    tier: 1,
    declaredCls,
    overrideCls: null,
    effectiveCls: declaredCls,
    transport: "webmcp-polyfill",
    ...over,
  };
}

/** The page in front of the user: three of its own tools and two of the shell's hands. */
const LIVE_TOOLS: ToolRow[] = [
  tool("list_invoices", "READ"),
  tool("open_invoice", "AUTO"),
  tool("send_reminder", "GATED"),
  tool("page_read", "GATED", { tier: 2, transport: "shell" }),
  tool("page_fill", "GATED", { tier: 2, transport: "shell" }),
];

function model(over: Partial<OriginsSources> = {}): OriginsModel {
  return selectOrigins({
    known: [INVOICES, SUPPORT],
    records: {
      [INVOICES]: stored(INVOICES, { overrides: { open_invoice: "GATED" } }),
      [SUPPORT]: stored(SUPPORT, { enabled: false, last_seen: "2026-03-01T11:02:00Z" }),
    },
    loaded: true,
    problem: null,
    tools: LIVE_TOOLS,
    currentOrigin: INVOICES,
    selected: null,
    actions: INERT_ACTIONS,
    ...over,
  });
}

/** One tick after mount: the table has answered and holds nothing. */
const empty = model({ known: [], records: {}, tools: [], currentOrigin: null });

const typical = model({ selected: INVOICES });

/** Twelve origins, and the open one is a page that is *not* in front of the user. */
const heavy = (() => {
  const hosts = Array.from({ length: 12 }, (_, i) => `https://app-${i + 1}.example.test`);
  const records: Record<string, StoredOrigin> = {};
  hosts.forEach((origin, i) => {
    const overrides: Record<string, ToolClass> = {};
    if (i % 3 === 0) overrides.page_fill = "GATED";
    if (i % 4 === 0) overrides.export_all = "GATED";
    // One row carries a ruling the page has since overtaken: stored AUTO under a tool the
    // manifest now declares GATED. The gate ignores it and the detail says so.
    if (i === 1) overrides.send_reminder = "AUTO";
    records[origin] = stored(origin, {
      enabled: i % 2 === 0,
      overrides,
      first_seen: `2026-0${(i % 3) + 1}-0${(i % 9) + 1}T08:00:00Z`,
      last_seen: `2026-03-${String((i % 28) + 1).padStart(2, "0")}T19:40:00Z`,
    });
  });
  return selectOrigins({
    known: hosts,
    records,
    loaded: true,
    problem: null,
    tools: LIVE_TOOLS.map((t) => ({ ...t, origin: hosts[1] })),
    currentOrigin: hosts[1],
    selected: hosts[1],
    actions: INERT_ACTIONS,
  });
})();

/** The store could not be read. Nothing can be shown and nothing could be saved. */
const degraded = model({
  known: [],
  records: {},
  tools: [],
  loaded: true,
  problem: "store_unavailable",
  currentOrigin: null,
});

/**
 * The commoner half of a degraded page: the table is fine, and the origin the user opened is one
 * whose page is not in a tab — so no declared class is known and its rulings can only be cleared.
 */
const noPage = model({ tools: [], currentOrigin: null, selected: INVOICES });

export const fixtures: Record<string, OriginsModel> = {
  empty,
  typical,
  heavy,
  degraded,
  "no-page": noPage,
};

export const fixtureIds = ["empty", "typical", "heavy", "degraded", "no-page"] as const;

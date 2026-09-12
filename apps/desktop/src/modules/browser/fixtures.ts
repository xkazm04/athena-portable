/**
 * The Browser module's fixtures — view-models, no store, no shell.
 *
 * `heavy` is twelve tabs and nine apps because the tab rail's whole design question is what
 * happens when the chips stop fitting (it scrolls; it does not squeeze) and the ledger's is what
 * a long table of mixed standings reads like. `degraded` is the shell not having answered — the
 * one failure this module has before a daemon exists — and `apps-unread` is the other: the
 * origins table refused, while the tabs are fine.
 */
import type { OriginRow } from "@/lib/store";
import type { Tab } from "@/lib/ipc";
import type { TabTools } from "@/stores/tools";

import {
  selectBrowser,
  type BrowserActions,
  type BrowserModel,
  type BrowserTab,
  type BrowserTools,
  type OriginsSnapshot,
} from "./model";

/** A fixture acts on nothing. Wiring an action to a store is the selector's job, never a
 *  fixture's — that is what makes a preview safe to click. */
const INERT: BrowserActions = {
  open: () => {},
  focus: () => {},
  close: () => {},
  navigate: () => {},
  register: () => {},
  openApp: () => {},
  setEnabled: () => {},
  forget: () => {},
};

function tab(id: number, title: string, url: string, focused = false): Tab {
  return { id, label: `page-${id}`, title, url, focused };
}

function origin(
  url: string,
  over: Partial<OriginRow> = {},
): OriginRow {
  return {
    origin: url,
    enabled: true,
    overrides: {},
    first_seen: "2026-09-01T09:00:00.000Z",
    last_seen: new Date(Date.now() - 1000 * 60 * 42).toISOString(),
    ...over,
  };
}

function answered(tabId: number, url: string, count: number, transport = "webmcp-polyfill"): TabTools {
  return {
    tabId,
    url,
    tools: Array.from({ length: count }, (_, i) => ({
      name: `tool_${i + 1}`,
      title: null,
      description: "",
      inputSchema: {},
      annotations: null,
      athena: null,
    })),
    transport,
    appId: null,
    appVersion: null,
    problem: null,
    asking: false,
  };
}

function silent(tabId: number, url: string): TabTools {
  return { ...answered(tabId, url, 0), transport: null, problem: "timeout" };
}

function snapshot(rows: OriginRow[], problem: string | null = null, loaded = true): OriginsSnapshot {
  return {
    records: Object.fromEntries(rows.map((r) => [r.origin, r])),
    known: rows.map((r) => r.origin),
    loaded,
    problem,
  };
}

const TYPICAL_TABS: Tab[] = [
  tab(1, "Invoices — March", "http://localhost:3004/invoices", true),
  tab(2, "Athena — the gate in one page", "https://example.test/docs/gate"),
  tab(3, "about:blank", "http://example.test/blank"),
];

const TYPICAL_TOOLS: Record<number, TabTools> = {
  1: answered(1, "http://localhost:3004/invoices", 3),
  2: silent(2, "https://example.test/docs/gate"),
};

const TYPICAL_APPS: OriginRow[] = [
  origin("http://localhost:3004", { overrides: { pay: "GATED" } }),
  origin("https://example.test"),
  origin("https://crm.example.test", {
    enabled: false,
    last_seen: "2026-08-20T14:12:00.000Z",
  }),
];

const HEAVY_TABS: Tab[] = Array.from({ length: 12 }, (_, i) =>
  tab(
    i + 1,
    i % 3 === 0
      ? `A title long enough that the chip has to elide it — number ${i + 1}`
      : `Tab ${i + 1}`,
    `https://host-${i + 1}.example.test/a/path/that/is/not/short?page=${i + 1}`,
    i === 4,
  ),
);

const HEAVY_TOOLS: Record<number, TabTools> = Object.fromEntries(
  HEAVY_TABS.map((t, i) => [
    t.id,
    i % 4 === 0
      ? answered(t.id, t.url, 7 + i, "webmcp-native")
      : i % 4 === 1
        ? silent(t.id, t.url)
        : i % 4 === 2
          ? { ...answered(t.id, t.url, 0), asking: true }
          : answered(t.id, t.url, 2),
  ]),
);

const HEAVY_APPS: OriginRow[] = [
  ...HEAVY_TABS.slice(0, 6).map((t, i) =>
    origin(new URL(t.url).origin, {
      enabled: i !== 3,
      overrides: i === 0 ? { pay: "GATED", export: "GATED", merge: "READ" } : {},
      last_seen: new Date(Date.now() - 1000 * 60 * 60 * (i + 1) * 5).toISOString(),
    }),
  ),
  origin("https://a-very-long-subdomain-of-an-enterprise-application.corp.example.test"),
  origin("https://mail.example.test", { last_seen: "" }),
  origin("https://notes.example.test", { enabled: false }),
];

/** The page answered: three tools over the polyfill, which is what the scratch page registers. */
const REGISTERED: BrowserTools = {
  count: 3,
  transport: "webmcp-polyfill",
  problem: null,
  asking: false,
};

/** The page has no bridge, so nothing ever answered and the relay's own timer said so. A page
 *  with zero tools is the ordinary case (ADR 0008), not a broken shell. */
const NO_BRIDGE: BrowserTools = {
  count: 0,
  transport: null,
  problem: "timeout",
  asking: false,
};

/** A model whose focused-tab tools are pinned to a given block, for the two strip fixtures. */
function withTools(model: BrowserModel, tools: BrowserTools): BrowserModel {
  return { ...model, tools: model.focused ? tools : null };
}

const typical = selectBrowser(TYPICAL_TABS, true, TYPICAL_TOOLS, INERT, snapshot(TYPICAL_APPS));

export const fixtures: Record<string, BrowserModel> = {
  empty: selectBrowser([], true, {}, INERT, snapshot([])),
  typical: withTools(typical, REGISTERED),
  heavy: selectBrowser(HEAVY_TABS, true, HEAVY_TOOLS, INERT, snapshot(HEAVY_APPS)),
  degraded: selectBrowser([], false, {}, INERT, snapshot([], null, false)),
  // The other degradation this module has, and the commoner one by far: the tab list is fine and
  // the page in it has nothing to say. Every real site starts here.
  "no-bridge": withTools(typical, NO_BRIDGE),
  // The origins table refused: the tabs are fine, the ledger says so in the store's own words.
  "apps-unread": selectBrowser(
    TYPICAL_TABS,
    true,
    TYPICAL_TOOLS,
    INERT,
    snapshot([], "store_list: origins: database is locked"),
  ),
};

export const fixtureIds = ["empty", "typical", "heavy", "degraded", "no-bridge", "apps-unread"] as const;

export type { BrowserTab };

/**
 * One trust verdict per tab (ADR 0105 amendment, ADR 0106, ADR 0065): every reader of the origins
 * table - the gate's lists, `open_apps`, `tabs_read`, the contract check and an enable's accepted
 * contracts - asks `trustOf` and folds the one answer its own way, so no two of them can disagree on
 * a row combination again.
 *
 * The shell is mocked at `@tauri-apps/api/core`, as `contracts.test.ts` does, for the one case that
 * drives the real origins store (`setEnabled` on a catalog-form row).
 */
import { beforeEach, describe, expect, test, vi } from "vitest";

import type { BridgeTool } from "@/lib/bridge";
import type { Tab } from "@/lib/ipc";
import { derivedIdOf } from "@/lib/manifest";
import type { OriginRow } from "@/lib/store";
import type { TabTools } from "@/stores/tools";

const harness = vi.hoisted(() => ({ rows: new Map<string, unknown>() }));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(async (command: string, args: Record<string, unknown> = {}) => {
    const key = `${String(args.table)}/${String(args.key)}`;
    if (command === "store_get") return harness.rows.has(key) ? harness.rows.get(key) : null;
    if (command === "store_set") {
      harness.rows.set(key, args.value);
      return String(args.key);
    }
    if (command === "store_list") {
      const rows = [...harness.rows.entries()]
        .filter(([k]) => k.startsWith(`${String(args.table)}/`))
        .map(([k, v]) => ({ ...(v as object), origin: k.slice(String(args.table).length + 1) }));
      return { rows, showing: rows.length, total: rows.length };
    }
    if (command === "store_delete") {
      harness.rows.delete(key);
      return null;
    }
    throw new Error(`no fake for ${command}`);
  }),
}));

globalThis.window = { __TAURI_INTERNALS__: {} } as unknown as Window & typeof globalThis;

const trust = await import("./trust");
const { contractDriftsOf, disabledOriginsOf, gatedListsOf, openTabOf, trustedAppOf } = await import("./run");
const { useOrigins } = await import("./origins");
const { useTabs } = await import("./tabs");
const { useTools } = await import("./tools");

type Table = import("./trust").TrustTable;

const BANK = "https://bank.test";
const BANK_URL = `${BANK}/statements/2026-09`;
const DERIVED = derivedIdOf(BANK)!;
const HOST = `host:${DERIVED}`;
const CLAIMED = "bankapp";

const TAB: Tab = { id: 2, label: "page-2", url: BANK_URL, title: "Statement", focused: false, nav: 0 };

function tool(name: string): BridgeTool {
  return { name, title: name, description: `${name}.`, inputSchema: { type: "object" }, annotations: null, athena: { reversible: true, side_effects: "none" } };
}

/** The tools store's answer for the bank tab: its own slug when it claims one, else none (derived). */
function byTabOf(appId: string | null): Record<number, TabTools> {
  return {
    [TAB.id]: { tabId: TAB.id, url: BANK_URL, tools: [tool("transfer")], transport: "webmcp-native", appId, appVersion: "1", problem: null, asking: false },
  };
}

const row = (origin: string, enabled: boolean): OriginRow => ({ origin, enabled, overrides: {}, first_seen: "", last_seen: "" });

/** A loaded table holding exactly these rows, every one of them known. */
function table(rows: Record<string, boolean>, over: Partial<Table> = {}): Table {
  const records = Object.fromEntries(Object.entries(rows).map(([k, on]) => [k, row(k, on)]));
  return { records, known: Object.keys(records), loaded: true, problem: null, contracts: {}, ...over };
}

interface Case {
  name: string;
  table: Table;
  appId: string | null;
  state: "unread" | "first-sight" | "trusted" | "off";
  /** The gate's lists as they stood before the fold (guard): gated_origins, gated_tools, disabled. */
  lists: [string[], string[], string[]];
}

const T = `host.${DERIVED}.transfer`;
const X = `host:${CLAIMED}`;

const MATRIX: Case[] = [
  { name: "no rows", table: table({}), appId: null, state: "first-sight", lists: [[HOST], [], []] },
  { name: "web-origin row enabled", table: table({ [BANK]: true }), appId: null, state: "trusted", lists: [[], [T], []] },
  { name: "web-origin row off", table: table({ [BANK]: false }), appId: null, state: "off", lists: [[], [], [HOST]] },
  { name: "host:<derived> enabled, no web row", table: table({ [HOST]: true }), appId: null, state: "trusted", lists: [[], [T], []] },
  { name: "host:<derived> off", table: table({ [HOST]: false }), appId: null, state: "off", lists: [[], [], [HOST]] },
  { name: "web row enabled + host:<derived> off", table: table({ [BANK]: true, [HOST]: false }), appId: null, state: "off", lists: [[], [], [HOST]] },
  { name: "claims slug X, host:X enabled, no web row", table: table({ [`host:${CLAIMED}`]: true }), appId: CLAIMED, state: "first-sight", lists: [[X], [], []] },
  { name: "claims slug X, host:X off, web row enabled", table: table({ [BANK]: true, [`host:${CLAIMED}`]: false }), appId: CLAIMED, state: "off", lists: [[], [], [X]] },
  { name: "loaded:false", table: table({ [BANK]: true }, { loaded: false }), appId: null, state: "unread", lists: [[HOST], [], []] },
  { name: "problem set", table: table({ [BANK]: true }, { problem: "disk on fire" }), appId: null, state: "unread", lists: [[HOST], [], []] },
];

describe("trustOf: one verdict per tab", () => {
  test.each(MATRIX)("$name -> $state", ({ table: t, appId, state }) => {
    const verdict = trust.trustOf(t, TAB, byTabOf(appId));
    expect(verdict.state).toBe(state);
    expect(verdict.app).toBe(appId ?? DERIVED);
  });
});

describe("tabs_read refuses an app switched off by its catalog-form row", () => {
  test("openTabOf: web row enabled, host:<derived> off -> not trusted", () => {
    const t = table({ [BANK]: true, [HOST]: false });
    expect(openTabOf(BANK_URL, [TAB], {}, t)?.trusted).toBe(false);
  });
});

describe("tabs_read keeps the web-origin rule: the fold tightens it and never loosens it", () => {
  test("host:<derived> enabled, no web row -> offered as an open_app, still not read", () => {
    const t = table({ [HOST]: true });
    expect(trust.readFold(trust.trustOf(t, TAB, {}))).toBe(false);
    expect(openTabOf(BANK_URL, [TAB], {}, t)?.trusted).toBe(false);
    expect(trustedAppOf(t, TAB, {})).toBe(DERIVED);
  });
});

describe("parity: every trust reader agrees on every row combination", () => {
  test.each(MATRIX)("$name", ({ table: t, appId }) => {
    const byTab = byTabOf(appId);
    const read = openTabOf(BANK_URL, [TAB], byTab, t)!.trusted;
    const offered = trustedAppOf(t, TAB, byTab) !== null;
    // No accepted contract: a trusted tab's every tool drifts, so a non-empty answer means it was read.
    const drifted = Object.keys(contractDriftsOf(t, [TAB], byTab)).length > 0;
    // tabs_read refuses everything open_apps refuses, never the reverse: it trusts the web-origin row
    // alone (ADR 0105 section 3), so a tab trusted only by its catalog-form row is offered but not read.
    if (read) expect(offered).toBe(true);
    expect(drifted).toBe(offered);
    if (offered) {
      const app = `host:${appId ?? DERIVED}`;
      expect(disabledOriginsOf(t.records, [TAB], byTab)).not.toContain(app);
      expect(gatedListsOf(t, [TAB], byTab).gated_origins).not.toContain(app);
    }
  });

  test("a switched-off row held in records but not yet in known still refuses (records and known read as one table)", () => {
    const t: Table = { records: { [BANK]: row(BANK, true), [HOST]: row(HOST, false) }, known: [BANK], loaded: true, problem: null };
    expect(disabledOriginsOf(t.records, [TAB], {})).toContain(HOST);
    expect(trustedAppOf(t, TAB, {})).toBeNull();
    expect(openTabOf(BANK_URL, [TAB], {}, t)?.trusted).toBe(false);
  });
});

describe("each fold names its unread arm", () => {
  const unread = table({ [BANK]: true, [HOST]: false }, { loaded: false });
  const verdict = () => trust.trustOf(unread, TAB, byTabOf(null));

  test("firstSightFold: an unread table counts the app first sight (fail closed)", () => {
    expect(trust.firstSightFold(verdict())).toBe(true);
    expect(gatedListsOf(unread, [TAB], byTabOf(null)).gated_origins).toEqual([HOST]);
  });

  test("trustFold: an unread table trusts nothing", () => {
    expect(trust.trustFold(verdict())).toBe(false);
    expect(trustedAppOf(unread, TAB, byTabOf(null))).toBeNull();
    expect(openTabOf(BANK_URL, [TAB], {}, unread)?.trusted).toBe(false);
    expect(contractDriftsOf(unread, [TAB], byTabOf(null))).toEqual({});
  });

  test("offRowsOf: an unread table still lists every switched-off row it holds", () => {
    expect(trust.offRowsOf(unread.records)).toEqual([HOST]);
    expect(disabledOriginsOf(unread.records, [TAB], byTabOf(null))).toEqual([HOST]);
  });
});

describe("guard: the gate's lists are unchanged by the fold", () => {
  test.each(MATRIX)("$name", ({ table: t, appId, lists: [origins, tools, disabled] }) => {
    const byTab = byTabOf(appId);
    expect(gatedListsOf(t, [TAB], byTab)).toEqual({ gated_origins: origins, gated_tools: tools });
    expect(disabledOriginsOf(t.records, [TAB], byTab)).toEqual(disabled);
  });
});

describe("guard: a catalog-form row accepts the contracts of its own derived tab only", () => {
  beforeEach(async () => {
    harness.rows.clear();
    useOrigins.setState({ records: {}, known: [], loaded: false, problem: null, contracts: {} });
    await useOrigins.getState().loadAll();
  });

  function show(appId: string | null): void {
    useTabs.setState({ tabs: [{ ...TAB }] } as never);
    useTools.setState({ byTab: byTabOf(appId) });
  }

  test("setEnabled(host:<derived>) accepts the tab whose derived id it is", async () => {
    show(null);
    await useOrigins.getState().setEnabled(HOST, true);
    expect(Object.keys(useOrigins.getState().contracts[BANK] ?? {})).toEqual(["transfer"]);
  });

  test("setEnabled(host:X) does not accept a tab that merely claims X", async () => {
    show(CLAIMED);
    await useOrigins.getState().setEnabled(`host:${CLAIMED}`, true);
    expect(useOrigins.getState().contracts[BANK]).toBeUndefined();
  });
});

/**
 * The Browser module's selector — the store snapshot in, the view-model out.
 *
 * The selector is where every fact the surface shows is decided, so it is where they are
 * asserted: which tab is focused, what a tab with no title is called, and the difference between
 * "no tabs are open" and "nobody has answered yet" — a distinction the view renders two different
 * ways and the first build collapsed into one empty list.
 */
import { expect, test, vi } from "vitest";

import type { Tab } from "@/lib/ipc";
import type { TabTools } from "@/stores/tools";

import type { OriginRow } from "@/lib/store";

import { appOf, monogramOf, selectBrowser, tabOn, type BrowserActions, type OriginsSnapshot } from "./model";

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

/** No tab has been asked yet. The commonest snapshot: the shell answers `tabs_list` first. */
const UNASKED: Record<number, TabTools> = {};

function tab(id: number, url: string, title = "", focused = false): Tab {
  return { id, label: `page-${id}`, url, title, focused };
}

function registered(id: number, names: string[], transport = "webmcp-polyfill"): TabTools {
  return {
    tabId: id,
    url: `https://tab-${id}.test/`,
    tools: names.map((name) => ({
      name,
      title: null,
      description: "",
      inputSchema: {},
      annotations: null,
      athena: null,
    })),
    transport,
    appId: null,
    problem: null,
    asking: false,
  };
}

test("the focused tab is the one Rust marked, and there is at most one", () => {
  const model = selectBrowser(
    [tab(1, "https://a.test/"), tab(2, "https://b.test/x", "B", true), tab(3, "https://c.test/")],
    true,
    UNASKED,
    INERT,
  );
  expect(model.tabs).toHaveLength(3);
  expect(model.focused?.id).toBe(2);
  expect(model.tabs.filter((t) => t.focused)).toHaveLength(1);
});

test("a tab with no title is called by its address, and every tab carries its host", () => {
  const model = selectBrowser([tab(1, "http://localhost:3004/invoices")], true, UNASKED, INERT);
  expect(model.tabs[0].title).toBe("http://localhost:3004/invoices");
  expect(model.tabs[0].host).toBe("localhost:3004");
});

test("no tabs is not the same fact as no answer", () => {
  const answered = selectBrowser([], true, UNASKED, INERT);
  expect(answered.focused).toBeNull();
  expect(answered.problem).toBeNull();

  const unanswered = selectBrowser([], false, UNASKED, INERT);
  expect(unanswered.problem).toBe("the shell has not answered tabs_list yet");
});

test("the actions are the view's only route out, and they are passed through untouched", () => {
  const actions: BrowserActions = {
    ...INERT,
    open: vi.fn(),
    focus: vi.fn(),
    close: vi.fn(),
    navigate: vi.fn(),
  };
  const model = selectBrowser([tab(1, "https://a.test/")], true, UNASKED, actions);
  model.actions.focus(1);
  model.actions.close(1);
  expect(actions.focus).toHaveBeenCalledWith(1);
  expect(actions.close).toHaveBeenCalledWith(1);
});

test("the tools are the focused tab's, and no tab focused is no tool block at all", () => {
  const byTab = { 1: registered(1, ["invoice_list"]), 2: registered(2, ["a", "b", "c"], "webmcp-native") };

  const first = selectBrowser([tab(1, "https://a.test/", "", true), tab(2, "https://b.test/")], true, byTab, INERT);
  expect(first.tools).toEqual({ count: 1, transport: "webmcp-polyfill", problem: null, asking: false });

  const second = selectBrowser([tab(1, "https://a.test/"), tab(2, "https://b.test/", "", true)], true, byTab, INERT);
  expect(second.tools).toEqual({ count: 3, transport: "webmcp-native", problem: null, asking: false });

  expect(selectBrowser([tab(1, "https://a.test/")], true, byTab, INERT).tools).toBeNull();
});

test("a tab nobody has asked about yet is asking, and is not a page with no tools", () => {
  const unasked = selectBrowser([tab(1, "https://a.test/", "", true)], true, UNASKED, INERT);
  expect(unasked.tools).toEqual({ count: 0, transport: null, problem: null, asking: true });

  const silent = selectBrowser([tab(1, "https://a.test/", "", true)], true, {
    1: { ...registered(1, []), problem: "timeout" },
  }, INERT);
  expect(silent.tools).toEqual({ count: 0, transport: "webmcp-polyfill", problem: "timeout", asking: false });
});


// -- the registered apps ---------------------------------------------------------------------

function row(origin: string, over: Partial<OriginRow> = {}): OriginRow {
  return {
    origin,
    enabled: true,
    overrides: {},
    first_seen: "2026-09-01T00:00:00Z",
    last_seen: "2026-09-12T00:00:00Z",
    ...over,
  };
}

function snapshot(rows: OriginRow[], problem: string | null = null, loaded = true): OriginsSnapshot {
  return {
    records: Object.fromEntries(rows.map((r) => [r.origin, r])),
    known: rows.map((r) => r.origin),
    loaded,
    problem,
  };
}

test("an app's standing is a fact about the tabs and the relay, in order of what is known", () => {
  const tabs = [tab(1, "https://a.test/invoices", "A", true), tab(2, "https://b.test/")];
  const byTab = { 1: registered(1, ["x", "y"], "webmcp-native"), 2: { ...registered(2, []), problem: "timeout" } };

  expect(appOf(row("https://a.test"), tabs, byTab)).toMatchObject({
    standing: "ready",
    summary: "2 tools over webmcp-native",
    tabId: 1,
    host: "a.test",
  });
  expect(appOf(row("https://b.test"), tabs, byTab)).toMatchObject({ standing: "hands", tabId: 2 });
  expect(appOf(row("https://c.test"), tabs, byTab)).toMatchObject({ standing: "closed", tabId: null, summary: "not opened" });
  // Open, but the relay has not answered: reading, not "no tools".
  expect(appOf(row("https://a.test"), tabs, {})).toMatchObject({ standing: "reading" });
  // Switched off outranks everything else: nothing runs there whatever the page offers.
  expect(appOf(row("https://a.test", { enabled: false }), tabs, byTab)).toMatchObject({ standing: "disabled" });
});

test("the overrides are counted, and a row the store never stamped has no last-seen", () => {
  const app = appOf(row("https://a.test", { overrides: { pay: "GATED", chase: "AUTO" }, last_seen: "" }), [], {});
  expect(app.overrides).toBe(2);
  expect(app.lastSeen).toBe("");
});

test("the apps come in the order the table answered, and a problem is carried verbatim", () => {
  const rows = [row("https://b.test"), row("https://a.test")];
  const model = selectBrowser([], true, UNASKED, INERT, snapshot(rows));
  expect(model.apps.map((a) => a.origin)).toEqual(["https://b.test", "https://a.test"]);
  expect(model.appsLoaded).toBe(true);
  expect(model.appsProblem).toBeNull();

  const refused = selectBrowser([], true, UNASKED, INERT, snapshot([], "database is locked"));
  expect(refused.apps).toEqual([]);
  expect(refused.appsProblem).toBe("database is locked");

  // No snapshot at all is "nobody has asked", not "no apps".
  expect(selectBrowser([], true, UNASKED, INERT).appsLoaded).toBe(false);
});

test("the tab on an origin is the focused one when several are, by origin and not by page", () => {
  const tabs = [tab(1, "https://a.test/one"), tab(2, "https://a.test/two", "", true), tab(3, "https://b.test/")];
  expect(tabOn("https://a.test", tabs)?.id).toBe(2);
  expect(tabOn("https://c.test", tabs)).toBeNull();
  expect(tabOn("https://b.test", [tab(3, "https://b.test/x")])?.id).toBe(3);
});

test("the tile letter is the host's first, past www, and a host with none gets a mark", () => {
  expect(monogramOf("ledgerbox.local")).toBe("L");
  expect(monogramOf("www.example.test")).toBe("E");
  expect(monogramOf("127.0.0.1:3004")).toBe("1");
  expect(monogramOf("")).toBe("?");
});

test("the tools cell is filled only by a page that answered with tools", () => {
  const row: OriginRow = {
    origin: "https://tab-1.test",
    enabled: true,
    overrides: {},
    first_seen: "",
    last_seen: "",
  };
  const open = [tab(1, "https://tab-1.test/x", "", true)];
  expect(appOf(row, open, UNASKED).tools).toBeNull();
  expect(appOf(row, open, { 1: registered(1, ["a", "b"], "webmcp-native") }).tools).toEqual({
    count: 2,
    transport: "webmcp-native",
  });
  expect(appOf(row, [], UNASKED).monogram).toBe("T");
});

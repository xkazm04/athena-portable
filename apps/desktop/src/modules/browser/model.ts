/**
 * The Browser module's view-model — README section 3.5, "the browser is one module among them".
 *
 * Two lists and the rectangle between them. The **tabs** are what is open now; the **registered
 * apps** are the origins the user has told Athena about (the `origins` table, README section
 * 3.3), whether or not one is open. The page itself is not in here and never will be — it is a
 * webview the Rust side positions under the chrome (`src-tauri/src/layout.rs`), so the module
 * renders a rectangle it does not paint.
 *
 * **An app's standing is derived, never stored.** Whether an app is "reading", "3 tools over the
 * polyfill" or "not opened" is a fact about the tabs and the relay right now, recomputed at every
 * render from the tab list and the tools store. A stored word would be the word the app had the
 * last time somebody looked.
 */
import type { OriginRow } from "@/lib/store";
import type { Tab } from "@/lib/ipc";
import { hostOf } from "@/lib/url";
import type { TabTools } from "@/stores/tools";

export interface BrowserTab {
  id: number;
  title: string;
  url: string;
  /** The host alone, for the strip: a chip is 11rem and an address is not. */
  host: string;
  focused: boolean;
}

/**
 * The focused tab's tier-1 surface (README section 3.4): what the page registered, and how it
 * answered. It is the one thing this module can say about the rectangle it does not paint, and it
 * is the first sign a relay is working at all — so it belongs in the strip, which is the only
 * part of this view that is on screen when a page is.
 */
export interface BrowserTools {
  /** How many tools the page registered. */
  count: number;
  /** `webmcp-native`, `webmcp-polyfill`, or null before the page has answered. */
  transport: string | null;
  /** The relay's words when the page could not be read, else null. Never paraphrased. */
  problem: string | null;
  /** A `bridge_list` is in flight. `0 tools` and "nobody has asked yet" are not one fact. */
  asking: boolean;
}

/**
 * Where a registered app stands with Athena right now, in one word the view can colour.
 *
 * - `closed`   — registered, no tab open on it.
 * - `reading`  — a tab is open and the relay is still asking the page.
 * - `ready`    — the page answered with at least one tool.
 * - `hands`    — the page answered nothing (no bridge): the generic hands operate it.
 * - `disabled` — the user switched the origin off; nothing runs there whatever it offers.
 */
export type AppStanding = "closed" | "reading" | "ready" | "hands" | "disabled";

export interface RegisteredApp {
  origin: string;
  host: string;
  enabled: boolean;
  /** ISO 8601, or "" for a row the store never stamped. */
  lastSeen: string;
  /** How many tools the user pinned at a class of their own. */
  overrides: number;
  standing: AppStanding;
  /** The standing as a sentence: "3 tools over webmcp-polyfill", "not opened". */
  summary: string;
  /** The open tab on this origin, if there is one. */
  tabId: number | null;
}

export interface BrowserActions {
  open: (url: string) => void;
  focus: (id: number) => void;
  close: (id: number) => void;
  navigate: (id: number, url: string) => void;
  /** Write the origin row for `url` and open a tab on it, so Athena can read the page. */
  register: (url: string) => void;
  /** Focus the open tab on this origin, or open one. */
  openApp: (origin: string) => void;
  setEnabled: (origin: string, enabled: boolean) => void;
  /** Delete the row, so the next visit to that origin is a first sight again. */
  forget: (origin: string) => void;
}

export interface BrowserModel {
  tabs: readonly BrowserTab[];
  /** The one the page webview is showing, or null when nothing is open. */
  focused: BrowserTab | null;
  /**
   * A sentence when the tab list could not be read, null when it could. "Nothing here" and
   * "could not be read" are different facts and the view renders them differently.
   */
  problem: string | null;
  /** The focused tab's tools, or null when no tab is focused. */
  tools: BrowserTools | null;
  /** Every origin the user has registered, in the order the table answered. */
  apps: readonly RegisteredApp[];
  /** A sentence when the origins table could not be read, null when it could or was not asked. */
  appsProblem: string | null;
  /** True once the origins table has answered. Before that, no apps means nobody has asked. */
  appsLoaded: boolean;
  actions: BrowserActions;
}

/** What the selector reads of `stores/origins.ts`. A snapshot, never the store. */
export interface OriginsSnapshot {
  records: Readonly<Record<string, OriginRow>>;
  known: readonly string[];
  loaded: boolean;
  problem: string | null;
}

/** A new tab starts blank; the address field is the way in. */
export const NEW_TAB_URL = "about:blank";

export const NO_ORIGINS: OriginsSnapshot = { records: {}, known: [], loaded: false, problem: null };

/**
 * The selector: the store snapshot in, the view-model out, and nothing else in the world. Pure,
 * so it is the piece a test can hold still — `model.test.ts` is the whole of what this module
 * asserts about its own behaviour.
 *
 * `loaded` is not a display state, it is a *fact*: before Rust has answered once, an empty list
 * means "nobody has asked yet", which is not "no tabs are open".
 */
export function selectBrowser(
  tabs: readonly Tab[],
  loaded: boolean,
  byTab: Readonly<Record<number, TabTools>>,
  actions: BrowserActions,
  origins: OriginsSnapshot = NO_ORIGINS,
): BrowserModel {
  const mapped: BrowserTab[] = tabs.map((t) => ({
    id: t.id,
    title: t.title || t.url,
    url: t.url,
    host: hostOf(t.url),
    focused: t.focused,
  }));
  const focused = mapped.find((t) => t.focused) ?? null;
  return {
    tabs: mapped,
    focused,
    problem: loaded ? null : "the shell has not answered tabs_list yet",
    tools: focused ? toolsOf(byTab[focused.id]) : null,
    apps: origins.known
      .map((origin) => origins.records[origin])
      .filter((row): row is OriginRow => row !== undefined)
      .map((row) => appOf(row, tabs, byTab)),
    appsProblem: origins.problem,
    appsLoaded: origins.loaded,
    actions,
  };
}

/** No entry at all is the same display as an entry in flight: nobody has an answer yet. */
function toolsOf(entry: TabTools | undefined): BrowserTools {
  if (!entry) return { count: 0, transport: null, problem: null, asking: true };
  return {
    count: entry.tools.length,
    transport: entry.transport,
    problem: entry.problem,
    asking: entry.asking,
  };
}

/** The tab open on an origin, if any. The focused one wins when several are. */
export function tabOn(origin: string, tabs: readonly Tab[]): Tab | null {
  const on = tabs.filter((t) => originOf(t.url) === origin);
  return on.find((t) => t.focused) ?? on[0] ?? null;
}

/**
 * One registered app, and where it stands. Exported so the test can hold the derivation still
 * on its own: every word in the table is decided here and nowhere else.
 */
export function appOf(
  row: OriginRow,
  tabs: readonly Tab[],
  byTab: Readonly<Record<number, TabTools>>,
): RegisteredApp {
  const tab = tabOn(row.origin, tabs);
  const base = {
    origin: row.origin,
    host: hostOf(row.origin),
    enabled: row.enabled,
    lastSeen: row.last_seen ?? "",
    overrides: Object.keys(row.overrides ?? {}).length,
    tabId: tab?.id ?? null,
  };
  if (!row.enabled) {
    return { ...base, standing: "disabled", summary: "switched off; nothing runs here" };
  }
  if (!tab) return { ...base, standing: "closed", summary: "not opened" };
  const tools = toolsOf(byTab[tab.id]);
  if (tools.asking) return { ...base, standing: "reading", summary: "reading the page" };
  if (tools.problem || tools.count === 0) {
    return { ...base, standing: "hands", summary: "no bridge; the generic hands operate it" };
  }
  return {
    ...base,
    standing: "ready",
    summary: `${tools.count} tool${tools.count === 1 ? "" : "s"} over ${tools.transport ?? "no transport"}`,
  };
}

export function originOf(url: string): string {
  try {
    return new URL(url).origin;
  } catch {
    return "";
  }
}

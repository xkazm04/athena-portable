/**
 * What each open tab registered — README section 3.4, tier 1.
 *
 * One entry per tab: the page's tools, the transport it answered on, and the reason it could not
 * be read when it could not. It is a mirror of something the shell asks for, exactly as `tabs.ts`
 * is, and it is refreshed on three occasions and no others: a `bridge:toolchange` from the page,
 * a tab that has just appeared, and a tab that has navigated to another document.
 *
 * `startTools()` is called by the app root (`src/app.tsx`) and by nothing else — the day-zero rule
 * from README section 3.5. A page's tool list has to stay true while the user is looking at the
 * Approvals module, because the next turn's manifest is built from it; a store a *view* starts is
 * a store that stops being true the moment that view goes away.
 *
 * Nothing here classifies anything. What a page registered is a claim (`lib/bridge.ts`), and
 * `AUTO` or `GATED` is the gate's answer, arrived at from the flags and the origin record.
 */
import { create } from "zustand";

import { bridgeList, onToolChange, type BridgeTool } from "@/lib/bridge";
import { hasShell, type Tab } from "@/lib/ipc";
import { useTabs } from "@/stores/tabs";

/** One tab's tier-1 surface, as of the last answer. */
export interface TabTools {
  tabId: number;
  /** The document the answer is about. An answer for another one is dropped, not shown. */
  url: string;
  tools: readonly BridgeTool[];
  /** `webmcp-native`, `webmcp-polyfill`, or null while nothing has answered yet. */
  transport: string | null;
  /** The page's `athena:app` slug, when it published one. */
  appId: string | null;
  /**
   * Why the page could not be read, verbatim, or null. A page with no bridge answers nothing and
   * its request times out, so `timeout` here means "this page has no tools", which is a fact and
   * not a failure of the shell (ADR 0008).
   */
  problem: string | null;
  /** A request is in flight. The first one is what makes an empty list "not asked yet". */
  asking: boolean;
}

export interface ToolsState {
  byTab: Readonly<Record<number, TabTools>>;
  /** Ask one tab what it has. Safe to call at any time; the answer is dropped if it is stale. */
  refresh: (tabId: number) => Promise<void>;
}

function blank(tabId: number, url: string): TabTools {
  return {
    tabId,
    url,
    tools: [],
    transport: null,
    appId: null,
    problem: null,
    asking: true,
  };
}

export const useTools = create<ToolsState>((set, get) => ({
  byTab: {},
  refresh: async (tabId) => {
    const url = urlOf(tabId);
    // The placeholder goes in first, so a second reconcile pass in the same tick sees this tab as
    // asked and the store answers "asking" rather than "nothing here".
    set({ byTab: { ...get().byTab, [tabId]: blank(tabId, url) } });

    let answer: TabTools;
    try {
      const reply = await bridgeList(tabId);
      answer = reply.ok
        ? {
            tabId,
            url,
            tools: reply.tools,
            transport: reply.page.transport,
            appId: reply.page.app_id,
            problem: null,
            asking: false,
          }
        : { ...blank(tabId, url), problem: reply.error, asking: false };
    } catch (e) {
      // A rejected command — no shell, no tab, a webview that has gone away. It is the reason,
      // and the module shows it in the page's own words rather than a guess of ours.
      answer = { ...blank(tabId, url), problem: String(e), asking: false };
    }

    const known = get().byTab[tabId];
    // Two ways an answer arrives too late to be true: the tab closed, or it went somewhere else
    // while the page was thinking. Either way this is an answer about a document that is gone.
    if (!known || known.url !== url) return;
    set({ byTab: { ...get().byTab, [tabId]: answer } });
  },
}));

/** The tab's address as the shell last reported it, or "" when the shell has not said. */
function urlOf(tabId: number): string {
  return useTabs.getState().tabs.find((t) => t.id === tabId)?.url ?? "";
}

/**
 * Keep the map to the tabs that exist, and ask any tab that is new or has moved.
 *
 * Exported for the test, and pure enough to be worth it: everything the store does that is not a
 * request is this function.
 */
export function reconcile(tabs: readonly Tab[]): void {
  const byTab = useTools.getState().byTab;
  const open = new Set(tabs.map((t) => t.id));

  const kept: Record<number, TabTools> = {};
  let dropped = false;
  for (const [key, entry] of Object.entries(byTab)) {
    if (open.has(Number(key))) kept[Number(key)] = entry;
    else dropped = true;
  }
  if (dropped) useTools.setState({ byTab: kept });

  for (const tab of tabs) {
    const known = kept[tab.id];
    if (!known || known.url !== tab.url) void useTools.getState().refresh(tab.id);
  }
}

let started = false;

export async function startTools(): Promise<void> {
  if (started || !hasShell()) return;
  started = true;
  // The page's own notification first: a tab that registers its tools after load — which is every
  // page that waits for a fetch — announces itself this way and nothing else would catch it.
  await onToolChange((tabId) => void useTools.getState().refresh(tabId));
  useTabs.subscribe((state) => reconcile(state.tabs));
  reconcile(useTabs.getState().tabs);
}

/**
 * The tab list, mirrored from Rust — README section 3.1.
 *
 * Nothing here is authoritative. Every mutation is a command, and the new list arrives on
 * `tabs:changed`, so the strip and any later surface can never disagree about what is open.
 *
 * `startTabs()` is called by the app root (`src/app.tsx`) and by nothing else. That is the
 * day-zero rule from README section 3.5: a store that a *view* starts stops being true the moment
 * the user navigates away from that view, which is how the first build's tray count froze.
 */
import { create } from "zustand";

import { hasShell, onTabsChanged, tabsClose, tabsCreate, tabsFocus, tabsList, tabsNavigate } from "@/lib/ipc";
import type { Tab } from "@/lib/ipc";

export interface TabsState {
  tabs: Tab[];
  /** True once Rust has answered once. Before that the list is empty because nothing asked yet,
   *  which is a different fact from "no tabs are open". */
  loaded: boolean;
  create: (url: string) => Promise<void>;
  close: (id: number) => Promise<void>;
  focus: (id: number) => Promise<void>;
  navigate: (id: number, url: string) => Promise<void>;
}

export const useTabs = create<TabsState>(() => ({
  tabs: [],
  loaded: false,
  create: async (url) => {
    await tabsCreate(url);
  },
  close: async (id) => {
    await tabsClose(id);
  },
  focus: async (id) => {
    await tabsFocus(id);
  },
  navigate: async (id, url) => {
    await tabsNavigate(id, url);
  },
}));

let started = false;

export async function startTabs(): Promise<void> {
  if (started || !hasShell()) return;
  started = true;
  // Subscribe before the first read, or a tab opened by `ATHENA_START_URL` between the two lands
  // in neither.
  await onTabsChanged((tabs) => useTabs.setState({ tabs, loaded: true }));
  useTabs.setState({ tabs: await tabsList(), loaded: true });
}

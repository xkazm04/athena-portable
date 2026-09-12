/**
 * The Browser module's `ModuleEntry` — the one file in this directory that knows a store exists.
 *
 * `Live` is where the two halves meet: the store snapshots go into the selector, the view-model
 * comes out, and the view renders it. Every other file here is testable and previewable without a
 * shell because this is the only one that is not.
 *
 * Three stores are read and none is started here (README section 3.5): the tabs, the tools the
 * relay reported per tab, and the origins table. Registering an app is the one action that
 * touches two of them in order — the row first, so the page is trusted before it is read, then
 * the tab.
 */
import { createElement } from "react";

import { useOrigins } from "@/stores/origins";
import { useTabs } from "@/stores/tabs";
import { useTools } from "@/stores/tools";
import type { ModuleEntry } from "@/modules/types";

import { fixtureIds, fixtures } from "./fixtures";
import { originOf, selectBrowser, tabOn, type BrowserActions } from "./model";
import BrowserView from "./view";

function Live() {
  const tabs = useTabs((s) => s.tabs);
  const loaded = useTabs((s) => s.loaded);
  const create = useTabs((s) => s.create);
  const close = useTabs((s) => s.close);
  const focus = useTabs((s) => s.focus);
  const navigate = useTabs((s) => s.navigate);
  // Read, never started: `src/app.tsx` starts these stores, because the focused page's tool list
  // and the origins table have to stay true while the user is looking at another module.
  const byTab = useTools((s) => s.byTab);
  const records = useOrigins((s) => s.records);
  const known = useOrigins((s) => s.known);
  const originsLoaded = useOrigins((s) => s.loaded);
  const originsProblem = useOrigins((s) => s.problem);

  // A rejected command is reported and not thrown: a tab that will not open must not take the
  // module down with it, and the strip still lists what is really there because the list only
  // ever changes on `tabs:changed`.
  const report = (what: string) => (e: unknown) => console.error(`[browser] ${what}: ${String(e)}`);
  const actions: BrowserActions = {
    open: (url) => void create(url).catch(report("open")),
    close: (id) => void close(id).catch(report("close")),
    focus: (id) => void focus(id).catch(report("focus")),
    navigate: (id, url) => void navigate(id, url).catch(report("navigate")),
    register: (url) => {
      const origin = originOf(url);
      if (!origin) return;
      void useOrigins
        .getState()
        .save(origin, { enabled: true })
        .then(() => create(url))
        .catch(report("register"));
    },
    openApp: (origin) => {
      const open = tabOn(origin, useTabs.getState().tabs);
      if (open) void focus(open.id).catch(report("show"));
      else void create(origin).catch(report("open app"));
    },
    setEnabled: (origin, enabled) =>
      void useOrigins.getState().setEnabled(origin, enabled).catch(report("switch")),
    forget: (origin) => void useOrigins.getState().forget(origin).catch(report("forget")),
  };

  return createElement(BrowserView, {
    model: selectBrowser(tabs, loaded, byTab, actions, {
      records,
      known,
      loaded: originsLoaded,
      problem: originsProblem,
    }),
  });
}

export const entry: ModuleEntry = {
  id: "browser",
  label: "Browser",
  blurb: "The apps Athena works in: what is open, what is registered, and the one rectangle this app does not paint.",
  fixtureIds,
  preview: (fixture) =>
    createElement(BrowserView, { model: fixtures[fixture] ?? fixtures.typical }),
  Live,
};

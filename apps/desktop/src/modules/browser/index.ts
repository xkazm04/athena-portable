/**
 * The Browser module's `ModuleEntry` — the one file in this directory that knows a store exists.
 *
 * `Live` is where the two halves meet: the store snapshot goes into the selector, the view-model
 * comes out, and the view renders it. Every other file here is testable and previewable without a
 * shell because this is the only one that is not.
 */
import { createElement } from "react";

import { useTabs } from "@/stores/tabs";
import { useTools } from "@/stores/tools";
import type { ModuleEntry } from "@/modules/types";

import { fixtureIds, fixtures } from "./fixtures";
import { selectBrowser, type BrowserActions } from "./model";
import BrowserView from "./view";

function Live() {
  const tabs = useTabs((s) => s.tabs);
  const loaded = useTabs((s) => s.loaded);
  const create = useTabs((s) => s.create);
  const close = useTabs((s) => s.close);
  const focus = useTabs((s) => s.focus);
  const navigate = useTabs((s) => s.navigate);
  // Read, never started: `src/app.tsx` starts this store, because the focused page's tool list
  // has to stay true while the user is looking at another module (README section 3.5).
  const byTab = useTools((s) => s.byTab);

  // A rejected command is reported and not thrown: a tab that will not open must not take the
  // module down with it, and the strip still lists what is really there because the list only
  // ever changes on `tabs:changed`.
  const report = (what: string) => (e: unknown) => console.error(`[browser] ${what}: ${String(e)}`);
  const actions: BrowserActions = {
    open: (url) => void create(url).catch(report("open")),
    close: (id) => void close(id).catch(report("close")),
    focus: (id) => void focus(id).catch(report("focus")),
    navigate: (id, url) => void navigate(id, url).catch(report("navigate")),
  };

  return createElement(BrowserView, { model: selectBrowser(tabs, loaded, byTab, actions) });
}

export const entry: ModuleEntry = {
  id: "browser",
  label: "Browser",
  blurb: "The tabs, and the one rectangle this app does not paint.",
  fixtureIds,
  preview: (fixture) =>
    createElement(BrowserView, { model: fixtures[fixture] ?? fixtures.typical }),
  Live,
};

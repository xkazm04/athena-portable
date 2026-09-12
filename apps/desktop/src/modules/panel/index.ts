/**
 * The Panel module's `ModuleEntry` — the one file here that knows a store exists.
 *
 * `Live` is where the halves meet: the run store's snapshot and the daemon's readiness go into the
 * selector, the view-model comes out, and the pure view renders it. Everything else in this
 * directory is previewable and testable without a shell because this file is not.
 */
import { createElement } from "react";

import { endpoint, useDaemon } from "@/stores/daemon";
import { useRun } from "@/stores/run";
import { useTabs } from "@/stores/tabs";
import { useTools, type TabTools } from "@/stores/tools";
import type { ModuleEntry } from "@/modules/types";
import type { ToolRow } from "@/lib/api";
// @ts-expect-error - gate.js is plain JavaScript with a .d.ts that does not cover these two.
import { classify, flagsOf } from "@athena/bridge/gate";

import { fixtureIds, fixtures } from "./fixtures";
import { selectPanel, type PanelActions } from "./model";
import PanelView from "./view";

function Live() {
  const run = useRun();
  const daemon = useDaemon();
  const tabs = useTabs((s) => s.tabs);
  const byTab = useTools((s) => s.byTab);

  const focused = tabs.find((tab) => tab.focused) ?? tabs[0];
  const origin = focused ? originOf(focused.url) : null;
  // The tool list is the relay's answer for the focused tab, not a second copy the panel keeps:
  // one source, so the strip and this list can never disagree about what the page offers.
  const tools: ToolRow[] = focused ? toolRows(byTab[focused.id]) : [];

  // A rejected turn is reported and not thrown: a page that will not answer must not take the
  // module down with it.
  const report = (what: string) => (e: unknown) => console.error(`[panel] ${what}: ${String(e)}`);
  const actions: PanelActions = {
    send: (message) => void run.send(message).catch(report("send")),
    answer: (id, choice) => void run.answer(id, choice).catch(report("answer")),
    clear: () => run.clear(),
  };

  const ready = endpoint(daemon) !== null;
  return createElement(PanelView, { model: selectPanel(run, ready, origin, tools, actions) });
}

/**
 * The relay reports a page's own tools; the class comes from the bridge's own gate.
 *
 * Not derived here and not invented here. `gate.js` is the surface half of README section 3.3 and
 * `tests/test_refusal_parity.py` pins its vocabulary to the Python's — the same derivation
 * `HostTool.default_class` makes, in the one file that is allowed to make it on a surface. It only
 * ever tightens: anything a page did not flag is `GATED`.
 */
function toolRows(found: TabTools | undefined): ToolRow[] {
  if (!found?.tools) return [];
  return found.tools.map((tool) => ({
    name: found.appId ? `host.${found.appId}.${tool.name}` : tool.name,
    origin: found.appId ? `host:${found.appId}` : "",
    class: classify(flagsOf(tool)) as ToolRow["class"],
    tier: 1,
    description: tool.description ?? "",
  }));
}

function originOf(url: string): string | null {
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}

export const entry: ModuleEntry = {
  id: "panel",
  label: "Athena",
  blurb: "The turn, the cards waiting on you, and what this page offers.",
  fixtureIds,
  preview: (fixture) => createElement(PanelView, { model: fixtures[fixture] ?? fixtures.typical }),
  Live,
};

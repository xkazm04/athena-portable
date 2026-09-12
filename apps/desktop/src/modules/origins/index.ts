/**
 * The Origins module's `ModuleEntry` — the one file in this directory that knows a store exists.
 *
 * Which origin is open is held here rather than in the store: it is a fact about *this visit to
 * this surface*, and a selection that outlived the module would come back pointing at a row the
 * user has since forgotten. Everything else — the rows, the trust, the rulings — is the `origins`
 * table, which `src/app.tsx` starts and this file only reads.
 *
 * The two writes go to different owners on purpose. `enabled` is the origins store's own column.
 * A ruling and a Forget go through the run loop's actions, because the daemon holds the catalog
 * the gate reads and a class the panel changed has to reach it in the same turn (README section
 * 3.3) — a surface that wrote the row and left the daemon on the old one would be a surface whose
 * switch is a lie until the next restart.
 */
import { createElement, useMemo, useState } from "react";

import type { ToolClass } from "@/lib/store";
import type { ModuleEntry } from "@/modules/types";
import { useOrigins } from "@/stores/origins";
import { useRun, runActions } from "@/stores/run";
import { useTabs } from "@/stores/tabs";

import { fixtureIds, fixtures } from "./fixtures";
import { selectOrigins, type OriginsActions } from "./model";
import OriginsView from "./view";

function Live() {
  const known = useOrigins((s) => s.known);
  const records = useOrigins((s) => s.records);
  const loaded = useOrigins((s) => s.loaded);
  const problem = useOrigins((s) => s.problem);
  const tools = useRun((s) => s.tools);
  const tabs = useTabs((s) => s.tabs);

  const [selected, setSelected] = useState<string | null>(null);

  const currentOrigin = useMemo(() => originOf(tabs.find((t) => t.focused)?.url ?? null), [tabs]);

  const actions: OriginsActions = useMemo(() => {
    const report = (what: string) => (e: unknown) => console.error(`[origins] ${what}: ${String(e)}`);
    return {
      select: setSelected,
      setEnabled: (origin, enabled) =>
        void useOrigins.getState().setEnabled(origin, enabled).catch(report("enable")),
      setOverride: (origin: string, tool: string, cls: ToolClass | null) =>
        void runActions.setOverride(origin, tool, cls).catch(report("override")),
      forget: (origin) => {
        // The row goes, so the selection that pointed at it must go with it — otherwise the rail
        // holds a detail for an origin the table no longer lists.
        setSelected((current) => (current === origin ? null : current));
        void runActions.forgetOrigin(origin).catch(report("forget"));
      },
    };
  }, []);

  const model = useMemo(
    () =>
      selectOrigins({
        known,
        records,
        loaded,
        problem,
        tools,
        currentOrigin,
        selected,
        actions,
      }),
    [known, records, loaded, problem, tools, currentOrigin, selected, actions],
  );

  return createElement(OriginsView, { model });
}

/** The origin of an address, or null. An address `URL` refuses has no origin to key a row on. */
function originOf(url: string | null): string | null {
  if (!url) return null;
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}

export const entry: ModuleEntry = {
  id: "origins",
  label: "Origins",
  blurb: "Every page Athena has been on, what she may do there, and how to take it back.",
  fixtureIds,
  preview: (fixture) => createElement(OriginsView, { model: fixtures[fixture] ?? fixtures.typical }),
  Live,
};

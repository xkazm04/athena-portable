/**
 * The Settings module's `ModuleEntry` — the one file in this directory that knows a store exists.
 *
 * The engine and the theme are `settings` rows; the probe list will be `stores/daemon.ts`'s, one
 * commit from now. Until it exists this passes `null`, which the model and the view already
 * render as "the probe has not answered" — a state they have to handle anyway, because a daemon
 * that is starting produces exactly it.
 */
import { createElement, useMemo, useState } from "react";

import { ENGINE_IDS, isEngineId } from "@/lib/engines";
import type { ModuleEntry } from "@/modules/types";
import { useSettings, type ThemeChoice } from "@/stores/settings";

import { fixtureIds, fixtures } from "./fixtures";
import { selectSettings, type SettingsActions } from "./model";
import SettingsView from "./view";

function Live() {
  const hydrated = useSettings((s) => s.hydrated);
  const engine = useSettings((s) => s.engine);
  const theme = useSettings((s) => s.theme);
  const storePath = useSettings((s) => s.storePath);

  // The intent, held here rather than in the store: it is a fact about *this* visit to this
  // surface, and it is answered by a restart the shell has not learned to do yet.
  const [pendingEngine, setPendingEngine] = useState<string | null>(null);

  const actions: SettingsActions = useMemo(
    () => ({
      chooseEngine: (id) => {
        if (!isEngineId(id)) return;
        setPendingEngine(id === useSettings.getState().engine ? null : id);
        void useSettings
          .getState()
          .setEngine(id)
          .catch((e: unknown) => console.error(`[settings] engine: ${String(e)}`));
      },
      // c20 replaces this body with `daemon_restart`; the callback is the seam, so that commit
      // touches one line here and nothing in the view.
      restartDaemon: () => setPendingEngine(null),
      dismissRestart: () => setPendingEngine(null),
      setTheme: (next: ThemeChoice) =>
        void useSettings
          .getState()
          .setTheme(next)
          .catch((e: unknown) => console.error(`[settings] theme: ${String(e)}`)),
    }),
    [],
  );

  const model = useMemo(
    () =>
      selectSettings({
        hydrated,
        engine,
        probes: null,
        theme,
        storePath,
        pendingEngine,
        restartWired: false,
        problem: null,
        engineIds: ENGINE_IDS,
        actions,
      }),
    [hydrated, engine, theme, storePath, pendingEngine, actions],
  );

  return createElement(SettingsView, { model });
}

export const entry: ModuleEntry = {
  id: "settings",
  label: "Settings",
  blurb: "The engine Athena is started on, the theme, and where this machine keeps her data.",
  fixtureIds,
  preview: (fixture) =>
    createElement(SettingsView, { model: fixtures[fixture] ?? fixtures.typical }),
  Live,
};

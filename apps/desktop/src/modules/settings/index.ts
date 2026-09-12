/**
 * The Settings module's `ModuleEntry` — the one file in this directory that knows a store exists.
 *
 * The engine and the theme are `settings` rows; the probe list and the restart are
 * `stores/daemon.ts`'s. Both halves of "the engine is configuration" meet here and nowhere else:
 * choosing one writes a row, and **restarting is what makes the running process agree with it**
 * (README section 3.5). The probe is still allowed to be `null` — a daemon that is starting has
 * not answered yet — and the model and the view already render that as its own third state.
 */
import { createElement, useMemo, useState } from "react";

import { ENGINE_IDS, isEngineId } from "@/lib/engines";
import type { ModuleEntry } from "@/modules/types";
import { engineProbes, useDaemon } from "@/stores/daemon";
import { useSettings, type ThemeChoice } from "@/stores/settings";

import { fixtureIds, fixtures } from "./fixtures";
import { selectSettings, type SettingsActions } from "./model";
import SettingsView from "./view";

function Live() {
  const hydrated = useSettings((s) => s.hydrated);
  const engine = useSettings((s) => s.engine);
  const theme = useSettings((s) => s.theme);
  const storePath = useSettings((s) => s.storePath);
  const engines = useDaemon((s) => s.engines);
  const daemonError = useDaemon((s) => s.lastError);

  // The intent, held here rather than in the store: it is a fact about *this* visit to this
  // surface, and it is answered by the restart below.
  const [pendingEngine, setPendingEngine] = useState<string | null>(null);

  const probes = useMemo(() => engineProbes({ engines }), [engines]);

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
      // The stored row is the intent; this is what makes the *running* process agree with it.
      // The notice goes as soon as the command is accepted, because the rest of the story —
      // starting, a fresh token, ready — arrives on `daemon:status` and is the panel's to show.
      restartDaemon: () => {
        const next = pendingEngine ?? useSettings.getState().engine;
        setPendingEngine(null);
        void useDaemon
          .getState()
          .restart(next)
          .catch((e: unknown) => console.error(`[settings] restart: ${String(e)}`));
      },
      dismissRestart: () => setPendingEngine(null),
      setTheme: (next: ThemeChoice) =>
        void useSettings
          .getState()
          .setTheme(next)
          .catch((e: unknown) => console.error(`[settings] theme: ${String(e)}`)),
    }),
    [pendingEngine],
  );

  const model = useMemo(
    () =>
      selectSettings({
        hydrated,
        engine,
        probes,
        theme,
        storePath,
        pendingEngine,
        // The shell can restart the daemon: the notice offers the button rather than explaining
        // that a later commit will.
        restartWired: true,
        problem: daemonError || null,
        engineIds: ENGINE_IDS,
        actions,
      }),
    [hydrated, engine, probes, theme, storePath, pendingEngine, daemonError, actions],
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

/**
 * The Setup wizard's `ModuleEntry` — the one file in this directory that knows a store exists.
 *
 * Three stores meet here and none of them is started here: `settings` (the engine, the brain
 * path, whether the letter has been read), `tabs` (whether a page is open), and the sidecar's,
 * which feeds `probes`. `null` still reaches the model while the daemon is starting, and `null`
 * means what it has always meant here: the probe has not answered, which is a different fact from
 * nothing being installed and the wizard shows a different station for each.
 *
 * The step is React state rather than a stored row, because it is a fact about *this* visit to
 * this surface and nothing outside the surface acts on it.
 */
import { createElement, useMemo, useState } from "react";

import { ENGINE_IDS, isEngineId } from "@/lib/engines";
import type { ModuleEntry } from "@/modules/types";
import { engineProbes, useDaemon } from "@/stores/daemon";
import { useSettings } from "@/stores/settings";
import { useShell } from "@/stores/shell";
import { useTabs } from "@/stores/tabs";

import { fixtureIds, fixtures } from "./fixtures";
import { selectSetup, type SetupActions, type StepKey } from "./model";
import SetupView from "./view";

function Live() {
  const engine = useSettings((s) => s.engine);
  const brainPath = useSettings((s) => s.brainPath);
  const onboarded = useSettings((s) => s.onboarded);
  const tabs = useTabs((s) => s.tabs);
  const engines = useDaemon((s) => s.engines);
  const daemonError = useDaemon((s) => s.lastError);

  const [step, setStep] = useState<StepKey>("engine");

  const probes = useMemo(() => engineProbes({ engines }), [engines]);

  const actions: SetupActions = useMemo(() => {
    // A rejected command is reported and not thrown: a directory the store will not take must
    // not take the wizard down with it.
    const report = (what: string) => (e: unknown) => console.error(`[setup] ${what}: ${String(e)}`);
    return {
      goTo: setStep,
      chooseEngine: (id) => {
        if (!isEngineId(id)) return;
        void useSettings.getState().setEngine(id).catch(report("engine"));
      },
      setBrainPath: (path) =>
        void useSettings.getState().setBrainPath(path).catch(report("brain path")),
      openPage: (url) => void useTabs.getState().create(url).catch(report("open")),
      finish: () => {
        void useSettings.getState().setOnboarded(true).catch(report("onboarded"));
        void useShell.getState().select("browser").catch(report("leave"));
      },
    };
  }, []);

  const model = useMemo(
    () =>
      selectSetup({
        step,
        probes,
        engine,
        engineIds: ENGINE_IDS,
        brainPath,
        tabs,
        onboarded,
        problem: daemonError || null,
        actions,
      }),
    [step, probes, engine, brainPath, tabs, onboarded, daemonError, actions],
  );

  return createElement(SetupView, { model });
}

export const entry: ModuleEntry = {
  id: "setup",
  label: "Setup",
  blurb: "What this machine still needs before Athena's first turn, derived and never stored.",
  fixtureIds,
  preview: (fixture) => createElement(SetupView, { model: fixtures[fixture] ?? fixtures.typical }),
  Live,
};

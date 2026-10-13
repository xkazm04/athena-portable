/**
 * The Setup module's `ModuleEntry` — the one file in this directory that knows a store exists.
 *
 * Four stores meet here and none of them is started here: `settings` (the engine, the theme,
 * the brain path, whether the letter has been read), `tabs` (whether a page is open), `daemon`
 * (which engine is running, and the restart), and `voice` (whether the daemon can hear). The
 * engine answer is read from `engines` (started by the app root); `null` means it has not answered.
 *
 * Two facts are React state rather than stored rows, because they are facts about *this* visit:
 * the microphone's answer (a permission is the browser's fact, not the store's) and whether the
 * welcome was reopened.
 */
import { createElement, useMemo, useState } from "react";

import { ENGINE_IDS, isEngineId } from "@/lib/engines";
import type { MotionChoice } from "@/lib/motion";
import { checkMicrophone, type MicStanding } from "@/lib/voice";
import type { ModuleEntry } from "@/modules/types";
import { useDaemon } from "@/stores/daemon";
import { useEngines } from "@/stores/engines";
import { chooseSetupEngine, useSettings, type ThemeChoice, type TypeScale } from "@/stores/settings";
import { useShell } from "@/stores/shell";
import { useTabs } from "@/stores/tabs";
import { useVoice } from "@/stores/voice";

import { fixtureIds, fixtures, initialOpenFor } from "./fixtures";
import { selectSetup, type SetupActions, type SetupModel } from "./model";
import SetupView from "./view";

/**
 * The model, built from the stores. A hook so the Setup module and the depth scenes that carry its
 * work (the first act, the Mind depth) share one selector and one set of actions; the old view and
 * the new ones differ only in what they draw.
 */
export function useSetupModel(
  options: { afterFinish?: () => void; onReopen?: () => void } = {},
): SetupModel {
  const { afterFinish, onReopen } = options;
  const hydrated = useSettings((s) => s.hydrated);
  const engine = useSettings((s) => s.engine);
  const theme = useSettings((s) => s.theme);
  const typeScale = useSettings((s) => s.typeScale);
  const motion = useSettings((s) => s.motion);
  const brainPath = useSettings((s) => s.brainPath);
  const onboarded = useSettings((s) => s.onboarded);
  const storePath = useSettings((s) => s.storePath);
  const tabs = useTabs((s) => s.tabs);
  const daemonHealth = useDaemon((s) => s.health);
  const daemonEngine = useDaemon((s) => s.engine);
  const daemonLoaded = useDaemon((s) => s.loaded);
  const daemonError = useDaemon((s) => s.lastError);
  const probes = useEngines((s) => s.probes);
  const checking = useEngines((s) => s.checking);
  const problem = useEngines((s) => s.problem);
  const voiceAvailable = useVoice((s) => s.available);
  const voiceReason = useVoice((s) => s.reason);

  const [mic, setMic] = useState<{ standing: MicStanding; detail: string }>({
    standing: "unknown",
    detail: "",
  });
  const [reopened, setReopened] = useState(false);

  const actions: SetupActions = useMemo(() => {
    // A rejected command is reported and not thrown: a directory the store will not take must
    // not take the module down with it.
    const report = (what: string) => (e: unknown) => console.error(`[setup] ${what}: ${String(e)}`);
    return {
      chooseEngine: (id) => {
        if (!isEngineId(id)) return;
        void chooseSetupEngine(id).catch(report("engine"));
      },
      checkEngines: () => void useEngines.getState().check(),
      restart: () => {
        void useDaemon.getState().restart(useSettings.getState().engine).catch(report("restart"));
      },
      setTheme: (next: ThemeChoice) =>
        void useSettings.getState().setTheme(next).catch(report("theme")),
      setTypeScale: (next: TypeScale) =>
        void useSettings.getState().setTypeScale(next).catch(report("text size")),
      setMotion: (next: MotionChoice) =>
        void useSettings.getState().setMotion(next).catch(report("motion")),
      setBrainPath: (path) =>
        void useSettings.getState().setBrainPath(path).catch(report("brain path")),
      openPage: (url) => void useTabs.getState().create(url).catch(report("open")),
      checkMic: () => {
        const media = typeof navigator === "undefined" ? undefined : navigator.mediaDevices;
        void checkMicrophone(media ? (c) => media.getUserMedia(c) : undefined).then(setMic);
      },
      finish: () => {
        setReopened(false);
        void useSettings.getState().setOnboarded(true).catch(report("onboarded"));
        // The module bar leaves into the Browser. The depth scenes pass their own destination: a
        // stray `browser` selection would tell Rust a page is wanted under a scene.
        if (afterFinish) afterFinish();
        else void useShell.getState().select("browser").catch(report("leave"));
      },
      // The module bar re-shows its own welcome; a scene says where the first act is shown instead.
      reopenOnboarding: () => (onReopen ? onReopen() : setReopened(true)),
    };
  }, [afterFinish, onReopen]);

  const model = useMemo(
    () =>
      selectSetup({
        onboarded,
        hydrated,
        engine,
        engineIds: ENGINE_IDS,
        probes,
        problem,
        checking,
        theme,
        typeScale,
        motion,
        brainPath,
        tabs,
        mic: mic.standing,
        micDetail: mic.detail,
        voiceAvailable,
        voiceReason,
        storePath,
        daemonHealth,
        daemonEngine,
        daemonLoaded,
        daemonError,
        reopened,
        actions,
      }),
    [
      onboarded,
      hydrated,
      engine,
      theme,
      typeScale,
      motion,
      brainPath,
      tabs,
      mic,
      voiceAvailable,
      voiceReason,
      storePath,
      daemonHealth,
      daemonEngine,
      daemonLoaded,
      daemonError,
      probes,
      checking,
      problem,
      reopened,
      actions,
    ],
  );

  return model;
}

function Live() {
  return createElement(SetupView, { model: useSetupModel() });
}

export const entry: ModuleEntry = {
  id: "setup",
  label: "Setup",
  blurb: "What this machine needs before the first turn, and every setting after it — derived, never stored.",
  fixtureIds,
  preview: (fixture) =>
    createElement(SetupView, {
      model: fixtures[fixture] ?? fixtures.typical,
      initialOpen: initialOpenFor(fixture),
    }),
  Live,
};

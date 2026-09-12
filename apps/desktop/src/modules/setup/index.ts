/**
 * The Setup module's `ModuleEntry` — the one file in this directory that knows a store exists.
 *
 * Four stores meet here and none of them is started here: `settings` (the engine, the theme,
 * the brain path, whether the letter has been read), `tabs` (whether a page is open), `daemon`
 * (which engine is running, and the restart), and `voice` (whether the daemon can hear). The
 * engine probe is still `null` — nothing in the shell asks the daemon for one yet — and `null`
 * already means what it has to mean: the probe has not answered.
 *
 * Two facts are React state rather than stored rows, because they are facts about *this* visit:
 * the microphone's answer (a permission is the browser's fact, not the store's) and whether the
 * welcome was reopened.
 */
import { createElement, useMemo, useState } from "react";

import { ENGINE_IDS, isEngineId } from "@/lib/engines";
import { checkMicrophone, type MicStanding } from "@/lib/voice";
import type { ModuleEntry } from "@/modules/types";
import { useDaemon } from "@/stores/daemon";
import { useSettings, type ThemeChoice } from "@/stores/settings";
import { useShell } from "@/stores/shell";
import { useTabs } from "@/stores/tabs";
import { useVoice } from "@/stores/voice";

import { fixtureIds, fixtures } from "./fixtures";
import { selectSetup, type SetupActions } from "./model";
import SetupView from "./view";

function Live() {
  const hydrated = useSettings((s) => s.hydrated);
  const engine = useSettings((s) => s.engine);
  const theme = useSettings((s) => s.theme);
  const brainPath = useSettings((s) => s.brainPath);
  const onboarded = useSettings((s) => s.onboarded);
  const storePath = useSettings((s) => s.storePath);
  const tabs = useTabs((s) => s.tabs);
  const daemonHealth = useDaemon((s) => s.health);
  const daemonEngine = useDaemon((s) => s.engine);
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
        void useSettings.getState().setEngine(id).catch(report("engine"));
      },
      restart: () => {
        void useDaemon.getState().restart(useSettings.getState().engine).catch(report("restart"));
      },
      setTheme: (next: ThemeChoice) =>
        void useSettings.getState().setTheme(next).catch(report("theme")),
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
        void useShell.getState().select("browser").catch(report("leave"));
      },
      reopenOnboarding: () => setReopened(true),
    };
  }, []);

  const model = useMemo(
    () =>
      selectSetup({
        onboarded,
        hydrated,
        engine,
        engineIds: ENGINE_IDS,
        probes: null,
        problem: null,
        theme,
        brainPath,
        tabs,
        mic: mic.standing,
        micDetail: mic.detail,
        voiceAvailable,
        voiceReason,
        storePath,
        daemonHealth,
        daemonEngine,
        reopened,
        actions,
      }),
    [
      onboarded,
      hydrated,
      engine,
      theme,
      brainPath,
      tabs,
      mic,
      voiceAvailable,
      voiceReason,
      storePath,
      daemonHealth,
      daemonEngine,
      reopened,
      actions,
    ],
  );

  return createElement(SetupView, { model });
}

export const entry: ModuleEntry = {
  id: "setup",
  label: "Setup",
  blurb: "What this machine needs before the first turn, and every setting after it — derived, never stored.",
  fixtureIds,
  preview: (fixture) => createElement(SetupView, { model: fixtures[fixture] ?? fixtures.typical }),
  Live,
};

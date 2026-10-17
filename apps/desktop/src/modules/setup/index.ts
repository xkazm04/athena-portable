/**
 * The Setup model hook — the one file in this directory that knows a store exists.
 *
 * Four stores meet here and none of them is started here: `settings` (the engine, the theme,
 * the brain path, whether the letter has been read), `tabs` (whether a page is open), `daemon`
 * (which engine is running, and the restart), and `voice` (whether the daemon can hear). The
 * engine answer is read from `engines` (started by the app root); `null` means it has not answered.
 *
 * Some facts are React state rather than stored rows, because they are facts about *this* visit:
 * the microphone's answer (a permission is the browser's fact, not the store's), whether the
 * welcome was reopened, and which writes the store refused (each shown beside its own control).
 */
import { useMemo, useState } from "react";

import { ENGINE_IDS, isEngineId } from "@/lib/engines";
import type { MotionChoice } from "@/lib/motion";
import { checkMicrophone, type MicStanding } from "@/lib/voice";
import { useDaemon } from "@/stores/daemon";
import { useEngines } from "@/stores/engines";
import { chooseSetupEngine, readRows, useSettings, type ThemeChoice, type TypeScale } from "@/stores/settings";
import { useTabs } from "@/stores/tabs";
import { useVoice } from "@/stores/voice";

import { selectSetup, type SetupActions, type SetupModel, type SetupRefusals, type SetupWrite } from "./model";

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
  const [refusals, setRefusals] = useState<SetupRefusals>({});
  const [waking, setWaking] = useState(false);

  const actions: SetupActions = useMemo(() => {
    // A rejected command is reported and not thrown: a directory the store will not take must
    // not take the module down with it.
    const report = (what: string) => (e: unknown) => console.error(`[setup] ${what}: ${String(e)}`);
    // A write the person made here: its refusal is kept beside its control, and the rows are read
    // again, so a choice painted before its write (the theme's rule) settles back to the stored one.
    const attempt = (what: SetupWrite, write: () => Promise<void>): Promise<boolean> => {
      setRefusals((now) => (what in now ? withoutKey(now, what) : now));
      return write().then(
        () => true,
        (e: unknown) => {
          report(what)(e);
          setRefusals((now) => ({ ...now, [what]: e instanceof Error ? e.message : String(e) }));
          void readRows().catch(report("re-read"));
          return false;
        },
      );
    };
    return {
      chooseEngine: (id) => {
        if (!isEngineId(id)) return;
        void attempt("engine", () => chooseSetupEngine(id));
      },
      checkEngines: () => void useEngines.getState().check(),
      restart: () => {
        void useDaemon.getState().restart(useSettings.getState().engine).catch(report("restart"));
      },
      setTheme: (next: ThemeChoice) => void attempt("theme", () => useSettings.getState().setTheme(next)),
      setTypeScale: (next: TypeScale) =>
        void attempt("typeScale", () => useSettings.getState().setTypeScale(next)),
      setMotion: (next: MotionChoice) => void attempt("motion", () => useSettings.getState().setMotion(next)),
      setBrainPath: (path) => void attempt("brainPath", () => useSettings.getState().setBrainPath(path)),
      openPage: (url) => void useTabs.getState().create(url).catch(report("open")),
      checkMic: () => {
        const media = typeof navigator === "undefined" ? undefined : navigator.mediaDevices;
        void checkMicrophone(media ? (c) => media.getUserMedia(c) : undefined).then(setMic);
      },
      finish: () => {
        // The act closes only once the row is stored: a refused wake keeps the act, its reason
        // and the button, rather than leaving a person on a surface that will not remember them.
        setWaking(true);
        void attempt("wake", () => useSettings.getState().setOnboarded(true)).then((stored) => {
          setWaking(false);
          if (!stored) return;
          setReopened(false);
          // Where waking her leaves to is the scene's to say: a `browser` selection would tell Rust
          // a page is wanted under a scene (ADR 0088), so this module selects nothing itself.
          afterFinish?.();
        });
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
        refusals,
        waking,
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
      refusals,
      waking,
      actions,
    ],
  );

  return model;
}

function withoutKey(refusals: SetupRefusals, what: SetupWrite): SetupRefusals {
  const next = { ...refusals };
  delete next[what];
  return next;
}

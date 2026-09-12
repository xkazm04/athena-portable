/**
 * The Setup wizard's view-model — README section 3.5 and the demo's first act (README section 1).
 *
 * Four things the machine has to have before Athena is useful, in the order it has to have them:
 * an **engine** the daemon can run a turn on, a **brain** to write the turn down in, a **page**
 * to work beside, and then nothing — setup's job is to end. A fifth, the **microphone**, is asked
 * here so the permission prompt lands in the setup act and not mid-demo; it is never required.
 *
 * **Readiness is derived, never stored.** There is no `setup_complete` row and no step counter in
 * SQLite. `onboarded` exists, and it is a different fact: it says the letter has been read once,
 * so a returning user is not made to read it again. Whether the machine is *ready* is recomputed
 * from the probe, the brain path and the tab list at every render, so a surface that said "ready"
 * while the engine went missing is not a state this module can reach.
 */
import type { EngineProbe } from "@/lib/engines";
import type { MicStanding } from "@/lib/voice";

/** The passages, which are also the things. `done` is the end, not one of them. */
export const STEPS = ["engine", "brain", "page", "mic", "done"] as const;

export type StepKey = (typeof STEPS)[number];

/** A tab, as this surface needs it: enough to say one is open on something. */
export interface SetupTab {
  id: number;
  title: string;
  host: string;
}

export interface SetupActions {
  goTo: (step: StepKey) => void;
  chooseEngine: (id: string) => void;
  setBrainPath: (path: string) => void;
  /** Opens a tab. The one act of this wizard that changes the world. */
  openPage: (url: string) => void;
  /** Ask the webview for the microphone once and release it at once. */
  checkMic: () => void;
  /** Mark the letter read and leave. Setup stays in the bar afterwards. */
  finish: () => void;
}

export interface SetupModel {
  step: StepKey;
  /** `null` until the probe has answered — not the same fact as "no engine is installed". */
  probes: readonly EngineProbe[] | null;
  /** The engine the `settings` row names. Not a claim that the daemon is running on it. */
  engine: string;
  /** The ids offered, whatever the probe found. */
  engineIds: readonly string[];
  /** The brain directory. Empty means the daemon's own default, which is a real answer. */
  brainPath: string;
  tabs: readonly SetupTab[];
  /** Has the letter been read once? The three claims are shown on the first run only. */
  onboarded: boolean;
  /** Why the probe could not be read at all, verbatim, or null. */
  problem: string | null;
  /** What the webview said when asked for the microphone; `unknown` until it was asked. */
  mic: MicStanding;
  /** The browser's own words: the device's label, or the refusal. */
  micDetail: string;
  actions: SetupActions;
}

export interface SetupSources {
  step: StepKey;
  probes: readonly EngineProbe[] | null;
  engine: string;
  engineIds: readonly string[];
  brainPath: string;
  /** The raw tab list, as `stores/tabs.ts` holds it. */
  tabs: readonly { id: number; title: string; url: string }[];
  onboarded: boolean;
  problem: string | null;
  mic?: MicStanding;
  micDetail?: string;
  actions: SetupActions;
}

/** The store snapshot in, the view-model out. Pure; the readiness is derived on top of it. */
export function selectSetup(source: SetupSources): SetupModel {
  return {
    step: source.step,
    probes: source.probes,
    engine: source.engine,
    engineIds: source.engineIds,
    brainPath: source.brainPath,
    tabs: source.tabs.map((t) => ({
      id: t.id,
      title: t.title || t.url,
      host: hostOfSafely(t.url),
    })),
    onboarded: source.onboarded,
    problem: source.problem,
    mic: source.mic ?? "unknown",
    micDetail: source.micDetail ?? "",
    actions: source.actions,
  };
}

/**
 * The host, or the raw string when it is not a URL at all.
 *
 * `about:blank` is a tab the wizard's own "+" can produce, and `new URL("about:blank").host` is
 * the empty string — which would render as a tab open on nothing.
 */
function hostOfSafely(url: string): string {
  try {
    return new URL(url).host || url;
  } catch {
    return url;
  }
}

/** Fixtures and any variant that needs a set that does nothing. */
export const INERT_ACTIONS: SetupActions = {
  goTo: () => {},
  chooseEngine: () => {},
  setBrainPath: () => {},
  openPage: () => {},
  checkMic: () => {},
  finish: () => {},
};

/**
 * The Setup module's view-model — README section 3.5, the `settings` table, and the demo's first
 * act (README section 1).
 *
 * One module, two moods, one set of facts. Before the letter has been read once the module is
 * **onboarding**: two things the machine has to have — an engine and a page — and one button.
 * After that it is **settings**: the same facts as a list a returning person adjusts. The mode
 * is derived from `onboarded` at render and stored nowhere else, so there is no wizard state to
 * get out of step with the rows it describes.
 *
 * Two rules the shape keeps:
 *
 * - **Readiness is derived, never stored.** Whether the machine can run a turn is recomputed from
 *   the probe and the tab list every time (`readiness.ts`); a surface that said "ready" while the
 *   engine went missing is not a state this module can reach.
 * - **Nothing here claims the daemon restarted.** Choosing an engine writes one row; whether the
 *   running daemon is on it is the daemon store's fact, and `pendingEngine` is the difference
 *   between the two, said plainly. Which of the engine's states holds is decided once, in
 *   `engine-state.ts`; `startFailure` and `pendingEngine` are read off it.
 */
import type { DaemonHealth } from "@/lib/daemon";
import { engineLabel, probeOf, remedyFor, type EngineProbe } from "@/lib/engines";
import type { MicStanding } from "@/lib/voice";
import type { MotionChoice } from "@/lib/motion";
import type { ThemeChoice, TypeScale } from "@/stores/settings";
import { DEFAULT_SKIN, type Skin } from "@/stores/shell";

import { engineStateOf } from "./engine-state";

export type SetupMode = "onboarding" | "settings";

/** The setting writes a person makes here whose refusal is shown where the choice was made. */
export type SetupWrite = "engine" | "theme" | "skin" | "typeScale" | "motion" | "brainPath" | "wake";

/** A refused write, by which one, in the store's own words. Absent means it was not refused. */
export type SetupRefusals = Readonly<Partial<Record<SetupWrite, string>>>;

const NO_REFUSALS: SetupRefusals = {};

/** A tab, as this surface needs it: enough to say one is open on something. */
export interface SetupTab {
  id: number;
  title: string;
  host: string;
}

export interface EngineOption {
  id: string;
  label: string;
  /** What the probe said about this engine, or `null` while it has not answered. */
  probe: EngineProbe | null;
  /** Present when this engine cannot be chosen; shown on the control, never merely implied. */
  disabledReason?: string;
}

export interface SetupActions {
  chooseEngine: (id: string) => void;
  /** Ask the daemon again which engines are installed and signed in. */
  checkEngines: () => void;
  /** Hand the chosen engine to the running daemon: a staged shutdown and a fresh spawn. */
  restart: () => void;
  setTheme: (theme: ThemeChoice) => void;
  /** The skin she wears (ADR 0142). */
  setSkin: (skin: Skin) => void;
  setTypeScale: (scale: TypeScale) => void;
  /** Calm motion: `system` follows the OS, the others override it (ADR 0089). */
  setMotion: (motion: MotionChoice) => void;
  setBrainPath: (path: string) => void;
  /** Opens a tab. The one act of onboarding that changes the world. */
  openPage: (url: string) => void;
  /** Ask the webview for the microphone once and release it at once. */
  checkMic: () => void;
  /** Mark the letter read and leave into the browser. */
  finish: () => void;
  /** Show the welcome again. The rows stay exactly as they are. */
  reopenOnboarding: () => void;
}

/** The daemon failed or stopped: what to say, why, and the one action that starts it again. */
export interface StartFailure {
  engine: string;
  title: string;
  /** The daemon's own words, or a plain sentence when it gave none. */
  reason: string;
  actionLabel: string;
}

export interface SetupModel {
  mode: SetupMode;
  /** True once the `settings` rows have been read. Before that, every value is a default. */
  hydrated: boolean;
  /** The stored engine — what the *next* daemon starts on, not necessarily the running one. */
  engine: string;
  engines: readonly EngineOption[];
  /** `null` until the probe has answered — not the same fact as "no engine is installed". */
  probes: readonly EngineProbe[] | null;
  /** Why the probe could not be read at all, verbatim, or null. */
  problem: string | null;
  /** A check is in flight: the button reads "Checking...". */
  checking: boolean;
  theme: ThemeChoice;
  skin: Skin;
  typeScale: TypeScale;
  motion: MotionChoice;
  /** The brain directory. Empty means the daemon's own default, which is a real answer. */
  brainPath: string;
  tabs: readonly SetupTab[];
  mic: MicStanding;
  /** The browser's own words: the device's label, or the refusal. */
  micDetail: string;
  /** `/voice` is listed by the daemon. */
  voiceAvailable: boolean;
  /** Why the key does nothing, in the app's own words. Empty when it works. */
  voiceReason: string;
  /** Where the store file is. Read-only: a person who has to ask where their data went is owed it. */
  storePath: string | null;
  daemonHealth: DaemonHealth;
  /** The engine the daemon is running on, or "" while it is not running. */
  daemonEngine: string;
  /** The daemon has reported once. Before that `daemonEngine` is a placeholder, not a reading. */
  loaded: boolean;
  /** An engine the user chose that a running daemon is not on (`engine-state.ts`). Null when settled. */
  pendingEngine: string | null;
  /**
   * Non-null when the daemon failed or stopped, on the stored engine or on the one it still ran
   * on after another was chosen. Restart, on the stored engine, is its action.
   */
  startFailure: StartFailure | null;
  /** The writes that were refused; the control shows its own, and the stored row is shown again. */
  refusals: SetupRefusals;
  /** "Wake her" is being stored: the act stays until the row lands. */
  waking: boolean;
  actions: SetupActions;
}

export interface SetupSources {
  onboarded: boolean;
  hydrated: boolean;
  engine: string;
  engineIds: readonly string[];
  probes: readonly EngineProbe[] | null;
  problem: string | null;
  checking?: boolean;
  theme: ThemeChoice;
  /** Her own teal where a fixture does not say. */
  skin?: Skin;
  /** Comfortable where a fixture does not say. */
  typeScale?: TypeScale;
  /** System where a fixture does not say. */
  motion?: MotionChoice;
  brainPath: string;
  /** The raw tab list, as `stores/tabs.ts` holds it. */
  tabs: readonly { id: number; title: string; url: string }[];
  mic?: MicStanding;
  micDetail?: string;
  voiceAvailable?: boolean;
  voiceReason?: string;
  storePath: string | null;
  daemonHealth?: DaemonHealth;
  daemonEngine?: string;
  /** The reason the last start failed, as the daemon store kept it. */
  daemonError?: string;
  /** The daemon store has heard from Rust. Defaults to true, so a fixture is unchanged. */
  daemonLoaded?: boolean;
  /** `true` for one visit after "Show the welcome again", whatever the stored row says. */
  reopened?: boolean;
  /** None where a fixture does not say. */
  refusals?: SetupRefusals;
  waking?: boolean;
  actions: SetupActions;
}

/** The store snapshot in, the view-model out. Pure; readiness is derived on top of it. */
export function selectSetup(source: SetupSources): SetupModel {
  const engines: EngineOption[] = source.engineIds.map((id) => {
    const probe = probeOf(source.probes, id);
    const option: EngineOption = { id, label: engineLabel(id), probe };
    if (probe && probe.state !== "found") option.disabledReason = remedyFor(probe);
    return option;
  });
  const health = source.daemonHealth ?? "stopped";
  const daemonEngine = source.daemonEngine ?? "";
  const loaded = source.daemonLoaded ?? true;
  const label = engineLabel(source.engine);
  const state = engineStateOf({ ...source, loaded, daemonEngine, daemonHealth: health });
  const failed = health === "failed";
  const other = state.kind === "down-on-other";
  // A daemon that failed or stopped is a failed start, with the act that starts it again (the
  // only restart a daemon that is not ready asks for). It is not a failed look, so the probe's
  // "daemon is not ready" reason is not shown beside it.
  const startFailure: StartFailure | null =
    state.move === "restart" && health !== "ready"
      ? {
          engine: other ? daemonEngine : source.engine,
          title: other && failed
            ? `Athena stopped on ${engineLabel(daemonEngine)}.`
            : `Athena ${failed ? "could not start" : "is not running"}${other ? "" : ` on ${label}`}.`,
          reason: source.daemonError || (failed ? "No reason was given." : "It stopped without saying why."),
          actionLabel: `${other ? "Start" : "Try again"} on ${label}`,
        }
      : null;
  return {
    mode: source.onboarded && !source.reopened ? "settings" : "onboarding",
    hydrated: source.hydrated,
    engine: source.engine,
    engines,
    probes: source.probes,
    problem: startFailure ? null : source.problem,
    checking: source.checking ?? false,
    theme: source.theme,
    skin: source.skin ?? DEFAULT_SKIN,
    typeScale: source.typeScale ?? "comfortable",
    motion: source.motion ?? "system",
    brainPath: source.brainPath,
    tabs: source.tabs.map((t) => ({
      id: t.id,
      title: t.title || t.url,
      host: hostOfSafely(t.url),
    })),
    mic: source.mic ?? "unknown",
    micDetail: source.micDetail ?? "",
    voiceAvailable: source.voiceAvailable ?? false,
    voiceReason: source.voiceReason ?? "",
    storePath: source.storePath,
    daemonHealth: health,
    daemonEngine,
    loaded,
    pendingEngine: state.kind === "pending-switch" ? source.engine : null,
    startFailure,
    refusals: source.refusals ?? NO_REFUSALS,
    waking: source.waking ?? false,
    actions: source.actions,
  };
}

/**
 * The host, or the raw string when it is not a URL at all.
 *
 * `about:blank` is a tab the address field can produce, and `new URL("about:blank").host` is the
 * empty string — which would render as a tab open on nothing.
 */
function hostOfSafely(url: string): string {
  try {
    return new URL(url).host || url;
  } catch {
    return url;
  }
}

/** Fixtures and any variant that needs a set that does nothing. */
const noop = () => {};

export const INERT_ACTIONS: SetupActions = {
  chooseEngine: noop,
  checkEngines: noop,
  restart: noop,
  setTheme: noop,
  setSkin: noop,
  setTypeScale: noop,
  setMotion: noop,
  setBrainPath: noop,
  openPage: noop,
  checkMic: noop,
  finish: noop,
  reopenOnboarding: noop,
};

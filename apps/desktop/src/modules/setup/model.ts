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
 *   between the two, said plainly.
 */
import type { DaemonHealth } from "@/lib/daemon";
import { engineLabel, probeOf, remedyFor, type EngineProbe } from "@/lib/engines";
import type { MicStanding } from "@/lib/voice";
import type { ThemeChoice } from "@/stores/settings";

export type SetupMode = "onboarding" | "settings";

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
  /** Hand the chosen engine to the running daemon: a staged shutdown and a fresh spawn. */
  restart: () => void;
  setTheme: (theme: ThemeChoice) => void;
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
  theme: ThemeChoice;
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
  /** An engine the user chose that the running daemon is not on. Null when settled. */
  pendingEngine: string | null;
  actions: SetupActions;
}

export interface SetupSources {
  onboarded: boolean;
  hydrated: boolean;
  engine: string;
  engineIds: readonly string[];
  probes: readonly EngineProbe[] | null;
  problem: string | null;
  theme: ThemeChoice;
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
  /** `true` for one visit after "Show the welcome again", whatever the stored row says. */
  reopened?: boolean;
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
  return {
    mode: source.onboarded && !source.reopened ? "settings" : "onboarding",
    hydrated: source.hydrated,
    engine: source.engine,
    engines,
    probes: source.probes,
    problem: source.problem,
    theme: source.theme,
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
    pendingEngine: pendingEngineOf(source.engine, daemonEngine, health),
    actions: source.actions,
  };
}

/**
 * The stored engine is pending when a daemon is running and it is not the one running on it. A
 * daemon that is stopped or starting has nothing to disagree with; the row is simply what the
 * next start uses.
 */
export function pendingEngineOf(
  stored: string,
  running: string,
  health: DaemonHealth,
): string | null {
  if (health !== "ready" || !running) return null;
  return stored === running ? null : stored;
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
export const INERT_ACTIONS: SetupActions = {
  chooseEngine: () => {},
  restart: () => {},
  setTheme: () => {},
  setBrainPath: () => {},
  openPage: () => {},
  checkMic: () => {},
  finish: () => {},
  reopenOnboarding: () => {},
};

/**
 * The Settings module's view-model — README section 3.5 (the `settings` table) and section 3.1.
 *
 * What is on this surface is what the daemon is **started with**, plus the theme, plus where the
 * app keeps its data. The first build's panel also asked for a daemon URL, a token and an API
 * key, because the extension could not start anything; the shell mints the token and spawns the
 * sidecar, so none of those are settings and none appear here.
 *
 * Two rules the shape keeps:
 *
 * - **Readiness is never claimed here.** Choosing an engine writes one row and raises an
 *   *intent* — `pendingEngine` — and nothing on this page says the daemon is now running on it.
 *   Whether it is comes back from the sidecar (c20), which is the only thing that knows.
 * - **`null` probes are not "no engine installed".** The probe not having answered is a third
 *   state, and the surface owes the user the difference.
 */
import { engineLabel, probeOf, remedyFor, type EngineProbe } from "@/lib/engines";
import type { ThemeChoice } from "@/stores/settings";

export interface EngineOption {
  id: string;
  label: string;
  /** What the probe said about this engine, or `null` while it has not answered. */
  probe: EngineProbe | null;
  /** Present when this engine cannot be chosen; shown on the control, never merely implied. */
  disabledReason?: string;
}

export interface SettingsActions {
  chooseEngine: (id: string) => void;
  /**
   * Hand the chosen engine to the running daemon.
   *
   * The sidecar is c20's, and this commit does not reach into it: the *intent* is exposed here
   * as a callback and the view says plainly when nothing is listening. That is the seam — a
   * view-model callback — rather than a `daemon_restart` this branch would have had to invent.
   */
  restartDaemon: () => void;
  /** Keep the stored engine and stop asking. The row stays; the running daemon does too. */
  dismissRestart: () => void;
  setTheme: (theme: ThemeChoice) => void;
}

export interface SettingsModel {
  /** True once the `settings` rows have been read. Before that, everything below is a default. */
  hydrated: boolean;
  /** The stored engine — what the *next* daemon starts on, not necessarily the running one. */
  engine: string;
  engines: readonly EngineOption[];
  theme: ThemeChoice;
  /** Where the store file is. Read-only: a user who has to ask where their data went is owed it. */
  storePath: string | null;
  /** An engine the user chose that the running daemon has not been given. Null when settled. */
  pendingEngine: string | null;
  /** Is anything listening for `restartDaemon` yet? False until the sidecar lands. */
  restartWired: boolean;
  /** A sentence when the probe could not be read at all, null when it could. Verbatim. */
  problem: string | null;
  actions: SettingsActions;
}

export interface SettingsSources {
  hydrated: boolean;
  engine: string;
  /** `/health`'s probe list, or `null` while nothing has answered. */
  probes: readonly EngineProbe[] | null;
  theme: ThemeChoice;
  storePath: string | null;
  pendingEngine: string | null;
  restartWired: boolean;
  problem: string | null;
  /** The ids offered, in bar order, whatever the probe found. */
  engineIds: readonly string[];
  actions: SettingsActions;
}

/**
 * The store snapshot in, the view-model out, and nothing else in the world.
 *
 * An engine the probe could not find is still *offered*, with the reason on it: hiding it would
 * turn "codex is not installed" into "this app has one engine", which is a different and less
 * true statement.
 */
export function selectSettings(source: SettingsSources): SettingsModel {
  const engines: EngineOption[] = source.engineIds.map((id) => {
    const probe = probeOf(source.probes ?? null, id);
    const option: EngineOption = { id, label: engineLabel(id), probe };
    if (probe && probe.state !== "found") option.disabledReason = remedyFor(probe);
    return option;
  });
  return {
    hydrated: source.hydrated,
    engine: source.engine,
    engines,
    theme: source.theme,
    storePath: source.storePath,
    pendingEngine: source.pendingEngine,
    restartWired: source.restartWired,
    problem: source.problem,
    actions: source.actions,
  };
}

/**
 * What the surface has to say about an engine change that has not reached the daemon.
 *
 * Derived at render from `pendingEngine` and `restartWired`, never stored: a surface that kept a
 * "needs restart" boolean is a surface that can disagree with the row it describes.
 */
export interface RestartNotice {
  /** The one line in the app's own words. */
  title: string;
  /** What pressing the action would do, or why there is no action. */
  detail: string;
  /** Null when there is nothing to press yet — the sidecar is not wired. */
  actionLabel: string | null;
}

export function restartNotice(model: SettingsModel): RestartNotice | null {
  if (!model.pendingEngine) return null;
  const label = engineLabel(model.pendingEngine);
  if (!model.restartWired) {
    return {
      title: `${label} is stored, and the running daemon is still on the old engine.`,
      detail:
        "Restarting the sidecar is the next commit's; until it lands, the new engine takes effect the next time Athena starts.",
      actionLabel: null,
    };
  }
  return {
    title: `${label} is stored. The daemon has to restart to run on it.`,
    detail: "A restart drops nothing: conversations are on disk and resume on the new engine.",
    actionLabel: `Restart on ${label}`,
  };
}

/** Fixtures and any variant that needs a set that does nothing. */
export const INERT_ACTIONS: SettingsActions = {
  chooseEngine: () => {},
  restartDaemon: () => {},
  dismissRestart: () => {},
  setTheme: () => {},
};

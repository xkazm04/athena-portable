/**
 * The Settings module's fixtures — four view-models, no store, no shell.
 *
 * `degraded` is what this module's degradation actually *is*: the daemon is not running, so no
 * probe has answered and the engine block is a list of names with nothing known about any of
 * them. It is not "some fields are empty" — that would be `empty`, which is the first tick after
 * mount, before the `settings` rows have been read.
 */
import type { EngineProbe } from "@/lib/engines";

import { INERT_ACTIONS, selectSettings, type SettingsModel } from "./model";

const ENGINE_IDS = ["claude_code", "codex"] as const;

function probe(id: string, state: EngineProbe["state"], detail: string): EngineProbe {
  return { id, state, detail };
}

const BOTH_FOUND: EngineProbe[] = [
  probe("claude_code", "found", "2.1.268 (Claude Code)"),
  probe("codex", "found", "codex-cli 0.41.0"),
];

function model(over: Partial<Parameters<typeof selectSettings>[0]>): SettingsModel {
  return selectSettings({
    hydrated: true,
    engine: "claude_code",
    probes: BOTH_FOUND,
    theme: "system",
    storePath: "%APPDATA%\\com.athena.portable\\athena.sqlite",
    pendingEngine: null,
    restartWired: false,
    problem: null,
    engineIds: ENGINE_IDS,
    actions: INERT_ACTIONS,
    ...over,
  });
}

/** One tick after mount: nothing has been read, so nothing may be shown as the user's choice. */
const empty = model({
  hydrated: false,
  probes: null,
  storePath: null,
});

const typical = model({ theme: "dark" });

/**
 * Every part of the block saying something at once: one engine is installed but signed out, the
 * user has chosen the other, the choice has not reached the daemon, and the path is long enough
 * to have to wrap somewhere sensible.
 */
const heavy = model({
  engine: "codex",
  theme: "light",
  probes: [
    probe("claude_code", "not_logged_in", "claude 2.1.268 — `claude` reports no active session"),
    probe("codex", "found", "codex-cli 0.41.0 (OpenAI, signed in as a-very-long-account-name)"),
  ],
  pendingEngine: "codex",
  restartWired: true,
  storePath:
    "C:\\Users\\a-long-account-name\\AppData\\Roaming\\com.athena.portable\\stores\\athena.sqlite",
});

/** The daemon never came up, so the probe never answered. The names are all that is known. */
const degraded = model({
  probes: null,
  problem: "daemon_offline",
  pendingEngine: "codex",
  engine: "codex",
});

export const fixtures: Record<string, SettingsModel> = { empty, typical, heavy, degraded };

export const fixtureIds = ["empty", "typical", "heavy", "degraded"] as const;

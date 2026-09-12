/**
 * The Setup module's fixtures — view-models, no store, no shell, no daemon.
 *
 * `empty` is a first launch that has answered nothing yet: no probe, no page, the letter still
 * to be read. `typical` is the settings list on a machine that works. `heavy` is every row saying
 * something awkward at once — a signed-out engine, a pending restart, a long path, a refused
 * microphone, eight tabs. `degraded` is the daemon offline, so nothing about the engine or the
 * voice is known. `onboarding` and `settings` are the two moods by name.
 */
import type { EngineProbe } from "@/lib/engines";

import { INERT_ACTIONS, selectSetup, type SetupModel, type SetupSources } from "./model";

const ENGINE_IDS = ["claude_code", "codex"] as const;

function probe(id: string, state: EngineProbe["state"], detail: string): EngineProbe {
  return { id, state, detail };
}

function tab(id: number, title: string, url: string) {
  return { id, title, url };
}

function model(over: Partial<SetupSources>): SetupModel {
  return selectSetup({
    onboarded: true,
    hydrated: true,
    engine: "claude_code",
    engineIds: ENGINE_IDS,
    probes: [
      probe("claude_code", "found", "2.1.268 (Claude Code)"),
      probe("codex", "not_found", "`codex` is not on the PATH"),
    ],
    problem: null,
    theme: "system",
    brainPath: "",
    tabs: [],
    mic: "unknown",
    micDetail: "",
    voiceAvailable: true,
    voiceReason: "",
    storePath: "%APPDATA%\\com.athena.portable\\athena.sqlite",
    daemonHealth: "ready",
    daemonEngine: "claude_code",
    actions: INERT_ACTIONS,
    ...over,
  });
}

/** A first launch, one tick in: nothing has answered, so nothing may be asserted. */
const empty = model({
  onboarded: false,
  hydrated: false,
  probes: null,
  storePath: null,
  voiceAvailable: false,
  daemonHealth: "starting",
  daemonEngine: "",
});

/** The letter, on a machine where both answers are in. */
const onboarding = model({
  onboarded: false,
  brainPath: "",
  tabs: [tab(1, "Invoices — March", "https://invoicing.example.test/invoices")],
  mic: "granted",
  micDetail: "Headset Microphone (USB Audio)",
});

/** The list, on a machine that works. */
const settings = model({
  theme: "dark",
  brainPath: "~/athena/brain",
  tabs: [tab(1, "Invoices — March", "https://invoicing.example.test/invoices")],
  mic: "granted",
  micDetail: "Headset Microphone (USB Audio)",
});

const typical = settings;

const heavy = model({
  engine: "codex",
  theme: "light",
  probes: [
    probe(
      "claude_code",
      "not_logged_in",
      "claude 2.1.268 answered its version flag, and `claude auth status` reports no active session on this machine",
    ),
    probe("codex", "found", "codex-cli 0.41.0 (OpenAI, signed in as a-very-long-account-name)"),
  ],
  brainPath: "C:\\Users\\a-long-account-name\\Documents\\Athena\\brains\\studio-primary\\brain",
  tabs: Array.from({ length: 8 }, (_, i) =>
    tab(
      i + 1,
      i % 3 === 0 ? `A title long enough that the row has to elide it — ${i + 1}` : `Tab ${i + 1}`,
      `https://host-${i + 1}.example.test/a/path/that/is/not/short?page=${i + 1}`,
    ),
  ),
  mic: "denied",
  micDetail:
    "NotAllowedError: Permission denied by system — the operating system's privacy setting for microphone access is off for this application",
  voiceAvailable: false,
  voiceReason: "the daemon was started without a voice backend",
  daemonEngine: "claude_code",
  storePath:
    "C:\\Users\\a-long-account-name\\AppData\\Roaming\\com.athena.portable\\stores\\athena.sqlite",
});

/** The daemon never came up, so the probe never answered. Everything else still reads. */
const degraded = model({
  probes: null,
  problem: "daemon_offline",
  brainPath: "~/athena/brain",
  tabs: [tab(1, "Invoices — March", "https://invoicing.example.test/invoices")],
  voiceAvailable: false,
  voiceReason: "the daemon is not running yet",
  daemonHealth: "failed",
  daemonEngine: "",
});

export const fixtures: Record<string, SetupModel> = {
  empty,
  typical,
  heavy,
  degraded,
  onboarding,
  settings,
};

export const fixtureIds = ["empty", "typical", "heavy", "degraded", "onboarding", "settings"] as const;

/**
 * The surface's fixtures — README section 3.5. View-models with inert actions, so the preview
 * harness and the tests render every state with no Tauri, no store and no daemon. The data is
 * invented demo content, as the other modules' fixtures are.
 */
import type { FixtureId } from "@/modules/types";

import { INERT_ACTIONS, selectSurface, type SurfaceModel, type SurfaceSources } from "./model";

const base: SurfaceSources = {
  athena: { state: "seal", cards: 0, line: "" },
  windowVisible: false,
  apps: [
    { id: "ledgerbox", host: "ledgerbox.example.test", enabled: true },
    { id: "inbox", host: "mail.example.test", enabled: true },
    { id: "gate-docs", host: "docs.example.test", enabled: true },
    { id: "crm", host: "crm.example.test", enabled: false },
    { id: "calendar", host: "calendar.example.test", enabled: false },
  ],
  openTabs: 3,
  projects: { count: 3, loaded: true, failed: false, active: "Renovation" },
  accounts: [
    {
      id: "gmail",
      label: "Gmail",
      connected: false,
      attention: true,
      word: "needs reconnecting",
      line: "Gmail let the grant go; connect again to continue.",
    },
    { id: "notion", label: "Notion", connected: true, attention: false, word: "connected", line: "Connected as Test User." },
    {
      id: "calendar",
      label: "Google Calendar",
      connected: false,
      attention: false,
      word: "not connected",
      line: "Nothing is stored for Google Calendar.",
    },
  ],
  chores: { total: 16, benched: 12, foundUsd: 551, loaded: true, failed: false },
  voiceAvailable: true,
  voiceKnown: true,
  engine: { label: "Claude Code", standing: "done", checkFailed: false, summary: "Claude Code is ready" },
  pendingRestart: null,
  inShell: true,
  actions: INERT_ACTIONS,
};

const make = (over: Partial<SurfaceSources> = {}): SurfaceModel => selectSurface({ ...base, ...over });

export const fixtures: Record<string, SurfaceModel> = {
  empty: make({
    apps: [],
    openTabs: 0,
    projects: { count: 0, loaded: true, failed: false, active: "" },
    accounts: [],
    chores: { total: 0, benched: 0, foundUsd: 0, loaded: true, failed: false },
    voiceAvailable: false,
    engine: { label: "Claude Code", standing: "unknown", checkFailed: false, summary: "checking the engine…" },
  }),
  typical: make(),
  /** Her window is out: her illustration's press puts it away. */
  "window out": make({ windowVisible: true }),
  working: make({ athena: { state: "tape", cards: 0, line: "Reading Invoices" } }),
  hearing: make({ athena: { state: "hear", cards: 0, line: "" } }),
  /** A face chosen (the ADR on Athena's face): her Avatar stands where the Bell would. */
  face: make({ avatar: "b04-owl", athena: { state: "face", cards: 0, line: "listening" } }),
  "face origami": make({ avatar: "d08-origami", athena: { state: "face", cards: 0, line: "listening" } }),
  asking: make({ athena: { state: "slip", cards: 2, line: "" } }),
  heavy: make({
    apps: Array.from({ length: 9 }, (_, i) => ({
      id: `host-${i + 1}`,
      host: `host-${i + 1}.example.test`,
      enabled: i % 3 !== 2,
    })),
    openTabs: 12,
    projects: { count: 9, loaded: true, failed: false, active: "" },
  }),
  // The shipped playbooks load lazily: until they arrive the light says it is counting.
  counting: make({ chores: { total: 0, benched: 0, foundUsd: 0, loaded: false, failed: false } }),
  degraded: make({
    inShell: false,
    projects: { count: 0, loaded: false, failed: true, active: "" },
    engine: {
      label: "Claude Code",
      standing: "missing",
      checkFailed: false,
      summary: "Claude Code is installed but not signed in",
    },
    voiceAvailable: false,
  }),
};

/** Every account connected and the engine ready: nothing needs the person, so no list is drawn. */
fixtures["all well"] = make({
  accounts: base.accounts.map((a) => ({ ...a, connected: true, attention: false, word: "connected", line: "Connected." })),
});

/**
 * More needs than the list shows: Codex is chosen but not found (so it cannot run, and she still
 * runs on Claude Code until a restart) and two accounts want the person. Three are drawn and the
 * rest are one press away.
 */
fixtures["many needs"] = make({
  engine: {
    label: "Codex",
    standing: "missing",
    checkFailed: false,
    summary: "Codex is chosen, but it was not found on this computer",
  },
  pendingRestart: { label: "Codex", running: "Claude Code" },
  accounts: [
    base.accounts[0]!,
    {
      id: "notion",
      label: "Notion",
      connected: true,
      attention: true,
      word: "broken (3 min ago)",
      line: "Notion did not answer the last probe.",
    },
    base.accounts[2]!,
  ],
});

export const fixtureIds: readonly FixtureId[] = Object.keys(fixtures);

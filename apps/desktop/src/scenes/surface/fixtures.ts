/**
 * The surface's fixtures — README section 3.5. View-models with inert actions, so the preview
 * harness and the tests render every state with no Tauri, no store and no daemon. The data is
 * invented demo content, as the other modules' fixtures are.
 */
import type { FixtureId } from "@/modules/types";

import { INERT_ACTIONS, selectSurface, type SurfaceModel, type SurfaceSources } from "./model";

const base: SurfaceSources = {
  athena: { state: "seal", cards: 0, line: "" },
  apps: [
    { id: "ledgerbox", host: "ledgerbox.example.test", enabled: true },
    { id: "inbox", host: "mail.example.test", enabled: true },
    { id: "gate-docs", host: "docs.example.test", enabled: true },
    { id: "crm", host: "crm.example.test", enabled: false },
    { id: "calendar", host: "calendar.example.test", enabled: false },
  ],
  openTabs: 3,
  accounts: [
    { id: "gmail", label: "Gmail", connected: false, attention: true },
    { id: "notion", label: "Notion", connected: true, attention: false },
    { id: "calendar", label: "Google Calendar", connected: false, attention: false },
  ],
  chores: { total: 16, benched: 12, foundUsd: 551, loaded: true, failed: false },
  voiceAvailable: true,
  voiceKnown: true,
  engine: { label: "Claude Code", standing: "done", checkFailed: false },
  inShell: true,
  actions: INERT_ACTIONS,
};

const make = (over: Partial<SurfaceSources> = {}): SurfaceModel => selectSurface({ ...base, ...over });

export const fixtures: Record<string, SurfaceModel> = {
  empty: make({
    apps: [],
    openTabs: 0,
    accounts: [],
    chores: { total: 0, benched: 0, foundUsd: 0, loaded: true, failed: false },
    voiceAvailable: false,
    engine: { label: "Claude Code", standing: "unknown", checkFailed: false },
  }),
  typical: make(),
  working: make({ athena: { state: "tape", cards: 0, line: "Reading Invoices" } }),
  hearing: make({ athena: { state: "hear", cards: 0, line: "" } }),
  asking: make({ athena: { state: "slip", cards: 2, line: "" } }),
  heavy: make({
    apps: Array.from({ length: 9 }, (_, i) => ({
      id: `host-${i + 1}`,
      host: `host-${i + 1}.example.test`,
      enabled: i % 3 !== 2,
    })),
    openTabs: 12,
  }),
  // The shipped playbooks load lazily: until they arrive the light says it is counting.
  counting: make({ chores: { total: 0, benched: 0, foundUsd: 0, loaded: false, failed: false } }),
  degraded: make({
    inShell: false,
    engine: { label: "Claude Code", standing: "missing", checkFailed: false },
    voiceAvailable: false,
  }),
};

export const fixtureIds: readonly FixtureId[] = Object.keys(fixtures);

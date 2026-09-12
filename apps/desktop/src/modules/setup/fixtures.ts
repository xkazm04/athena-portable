/**
 * The Setup wizard's fixtures — four view-models, no store, no shell, no daemon.
 *
 * `empty` is a first launch that has answered nothing yet: no probe, no brain, no tab, and the
 * three claims still on the page. `degraded` is the one failure this surface actually has before
 * a panel exists — the daemon is not running, so the probe cannot answer and the engine passage
 * has nothing to report but the reason.
 *
 * `heavy` is not "more of the same": it is every passage saying something awkward at once, which
 * is the only way a fixture can protect a layout — a signed-out engine with a long detail, a long
 * Windows path, and eight tabs.
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
    step: "engine",
    probes: [
      probe("claude_code", "found", "2.1.268 (Claude Code)"),
      probe("codex", "not_found", "`codex` is not on the PATH"),
    ],
    engine: "claude_code",
    engineIds: ENGINE_IDS,
    brainPath: "",
    tabs: [],
    onboarded: false,
    problem: null,
    actions: INERT_ACTIONS,
    ...over,
  });
}

/** A first launch, one tick in: nothing has answered, so nothing may be asserted. */
const empty = model({ probes: null });

const typical = model({
  step: "page",
  brainPath: "~/athena/brain",
  tabs: [tab(1, "Invoices — March", "https://invoicing.example.test/invoices")],
  onboarded: false,
});

const heavy = model({
  step: "brain",
  probes: [
    probe(
      "claude_code",
      "not_logged_in",
      "claude 2.1.268 answered its version flag, and `claude auth status` reports no active session on this machine",
    ),
    probe("codex", "found", "codex-cli 0.41.0"),
  ],
  engine: "claude_code",
  brainPath: "C:\\Users\\a-long-account-name\\Documents\\Athena\\brains\\studio-primary\\brain",
  tabs: Array.from({ length: 8 }, (_, i) =>
    tab(
      i + 1,
      i % 3 === 0 ? `A title long enough that the row has to elide it — ${i + 1}` : `Tab ${i + 1}`,
      `https://host-${i + 1}.example.test/a/path/that/is/not/short?page=${i + 1}`,
    ),
  ),
  onboarded: true,
});

/** The daemon is not running, so the probe cannot answer. Everything else still reads. */
const degraded = model({
  probes: null,
  problem: "daemon_offline",
  brainPath: "~/athena/brain",
  tabs: [tab(1, "Invoices — March", "https://invoicing.example.test/invoices")],
  onboarded: true,
});

export const fixtures: Record<string, SetupModel> = { empty, typical, heavy, degraded };

export const fixtureIds = ["empty", "typical", "heavy", "degraded"] as const;

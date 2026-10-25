/**
 * The Projects scene's fixtures — README section 3.5, ADR 0090 and 0225. Invented demo content, as
 * the other scenes' fixtures are: the summaries the daemon would answer, the Browser module's own
 * registered apps, and a few saved chores. Actions answer from the fixture and change nothing, so
 * the preview and the tests render every state with no Tauri, no store and no daemon.
 */
import type { Path } from "@/depth/model";
import { CORE, type SpaceMemoryKind, type SpaceMemoryPage, type SpaceMemoryRow, type SpaceSummary } from "@/lib/spaces";
import { fixtures as browser } from "@/modules/browser/fixtures";
import type { FixtureId } from "@/modules/types";

import { selectProjects, type ChoreRow, type ChoresState, type ProjectsActions, type ProjectsModel, type ProjectsSources } from "./model";

const REGISTERED = browser.typical!.apps;

const space = (over: Partial<SpaceSummary> & Pick<SpaceSummary, "id" | "name">): SpaceSummary => ({
  brief: "",
  apps: [],
  hue: 210,
  created: "2026-09-01T09:00:00Z",
  updated: "2026-10-20T09:00:00Z",
  counts: { episodes: 0, facts: 0, procedurals: 0, chores: 0 },
  ...over,
});

export const RENOVATION = space({
  id: "spc_0a1b2c3d4e5f",
  name: "Renovation",
  brief:
    "The kitchen and the bathroom, from quotes to the last invoice.\nKeep every quote next to its contractor, and never pay a deposit above 20%.",
  apps: ["http://localhost:3004", "https://crm.example.test", "https://builder.example.test"],
  hue: 24,
  created: "2026-08-02T10:00:00Z",
  updated: "2026-10-24T18:30:00Z",
  counts: { episodes: 168, facts: 38, procedurals: 6, chores: 4 },
});

const TAXES = space({
  id: "spc_1b2c3d4e5f60",
  name: "Taxes 2026",
  brief: "Receipts, deductions and the filing in April.",
  apps: ["https://example.test", "http://localhost:3004"],
  hue: 204,
  created: "2026-08-20T10:00:00Z",
  updated: "2026-10-22T08:00:00Z",
  counts: { episodes: 31, facts: 14, procedurals: 3, chores: 1 },
});

const GARDEN = space({
  id: "spc_2c3d4e5f6071",
  name: "Garden club",
  hue: 132,
  created: "2026-10-18T10:00:00Z",
  updated: "2026-10-18T10:00:00Z",
});

const CHORES: ChoreRow[] = [
  { caseId: "proj_000000000001", playbookId: "contractor-quotes", title: "Compare contractor quotes", spaceId: RENOVATION.id },
  { caseId: "proj_000000000002", playbookId: "invoice-chaser", title: "Chase unpaid invoices", spaceId: RENOVATION.id },
  { caseId: "proj_000000000003", playbookId: "permit-tracker", title: "Track the building permit", spaceId: RENOVATION.id },
  { caseId: "proj_000000000004", playbookId: "warranty-keeper", title: "Keep the warranties", spaceId: RENOVATION.id },
  { caseId: "proj_000000000005", playbookId: "receipt-sorter", title: "Sort this year's receipts", spaceId: TAXES.id },
  { caseId: "proj_000000000006", playbookId: "flight-compensation", title: "Claim flight delays", spaceId: CORE },
  { caseId: "proj_000000000007", playbookId: "subscription-audit", title: "Cancel what I do not use", spaceId: CORE },
];

const READ: ChoresState = { loaded: true, problem: "", rows: CHORES, footer: "" };

/** The memory each project answers, newest first. */
const MEMORY: SpaceMemoryRow[] = [
  { id: "fct_000000000001", kind: "fact", line: "\"The tiler's quote was 4,200 EUR, labour only.\"", created: "2026-10-24T18:20:00Z" },
  { id: "prc_000000000001", kind: "procedural", line: "\"Before paying a deposit, check it is at most 20% of the quote.\"", created: "2026-10-23T11:00:00Z" },
  { id: "epi_000000000001", kind: "episode", line: "\"Read the second quote from Novak & Sons on the builder's portal.\"", created: "2026-10-23T10:40:00Z" },
  { id: "fct_000000000002", kind: "fact", line: "\"The bathroom window is 90 by 120 cm.\"", created: "2026-10-21T09:00:00Z" },
  { id: "epi_000000000002", kind: "episode", line: "\"Drafted a reminder for invoice 2026-118 and kept it as a draft.\"", created: "2026-10-20T16:00:00Z" },
];

/** A page as the daemon would answer it: the kind's rows, at most `limit`, and the whole count. */
export function memoryPage(rows: readonly SpaceMemoryRow[], kind?: SpaceMemoryKind, total?: number): SpaceMemoryPage {
  const of = kind ? rows.filter((r) => r.kind === kind) : rows;
  return { rows: of, showing: of.length, total: total ?? of.length };
}

export const FIXTURE_ACTIONS: ProjectsActions = {
  create: (input) =>
    Promise.resolve(space({ id: "spc_ffffffffffff", name: input.name, created: "2026-10-25T09:00:00Z", updated: "2026-10-25T09:00:00Z" })),
  update: (id, patch) => {
    const found = [RENOVATION, TAXES, GARDEN].find((s) => s.id === id) ?? RENOVATION;
    return Promise.resolve({ ...found, ...patch, apps: patch.apps ?? found.apps, hue: patch.hue ?? found.hue });
  },
  erase: (id) => {
    const found = [RENOVATION, TAXES, GARDEN].find((s) => s.id === id) ?? RENOVATION;
    return Promise.resolve({ id, episodes: found.counts.episodes, facts: found.counts.facts, procedurals: found.counts.procedurals, chores_unlinked: found.counts.chores });
  },
  // The daemon caps a page at 50 by default; Renovation remembers 212, so the page says so.
  memory: (id, kind) => Promise.resolve(memoryPage(id === GARDEN.id ? [] : MEMORY, kind, id === RENOVATION.id && !kind ? 212 : undefined)),
  promote: () => Promise.resolve(),
  linkCase: () => Promise.resolve(),
};

const base: ProjectsSources = {
  spaces: [RENOVATION, TAXES, GARDEN],
  loaded: true,
  problem: "",
  activeId: RENOVATION.id,
  pending: null,
  registered: REGISTERED,
  chores: READ,
  actions: FIXTURE_ACTIONS,
};

const make = (over: Partial<ProjectsSources> = {}): ProjectsModel => selectProjects({ ...base, ...over });

const NAMES = ["Renovation", "Taxes 2026", "Garden club", "Wedding", "Job search", "Car", "Moving flat", "Health", "Side shop"];

/** Nine projects, a spread of hues, apps and memories: the orrery at its busiest ordinary size. */
const MANY: SpaceSummary[] = NAMES.map((name, i) =>
  space({
    id: `spc_${(i + 1).toString(16).padStart(12, "0")}`,
    name,
    brief: i % 3 === 2 ? "" : `What Athena is for in ${name.toLowerCase()}.`,
    apps: REGISTERED.slice(0, i % 4).map((a) => a.origin).concat(i === 4 ? ["https://jobs.example.test", "https://mail.example.test"] : []),
    hue: (i * 40 + 10) % 360,
    created: `2026-0${1 + (i % 9)}-1${i}T10:00:00Z`,
    counts: { episodes: [0, 4, 30, 160, 900, 12, 0, 60, 2400][i]!, facts: i * 2, procedurals: i % 3, chores: i % 4 },
  }),
);

/** One project paired with the most apps a space may hold (24). */
const CROWDED = space({
  ...RENOVATION,
  id: "spc_3d4e5f607182",
  name: "Office move",
  brief: "Every tool the office runs on, moved to the new building by December.",
  apps: Array.from({ length: 24 }, (_, i) => (i < REGISTERED.length ? REGISTERED[i]!.origin : `https://tool-${i + 1}.example.test`)),
  hue: 280,
  created: "2026-09-10T10:00:00Z",
});

export const fixtures: Record<string, ProjectsModel> = {
  typical: make(),
  empty: make({ spaces: [], activeId: CORE, chores: { ...READ, rows: CHORES.map((c) => ({ ...c, spaceId: CORE })) } }),
  /** The first list has not answered yet. */
  reading: make({ spaces: [], loaded: false, chores: { loaded: false, problem: "", rows: [], footer: "" } }),
  degraded: make({
    spaces: [],
    loaded: true,
    problem: "offline: The daemon is not running.",
    activeId: CORE,
    chores: { loaded: true, problem: "offline: The daemon is not running.", rows: [], footer: "" },
  }),
  heavy: make({ spaces: MANY, activeId: MANY[4]!.id, chores: READ }),
  full: make({ spaces: [CROWDED, TAXES], activeId: CORE }),
  /** A switch waits on the turn that is running. */
  switching: make({ activeId: TAXES.id, pending: RENOVATION.id }),
};

export const fixtureIds: readonly FixtureId[] = Object.keys(fixtures);

/** The place each fixture's story is about, for the preview and the tests. */
export const PATHS: Record<string, Path> = {
  field: { root: "projects" },
  project: { root: "projects", item: RENOVATION.id },
  empty: { root: "projects", item: GARDEN.id },
  core: { root: "projects", item: "core" },
  memory: { root: "projects", item: RENOVATION.id, sub: { kind: "memory" } },
  coreMemory: { root: "projects", item: "core", sub: { kind: "memory" } },
  missing: { root: "projects", item: "spc_999999999999" },
};

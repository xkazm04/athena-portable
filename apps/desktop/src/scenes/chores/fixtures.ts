/**
 * The Chores scene's fixtures — README section 3.5, ADR 0040 and 0090.
 *
 * The module's own view-models, reused as they are (`modules/playbooks/fixtures.ts`): built through
 * the same reader the shipped set goes through, so a fixture cannot drift into a shape no real
 * playbook could produce. What the old view expressed as an open layer (`initialOpenFor`,
 * `initialFacetFor`, `initialTurnFor`) is a place here: `pathFor` names it, and the preview opens
 * it with `&at=%23/chores/<id>`. `typical` is first, because the perf gate renders the first.
 */
import type { Path } from "@/depth/model";
import type { Playbook } from "@/lib/playbooks";
import type { CategoryId, JobId } from "@/lib/playbook-taxonomy";
import { selectPlaybooks, type PlaybooksModel } from "@/modules/playbooks/model";
import {
  fixtures as moduleFixtures,
  initialFacetFor,
  initialOpenFor,
  initialTurnFor,
} from "@/modules/playbooks/fixtures";
import type { FixtureId } from "@/modules/types";

import { ADOPT_FIXTURES, ADOPT_PLAYBOOK, CASE_FIXTURES, PREVIEW_CASE } from "./adopt/fixtures";
import { INTAKE_FIXTURES } from "./intake/fixtures";
import { adoptPath, casePath, chorePath, newChorePath, runPath } from "./model";

/** The module's fixtures minus the one per shipped playbook, which the evidence capture films. */
const IDS: readonly FixtureId[] = [
  "typical",
  "empty",
  "heavy",
  "degraded",
  "open",
  "open-run",
  "open-turn-2",
  "open-traps",
  "open-short",
  "open-short-traps",
  "open-short-proof",
  "open-unbenched",
  "open-evidence",
  "open-short-evidence",
  "shipped",
  "shipped-open",
  "shipped-proof",
];

/** A frame for an invented storyboard still: a flat card with a number, so no image file is needed. */
const still = (n: number) =>
  "data:image/svg+xml," +
  encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="320" height="200"><rect width="320" height="200" fill="#0f1c1f"/><rect x="16" y="16" width="${60 + 40 * n}" height="14" rx="4" fill="#2f6f73"/><text x="160" y="130" font-size="48" fill="#9fd" text-anchor="middle">${n}</text></svg>`,
  );

const AREAS: Record<string, [CategoryId, JobId]> = {
  "carrier-refunds": ["freight", "recover"],
  "chargeback-evidence": ["commerce", "contest"],
  "flight-compensation": ["consumer", "claim"],
};

/**
 * The ledger's own fixture: `typical`, each playbook given an area and a job (the module's
 * invented playbooks name none), and the refunds run given a storyboard of three stills. Built
 * through the module's selector, so the verdicts, the points and the totals are derived as they
 * are for the shipped set.
 */
function ledgerFixture(): PlaybooksModel {
  const typical = moduleFixtures.typical!;
  const playbooks = typical.items.map((v): Playbook => {
    const [category, job] = AREAS[v.id] ?? [null, null];
    const p = v.playbook;
    const evidence =
      p.evidence && v.id === "carrier-refunds"
        ? {
            ...p.evidence,
            story: [
              { url: still(1), caption: "Abstract", turn: null },
              { url: still(2), caption: "Turn 2 - Carrier billing centre: list the invoice", turn: 2 },
              { url: still(3), caption: "What she filed", turn: null },
            ],
          }
        : p.evidence;
    return { ...p, category, job, evidence };
  });
  return selectPlaybooks(playbooks, typical.actions);
}

export const fixtures: Readonly<Record<string, PlaybooksModel>> = {
  ...Object.fromEntries(IDS.map((id) => [id, moduleFixtures[id]!])),
  ledger: ledgerFixture(),
  // The Adopt studio plays a scripted session over a shipped playbook (ADR 0097).
  ...Object.fromEntries(ADOPT_FIXTURES.map((id) => [id, moduleFixtures.shipped!])),
  // A saved case of the same chore, on its topic page and reopened in the studio (ADR 0123).
  ...Object.fromEntries(CASE_FIXTURES.map((id) => [id, moduleFixtures.shipped!])),
  // The front door plays a scripted conversation over the same shipped set (ADR 0098).
  ...Object.fromEntries(INTAKE_FIXTURES.map((id) => [id, moduleFixtures.shipped!])),
};

export const fixtureIds: readonly FixtureId[] = [
  ...IDS,
  "ledger",
  ...ADOPT_FIXTURES,
  ...CASE_FIXTURES,
  ...INTAKE_FIXTURES,
];

/** Where a fixture is meant to be looked at: the catalogue, a chore's topic page, a turn of its replay, or its studio. */
export function pathFor(fixture: FixtureId): Path {
  if ((ADOPT_FIXTURES as readonly string[]).includes(fixture)) return adoptPath(ADOPT_PLAYBOOK);
  if (fixture === "adopt-case") return casePath(ADOPT_PLAYBOOK, PREVIEW_CASE.case_id);
  if ((CASE_FIXTURES as readonly string[]).includes(fixture)) return chorePath(ADOPT_PLAYBOOK);
  if ((INTAKE_FIXTURES as readonly string[]).includes(fixture)) return newChorePath();
  const id = initialOpenFor(fixture);
  if (id === null) return { root: "chores" };
  return initialFacetFor(fixture) === "run" ? runPath(id, initialTurnFor(fixture)) : chorePath(id);
}

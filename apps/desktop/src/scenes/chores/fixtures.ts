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
import type { CaseSummary, CasesReply, DueReview } from "@/lib/adopt";
import { ApiError } from "@/lib/api";
import type { ChoresClient } from "@/lib/chores-client";
import { featuredStatus, type Featured, type Playbook } from "@/lib/playbooks";
import type { CategoryId, JobId } from "@/lib/playbook-taxonomy";
import { selectPlaybooks, type PlaybooksModel } from "@/modules/playbooks/model";
import {
  fixtures as moduleFixtures,
  initialFacetFor,
  initialOpenFor,
  initialTurnFor,
} from "@/modules/playbooks/fixtures";
import type { FixtureId } from "@/modules/types";

import type { AdoptDeps } from "./adopt/deps";
import {
  ADOPT_FIXTURES,
  ADOPT_PLAYBOOK,
  CASE_FIXTURES,
  PREVIEW_CASE,
  ScriptedClient,
  scriptedDictation,
} from "./adopt/fixtures";
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

/** The featured band on the catalogue (ADR 0300). */
export const FEATURED_FIXTURE = "ledger-featured";

/** An invented `senses/proofs.json`: `passed` of `total` proofs passed, the reader on `reader`. */
const proofsFile = (passed: number, total: number, reader: "fixture" | "meta") => ({
  passed: passed === total,
  backends: { segmenter: "fixture", reader },
  proofs: Array.from({ length: total }, (_, i) => ({
    id: `F${i + 1}`,
    question: "invented for the preview",
    measured: i < passed ? 1 : 0,
    bar: 1,
    op: ">=",
    passed: i < passed,
    n: 12,
  })),
});

/** A `featured` block as the reader builds it, its status by the same rule, from an invented file. */
function featured(senses: Featured["senses"], spike: string, file: unknown): Featured {
  const rows = (file as { proofs?: { passed: boolean }[] } | null)?.proofs ?? [];
  return {
    senses,
    spike,
    since: "2026-10-26",
    status: featuredStatus(file),
    proofs: { passed: rows.filter((r) => r.passed).length, total: rows.length },
  };
}

/** Each invented playbook given a featured block, in three of the four statuses (`unproven` is no
 *  file): refunds rehearsed on fixtures, chargebacks proven on Meta, flights with a proof failing. */
const FEATURED: Record<string, Featured> = {
  "carrier-refunds": featured(["paper"], "01-paper-flip", proofsFile(4, 4, "fixture")),
  "chargeback-evidence": featured(["paper", "call"], "02-appeal-kin", proofsFile(5, 5, "meta")),
  "flight-compensation": featured(["walk"], "04-renovation-witness", proofsFile(2, 3, "meta")),
};

/** The ledger fixture with `FEATURED` laid on, re-selected so every derived figure follows. */
function featuredFixture(): PlaybooksModel {
  const ledger = ledgerFixture();
  const books = ledger.items.map((v) => ({ ...v.playbook, featured: FEATURED[v.id] ?? null }));
  return selectPlaybooks(books, ledger.actions);
}

/** "Your chores" on the catalogue: the shipped set, with two saved cases, one of them due. */
export const YOURS_FIXTURE = "ledger-yours";

/** The second saved case the band lists: a lost suitcase, approved after the credits case. */
const BAGS_CASE: CaseSummary = {
  case_id: "proj_5e6f7a8b9c0d",
  playbook_id: "baggage-delay-claims",
  title: "The suitcase that stayed in Lisbon",
  approved_rev: 1,
  approved_at: "2026-10-12T08:00:00+00:00",
  created: "2026-10-12T08:00:00+00:00",
  confirmed: 4,
  slots: 6,
  space_id: "",
};

/** The scripted session, answering every saved case when asked with no playbook (`cases('')`). */
class YoursClient extends ScriptedClient {
  cases(playbookId: string): Promise<CasesReply> {
    if (playbookId !== "") return super.cases(playbookId);
    const cases = [BAGS_CASE, PREVIEW_CASE];
    return Promise.resolve({ ok: true, cases, showing: cases.length, total: cases.length, footer: "" });
  }
}

/** The credits case came due on Monday and is still unanswered; the suitcase has no cadence. */
const yoursChores: ChoresClient = {
  cadence: () => Promise.reject(new ApiError(404, "unknown_ref", "not in the preview")),
  setCadence: () => Promise.reject(new ApiError(404, "unknown_ref", "not in the preview")),
  answer: () => Promise.resolve(null),
  due: () => Promise.reject(new ApiError(404, "unknown_ref", "not in the preview")),
  review: (caseId: string): Promise<DueReview | null> =>
    Promise.resolve(
      caseId !== PREVIEW_CASE.case_id
        ? null
        : {
            case_id: caseId,
            playbook_id: ADOPT_PLAYBOOK,
            title: PREVIEW_CASE.title,
            command: "",
            enabled: true,
            rule_text: "every Monday at 09:00",
            timezone: "",
            next_run_at: "2026-10-26T09:00:00+00:00",
            review: {
              due_at: "2026-10-19T09:00:00+00:00",
              opened_at: "2026-10-19T09:00:00+00:00",
              missed: 0,
              missed_at: [],
              delivered_at: "2026-10-19T09:00:00+00:00",
              held_at: "",
              answer: "",
              answered_at: "",
              first_turn_id: "",
            },
            unanswered: 1,
            ask_slow: false,
            last_run_at: "",
            lines: [],
            lines_total: 0,
            lines_footer: "",
            portals: [],
          },
    ),
};

let yoursDeps: AdoptDeps | undefined;

/** The deps the `ledger-yours` fixture hands the catalogue; the same object every render. */
export function yoursDepsFor(fixture: FixtureId): AdoptDeps | undefined {
  if (fixture !== YOURS_FIXTURE) return undefined;
  yoursDeps ??= { client: new YoursClient([], { cases: [PREVIEW_CASE] }), chores: yoursChores, dictation: scriptedDictation };
  return yoursDeps;
}

export const fixtures: Readonly<Record<string, PlaybooksModel>> = {
  ...Object.fromEntries(IDS.map((id) => [id, moduleFixtures[id]!])),
  ledger: ledgerFixture(),
  [FEATURED_FIXTURE]: featuredFixture(),
  [YOURS_FIXTURE]: moduleFixtures.shipped!,
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
  FEATURED_FIXTURE,
  YOURS_FIXTURE,
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

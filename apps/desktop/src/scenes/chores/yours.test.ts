/**
 * "Your chores" on the catalogue, as words and an order — README section 3.5.
 *
 * `yoursOf` joins the daemon's saved cases (`GET /adopt/cases`, every playbook) to the chores this
 * build ships: one row per case, an open review first, then the latest approval; a case whose chore
 * is not shipped is counted and said, never dropped in silence.
 */
import { describe, expect, it } from "vitest";

import type { CaseSummary, ChoreReview, DueReview } from "@/lib/adopt";
import type { SpaceSummary } from "@/lib/spaces";

import { ADOPT_PLAYBOOK } from "./adopt/fixtures";
import { fixtures } from "./fixtures";
import { hasCase, yoursLine, yoursOf } from "./yours";

const model = () => fixtures.shipped!;
const OTHER = "baggage-delay-claims";
const title = (id: string) => model().items.find((v) => v.id === id)!.playbook.shortTitle;

const CREDITS: CaseSummary = {
  case_id: "proj_aaaaaaaaaaaa",
  playbook_id: ADOPT_PLAYBOOK,
  title: "Airline credits, my 2026 trips",
  approved_rev: 2,
  approved_at: "2026-10-08T17:42:00+00:00",
  created: "2026-10-01T09:00:00+00:00",
  confirmed: 7,
  slots: 9,
  space_id: "",
};
const BAGS: CaseSummary = {
  case_id: "proj_bbbbbbbbbbbb",
  playbook_id: OTHER,
  title: "The lost suitcase in Lisbon",
  approved_rev: 1,
  approved_at: "2026-10-12T08:00:00+00:00",
  created: "2026-10-12T08:00:00+00:00",
  confirmed: 4,
  slots: 6,
  space_id: "",
};

const reviewOf = (c: CaseSummary, review: Partial<ChoreReview> | null): DueReview => ({
  case_id: c.case_id,
  playbook_id: c.playbook_id,
  title: c.title,
  command: "",
  enabled: true,
  rule_text: "every Monday at 09:00",
  timezone: "",
  next_run_at: "",
  review:
    review === null
      ? null
      : {
          due_at: "",
          opened_at: "",
          missed: 0,
          missed_at: [],
          delivered_at: "",
          held_at: "",
          answer: "",
          answered_at: "",
          first_turn_id: "",
          ...review,
        },
  unanswered: 0,
  ask_slow: false,
  last_run_at: "",
  lines: [],
  lines_total: 0,
  lines_footer: "",
  portals: [],
});

describe("yoursOf", () => {
  it("case 0: one row per saved case, the chore's name, the case, its approval and its slots, latest approval first", () => {
    const yours = yoursOf(model(), [CREDITS, BAGS], new Map());
    expect(yours.rows.map((r) => r.caseId)).toEqual([BAGS.case_id, CREDITS.case_id]);
    const [bags, credits] = yours.rows;
    expect(bags).toMatchObject({
      playbookId: OTHER,
      chore: title(OTHER),
      title: "The lost suitcase in Lisbon",
      approved: "Last approved 2026-10-12",
      confirmed: "4 of 6 confirmed",
      due: "",
    });
    expect(credits).toMatchObject({
      chore: title(ADOPT_PLAYBOOK),
      approved: "Last approved 2026-10-08",
      confirmed: "7 of 9 confirmed",
    });
    expect(yours.elsewhere).toBe(0);
    expect(yours.elsewhereLine).toBe("");
  });

  it("case 1: an open review says when it came due and how many were missed, and sorts before every case without one", () => {
    const reviews = new Map<string, DueReview | null>([
      [CREDITS.case_id, reviewOf(CREDITS, { due_at: "2026-10-24T12:00:00+00:00", missed: 2 })],
      [BAGS.case_id, reviewOf(BAGS, null)],
    ]);
    const yours = yoursOf(model(), [BAGS, CREDITS], reviews);
    expect(yours.rows.map((r) => r.caseId)).toEqual([CREDITS.case_id, BAGS.case_id]);
    expect(yours.rows[0]!.due).toBe("Due 2026-10-24 and 2 missed");
    expect(yours.rows[1]!.due).toBe("");
    // An answered review is not waiting any more.
    const answered = new Map([
      [
        CREDITS.case_id,
        reviewOf(CREDITS, {
          due_at: "2026-10-24T12:00:00+00:00",
          answer: "skip",
        }),
      ],
    ]);
    expect(yoursOf(model(), [BAGS, CREDITS], answered).rows.map((r) => r.due)).toEqual(["", ""]);
    const once = new Map([[CREDITS.case_id, reviewOf(CREDITS, { due_at: "2026-10-24T12:00:00+00:00" })]]);
    expect(yoursOf(model(), [CREDITS], once).rows[0]!.due).toBe("Due 2026-10-24");
  });

  it("case 2: a case for a chore this build does not ship is not a row, and is said", () => {
    const gone = {
      ...BAGS,
      case_id: "proj_cccccccccccc",
      playbook_id: "a-chore-renamed-long-ago",
    };
    const yours = yoursOf(model(), [CREDITS, gone], new Map());
    expect(yours.rows.map((r) => r.caseId)).toEqual([CREDITS.case_id]);
    expect(yours.elsewhere).toBe(1);
    expect(yours.elsewhereLine).toBe("1 saved case is for a chore this build does not ship.");
    const two = yoursOf(model(), [gone, { ...gone, case_id: "proj_dddddddddddd" }], new Map());
    expect(two.elsewhereLine).toBe("2 saved cases are for chores this build does not ship.");
    expect([...hasCase(model(), [CREDITS, gone])]).toEqual([ADOPT_PLAYBOOK]);
  });
});

describe("yoursOf, with the Projects (ADR 0225)", () => {
  const RENOVATION: SpaceSummary = {
    id: "spc_0123456789ab",
    name: "Renovation",
    brief: "",
    apps: [],
    hue: 30,
    created: "2026-10-20T09:00:00Z",
    updated: "2026-10-20T09:00:00Z",
    counts: { episodes: 0, facts: 0, procedurals: 0, chores: 1 },
  };

  it("names the Project a case is linked to, and none for core or a Project the list does not hold", () => {
    const linked = { ...CREDITS, space_id: RENOVATION.id };
    const lost = { ...BAGS, space_id: "spc_ffffffffffff" };
    const rows = yoursOf(model(), [linked, lost], new Map(), [RENOVATION]).rows;
    expect(rows.find((r) => r.caseId === CREDITS.case_id)!.space).toBe(RENOVATION);
    expect(rows.find((r) => r.caseId === BAGS.case_id)!.space).toBeNull();
    // Core, and a list not handed in: no row names one.
    expect(yoursOf(model(), [CREDITS, BAGS], new Map(), [RENOVATION]).rows.map((r) => r.space)).toEqual([null, null]);
    expect(yoursOf(model(), [linked], new Map()).rows[0]!.space).toBeNull();
  });
});

describe("yoursLine", () => {
  it("says every state with no row in words", () => {
    expect(yoursLine({ kind: "looking" })).toBe("Looking for the cases you saved…");
    expect(yoursLine({ kind: "failed", offline: true, detail: "" })).toBe(
      "Your chores could not be looked up: the daemon is not running.",
    );
    expect(
      yoursLine({
        kind: "failed",
        offline: false,
        detail: "no brain is wired",
      }),
    ).toBe("Your chores could not be looked up: no brain is wired");
    expect(yoursLine({ kind: "found", cases: [], footer: "", reviews: new Map() })).toMatch(/^No saved case yet\./);
    expect(
      yoursLine({
        kind: "found",
        cases: [CREDITS],
        footer: "",
        reviews: new Map(),
      }),
    ).toBe("");
  });
});

/**
 * The board's totals count exactly the people its columns draw, under every filter.
 *
 * `Columns.tsx` narrowed by role and by "arguable only"; the masthead and crumb totals in
 * `Board.tsx` narrowed by role alone. So with the arguable filter on, the columns summed to the
 * six flagged candidates while the headline and the crumb still read the whole pipeline. Both now
 * read `components/board/columns/filter.ts`, and this holds the two readings to one number.
 *
 *   node --import ./test/register.mjs --test "test/**\/*.test.ts"
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { tempHome } from "./tmp-home";

tempHome("hirelane-filter-test-");

const { buildBoard } = await import("../lib/board");
const { STAGES } = await import("../lib/constants");
const { boardTotals, groupsAt } = await import("../components/board/columns/filter");

type Board = ReturnType<typeof buildBoard>;

/** What the five columns draw, counted the way a reader would count them: column by column. */
function drawn(board: Board, filter: { roleFilter: string; onlyBorderline: boolean }) {
  const people = STAGES.flatMap((stage) => groupsAt(board, stage, filter).flatMap((g) => g.candidates));
  return {
    applicants: people.length,
    scored: people.filter((c) => c.scored).length,
    borderline: people.filter((c) => c.borderline).length,
  };
}

test("the seed has arguable and unarguable people in more than one role, or this asserts nothing", () => {
  const board = buildBoard();
  const all = board.roles.flatMap((r) => r.columns.flatMap((c) => c.candidates));
  assert.ok(board.roles.length > 1);
  assert.ok(all.some((c) => c.borderline) && all.some((c) => !c.borderline));
});

test("unfiltered, the totals are the roles' own stored totals", () => {
  const board = buildBoard();
  const totals = boardTotals(board, { roleFilter: "all", onlyBorderline: false });
  assert.deepEqual(totals, {
    roles: board.roles.length,
    applicants: board.roles.reduce((n, r) => n + r.totals.applicants, 0),
    scored: board.roles.reduce((n, r) => n + r.totals.scored, 0),
    borderline: board.roles.reduce((n, r) => n + r.totals.borderline, 0),
  });
});

test("under every filter, the totals are what the columns draw", () => {
  const board = buildBoard();
  for (const roleFilter of ["all", ...board.roles.map((r) => r.id)]) {
    for (const onlyBorderline of [false, true]) {
      const filter = { roleFilter, onlyBorderline };
      const { roles, ...figures } = boardTotals(board, filter);
      assert.deepEqual(figures, drawn(board, filter), `role ${roleFilter}, arguable only ${onlyBorderline}`);
      assert.equal(roles, roleFilter === "all" ? board.roles.length : 1, "roles obey the role filter");
    }
  }
});

test("arguable only: every applicant counted is an arguable one", () => {
  const board = buildBoard();
  const totals = boardTotals(board, { roleFilter: "all", onlyBorderline: true });
  const flagged = board.roles.reduce((n, r) => n + r.totals.borderline, 0);
  assert.equal(totals.applicants, flagged);
  assert.equal(totals.borderline, flagged);
  assert.ok(totals.applicants < board.roles.reduce((n, r) => n + r.totals.applicants, 0));
});

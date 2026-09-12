/**
 * The board payload's internal agreement.
 *
 * `scored`/`scores` and `gap`/`line` used to come from two separate reads of "the latest rubric
 * note for an applicant of this role" - the same SQL written twice. They feed different fields of
 * the SAME candidate, so a divergence between them is not a stale number: it is a card reading
 * `not scored` while printing a gap, or a scorecard with no line under it. One read now, and this
 * is what says so.
 *
 *   node --import ./test/register.mjs --test "test/**\/*.test.ts"
 */
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

process.chdir(mkdtempSync(join(tmpdir(), "hirelane-board-test-")));

const { buildBoard } = await import("../lib/board");
const { overallScore } = await import("../lib/scoring");

/** The view model renames `criterion_id`; the arithmetic is over score and weight either way. */
const weighted = (scores: { score: number; weight: number }[]): number =>
  overallScore(scores.map((s) => ({ criterion_id: "", name: "", evidence: [], ...s })));

test("every candidate's score and its sentence come from the same scorecard", () => {
  const board = buildBoard();
  const cards = board.roles.flatMap((r) => r.columns.flatMap((c) => c.candidates));
  assert.ok(cards.length > 0, "the seed produces candidates");
  assert.ok(
    cards.some((c) => c.scored),
    "and some of them are scored, or this asserts nothing",
  );

  for (const candidate of cards) {
    if (candidate.scored) {
      assert.equal(
        candidate.overall,
        weighted(candidate.scores),
        `${candidate.name}: the printed overall is the one their stored scorecard computes`,
      );
      assert.notEqual(candidate.line, "Not scored yet.", `${candidate.name}: scored, with a line`);
    } else {
      assert.equal(candidate.overall, 0, `${candidate.name}: unscored, so no number`);
      assert.match(candidate.line, /Not scored yet/, `${candidate.name}: unscored, and it says so`);
    }
  }
});

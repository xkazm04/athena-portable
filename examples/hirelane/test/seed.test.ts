/**
 * What the seeded database has to be able to show.
 *
 * The demo's centrepiece is the six deliberately borderline applicants - `lib/board/index.ts` and
 * `design/board-brief.md` §4 both name them as the reason the comparison levels exist. They are
 * borderline only at `screening`, and the seed used to return before writing a rubric note for
 * anyone at that stage, so the carousel and the head-to-head diff opened on six blank scorecards
 * and compared nothing. These assertions are the rule, not the observation: a candidate the board
 * flags as arguable must carry a scorecard to argue over.
 *
 *   node --import ./test/register.mjs --test "test/**\/*.test.ts"
 */
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

process.chdir(mkdtempSync(join(tmpdir(), "hirelane-seed-test-")));

const { db } = await import("../lib/db");
const { buildBoard } = await import("../lib/board");
const { FIT_PROMISING, FIT_STRONG } = await import("../components/board/model/fit");

interface Row {
  id: string;
  stage: string;
  gap: string | null;
  notes: number;
}

const borderline = (): Row[] =>
  db().all<Row>(
    `SELECT a.id AS id, a.stage AS stage, a.gap_criterion_id AS gap,
            (SELECT COUNT(*) FROM notes n WHERE n.applicant_id = a.id AND n.kind = 'rubric') AS notes
       FROM applicants a WHERE a.borderline = 1 ORDER BY a.id`,
  );

test("every borderline candidate is scored, or there is nothing to compare", () => {
  const rows = borderline();
  assert.ok(rows.length > 0, "the seed produces borderline candidates");
  for (const row of rows) {
    assert.equal(row.notes, 1, `${row.id}: flagged borderline, so it carries one rubric note`);
  }
});

test("borderline means borderline: the score lands between the two fit floors", () => {
  const board = buildBoard();
  const cards = new Map(
    board.roles.flatMap((r) => r.columns.flatMap((c) => c.candidates)).map((c) => [c.id, c]),
  );
  for (const row of borderline()) {
    const card = cards.get(row.id)!;
    assert.ok(card.scored, `${row.id}: scored on the board, not just in the table`);
    assert.ok(
      card.overall >= FIT_PROMISING && card.overall < FIT_STRONG,
      `${row.id}: ${card.overall} sits in the arguable middle [${FIT_PROMISING}, ${FIT_STRONG})`,
    );
    const gap = card.scores.find((s) => s.criterionId === row.gap);
    assert.equal(gap?.score, 0, `${row.id}: the seeded gap (${row.gap}) is the criterion they miss`);
  }
});

test("`applied` stays unscored, because the stage copy promises it has not been read", () => {
  const scoredAtApplied = db().get<{ n: number }>(
    `SELECT COUNT(DISTINCT a.id) AS n FROM applicants a
       JOIN notes n2 ON n2.applicant_id = a.id AND n2.kind = 'rubric'
      WHERE a.stage = 'applied'`,
  )!;
  assert.equal(scoredAtApplied.n, 0);
});

test("no candidate's history runs backwards, and arrival is the date they applied", () => {
  const events = db().all<{ applicant_id: string; ts: string; to_stage: string }>(
    "SELECT applicant_id, ts, to_stage FROM stage_events ORDER BY applicant_id, id",
  );
  assert.ok(events.length > 0, "the seed produces stage events");
  const appliedAt = new Map(
    db()
      .all<{ id: string; applied_at: string }>("SELECT id, applied_at FROM applicants")
      .map((a) => [a.id, a.applied_at]),
  );

  const trails = new Map<string, { ts: string; to: string }[]>();
  for (const e of events) {
    const list = trails.get(e.applicant_id) ?? [];
    list.push({ ts: e.ts, to: e.to_stage });
    trails.set(e.applicant_id, list);
  }

  for (const [id, trail] of trails) {
    assert.equal(
      trail[0]!.ts,
      appliedAt.get(id),
      `${id}: "Application received" is the applicant's own applied_at, not a third date`,
    );
    for (let i = 1; i < trail.length; i += 1) {
      assert.ok(
        trail[i]!.ts > trail[i - 1]!.ts,
        `${id}: moved to ${trail[i]!.to} at ${trail[i]!.ts}, after ${trail[i - 1]!.to} at ${trail[i - 1]!.ts}`,
      );
    }
  }
});

test("the rest of screening is left for the scoring action to do", () => {
  const unscored = db().get<{ n: number }>(
    `SELECT COUNT(*) AS n FROM applicants a
      WHERE a.stage = 'screening' AND a.borderline = 0
        AND NOT EXISTS (SELECT 1 FROM notes n WHERE n.applicant_id = a.id AND n.kind = 'rubric')`,
  )!;
  const screening = db().get<{ n: number }>(
    "SELECT COUNT(*) AS n FROM applicants WHERE stage = 'screening' AND borderline = 0",
  )!;
  assert.equal(unscored.n, screening.n, "act 2 still has a batch to score");
});

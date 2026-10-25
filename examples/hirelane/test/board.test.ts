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
import { test } from "node:test";
import { tempHome } from "./tmp-home";

tempHome("hirelane-board-test-");

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

/*
 * What has reached a person is every message they were sent, however many the app has sent since.
 *
 * `buildBoard` read the messages through `listMessages()`, which kept the newest fifty in the whole
 * app. Past fifty sends, the oldest letters fell off every card without a word: the dossier's
 * "Already sent" read "nothing" and the agent's `already_sent` was empty for a person who had been
 * rejected in writing.
 */
test("a person's sent letters stay on their card after fifty newer sends to somebody else", async () => {
  const { db } = await import("../lib/db");
  const find = (id: string) =>
    buildBoard()
      .roles.flatMap((r) => r.columns.flatMap((c) => c.candidates))
      .find((c) => c.id === id)!;
  const rejected = db().get<{ id: string }>(
    "SELECT applicant_id AS id FROM messages WHERE kind = 'rejection' ORDER BY id LIMIT 1",
  )!.id;
  assert.equal(find(rejected).meta.sent.length, 1, "the seed wrote them one letter");

  const other = db().get<{ id: string; email: string }>(
    "SELECT id, email FROM applicants WHERE stage = 'interview' ORDER BY id LIMIT 1",
  )!;
  const raw = db().raw;
  raw.exec("SAVEPOINT sends");
  try {
    for (let n = 0; n < 50; n++) {
      db().run(
        "INSERT INTO messages (applicant_id, ts, kind, to_email, subject, body) VALUES (?, ?, 'scheduling', ?, ?, ?)",
        [other.id, "2026-09-07T10:00:00.000Z", other.email, `Interview ${n}`, "-"],
      );
    }
    assert.equal(find(rejected).meta.sent.length, 1, "their letter is still on their card");
    assert.equal(find(other.id).meta.sent.length, 50, "and every one of the fifty is on the other's");
  } finally {
    raw.exec("ROLLBACK TO sends");
    raw.exec("RELEASE sends");
  }
});

/*
 * The evidence facets are a claim that somebody read the application against the rubric.
 *
 * An unscored applicant used to get a fabricated row of zero scores, and a count, a band and a
 * list of "uncertain because" criteria derived from it: "0 of 5 evidenced, thinly evidenced,
 * nothing quoted for all five". Nobody had read them. `evidence` is now null for exactly them.
 */
const { latestScorecards } = await import("../lib/queries");

/** The base tree's arithmetic over a STORED scorecard, re-derived here rather than imported. */
function baseFacets(stored: { name: string; evidence: string[] }[]) {
  const evidenced = stored.filter((s) => s.evidence.length > 0).length;
  const share = stored.length === 0 ? 0 : evidenced / stored.length;
  const band = share >= 0.8 ? "tight" : share >= 0.5 ? "moderate" : "wide";
  return { evidenced, band, drivers: stored.filter((s) => s.evidence.length === 0).map((s) => s.name) };
}

test("evidence case 1: no unscored candidate carries an evidence count, band or drivers", () => {
  const board = buildBoard();
  const unscored = board.roles.flatMap((r) => r.columns.flatMap((c) => c.candidates)).filter((c) => !c.scored);
  assert.ok(unscored.length > 0, "the seed leaves some applications unread, or this asserts nothing");
  for (const candidate of unscored) {
    assert.strictEqual(candidate.evidence, null, `${candidate.name}: unread, so no evidence facts`);
    assert.equal("band" in candidate, false, `${candidate.name}: no flat band`);
    assert.equal("bandDrivers" in candidate, false, `${candidate.name}: no flat drivers`);
    assert.equal("evidenced" in candidate.meta, false, `${candidate.name}: no flat evidenced count`);
  }
});

test("evidence case 2: a scored candidate's evidence is its stored scorecard's, as the base tree printed it", () => {
  const board = buildBoard();
  let seen = 0;
  for (const role of board.roles) {
    const cards = latestScorecards(role.id);
    for (const candidate of role.columns.flatMap((c) => c.candidates).filter((c) => c.scored)) {
      const stored = cards[candidate.id];
      assert.ok(stored, `${candidate.name}: scored means a stored scorecard`);
      const want = baseFacets(stored);
      assert.ok(candidate.evidence, `${candidate.name}: scored, so evidence is present`);
      assert.equal(candidate.evidence.evidenced, want.evidenced, `${candidate.name}: evidenced`);
      assert.equal(
        candidate.evidence.evidenced,
        candidate.scores.filter((s) => s.evidence.length > 0).length,
        `${candidate.name}: evidenced counts the scores with a quote`,
      );
      assert.equal(candidate.evidence.criteriaCount, role.criteria.length, `${candidate.name}: criteriaCount`);
      assert.equal(candidate.evidence.band, want.band, `${candidate.name}: band`);
      assert.deepEqual(candidate.evidence.drivers, want.drivers, `${candidate.name}: drivers`);
      seen++;
    }
  }
  assert.ok(seen > 0, "some candidates are scored");
});

/**
 * Score the pile in one act: a batch scorecard with one undo, offered on the group.
 *
 * The journey's first step is "score the pile", and until `score_batch` it was one act per person,
 * for the person and for the agent: twelve presses, twelve toasts, twelve History rows, and twelve
 * undos to take back a wrong run. `scoreBatch` scores every unscored, undecided applicant of a role
 * (at one stage, if it is given) inside one transaction, with the same scorer `scoreAgainstRubric`
 * uses, and logs ONE activity row whose undo lists every note it wrote. Who is in the batch is
 * `scoreBatchFor` in `lib/acts.ts`, which the group's control counts from too (ADR 0107).
 *
 * The cases run in order on one fresh seed: 1, 3, 4 and 6 read the batch case 1 wrote; 5 undoes it;
 * 2 and 7 then start from the unscored pile again.
 *
 *   node --import ./test/register.mjs --test "test/**\/*.test.ts"
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { tempHome } from "./tmp-home";

tempHome("hirelane-score-batch-test-");

const { db } = await import("../lib/db");
const { buildBoard } = await import("../lib/board");
const { listCriteria } = await import("../lib/queries");
const { scoreAgainst } = await import("../lib/scoring");
const actions = await import("../app/actions");
/* Read per case, so a missing export fails each case on its own rather than the whole file. */
const acts = () => import("../lib/acts") as Promise<Record<string, unknown>>;

type Batch = (roleId: string, stage?: string) => Promise<{ ok: boolean; message: string; undoId?: number }>;
const scoreBatch: Batch = (roleId, stage) => {
  const fn = (actions as unknown as Record<string, Batch | undefined>).scoreBatch;
  assert.equal(typeof fn, "function", "app/actions.ts exports scoreBatch");
  return fn!(roleId, stage);
};

interface Row {
  id: string;
  role_id: string;
  stage: string;
  cv_text: string;
  short_answer: string;
}

const applicants = (): Row[] =>
  db().all<Row>("SELECT id, role_id, stage, cv_text, short_answer FROM applicants ORDER BY id");

const rubricCounts = (): Map<string, number> =>
  new Map(
    db()
      .all<{ id: string; n: number }>(
        `SELECT a.id, (SELECT COUNT(*) FROM notes WHERE applicant_id = a.id AND kind = 'rubric') AS n
           FROM applicants a`,
      )
      .map((r) => [r.id, r.n]),
  );

const activityCount = (): number => db().get<{ n: number }>("SELECT COUNT(*) AS n FROM activity")!.n;

const UNDECIDED = new Set(["applied", "screening"]);

/* What case 1 saw and wrote, for the cases that read it. */
let before = new Map<string, number>();
let batchIds: string[] = [];
let undoId = 0;

test("case 1: one press scores the role's twelve unscored undecided applicants, as one row with one undo", async () => {
  before = rubricCounts();
  const rows = activityCount();
  const pile = applicants().filter(
    (a) => a.role_id === "role_backend" && UNDECIDED.has(a.stage) && before.get(a.id) === 0,
  );
  assert.equal(pile.length, 12, "the seed's pile: 11 at applied and 1 at screening");

  const result = await scoreBatch("role_backend");
  assert.equal(result.ok, true, result.message);
  assert.equal(result.message, "Scored 12 Backend Engineer applicants.");
  assert.equal(typeof result.undoId, "number", "the batch hands back its one undo");
  undoId = result.undoId!;

  const after = rubricCounts();
  for (const a of pile) assert.equal(after.get(a.id), 1, `${a.id} has exactly one rubric note`);
  batchIds = pile.map((a) => a.id);

  assert.equal(activityCount(), rows + 1, "exactly one new activity row");
  const row = db().get<{ action: string; reversible: number }>(
    "SELECT action, reversible FROM activity ORDER BY id DESC LIMIT 1",
  )!;
  assert.equal(row.action, "score_batch");
  assert.equal(row.reversible, 1);
});

test("case 3 (guard): the scored, the decided, the interviewed and the other role are left alone", () => {
  const after = rubricCounts();
  for (const a of applicants()) {
    if (batchIds.includes(a.id)) continue;
    assert.equal(after.get(a.id), before.get(a.id), `${a.id} (${a.role_id}, ${a.stage}) kept its rubric notes`);
  }
});

test("case 4: each batch note is the scorecard scoreAgainstRubric would write for that person", () => {
  assert.equal(batchIds.length, 12, "case 1's batch is the one compared here");
  const byId = new Map(applicants().map((a) => [a.id, a]));
  for (const id of batchIds) {
    const a = byId.get(id)!;
    const note = db().get<{ scores_json: string }>(
      "SELECT scores_json FROM notes WHERE applicant_id = ? AND kind = 'rubric' ORDER BY id DESC LIMIT 1",
      [id],
    )!;
    const expected = scoreAgainst(listCriteria(a.role_id), a.cv_text, a.short_answer);
    assert.equal(note.scores_json, JSON.stringify(expected), `${id}: one scorer, lib/scoring.ts`);
  }
});

test("case 6: a second batch has nothing left, and an unknown role names the two there are", async () => {
  const rows = activityCount();
  const again = await scoreBatch("role_backend");
  assert.equal(again.ok, false);
  assert.equal(again.message, "Nothing left to score for Backend Engineer.");
  assert.equal(activityCount(), rows, "a refused batch logs nothing");

  const sales = await scoreBatch("role_sales");
  assert.equal(sales.ok, false);
  assert.match(sales.message, /role_backend/);
  assert.match(sales.message, /role_designer/);
  assert.equal(activityCount(), rows);
});

test("case 5: one undo deletes every note the batch wrote, and the twelve read as unscored again", async () => {
  const outcome = await actions.undoAction(undoId);
  assert.equal(outcome.ok, true, outcome.reason);
  const after = rubricCounts();
  for (const id of batchIds) assert.equal(after.get(id), 0, `${id}: its batch note is gone`);
  const board = buildBoard();
  const backend = board.roles.find((r) => r.id === "role_backend")!;
  const people = backend.columns.flatMap((c) => c.candidates);
  for (const id of batchIds) {
    assert.equal(people.find((p) => p.id === id)?.scored, false, `${id} reads unscored on the board`);
  }
});

test("case 2: a stage narrows the batch to that stage alone", async () => {
  const counts = rubricCounts();
  const at = (stage: string) =>
    applicants().filter((a) => a.role_id === "role_backend" && a.stage === stage && counts.get(a.id) === 0);
  const screening = at("screening");
  const applied = at("applied");
  assert.equal(screening.length, 1, "one unscored backend applicant at screening");

  const result = await scoreBatch("role_backend", "screening");
  assert.equal(result.ok, true, result.message);
  const after = rubricCounts();
  assert.equal(after.get(screening[0]!.id), 1, "the screening applicant is scored");
  for (const a of applied) assert.equal(after.get(a.id), 0, `${a.id} at applied stays unscored`);
});

test("case 7: scoreBatchFor on the board's people names exactly the ids the action scores", async () => {
  const mod = await acts();
  const scoreBatchFor = mod.scoreBatchFor as
    | ((people: readonly { id: string; stage: string; scored: boolean }[], stage?: string) => string[])
    | undefined;
  assert.equal(typeof scoreBatchFor, "function", "lib/acts.ts exports scoreBatchFor");
  for (const stage of ["screening", undefined]) {
    const designer = buildBoard().roles.find((r) => r.id === "role_designer")!;
    const offered = scoreBatchFor!(
      designer.columns.flatMap((c) => c.candidates),
      stage,
    ).sort();
    assert.ok(offered.length > 0, "the designer pile is not empty");
    const counts = rubricCounts();
    const result = await scoreBatch("role_designer", stage);
    assert.equal(result.ok, true, result.message);
    const after = rubricCounts();
    const scored = [...after].filter(([id, n]) => n > (counts.get(id) ?? 0)).map(([id]) => id).sort();
    assert.deepEqual(scored, offered, `stage ${stage ?? "any"}: the control and the action agree`);
  }
});

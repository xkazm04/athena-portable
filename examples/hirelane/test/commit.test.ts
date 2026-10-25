/**
 * The act chokepoint: who acted, and the act's class, written once per log row.
 *
 * Every act on a person is written through `commitAct` in `app/commit.ts`. It records who ran the
 * act - the person, or Athena through the same server actions - and derives whether the row is
 * reversible from the manifest's own rule (`lib/manifest.ts` `isAuto`), so no call site states
 * the class and none can drift from it.
 *
 *   node --import ./test/register.mjs --test "test/**\/*.test.ts"
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import type { ActionResult } from "../app/actions";
import { tempHome } from "./tmp-home";

tempHome("hirelane-commit-test-");

const { db } = await import("../lib/db");
const { isAuto, SHIPPED_CAPABILITIES } = await import("../lib/manifest");
const actions = await import("../app/actions");
const { addNote, moveStage } = actions;
/* Imported per test, so a missing module fails each case on its own rather than the whole file. */
const commit = () => import("../app/commit");

type Actor = "user" | "athena";

interface Activity {
  id: number;
  actor: string;
  action: string;
  reversible: number;
}

/** Applicants a case has already acted on, so each case starts from a fresh one. */
const used = new Set<string>();

function fresh(stage: string): string {
  const rows = db().all<{ id: string }>("SELECT id FROM applicants WHERE stage = ? ORDER BY id", [stage]);
  const found = rows.find((r) => !used.has(r.id));
  assert.ok(found, `a fresh applicant at ${stage}`);
  used.add(found.id);
  return found.id;
}

const newest = (): Activity =>
  db().get<Activity>("SELECT id, actor, action, reversible FROM activity ORDER BY id DESC LIMIT 1")!;

const activityCount = (): number => db().get<{ n: number }>("SELECT COUNT(*) AS n FROM activity")!.n;

const noteCount = (applicantId: string): number =>
  db().get<{ n: number }>("SELECT COUNT(*) AS n FROM notes WHERE applicant_id = ?", [applicantId])!.n;

const newestStageEvent = (applicantId: string): { actor: string } =>
  db().get<{ actor: string }>("SELECT actor FROM stage_events WHERE applicant_id = ? ORDER BY id DESC LIMIT 1", [
    applicantId,
  ])!;

test("case 1: a move Athena ran is logged as Athena's, on the activity row and the stage event", async () => {
  const id = fresh("applied");
  const result = await moveStage(id, "screening", "athena");
  assert.equal(result.ok, true, result.message);
  const row = newest();
  assert.equal(row.action, "move_stage");
  assert.equal(row.actor, "athena", "the activity row names who ran it");
  assert.equal(newestStageEvent(id).actor, "athena", "and so does the stage event it wrote");
});

test("case 2 (guard): a move with no actor is the person's own, as it always was", async () => {
  const id = fresh("applied");
  const result = await moveStage(id, "screening");
  assert.equal(result.ok, true, result.message);
  assert.equal(newest().actor, "user");
  assert.equal(newestStageEvent(id).actor, "user");
});

test("case 3: an actor outside the closed set is refused before anything is written", async () => {
  const id = fresh("applied");
  const notes = noteCount(id);
  const rows = activityCount();
  const result = await addNote(id, "x", "root" as Actor);
  assert.equal(result.ok, false);
  assert.match(result.message, /user/);
  assert.match(result.message, /athena/);
  assert.equal(noteCount(id), notes, "no note row");
  assert.equal(activityCount(), rows, "no activity row");
});

test("case 4: commitAct refuses an AUTO act with no undo and a GATED act with one, inside the transaction", async () => {
  const { commitAct } = await commit();
  const id = fresh("applied");
  const rows = activityCount();
  assert.throws(
    () =>
      db().withTx((tx) =>
        commitAct(tx, { capability: "move_stage", actor: "user", target: `applicant:${id}`, summary: "A move." }),
      ),
    /move_stage is AUTO and must log its undo/,
  );
  assert.equal(activityCount(), rows, "the AUTO refusal left no activity row");
  assert.throws(
    () =>
      db().withTx((tx) =>
        commitAct(tx, {
          capability: "decide_stage",
          actor: "user",
          target: `applicant:${id}`,
          summary: "A decision.",
          undo: { kind: "stage", applicantId: id, stage: "applied", eventId: 1 },
        }),
      ),
    /decide_stage is GATED and logs no undo/,
  );
  assert.equal(activityCount(), rows, "the GATED refusal left no activity row");
});

/**
 * One way to run each act on a fresh applicant it fits. The expected class is NOT here: it is read
 * from the manifest below, and the keys are checked against the manifest so a new act cannot be
 * left out of this case.
 */
const RUN: Record<string, (actor: Actor) => Promise<ActionResult>> = {
  score_against_rubric: (actor) => actions.scoreAgainstRubric(fresh("applied"), actor),
  add_note: (actor) => actions.addNote(fresh("applied"), "Worth a second read.", actor),
  move_stage: (actor) => actions.moveStage(fresh("applied"), "screening", actor),
  decide_stage: (actor) => actions.decideStage(fresh("applied"), "offer", actor),
  propose_slots: (actor) => actions.proposeSlots(fresh("interview"), actor),
  send_scheduling_email: (actor) => {
    const slot = db().get<{ id: string }>("SELECT id FROM slots WHERE status = 'open' ORDER BY id LIMIT 1")!;
    return actions.sendSchedulingEmail(fresh("interview"), slot.id, actor);
  },
  send_rejection: (actor) => actions.sendRejection(fresh("applied"), "standard", actor),
};

test("case 5: every data act's logged class and its undo are the manifest's, and it names its actor", async () => {
  const acts = SHIPPED_CAPABILITIES.filter((c) => c.sideEffects !== "none");
  assert.deepEqual(Object.keys(RUN).sort(), acts.map((c) => c.name).sort(), "one runner per data act on the manifest");
  for (const capability of acts) {
    const result = await RUN[capability.name]!("athena");
    assert.equal(result.ok, true, `${capability.name}: ${result.message}`);
    const row = newest();
    assert.equal(row.action, capability.name, `${capability.name} wrote the newest row`);
    assert.equal(row.reversible, Number(isAuto(capability)), `${capability.name}: reversible is the manifest's class`);
    assert.equal("undoId" in result, isAuto(capability), `${capability.name}: an undo exactly when AUTO`);
    assert.equal(row.actor, "athena", `${capability.name}: logged as the one who ran it`);
  }
});

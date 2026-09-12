/**
 * The server actions' preconditions, pinned.
 *
 * Every one of these is a rule the UI already stated and the action did not enforce, which means
 * the button was the whole guard and an agent calling the same action never saw it. A server action
 * is a POST endpoint; the invariant belongs here, so the test belongs here too.
 *
 *   node --import ./test/register.mjs --test "test/**\/*.test.ts"
 */
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

// `openDb` resolves the file from `process.cwd()/data`, so a scratch cwd gives this run its own
// seeded copy and never touches the one under `data/`.
process.chdir(mkdtempSync(join(tmpdir(), "hirelane-test-")));

const { STUDIO } = await import("@athena/demo-kit/seed");
const { db } = await import("../lib/db");
const { decideStage, moveStage, proposeSlots, sendRejection, sendSchedulingEmail, undoAction } =
  await import("../app/actions");

interface Row {
  id: string;
  stage?: string;
  status?: string;
  applicant_id?: string | null;
}

const pick = (stage: string): Row =>
  db().get<Row>("SELECT id, stage FROM applicants WHERE stage = ? ORDER BY id LIMIT 1", [stage])!;

const slot = (id: string): Row =>
  db().get<Row>("SELECT id, status, applicant_id FROM slots WHERE id = ?", [id])!;

const openSlot = (): Row => db().get<Row>("SELECT id FROM slots WHERE status = 'open' ORDER BY id LIMIT 1")!;

const schedulingCount = (applicantId: string): number =>
  db().get<{ n: number }>("SELECT COUNT(*) AS n FROM messages WHERE applicant_id = ? AND kind = 'scheduling'", [
    applicantId,
  ])!.n;

test("scheduling is refused below Interview, the stage the gate panel declares", async () => {
  const applied = pick("applied");
  const target = openSlot();
  const before = schedulingCount(applied.id);

  const result = await sendSchedulingEmail(applied.id, target.id);

  assert.equal(result.ok, false);
  assert.match(result.message, /Interview/);
  assert.equal(slot(target.id).status, "open", "the slot is not booked");
  assert.equal(schedulingCount(applied.id), before, "nothing reaches the candidate");
});

test("scheduling works at Interview, so the guard is a precondition and not a wall", async () => {
  const interviewing = pick("interview");
  const target = openSlot();

  const result = await sendSchedulingEmail(interviewing.id, target.id);

  assert.equal(result.ok, true, result.message);
  assert.equal(slot(target.id).status, "booked");
  assert.equal(slot(target.id).applicant_id, interviewing.id);
});

test("a slot held for one candidate cannot be re-targeted at another", async () => {
  const [first, second] = db().all<Row>(
    "SELECT id, stage FROM applicants WHERE stage = 'interview' ORDER BY id LIMIT 2",
  );
  assert.ok(first && second, "the seed carries two applicants at interview");

  assert.equal((await proposeSlots(first.id)).ok, true);
  const held = db().get<Row>(
    "SELECT id, status, applicant_id FROM slots WHERE applicant_id = ? AND status = 'proposed' ORDER BY id LIMIT 1",
    [first.id],
  );
  assert.ok(held, "propose_slots holds slots for the first candidate");

  const stolen = await sendSchedulingEmail(second.id, held.id);

  assert.equal(stolen.ok, false);
  assert.match(stolen.message, /held for someone else/);
  assert.equal(slot(held.id).applicant_id, first.id, "the slot stays with the candidate it was held for");
  assert.equal(slot(held.id).status, "proposed");

  // The same candidate booking a slot held for them is the flow the guard must keep.
  const kept = await sendSchedulingEmail(first.id, held.id);
  assert.equal(kept.ok, true, kept.message);
  assert.equal(slot(held.id).status, "booked");
});

test("an AUTO move cannot walk a decided candidate back into the pipeline", async () => {
  const rejected = pick("rejected");
  assert.ok(rejected, "the seed carries a rejected applicant");

  const result = await moveStage(rejected.id, "screening");

  assert.equal(result.ok, false);
  assert.match(result.message, /Undo/);
  assert.equal(pick("rejected").id, rejected.id, "the stage did not change");
  assert.equal(
    db().get<{ n: number }>("SELECT COUNT(*) AS n FROM stage_events WHERE applicant_id = ? AND from_stage = 'rejected'", [
      rejected.id,
    ])!.n,
    0,
    "no rejected -> screening event was written",
  );
});

test("a decision cannot be re-made: no offer over a rejection, no second letter", async () => {
  const rejected = pick("rejected");
  const letters = db().get<{ n: number }>(
    "SELECT COUNT(*) AS n FROM messages WHERE applicant_id = ? AND kind = 'rejection'",
    [rejected.id],
  )!.n;

  const offered = await decideStage(rejected.id, "offer");
  assert.equal(offered.ok, false);
  assert.match(offered.message, /already at Rejected/);

  const again = await sendRejection(rejected.id, "encouraging");
  assert.equal(again.ok, false);
  assert.match(again.message, /already at Rejected/);

  assert.equal(
    db().get<Row>("SELECT id, stage FROM applicants WHERE id = ?", [rejected.id])!.stage,
    "rejected",
    "the stage is unchanged",
  );
  assert.equal(
    db().get<{ n: number }>("SELECT COUNT(*) AS n FROM messages WHERE applicant_id = ? AND kind = 'rejection'", [
      rejected.id,
    ])!.n,
    letters,
    "no second letter reaches them",
  );
});

test("a first decision is untouched by the terminal guard", async () => {
  const screening = pick("screening");

  const result = await decideStage(screening.id, "rejected");

  assert.equal(result.ok, true, result.message);
  assert.equal(
    db().get<Row>("SELECT id, stage FROM applicants WHERE id = ?", [screening.id])!.stage,
    "rejected",
  );
});

test("undoing propose_slots does not un-book a slot a gated send already booked", async () => {
  const candidate = pick("interview");
  assert.equal((await proposeSlots(candidate.id)).ok, true);

  const entry = db().get<{ id: number; undo_json: string }>(
    "SELECT id, undo_json FROM activity WHERE action = 'propose_slots' ORDER BY id DESC LIMIT 1",
  )!;
  const held = (JSON.parse(entry.undo_json) as { slotIds: string[] }).slotIds;
  assert.equal(held.length, 3, "three slots were held");

  const booked = held[0]!;
  assert.equal((await sendSchedulingEmail(candidate.id, booked)).ok, true);
  assert.equal(slot(booked).status, "booked");

  assert.equal((await undoAction(entry.id)).ok, true);

  assert.equal(slot(booked).status, "booked", "the booked, emailed slot is not released");
  assert.equal(slot(booked).applicant_id, candidate.id);
  for (const id of held.slice(1)) {
    assert.equal(slot(id).status, "open", "the merely-proposed slots do return to the pool");
  }
  assert.match(
    db().get<{ summary: string }>("SELECT summary FROM activity ORDER BY id DESC LIMIT 1 OFFSET 1")!.summary,
    /released 2 of 3 slots: 1 had already been booked/,
    "the partial undo says so in the log, since the kit's own line reports a clean one either way",
  );
});

/*
 * The two gated sends, as a mail connector reads them.
 *
 * In the demo the send is carried OUTSIDE the page (README section 4): the tool returns a message
 * and a tier-3 executor delivers it. A result saying "Interview time sent" is useless to that
 * executor — it cannot address an envelope from a candidate id — so the result, and the row the
 * app keeps, are a complete message. These assert the three fields on both.
 */
test("a scheduling send returns a complete, addressable message, and stores the same one", async () => {
  const target = db().get<{ id: string; name: string; email: string }>(
    "SELECT id, name, email FROM applicants WHERE stage = 'interview' ORDER BY id LIMIT 1",
  )!;
  const open = openSlot();

  const result = await sendSchedulingEmail(target.id, open.id);

  assert.equal(result.ok, true, result.message);
  assert.ok(result.mail, "a send produces a message");
  assert.equal(result.mail.to, target.email, "addressed to the applicant, at the address on file");
  assert.ok(result.mail.subject.length > 0 && result.mail.subject.includes("Interview"));
  assert.match(result.mail.body, /Backend Engineer|Product Designer/, "it names the role");
  assert.ok(result.mail.body.includes(STUDIO.owner.name), "and it is signed by the hiring manager");
  assert.ok(result.mail.body.includes(STUDIO.inbox), "with the studio's inbox to reply to");

  const row = db().get<{ to_email: string; subject: string; body: string }>(
    "SELECT to_email, subject, body FROM messages WHERE applicant_id = ? AND kind = 'scheduling' ORDER BY id DESC LIMIT 1",
    [target.id],
  )!;
  assert.equal(row.to_email, result.mail.to, "the row is the envelope, not a summary of it");
  assert.equal(row.subject, result.mail.subject);
  assert.equal(row.body, result.mail.body);
});

test("a rejection send returns the wording that reaches the person, and stores it", async () => {
  const target = db().get<{ id: string; name: string; email: string }>(
    "SELECT id, name, email FROM applicants WHERE stage = 'screening' ORDER BY id DESC LIMIT 1",
  )!;

  const result = await sendRejection(target.id, "encouraging");

  assert.equal(result.ok, true, result.message);
  assert.ok(result.mail, "a send produces a message");
  assert.equal(result.mail.to, target.email);
  assert.match(result.mail.subject, /Your application for/);
  assert.ok(result.mail.subject.includes(STUDIO.name), "the studio's name is on the envelope");
  assert.ok(result.mail.body.includes(target.name.split(" ")[0]!), "it greets them by name");
  assert.ok(result.mail.body.includes(STUDIO.owner.name), "and is signed");

  const row = db().get<{ to_email: string; subject: string; body: string }>(
    "SELECT to_email, subject, body FROM messages WHERE applicant_id = ? AND kind = 'rejection' ORDER BY id DESC LIMIT 1",
    [target.id],
  )!;
  assert.equal(row.to_email, result.mail.to);
  assert.equal(row.subject, result.mail.subject);
  assert.equal(row.body, result.mail.body);
});

test("a refused send produces no message at all", async () => {
  const applied = pick("applied");
  const result = await sendSchedulingEmail(applied.id, openSlot().id);
  assert.equal(result.ok, false);
  assert.equal(result.mail, undefined, "nothing to deliver, so nothing is handed back");
});

test("propose_slots hands back the ids it held and when each one starts", async () => {
  const target = pick("interview");
  const result = await proposeSlots(target.id);

  assert.equal(result.ok, true, result.message);
  assert.ok(result.slots && result.slots.length > 0, "the held slots come back with the result");
  for (const slot of result.slots) {
    assert.ok(slot.id.length > 0);
    assert.ok(!Number.isNaN(Date.parse(slot.start)), `${slot.id}: a real start time`);
    assert.ok(slot.minutes > 0);
    assert.equal(
      db().get<{ status: string }>("SELECT status FROM slots WHERE id = ?", [slot.id])!.status,
      "proposed",
      `${slot.id}: held, not sent`,
    );
  }
});

test("an ordinary move is untouched by the from-stage guard", async () => {
  const screening = pick("screening");

  const result = await moveStage(screening.id, "interview");

  assert.equal(result.ok, true, result.message);
  assert.equal(
    db().get<Row>("SELECT id, stage FROM applicants WHERE id = ?", [screening.id])!.stage,
    "interview",
  );
});

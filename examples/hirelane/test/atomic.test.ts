/**
 * Every server action is all of its writes or none of them.
 *
 * Each action writes the domain change and then the activity row that records it. Written as
 * separate statements, a failure on the record (a locked file, a full disk) leaves the change in
 * place with nothing saying it happened: a rejected applicant with a letter on file and no row in
 * the log, which for the three GATED acts is exactly the outcome that most needs evidence. The
 * sibling `examples/ledgerbox/app/actions.ts` runs each action inside `withTx`; this pins the same
 * rule here by failing the LAST write of every action and asserting the earlier ones rolled back.
 *
 *   node --import ./test/register.mjs --test "test/**\/*.test.ts"
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { tempHome } from "./tmp-home";

tempHome("hirelane-atomic-test-");

const { db } = await import("../lib/db");
const {
  addNote,
  decideStage,
  moveStage,
  proposeSlots,
  scoreAgainstRubric,
  sendRejection,
  sendSchedulingEmail,
} = await import("../app/actions");

/** Everything an action can write, as one comparable snapshot. */
const state = (): string =>
  JSON.stringify({
    stages: db().all("SELECT id, stage FROM applicants ORDER BY id"),
    events: db().get("SELECT COUNT(*) AS n FROM stage_events"),
    notes: db().get("SELECT COUNT(*) AS n FROM notes"),
    messages: db().get("SELECT COUNT(*) AS n FROM messages"),
    slots: db().all("SELECT id, status, applicant_id FROM slots ORDER BY id"),
    activity: db().get("SELECT COUNT(*) AS n FROM activity"),
  });

/** The activity insert is the last write every action makes; fail it, run `act`, put it back. */
async function withFailingLog(act: () => Promise<unknown>): Promise<void> {
  db().raw.exec(
    "CREATE TEMP TRIGGER seeded_log_failure BEFORE INSERT ON activity BEGIN SELECT RAISE(ABORT, 'seeded failure'); END;",
  );
  try {
    await assert.rejects(act, /seeded failure/);
  } finally {
    db().raw.exec("DROP TRIGGER temp.seeded_log_failure");
  }
}

const pick = (stage: string): string =>
  db().get<{ id: string }>("SELECT id FROM applicants WHERE stage = ? ORDER BY id LIMIT 1", [stage])!.id;
const openSlot = (): string =>
  db().get<{ id: string }>("SELECT id FROM slots WHERE status = 'open' ORDER BY id LIMIT 1")!.id;

const ACTS: [string, () => Promise<unknown>][] = [
  ["add_note", () => addNote(pick("screening"), "A note that is never recorded.")],
  ["score_against_rubric", () => scoreAgainstRubric(pick("screening"))],
  ["move_stage", () => moveStage(pick("applied"), "screening")],
  ["decide_stage", () => decideStage(pick("screening"), "offer")],
  ["propose_slots", () => proposeSlots(pick("interview"))],
  ["send_scheduling_email", () => sendSchedulingEmail(pick("interview"), openSlot())],
  ["send_rejection", () => sendRejection(pick("screening"), "standard")],
];

for (const [name, act] of ACTS) {
  test(`${name}: a failed activity row takes the domain write back with it`, async () => {
    const before = state();
    await withFailingLog(act);
    assert.equal(state(), before, `${name} left a write behind with no row recording it`);
  });
}

test("the seeded failure is the only thing stopping them: each act still lands whole", async () => {
  for (const [name, act] of ACTS) {
    const result = (await act()) as { ok: boolean; message: string };
    assert.equal(result.ok, true, `${name}: ${result.message}`);
  }
});

/**
 * The way back, as the board shows it: the toast's Undo and the dossier's History band.
 *
 * `undoAction` has existed and been tested for as long as the AUTO acts have, and no surface
 * called it. These pin the two places it is now reached from, and the rule that an act with no
 * way back says why rather than drawing a dead control.
 *
 *   node --import ./test/register.mjs --test "test/**\/*.test.ts"
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { tempHome } from "./tmp-home";

tempHome("hirelane-history-test-");

const { db } = await import("../lib/db");
const { buildBoard } = await import("../lib/board");
const { addNote, moveStage, undoAction } = await import("../app/actions");
/* Imported per test, so a missing module fails each case on its own rather than the whole file. */
const history = () => import("../components/board/history");

const applied = (offset: number): { id: string; name: string } =>
  db().get<{ id: string; name: string }>(
    "SELECT id, name FROM applicants WHERE stage = 'applied' ORDER BY id LIMIT 1 OFFSET ?",
    [offset],
  )!;

const candidateOn = (id: string) => {
  const found = buildBoard()
    .roles.flatMap((r) => r.columns.flatMap((c) => c.candidates))
    .find((c) => c.id === id);
  assert.ok(found, `${id} is on the board`);
  return found;
};

test("toastFor puts an Undo on a result that carries one, and nothing on a result that does not", async () => {
  const { toastFor } = await history();
  assert.deepEqual(toastFor({ ok: true, message: "Note added.", undoId: 42 }), {
    text: "Note added.",
    tone: "success",
    action: { label: "Undo", id: 42 },
  });
  assert.deepEqual(toastFor({ ok: true, message: "Interview time sent." }), {
    text: "Interview time sent.",
    tone: "success",
  });
  assert.deepEqual(toastFor({ ok: false, message: "Write something first." }), {
    text: "Write something first.",
    tone: "error",
  });
});

test("the History band lists a person's acts newest first, and an undone act loses its Undo", async () => {
  const x = applied(0);
  assert.equal((await moveStage(x.id, "screening")).ok, true);
  assert.equal((await addNote(x.id, "Strong systems answer.")).ok, true);

  const before = candidateOn(x.id).meta.history;
  assert.deepEqual(
    before.map((r) => r.action),
    ["add_note", "move_stage"],
    "newest first, and only this person's rows",
  );
  assert.ok(before.every((r) => r.undoable), "both are reversible and neither is undone");

  const move = before[1]!;
  assert.equal((await undoAction(move.id)).ok, true);

  const after = candidateOn(x.id);
  assert.equal(after.stage, "applied", "the undo put them back");
  assert.equal(after.meta.history[0]!.action, "undo", "the undo is itself on the record, at the top");
  const moved = after.meta.history.find((r) => r.id === move.id)!;
  assert.equal(moved.undone, true, "the move reads undone");
  assert.equal(moved.undoable, false, "and offers no second undo");
});

test("an irreversible act says why it has no Undo instead of drawing one", async () => {
  const { historyRow } = await history();
  const row = historyRow({
    id: 7,
    ts: "2026-09-07T09:00:00.000Z",
    action: "decide_stage",
    summary: "Decision on Ada Byrne: Offer.",
    reversible: false,
    undone: false,
  });
  assert.equal(row.undoable, false);
  assert.equal(row.why, "reached the person and cannot be taken back");
});

test("the History band is bounded and says by how much", async () => {
  const { historyNote } = await history();
  const y = applied(1);
  for (let i = 1; i <= 12; i += 1) {
    assert.equal((await addNote(y.id, `Reading note ${i}.`)).ok, true);
  }

  const { meta } = candidateOn(y.id);
  assert.equal(meta.history.length, 8, "eight rows are shown");
  assert.equal(meta.historyTotal, 12, "of the twelve that exist");
  assert.equal(historyNote(meta), "(showing 8 of 12)");
  assert.match(meta.history[0]!.summary, /Reading note 12/, "and they are the newest eight");
});

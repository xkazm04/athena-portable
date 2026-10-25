// An undo answers what it put back (scan-sweep challenge 2026-10-25, demo-kit-ui-webmcp/B).
//
// `undoActivity` used to treat a returning `applyUndo` as a clean reversal: it marked the row
// undone and logged "Undid #n" whatever the app had done, so an app that declined (a later move
// stood in the way) or only half-reversed (a slot already booked) was reported as undone. These
// pin the verdict `applyUndo` may now return, and the chain `{through: true}` takes.
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { registerHooks } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";

// The module imports the `server-only` build marker, which only a bundler resolves.
registerHooks({
  resolve(specifier, context, next) {
    if (specifier === "server-only") return { url: "data:text/javascript,export{}", shortCircuit: true };
    return next(specifier, context);
  },
});

const { DB_SCRATCH_ENV, openDb } = await import("../src/db/index.ts");
const { createActivityTable, getActivity, listActivity, logActivity, undoActivity } = await import(
  "../src/activity/index.ts"
);
type Db = import("../src/db/index.ts").Db;
type ActivityEntry = import("../src/activity/types.ts").ActivityEntry;

const scratch = mkdtempSync(join(tmpdir(), "dk-activity-undo-"));
const prior = process.env[DB_SCRATCH_ENV];
process.env[DB_SCRATCH_ENV] = scratch;
const opened: Db[] = [];
after(() => {
  for (const d of opened) d.close();
  if (prior === undefined) delete process.env[DB_SCRATCH_ENV];
  else process.env[DB_SCRATCH_ENV] = prior;
  rmSync(scratch, { recursive: true, force: true });
});

let n = 0;
/** A fresh scratch database with the activity table and one domain table an undo can write. */
function fresh(): Db {
  n += 1;
  const d = openDb(`undo${n}`, {
    file: join(scratch, "data", `undo${n}.sqlite`),
    seed: (tx) => {
      createActivityTable(tx);
      tx.exec("CREATE TABLE things (id INTEGER PRIMARY KEY, v TEXT)");
    },
  });
  opened.push(d);
  return d;
}

const act = (d: Db, summary: string) =>
  logActivity(d, { actor: "athena", action: "move", target: "thing:1", summary, reversible: true, undo: { s: summary } });
const rows = (d: Db) => listActivity(d, 100);
const things = (d: Db) => d.all<{ v: string }>("SELECT v FROM things ORDER BY id").map((r) => r.v);

test("case 1: a refused verdict leaves the row undoable, logs nothing, and rolls back what applyUndo wrote", () => {
  const d = fresh();
  const blocker = act(d, "first");
  const entry = act(d, "second");
  const before = rows(d).length;

  const result = undoActivity(d, entry.id, (tx) => {
    tx.run("INSERT INTO things (v) VALUES ('half-written')");
    return { refused: "a later move (to Interview) was made after it", blockedBy: blocker.id };
  });

  assert.deepEqual(
    { ok: result.ok, reason: result.reason, blockedBy: result.blockedBy },
    { ok: false, reason: "a later move (to Interview) was made after it", blockedBy: blocker.id },
  );
  assert.equal(getActivity(d, entry.id)!.undone, false, "the entry stays undoable");
  assert.equal(rows(d).length, before, "no activity row is added");
  assert.deepEqual(things(d), [], "the write applyUndo made before refusing is rolled back");
});

test("case 2: a partial verdict is ONE 'Partly undid' row, and the entry reads undone", () => {
  const d = fresh();
  const entry = act(d, "held 3 slots");
  const before = rows(d).length;
  const note = "released 2 of 3 slots: 1 had already been booked";

  const result = undoActivity(d, entry.id, () => ({ partial: note }));

  assert.equal(result.ok, true);
  assert.equal(result.partial, note);
  assert.equal(getActivity(d, entry.id)!.undone, true);
  const added = rows(d).slice(0, rows(d).length - before);
  assert.equal(added.length, 1, "exactly one compensating row");
  assert.equal(added[0]!.summary, `Partly undid #${entry.id}: ${note}`);
  assert.equal(added.some((r) => r.summary.startsWith("Undid #")), false, "no clean 'Undid' line beside it");
});

test("case 3 (guard): a void applyUndo is today's undo, unchanged", () => {
  const d = fresh();
  const entry = act(d, "moved X");
  const before = rows(d).length;

  const result = undoActivity(d, entry.id, (tx: Db, e: ActivityEntry): void => {
    tx.run("INSERT INTO things (v) VALUES (?)", [`reversed ${e.id}`]);
  });

  assert.deepEqual(Object.keys(result).sort(), ["entry", "ok"]);
  assert.equal(result.ok, true);
  assert.equal(getActivity(d, entry.id)!.undone, true);
  assert.equal(rows(d).length, before + 1);
  assert.equal(rows(d)[0]!.summary, `Undid #${entry.id}: moved X`);
  assert.deepEqual(things(d), [`reversed ${entry.id}`]);
});

/** An app whose undo of `id` refuses while a later row it names still stands. */
function chainedUndo(blockerOf: Map<number, number>, refuseAfter?: number) {
  return (tx: Db, e: ActivityEntry) => {
    const blocker = blockerOf.get(e.id);
    if (blocker !== undefined && !getActivity(tx, blocker)!.undone) {
      return { refused: `#${blocker} was made after it`, blockedBy: blocker };
    }
    if (e.id === refuseAfter) return { refused: "the world moved again" };
    tx.run("INSERT INTO things (v) VALUES (?)", [`reversed ${e.id}`]);
    return undefined;
  };
}

test("case 4: {through:true} undoes the blocker then the row, newest first, in one transaction", () => {
  const d = fresh();
  const first = act(d, "first");
  const blocker = act(d, "blocker");
  const apply = chainedUndo(new Map([[first.id, blocker.id]]));

  const result = undoActivity(d, first.id, apply, { through: true });

  assert.equal(result.ok, true, result.reason);
  assert.deepEqual(things(d), [`reversed ${blocker.id}`, `reversed ${first.id}`], "newest first");
  assert.equal(getActivity(d, blocker.id)!.undone, true);
  assert.equal(getActivity(d, first.id)!.undone, true);
  assert.deepEqual(result.alsoUndone?.map((e) => e.id), [blocker.id]);

  // All or nothing: when the row itself still refuses once its blocker is undone, neither is.
  const d2 = fresh();
  const a = act(d2, "first");
  const b = act(d2, "blocker");
  const before = rows(d2).length;
  const refused = undoActivity(d2, a.id, chainedUndo(new Map([[a.id, b.id]]), a.id), { through: true });
  assert.equal(refused.ok, false);
  assert.equal(refused.reason, "the world moved again", "the result names the refusal");
  assert.equal(getActivity(d2, a.id)!.undone, false);
  assert.equal(getActivity(d2, b.id)!.undone, false, "the blocker's undo is rolled back too");
  assert.equal(rows(d2).length, before, "and so are both compensating rows");
  assert.deepEqual(things(d2), []);
});

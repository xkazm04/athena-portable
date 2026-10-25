// The template's one reversible act (scan-sweep challenge 2026-10-25, demo-kit-template/B).
//
// The template a new app is copied from used to act on nothing: every registered tool was
// read-only, the selection was counted and inert, and `applyUndo` restored a status nothing ever
// wrote. These pin the act it now ships - a bulk status change, logged once with its undo, handed
// back as `undoId` (ADR 0111), undone only where a later act has not moved the record since - and
// the tool an agent reaches it by, classified AUTO under the kit's own rule.
//
// The template sits outside the pnpm workspace and imports the kit by package name and its own
// siblings without an extension (Next resolves both), so the hook below maps those to the kit's
// source and `.ts`, and stubs the `server-only` build marker. The code under test is the source a
// copy ships.
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { registerHooks } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

const KIT = join(dirname(fileURLToPath(import.meta.url)), "..");
const TEMPLATE = join(KIT, "template");

registerHooks({
  resolve(specifier, context, next) {
    if (specifier === "server-only") return { url: "data:text/javascript,export{}", shortCircuit: true };
    const kit = /^@athena\/demo-kit\/([a-z]+)$/.exec(specifier);
    if (kit) return { url: pathToFileURL(join(KIT, "src", kit[1]!, "index.ts")).href, shortCircuit: true };
    try {
      return next(specifier, context);
    } catch (err) {
      if ((err as { code?: string }).code !== "ERR_MODULE_NOT_FOUND" || !specifier.startsWith(".")) throw err;
      return next(`${specifier}.ts`, context);
    }
  },
});

const { DB_SCRATCH_ENV, openDb } = await import("../src/db/index.ts");
const { listActivity, getActivity, logActivity, undoActivity } = await import("../src/activity/index.ts");
const { classifyTool } = await import("../src/webmcp/types.ts");
const { athenaFor } = await import("../src/webmcp/hooks.ts");
const { STATUSES } = await import("../template/lib/types.ts");
const { MAX_ACT_IDS, SET_STATUS_TOOL, planStatusChange } = await import("../template/lib/acts.ts");
const { RECORDS_SCHEMA, applyUndo, seedRecords, setRecordStatus } = await import("../template/lib/db.ts");
type Db = import("../src/db/index.ts").Db;

const scratch = mkdtempSync(join(tmpdir(), "dk-template-acts-"));
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
/** The template's own seed in a scratch file, with rec_0001..rec_0003 set open so cases are fixed. */
function fresh(): Db {
  n += 1;
  const d = openDb(`acts${n}`, { file: join(scratch, "data", `acts${n}.sqlite`), seed: seedRecords });
  opened.push(d);
  d.run("UPDATE records SET status = 'open' WHERE id IN ('rec_0001','rec_0002','rec_0003')");
  return d;
}
const statusOf = (d: Db, id: string) => d.get<{ status: string }>("SELECT status FROM records WHERE id = ?", [id])?.status;
const activityCount = (d: Db) => listActivity(d, 1000).length;

const open = (id: string) => ({ id, status: "open" as const });
const archived = (id: string) => ({ id, status: "archived" as const });

test("case 1: planning both open records to archived changes both, skips none, and says 'Archived 2 records.'", () => {
  const plan = planStatusChange([open("rec_0001"), open("rec_0002"), open("rec_0003")], ["rec_0001", "rec_0002"], "archived");
  assert.deepEqual(plan, {
    ok: true,
    to: "archived",
    changes: [
      { id: "rec_0001", from: "open", to: "archived" },
      { id: "rec_0002", from: "open", to: "archived" },
    ],
    skipped: [],
    summary: "Archived 2 records.",
  });
});

test("case 2: an id already there and an unknown id are skipped with reasons; all skipped is a refusal that logs nothing", () => {
  const rows = [open("rec_0001"), archived("rec_0002")];
  const plan = planStatusChange(rows, ["rec_0001", "rec_0002", "rec_9999"], "archived");
  assert.ok(plan.ok);
  assert.deepEqual(plan.changes, [{ id: "rec_0001", from: "open", to: "archived" }]);
  assert.deepEqual(plan.skipped, [
    { id: "rec_0002", reason: "already archived" },
    { id: "rec_9999", reason: "no record rec_9999" },
  ]);

  const none = planStatusChange(rows, ["rec_0002", "rec_9999"], "archived");
  assert.equal(none.ok, false);
  assert.ok(!none.ok && /already archived/.test(none.error) && /no record rec_9999/.test(none.error), JSON.stringify(none));

  const d = fresh();
  d.run("UPDATE records SET status = 'archived' WHERE id = 'rec_0002'");
  const before = activityCount(d);
  const result = setRecordStatus(d, ["rec_0002", "rec_9999"], "archived", "user");
  assert.equal(result.ok, false);
  assert.equal(activityCount(d), before, "a refusal writes no activity row");
});

test("case 3: 51 ids are refused naming the cap; the tool's ids cap and status enum are the one vocabulary", () => {
  const ids = Array.from({ length: 51 }, (_, i) => `rec_${String(i + 1).padStart(4, "0")}`);
  const plan = planStatusChange(ids.map(open), ids, "archived");
  assert.equal(plan.ok, false);
  assert.ok(!plan.ok && /50/.test(plan.error), JSON.stringify(plan));
  assert.equal(MAX_ACT_IDS, 50);

  const d = fresh();
  const before = activityCount(d);
  assert.equal(setRecordStatus(d, ids, "archived", "user").ok, false);
  assert.equal(activityCount(d), before, "nothing written over the cap");
  assert.equal(statusOf(d, "rec_0001"), "open");

  const params = new Map(SET_STATUS_TOOL.parameters.map((p) => [p.name, p]));
  assert.equal(params.get("ids")?.maxItems, 50);
  assert.equal(params.get("ids")?.type, "string[]");
  assert.deepEqual(params.get("status")?.enum, [...STATUSES]);
  const check = /CHECK \(status IN \(([^)]*)\)\)/.exec(RECORDS_SCHEMA)?.[1];
  assert.deepEqual(check?.split(",").map((s) => s.trim().replace(/'/g, "")), [...STATUSES]);
});

test("case 4: setRecordStatus updates the rows and logs exactly one reversible row whose id comes back as undoId", () => {
  const d = fresh();
  const before = activityCount(d);
  const result = setRecordStatus(d, ["rec_0001", "rec_0002"], "archived", "athena");
  assert.ok(result.ok, JSON.stringify(result));
  assert.equal(statusOf(d, "rec_0001"), "archived");
  assert.equal(statusOf(d, "rec_0002"), "archived");
  assert.equal(activityCount(d), before + 1, "exactly one activity row");
  const row = listActivity(d, 1)[0]!;
  assert.equal(result.undoId, row.id);
  assert.equal(row.reversible, true);
  assert.equal(row.actor, "athena");
  assert.equal(row.summary, "Archived 2 records.");
  assert.deepEqual(row.undo, {
    kind: "status",
    changes: [
      { id: "rec_0001", from: "open", to: "archived" },
      { id: "rec_0002", from: "open", to: "archived" },
    ],
  });
});

test("case 5: undoActivity(undoId) puts every record back at its from status and marks the entry undone", () => {
  const d = fresh();
  const result = setRecordStatus(d, ["rec_0001", "rec_0002"], "archived", "user");
  assert.ok(result.ok);
  const undone = undoActivity(d, result.undoId, applyUndo);
  assert.equal(undone.ok, true, JSON.stringify(undone));
  assert.equal(undone.partial, undefined);
  assert.equal(statusOf(d, "rec_0001"), "open");
  assert.equal(statusOf(d, "rec_0002"), "open");
  assert.equal(getActivity(d, result.undoId)!.undone, true);
});

test("case 6: guarded undo restores what the act left, leaves a record a later act moved, and names it", () => {
  const d = fresh();
  const first = setRecordStatus(d, ["rec_0001", "rec_0002"], "archived", "user");
  assert.ok(first.ok);
  const second = setRecordStatus(d, ["rec_0001"], "open", "user");
  assert.ok(second.ok);

  const undone = undoActivity(d, first.undoId, applyUndo);
  assert.equal(undone.ok, true, JSON.stringify(undone));
  assert.equal(statusOf(d, "rec_0002"), "open", "rec_0002 restored");
  assert.equal(statusOf(d, "rec_0001"), "open", "rec_0001 left where the later act put it");
  const line = listActivity(d, 1)[0]!;
  assert.equal(line.action, "undo");
  assert.match(line.summary, /left rec_0001/);

  // Every record moved since: nothing to put back is a refusal naming the act in the way.
  const third = setRecordStatus(d, ["rec_0003"], "archived", "user");
  assert.ok(third.ok);
  const fourth = setRecordStatus(d, ["rec_0003"], "open", "user");
  assert.ok(fourth.ok);
  const refused = undoActivity(d, third.undoId, applyUndo);
  assert.equal(refused.ok, false);
  assert.equal(refused.blockedBy, fourth.undoId);
  assert.equal(getActivity(d, third.undoId)!.undone, false);
});

test("case 7 (guard): set_record_status is AUTO under the kit's rule; the template's other tools stay read-only", () => {
  assert.equal(SET_STATUS_TOOL.name, "set_record_status");
  assert.deepEqual(athenaFor(SET_STATUS_TOOL), { reversible: true, side_effects: "internal" });
  assert.equal(classifyTool(athenaFor(SET_STATUS_TOOL)), "AUTO");

  // The registrations as written in the template's components: name -> sideEffects literal.
  const registered = new Map<string, string>();
  for (const dir of ["components", "app"]) {
    const walk = (p: string): void => {
      for (const e of readdirSync(p, { withFileTypes: true })) {
        const path = join(p, e.name);
        if (e.isDirectory()) walk(path);
        else if (/\.tsx?$/.test(e.name)) {
          const text = readFileSync(path, "utf8");
          for (const m of text.matchAll(/useWebMCPTool\(\{\s*name:\s*"([a-z_]+)"[\s\S]*?sideEffects:\s*"([a-z]+)"/g)) {
            registered.set(m[1]!, m[2]!);
          }
        }
      }
    };
    walk(join(TEMPLATE, dir));
  }
  for (const name of ["navigate", "read_current_view", "read_selection"]) {
    assert.equal(registered.get(name), "none", `${name} is no longer read-only`);
  }
});

test("case 8 (guard): an unknown undo kind still throws, and the seed row still refuses as not reversible", () => {
  const d = fresh();
  const odd = logActivity(d, {
    actor: "user",
    action: "mystery",
    target: "records",
    summary: "A write with no strategy.",
    reversible: true,
    undo: { kind: "teleport" },
  });
  assert.throws(() => undoActivity(d, odd.id, applyUndo), /no undo strategy for mystery/);
  const seed = listActivity(d, 1000).find((e) => e.action === "seed")!;
  const refused = undoActivity(d, seed.id, applyUndo);
  assert.equal(refused.ok, false);
  assert.match(refused.reason ?? "", /not reversible/);
});

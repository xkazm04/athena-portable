/**
 * The write paths under generated sequences: a seeded walk over every mutation in lib/mutations.ts,
 * with an oracle that recomputes every stored flag, segment and sheet figure from the raw columns
 * after each step (test/model/oracle.ts).
 *
 * The per-write tests beside this file (liveness, conflict-flag, pairs, merge-plan) each pin one
 * write against the one state the seed gives them. The seed cannot reach most of the states the
 * writes must survive - a contact in two open pairs, a domain with nobody left on it, an undo the
 * world has moved past - so this file generates them, and the reach tally fails if the generator
 * stops getting there. A failing walk writes its op trace to test/model/traces/, and every trace
 * committed there replays as a regression. Isolation between walks is a row snapshot, not an outer
 * transaction: `withTx` is re-entrant and joins, so a walk wrapped in one would keep what a
 * refused inner write left behind.
 *
 *   node --experimental-transform-types --import ./test/register.mjs --test "test/**\/*.test.ts"
 */
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { tempHome } from "./tmp-home";
import type { Trace, WalkResult } from "./model/ops";

tempHome("tidycrm-model-");

const TRACES = fileURLToPath(new URL("./model/traces/", import.meta.url));

const { db, segmentRows } = await import("../lib/db");
const { restamp } = await import("../lib/flags");
const { deleteContacts } = await import("../lib/mutations");
const { checkInvariants, INVARIANTS } = await import("./model/oracle");
const ops = await import("./model/ops");
const snapshot = await import("./model/snapshot");

const SEEDED = snapshot.take(db());
const SEEDED_PRINT = snapshot.fingerprint(db());

/** Back to the freshly seeded rows, ids and sequences included, so every case starts the same. */
function reset(): void {
  snapshot.restore(db(), SEEDED);
}

const invariantsOf = (vs: { invariant: string }[]) => [...new Set(vs.map((v) => v.invariant))];

test("oracle negative control: a conflict flag cleared by hand is named, with its domain", () => {
  reset();
  const DOMAIN = "verdant-supply.example";
  db().run("UPDATE contacts SET conflict = 0 WHERE domain = ?", [DOMAIN]);
  const found = checkInvariants();
  assert.ok(found.length > 0, "the oracle can go red");
  assert.ok(
    found.some((v) => v.invariant === "conflict" && v.subject === DOMAIN),
    `a violation names conflict and ${DOMAIN}: ${JSON.stringify(found.slice(0, 3))}`,
  );
  reset();
});

test("oracle negative control: a pair flag flipped by hand and an open pair on a deleted record are both named", () => {
  reset();
  const [pair] = db().all<{ keep_id: string }>(
    "SELECT keep_id FROM merge_pairs WHERE status = 'open' ORDER BY id LIMIT 1",
  );
  assert.ok(pair, "the seed carries open pairs");
  db().run("UPDATE contacts SET in_open_pair = 0 WHERE id = ?", [pair.keep_id]);
  const flipped = checkInvariants();
  assert.ok(
    flipped.some((v) => v.invariant === "in_open_pair" && v.subject === pair.keep_id),
    `in_open_pair is named on ${pair.keep_id}: ${JSON.stringify(invariantsOf(flipped))}`,
  );
  reset();

  // Separately: a record that left through the real delete path, then a pair planted against it
  // and stamped through the flags' own writer, so the only lie left is the pair itself.
  const unpaired = segmentRows("all").filter((c) => c.in_open_pair === 0);
  const [keep, gone] = [unpaired[0], unpaired[1]];
  assert.ok(keep && gone);
  assert.equal(deleteContacts([gone.id]).ok, true);
  assert.deepEqual(checkInvariants(), [], "a real delete leaves nothing for the oracle");
  db().run(
    `INSERT INTO merge_pairs (id, keep_id, drop_id, confidence, evidence_json, status)
     VALUES ('pair_planted', ?, ?, 0.5, '[]', 'open')`,
    [keep.id, gone.id],
  );
  restamp(db(), { ids: [keep.id, gone.id] });
  const planted = checkInvariants();
  assert.ok(
    planted.some((v) => v.invariant === "open pair with a non-working member" && v.subject === "pair_planted"),
    `the planted pair is named: ${JSON.stringify(invariantsOf(planted))}`,
  );
  reset();
});

test("oracle on the untouched seed: zero violations across all eight invariants", () => {
  reset();
  assert.equal(INVARIANTS.length, 8, "eight invariants are checked");
  assert.deepEqual(checkInvariants(), []);
});

/** The walks run once; the reach and round-trip cases read what they recorded. */
const WALK_SEEDS = [1, 2, 3, 4, 5, 6, 7, 8];
const STEPS = 40;
let walks: WalkResult[] = [];

test("random walk: seeds 1..8, 40 ops each, every invariant holds after every op", () => {
  walks = WALK_SEEDS.map((seed) => {
    reset();
    return ops.walk(seed, STEPS, { check: checkInvariants, tracesDir: TRACES });
  });
  for (const w of walks) {
    assert.equal(w.trace.ops.length, STEPS, `seed ${w.seed} took ${STEPS} steps`);
    assert.equal(
      w.failure,
      null,
      w.failure ? `seed ${w.seed}: ${w.failure.message} (trace written to ${w.failure.tracePath})` : "",
    );
  }
  // The walk did work, not 320 refusals.
  const landed = walks.reduce((n, w) => n + w.landed, 0);
  assert.ok(landed > STEPS, `writes landed: ${landed}`);
});

test("undo round trip: a reversible op undone at once restores contacts and merge_pairs", (t) => {
  assert.ok(walks.length === WALK_SEEDS.length, "the walks ran");
  const trips = walks.flatMap((w) => w.roundTrips);
  assert.ok(trips.length >= 8, `round trips checked: ${trips.length}`);
  t.diagnostic(`round trips: ${trips.length}`);
  const broken = trips.filter((trip) => !trip.restored);
  assert.deepEqual(
    broken.map((trip) => `seed ${trip.seed} step ${trip.step}: ${trip.op}`),
    [],
    "every immediate undo returned the tables to their pre-op digests",
  );
});

test("generator reach: the walks visit the states the seed cannot produce", (t) => {
  assert.ok(walks.length === WALK_SEEDS.length, "the walks ran");
  const tally = ops.emptyTally();
  for (const w of walks) for (const k of ops.REACH) tally[k] += w.tally[k];
  t.diagnostic(`reach: ${JSON.stringify(tally)}`);
  const unreached = ops.REACH.filter((k) => tally[k] === 0);
  assert.deepEqual(unreached, [], `the generator never reached: ${unreached.join(", ")}`);
});

test("replay: every committed trace replays and holds every invariant after each step", async (t) => {
  assert.ok(existsSync(TRACES), "the traces directory exists");
  const files = readdirSync(TRACES).filter((f) => f.endsWith(".json"));
  let replayed = 0;
  for (const file of files) {
    const trace = JSON.parse(readFileSync(TRACES + file, "utf8")) as Trace;
    await t.test(file, { todo: trace.todo }, () => {
      reset();
      ops.replay(trace, (step, op) => {
        const found = checkInvariants();
        assert.deepEqual(found, [], `${file} step ${step}: ${JSON.stringify(op)}`);
      });
    });
    replayed += 1;
  }
  assert.equal(replayed, files.length, "the loop ran over the whole directory");
  assert.ok(readdirSync(TRACES).length > 0, "and the directory it ran over is the committed one");
});

test("isolation: the snapshot restore returns all four tables to their seeded rows", () => {
  // The last case left whatever its replay wrote; the walks before it left their eighth world.
  ops.replay({ ops: [{ op: "deleteContacts", args: [[segmentRows("all")[0]?.id ?? ""]] }] }, () => {});
  assert.notDeepEqual(snapshot.fingerprint(db()), SEEDED_PRINT, "there is something to restore");
  reset();
  assert.deepEqual(snapshot.fingerprint(db()), SEEDED_PRINT);
  assert.deepEqual(checkInvariants(), []);
});

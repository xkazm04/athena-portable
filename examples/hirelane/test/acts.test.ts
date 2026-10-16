/**
 * The dossier offers exactly what the server actions accept: one act-availability module, pinned.
 *
 * DESIGN-LAW §7.7 used to govern one direction only - whatever the surface states, the action
 * enforces. The other direction drifted: the gate panel listed `board.openSlots` (status = 'open'),
 * the scheduling action accepts any slot that is not booked and is not held for somebody else, so
 * a candidate whose three slots Propose slots had just held could not be booked into any of them
 * from the dossier. `lib/acts.ts` is now the one answer to "may this act run for this person, with
 * which choices, and if not, why", and these cases hold both readers to it.
 *
 *   node --import ./test/register.mjs --test "test/**\/*.test.ts"
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { tempHome } from "./tmp-home";

tempHome("hirelane-acts-test-");

const { db } = await import("../lib/db");
const { buildBoard } = await import("../lib/board");
const { actsFor, isFree, REFUSAL } = await import("../lib/acts");
const { STAGES } = await import("../lib/constants");
const { boardRead, dossierRead } = await import("../components/board/tools/read");
const { decideStage, moveStage, proposeSlots, scoreAgainstRubric, sendRejection, sendSchedulingEmail } =
  await import("../app/actions");

type Board = ReturnType<typeof buildBoard>;

/** The candidate as the dossier receives it, and the role it sits in. */
function find(board: Board, id: string) {
  for (const role of board.roles) {
    for (const column of role.columns) {
      const candidate = column.candidates.find((c) => c.id === id);
      if (candidate) return { role, candidate };
    }
  }
  throw new Error(`no candidate ${id} on the board`);
}

const firstAt = (stage: string): string =>
  db().get<{ id: string }>("SELECT id FROM applicants WHERE stage = ? ORDER BY id LIMIT 1", [stage])!.id;

/*
 * Run in order, on one database. The first case holds three slots for one interview candidate and
 * leaves them held - the state the bug lived in - and the two reads after it look at that state.
 * The parity matrix runs last because it drains every free slot; each of its own calls is rolled
 * back through a SAVEPOINT, so the acts it compares are always the ones the board would show.
 */
let heldFor = "";
let held: string[] = [];

test("actsFor offers the slots Propose slots just held, first, and picks the first of them", async () => {
  heldFor = firstAt("interview");
  const result = await proposeSlots(heldFor);
  assert.equal(result.ok, true, result.message);
  held = (result.slots ?? []).map((s) => s.id);
  assert.equal(held.length, 3, "three slots were held");

  const board = buildBoard();
  const { candidate } = find(board, heldFor);
  const schedule = actsFor(candidate, board.slots).schedule;

  assert.equal(schedule.enabled, true);
  assert.deepEqual(
    schedule.slots.slice(0, 3).map((s) => s.id),
    held,
    "the held three lead the list, in the order they were held",
  );
  assert.equal(schedule.slots[0]?.id, held[0], "and the default pick is the first held slot");
  const rest = schedule.slots.slice(3);
  assert.equal(rest.length, 12, "then twelve open slots");
  for (const s of rest) assert.ok(isFree(s), `${s.id}: an open slot nobody holds`);
});

test("a refusal reason reads the same in the dossier and from the server", async () => {
  const rejected = firstAt("rejected");
  const board = buildBoard();
  const { candidate } = find(board, rejected);

  const offer = actsFor(candidate, board.slots).offer;
  assert.deepEqual(offer, { enabled: false, reason: "decided" });

  const refused = await decideStage(rejected, "offer");
  assert.equal(refused.ok, false);
  assert.equal(refused.message, REFUSAL.decided(candidate), "the server's words are the module's");
});

test("the agent's dossier read carries the same acts, and read_view counts free slots by the same predicate", () => {
  const board = buildBoard();
  const { role, candidate } = find(board, heldFor);

  const read = dossierRead(role, candidate, board.slots);
  const schedule = read.acts.send_scheduling_email;
  assert.equal(schedule.enabled, true);
  assert.ok("slots" in schedule && schedule.slots, "an open act names its choices");
  assert.deepEqual(
    schedule.slots.slice(0, 3).map((s) => s.id),
    held,
    "the agent is offered the held three first, as the person is",
  );
  assert.deepEqual(
    schedule.slots.map((s) => s.id),
    actsFor(candidate, board.slots).schedule.slots.map((s) => s.id),
  );

  const free = db().get<{ n: number }>("SELECT COUNT(*) AS n FROM slots WHERE status = 'open'")!.n;
  assert.equal(boardRead(board).open_interview_slots, free, "every free slot, not a capped list of them");
  assert.equal(boardRead(board).open_interview_slots, board.slots.filter(isFree).length);
});

/*
 * Propose slots holds interview time, so it is for the people who can be booked into it: at
 * Interview, not decided, and three slots each in all. Each case below is rolled back, so the
 * matrix after it sees the board the first case left.
 */
const heldCount = (id: string): number =>
  db().get<{ n: number }>("SELECT COUNT(*) AS n FROM slots WHERE status = 'proposed' AND applicant_id = ?", [id])!.n;

const rolledBack = async (body: () => Promise<void>): Promise<void> => {
  const raw = db().raw;
  raw.exec("SAVEPOINT propose");
  try {
    await body();
  } finally {
    raw.exec("ROLLBACK TO propose");
    raw.exec("RELEASE propose");
  }
};

test("propose_slots refuses a decided or pre-interview person, in the module's words, and holds nothing", async () => {
  const want = { applied: "too_early", screening: "too_early", offer: "decided", rejected: "decided" } as const;
  for (const [stage, reason] of Object.entries(want)) {
    const id = firstAt(stage);
    const board = buildBoard();
    const { candidate } = find(board, id);
    assert.deepEqual(actsFor(candidate, board.slots).propose, { enabled: false, reason }, `${stage}: the button`);
    await rolledBack(async () => {
      const result = await proposeSlots(id);
      assert.equal(result.ok, false, `${stage}: the server`);
      assert.equal(result.message, REFUSAL[reason](candidate), `${stage}: the module's sentence`);
      assert.equal(heldCount(id), 0, `${stage}: no slot held`);
    });
  }
});

test("a second propose_slots holds nothing new: three held is the most one person gets", async () => {
  const board = buildBoard();
  const { candidate } = find(board, heldFor);
  assert.equal(heldCount(heldFor), 3);
  assert.deepEqual(actsFor(candidate, board.slots).propose, { enabled: false, reason: "already_held" });
  await rolledBack(async () => {
    const again = await proposeSlots(heldFor);
    assert.equal(again.ok, false, again.message);
    assert.equal(again.message, REFUSAL.already_held(candidate));
    assert.equal(heldCount(heldFor), 3, "still three");
  });
});

test("with one of their three released, propose_slots tops them back up to three, not to six", async () => {
  await rolledBack(async () => {
    db().run("UPDATE slots SET status = 'open', applicant_id = NULL WHERE id = ?", [held[2]!]);
    const board = buildBoard();
    const { candidate } = find(board, heldFor);
    assert.equal(actsFor(candidate, board.slots).propose.enabled, true);
    const result = await proposeSlots(heldFor);
    assert.equal(result.ok, true, result.message);
    assert.equal(result.slots?.length, 1, "one slot held, the one they were short");
    assert.equal(heldCount(heldFor), 3);
  });
});

test("a shut Propose button names its own reason, and the dossier prints that label", async () => {
  const { proposeLabel } = await import("../lib/acts");
  const labels = {
    enabled: proposeLabel({ enabled: true }, "interview"),
    decided: proposeLabel({ enabled: false, reason: "decided" }, "rejected"),
    too_early: proposeLabel({ enabled: false, reason: "too_early" }, "screening"),
    already_held: proposeLabel({ enabled: false, reason: "already_held" }, "interview"),
    no_slot: proposeLabel({ enabled: false, reason: "no_slot" }, "interview"),
  };
  assert.equal(labels.enabled, "Propose slots");
  assert.equal(labels.no_slot, "No slot is open");
  assert.equal(new Set(Object.values(labels)).size, 5, `one label per reason: ${JSON.stringify(labels)}`);

  const { readFileSync } = await import("node:fs");
  const source = readFileSync(new URL("../components/board/dossier/Acts.tsx", import.meta.url), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/.*$/gm, "");
  assert.match(source, /proposeLabel\(acts\.propose, candidate\.stage\)/, "Acts.tsx prints the module's label");
  assert.doesNotMatch(source, /"No slot is open"/, "and types no reason of its own");
});

test("the dossier's act set equals what the server actions accept, for every applicant and act", async () => {
  const raw = db().raw;
  const anySlot = (): string =>
    db().get<{ id: string }>("SELECT id FROM slots WHERE status <> 'booked' ORDER BY id LIMIT 1")?.id ??
    "slot_none";

  /** Every applicant x every act, each call rolled back so the next one sees the same state. */
  const matrix = async (label: string): Promise<{ mismatches: string[]; reasons: Set<string> }> => {
    const ids = db().all<{ id: string }>("SELECT id FROM applicants ORDER BY id").map((r) => r.id);
    const mismatches: string[] = [];
    const reasons = new Set<string>();
    for (const id of ids) {
      const board = buildBoard();
      const { candidate } = find(board, id);
      const acts = actsFor(candidate, board.slots);
      const ladderNext = STAGES[STAGES.indexOf(candidate.stage) + 1] ?? "screening";
      const calls = {
        score: () => scoreAgainstRubric(id),
        move: () => moveStage(id, acts.move.to ?? ladderNext),
        propose: () => proposeSlots(id),
        offer: () => decideStage(id, "offer"),
        reject: () => sendRejection(id, "standard"),
        schedule: () => sendSchedulingEmail(id, acts.schedule.slots[0]?.id ?? anySlot()),
      } as const;
      for (const [act, call] of Object.entries(calls) as [keyof typeof calls, () => Promise<{ ok: boolean; message: string }>][]) {
        const offered = acts[act];
        if (offered.reason) reasons.add(`${act}:${offered.reason}`);
        raw.exec("SAVEPOINT parity");
        try {
          const result = await call();
          if (result.ok !== offered.enabled) {
            mismatches.push(
              `${label} ${id} (${candidate.stage}) ${act}: offered ${offered.enabled}, server ${result.ok} - ${result.message}`,
            );
          }
        } finally {
          raw.exec("ROLLBACK TO parity");
          raw.exec("RELEASE parity");
        }
      }
    }
    return { mismatches, reasons };
  };

  const fresh = await matrix("held");
  assert.deepEqual(fresh.mismatches, [], "no act is offered that the server refuses, or refused that it accepts");

  // Now with every free slot held: propose and schedule meet `no_slot`, and the candidate whose
  // slots were held first can still book one of their own. Only someone at Interview can hold, and
  // three at most, so the pool is drained the way a recruiter would drain it: advance an applicant
  // to Interview, hold their three, and take the next.
  const freeLeft = (): number => buildBoard().slots.filter(isFree).length;
  for (const id of db().all<{ id: string }>("SELECT id FROM applicants WHERE stage = 'applied' ORDER BY id").map((r) => r.id)) {
    if (freeLeft() === 0) break;
    assert.equal((await moveStage(id, "screening")).ok, true);
    assert.equal((await moveStage(id, "interview")).ok, true);
    assert.equal((await proposeSlots(id)).ok, true);
  }
  assert.equal(freeLeft(), 0, "every free slot is held");
  const drained = await matrix("drained");
  assert.deepEqual(drained.mismatches, []);

  const seen = new Set([...fresh.reasons, ...drained.reasons]);
  for (const reason of [
    "move:decided",
    "move:next_is_a_decision",
    "offer:decided",
    "reject:decided",
    "schedule:decided",
    "schedule:too_early",
    "schedule:no_slot",
    "propose:no_slot",
    "propose:decided",
    "propose:too_early",
    "propose:already_held",
  ]) {
    assert.ok(seen.has(reason), `the matrix met ${reason}, so the parity covers it`);
  }
});

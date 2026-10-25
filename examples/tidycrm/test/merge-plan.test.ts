/**
 * `preview_merge` states what the irreversible merge will write, from the planner the write runs.
 *
 * `mergeContacts` is GATED and cannot be undone, so the person approving it should see its
 * consequences before the yes: which values the survivor takes, which other open pairs close as
 * skipped, which flags and segments clear. `planMerge` is the one place that decides all of it;
 * `previewMerge` (what `previewMergeAction` and so the `preview_merge` tool return) attaches its
 * `outcome`, and `mergeContacts` executes the same plan. The cases below pin the preview against
 * what the write then does. Its own file, so the constructed pairs and spellings have a freshly
 * seeded database to themselves.
 *
 *   node --experimental-transform-types --import ./test/register.mjs --test "test/**\/*.test.ts"
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { tempHome } from "./tmp-home";

const ACTIONS = fileURLToPath(new URL("../app/actions.ts", import.meta.url));

tempHome("tidycrm-test-");

const { countSegment, db, getContact, getPair, listOpenPairs, previewPair } = await import("../lib/db");
const { restamp } = await import("../lib/flags");
const mutations = await import("../lib/mutations");
const { mergeContacts } = mutations;

/** Loaded per case, so the guard cases still run before `previewMerge` exists. */
function previewMerge(pairId: string) {
  const fn = (mutations as Record<string, unknown>).previewMerge as
    | ((id: string) => (ReturnType<typeof previewPair> & { outcome: import("../lib/types").MergeOutcome }) | undefined)
    | undefined;
  assert.equal(typeof fn, "function", "lib/mutations exports previewMerge");
  const preview = fn!(pairId);
  assert.ok(preview, `a preview for ${pairId}`);
  assert.ok(preview.outcome, "the preview carries the planner's outcome");
  return preview;
}

function statuses(): Map<string, string> {
  return new Map(db().all<{ id: string; status: string }>("SELECT id, status FROM merge_pairs").map((r) => [r.id, r.status]));
}

test("case 6 (guard): the preview keeps pair, keep, drop and conflicts with the same values as before", () => {
  const first = listOpenPairs(1)[0];
  assert.ok(first);
  const before = previewPair(first.id);
  assert.ok(before);
  // The fields assert against previewPair, the shape preview_merge returned before this change.
  const { pair, keep, drop, conflicts } = previewMerge(first.id);
  assert.deepEqual({ pair, keep, drop, conflicts }, before);
  // previewMergeAction is the preview, verbatim: the tool reads the same object this file tests.
  assert.match(readFileSync(ACTIONS, "utf8"), /return previewMerge\(pairId\) \?\? null;/);
});

test("case 7 (guard): mergeContacts' refusals and activity summary are unchanged for the seed's first pair", () => {
  const p = listOpenPairs(1)[0];
  assert.ok(p, "the seed carries open identity pairs");
  assert.equal(p.id, "pair_003");
  assert.deepEqual(mergeContacts(p.keep_id, p.keep_id), {
    ok: false,
    summary: "",
    error: "A contact cannot merge into itself.",
  });
  assert.deepEqual(mergeContacts("ct_nope", p.drop_id), { ok: false, summary: "", error: "One of those contacts is gone." });
  assert.deepEqual(mergeContacts(p.drop_id, p.keep_id), {
    ok: false,
    summary: "",
    error: "No open identity pair proposes merging ct_0116 into ct_0727.",
  });
  assert.deepEqual(mergeContacts(p.keep_id, p.drop_id), { ok: true, summary: "Merged ct_0727 into ct_0116." });
  assert.equal(
    db().get<{ summary: string }>("SELECT summary FROM activity ORDER BY id DESC LIMIT 1")?.summary,
    "Merged Zeké Mbeki (ct_0727) into Zeke Mbeki (ct_0116); nothing carried over (pair_003, 93% confidence).",
  );
  assert.equal(mergeContacts(p.keep_id, p.drop_id).error, "ct_0727 is already merged.");
  assert.equal(mergeContacts(p.drop_id, p.keep_id).error, "ct_0727 is already merged into ct_0116.");
});

test("case 1: the preview names each value the survivor adopts, from and to", () => {
  // pair_011: the keep's phone is badly formatted, the drop's is E.164.
  const phone = previewMerge("pair_011");
  assert.equal(phone.keep.phone_ok, 0);
  assert.equal(phone.drop.phone_ok, 1);
  assert.deepEqual(
    phone.outcome.adopts.find((a) => a.field === "phone"),
    { field: "phone", from: phone.keep.phone, to: phone.drop.phone },
  );

  // pair_001: the drop was active more recently than the keep.
  const date = previewMerge("pair_001");
  assert.ok(date.drop.last_activity_at > date.keep.last_activity_at);
  assert.deepEqual(
    date.outcome.adopts.find((a) => a.field === "last_activity_at"),
    { field: "last_activity_at", from: date.keep.last_activity_at, to: date.drop.last_activity_at },
  );
  assert.equal(date.outcome.refusal, undefined);
});

test("case 3: the preview names the flags the merge clears, on the domain and on the survivor", () => {
  // The drop of pair_007 is made the last odd spelling on its domain.
  const p = getPair("pair_007");
  assert.ok(p && p.status === "open");
  const drop = getContact(p.drop_id)!;
  const keep = getContact(p.keep_id)!;
  db().run("UPDATE contacts SET company = ? WHERE domain = ? AND deleted_at IS NULL AND merged_into IS NULL", [
    keep.company.trim(),
    drop.domain,
  ]);
  db().run("UPDATE contacts SET company = 'Odd Spelling Ltd' WHERE id = ?", [drop.id]);
  restamp(db(), { domains: [drop.domain, keep.domain] });
  assert.equal(getContact(drop.id)?.conflict, 1);

  const odd = previewMerge("pair_007");
  assert.deepEqual(
    odd.outcome.restamps.find((r) => r.flag === "conflict"),
    { flag: "conflict", domain: drop.domain, from: 1, to: 0 },
  );
  assert.equal(mergeContacts(p.keep_id, p.drop_id).ok, true);
  assert.equal(getContact(keep.id)?.conflict, 0, "the merge did what the preview said");

  // pair_035: a stale keep, a drop active since the cutoff.
  const stale = previewMerge("pair_035");
  assert.equal(stale.keep.is_stale, 1);
  assert.equal(stale.drop.is_stale, 0);
  assert.deepEqual(
    stale.outcome.restamps.find((r) => r.flag === "is_stale" && "id" in r && r.id === stale.keep.id),
    { flag: "is_stale", id: stale.keep.id, from: 1, to: 0 },
  );
  assert.equal(mergeContacts(stale.keep.id, stale.drop.id).ok, true);
  assert.equal(getContact(stale.keep.id)?.is_stale, 0, "the merge did what the preview said");
});

test("case 2: the preview lists the other open pairs the merge closes, and the merge closes exactly those", () => {
  const p = getPair("pair_011");
  assert.ok(p && p.status === "open");
  // A second open pair the drop stands in: a live contact in no pair proposes absorbing it too.
  const other = db().get<{ id: string }>(
    `SELECT id FROM contacts WHERE deleted_at IS NULL AND merged_into IS NULL AND in_open_pair = 0
      AND id NOT IN (?, ?) ORDER BY id LIMIT 1`,
    [p.keep_id, p.drop_id],
  );
  assert.ok(other);
  db().run(
    "INSERT INTO merge_pairs (id, keep_id, drop_id, confidence, evidence_json, status) VALUES ('pair_901', ?, ?, 0.5, '[]', 'open')",
    [other.id, p.drop_id],
  );
  restamp(db(), { ids: [other.id, p.drop_id] });

  const preview = previewMerge("pair_011");
  assert.deepEqual(preview.outcome.closes, ["pair_901"]);
  assert.deepEqual(
    preview.outcome.restamps.find((r) => r.flag === "in_open_pair" && "id" in r && r.id === other.id),
    { flag: "in_open_pair", id: other.id, from: 1, to: 0 },
  );

  const before = statuses();
  assert.equal(mergeContacts(p.keep_id, p.drop_id).ok, true);
  const after = statuses();
  const moved = [...after].filter(([id, s]) => before.get(id) !== s).map(([id]) => id).sort();
  assert.deepEqual(moved, ["pair_011", ...preview.outcome.closes].sort());
  assert.equal(after.get("pair_901"), "skipped");
});

test("case 5: a preview of a pair whose drop was merged by an earlier pair carries the write's own refusal", () => {
  const p = getPair("pair_901");
  assert.ok(p, "case 2 created it");
  const preview = previewMerge("pair_901");
  const refused = mergeContacts(p.keep_id, p.drop_id);
  assert.equal(refused.ok, false);
  assert.equal(preview.outcome.refusal, refused.error);
  assert.equal(preview.outcome.refusal, `${p.drop_id} is already merged.`);
  assert.deepEqual(preview.outcome.adopts, []);
  assert.deepEqual(preview.outcome.closes, []);
  assert.deepEqual(preview.outcome.restamps, []);
  assert.equal(preview.outcome.survivor, null);
});

test("case 4: parity walk - for 10 open pairs in turn, the survivor after the merge is the planned survivor", () => {
  for (let step = 0; step < 10; step++) {
    const p = listOpenPairs(1)[0];
    assert.ok(p, `an open pair at step ${step}`);
    const { outcome } = previewMerge(p.id);
    assert.equal(outcome.refusal, undefined);
    assert.ok(outcome.survivor);
    const total = countSegment("all");
    assert.equal(mergeContacts(p.keep_id, p.drop_id).ok, true);
    const s = getContact(p.keep_id)!;
    assert.deepEqual(
      { id: s.id, phone: s.phone, last_activity_at: s.last_activity_at, phone_ok: s.phone_ok, is_stale: s.is_stale },
      outcome.survivor,
      `step ${step} (${p.id})`,
    );
    assert.equal(countSegment("all"), total - 1);
    // Every flag the plan said would move is where it said it would land.
    for (const r of outcome.restamps) {
      const rows =
        "id" in r
          ? [getContact(r.id)!]
          : db().all<Record<string, number>>(
              "SELECT * FROM contacts WHERE domain = ? AND deleted_at IS NULL AND merged_into IS NULL",
              [r.domain],
            );
      for (const row of rows) assert.equal((row as unknown as Record<string, number>)[r.flag], r.to, `${p.id} ${r.flag}`);
    }
  }
});

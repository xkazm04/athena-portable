/**
 * The gated, irreversible writes, pinned.
 *
 * `merge_contacts` is the one action in this app that cannot be undone, so its
 * preconditions are the ones worth a test rather than a reading. Everything here
 * runs against a freshly seeded database in a scratch directory.
 *
 *   node --import ./test/register.mjs --test test/
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { tempHome } from "./tmp-home";

// `openDb` resolves the file from `process.cwd()/data`, so a scratch cwd gives this
// run its own seeded copy and never touches the one committed under `data/`.
tempHome("tidycrm-test-");

const { getActivity } = await import("@athena/demo-kit/activity");
const { countSegment, db, getContact, listOpenPairs, listRevisions, segmentRows } = await import("../lib/db");
const { mergeContacts, normalizeFields, undoWrite } = await import("../lib/mutations");
const { exportSummary } = await import("../lib/summary");

test("a merge cannot be pointed back the other way", () => {
  const pair = listOpenPairs(1)[0];
  assert.ok(pair, "the seed carries open identity pairs");

  const before = countSegment("all");
  assert.equal(mergeContacts(pair.keep_id, pair.drop_id).ok, true);
  assert.equal(countSegment("all"), before - 1, "one record leaves the working list");

  // The same adjudication, arguments swapped. Accepting it would set
  // merged_into on both rows and remove BOTH from every working segment.
  const back = mergeContacts(pair.drop_id, pair.keep_id);
  assert.equal(back.ok, false);
  assert.match(back.error ?? "", /already merged/);
  assert.equal(countSegment("all"), before - 1, "the survivor stays in the working list");
  assert.equal(getContact(pair.keep_id)?.merged_into, null, "the survivor survives");
});

test("a merge needs an identity pair that proposed it, in that orientation", () => {
  const free = segmentRows("all").filter((c) => c.in_open_pair === 0);
  const [a, b] = free;
  assert.ok(a && b, "the seed leaves records in no pair at all");

  const before = countSegment("all");
  const invented = mergeContacts(a.id, b.id);
  assert.equal(invented.ok, false, "two ids a caller made up are not an adjudication");
  assert.match(invented.error ?? "", /No open identity pair/);

  // An open pair adjudicated keep->drop does not authorise drop->keep: that is a
  // different verdict about which record survives.
  const pair = listOpenPairs(1)[0];
  assert.ok(pair);
  const swapped = mergeContacts(pair.drop_id, pair.keep_id);
  assert.equal(swapped.ok, false);
  assert.match(swapped.error ?? "", /No open identity pair/);

  assert.equal(countSegment("all"), before, "no record left the working list");

  // The orientation the rule set did propose still merges.
  assert.equal(mergeContacts(pair.keep_id, pair.drop_id).ok, true);
  assert.equal(countSegment("all"), before - 1);
});

/* --------------------------------- one field-write door (lib/flags.ts) */

test("a merge that adopts the drop's phone and date records both as revisions on the survivor", () => {
  const pair = listOpenPairs(200).find((p) => {
    const keep = getContact(p.keep_id);
    const drop = getContact(p.drop_id);
    return keep?.phone_ok === 0 && drop?.phone_ok === 1 && drop.last_activity_at > keep.last_activity_at;
  });
  assert.ok(pair, "the seed pairs a badly formatted keeper with a newer, well formatted duplicate");
  const keep = getContact(pair.keep_id)!;
  const drop = getContact(pair.drop_id)!;

  assert.equal(mergeContacts(keep.id, drop.id).ok, true);

  const revs = listRevisions(keep.id).filter((r) => r.rules === "merge_contacts");
  const phone = revs.find((r) => r.field === "phone");
  assert.ok(phone, "the survivor's history says why its phone changed");
  assert.equal(phone.old_value, keep.phone);
  assert.equal(phone.new_value, drop.phone);
  const date = revs.find((r) => r.field === "last_activity_at");
  assert.ok(date, "and why its last activity moved");
  assert.equal(date.old_value, keep.last_activity_at);
  assert.equal(date.new_value, drop.last_activity_at);
  assert.equal(getContact(keep.id)?.phone_ok, 1, "the adopted phone restamped its flag");
});

test("a merge adoption is not a normalisation: the export's normalised figures do not move", () => {
  const pair = listOpenPairs(200).find((p) => getContact(p.keep_id)?.phone_ok === 0 && getContact(p.drop_id)?.phone_ok === 1);
  assert.ok(pair, "another pair whose survivor adopts a phone");
  const before = exportSummary("all");
  assert.equal(mergeContacts(pair.keep_id, pair.drop_id).ok, true);
  assert.equal(getContact(pair.keep_id)?.phone, getContact(pair.drop_id)?.phone, "the phone was adopted");
  const after = exportSummary("all");
  assert.equal(after.normalized_fields, before.normalized_fields);
  assert.equal(after.normalized, before.normalized);
});

test("normalising a phone and undoing it puts the phone and its flag back, and marks the revision reverted", () => {
  const victim = segmentRows("phone-format").find((c) => c.in_open_pair === 0 && /^\D*1?\D*(\d\D*){10}$/.test(c.phone));
  assert.ok(victim, "the seed carries a rewritable, badly formatted phone");
  assert.equal(normalizeFields([victim.id], ["phone_e164"]).ok, true);
  assert.equal(getContact(victim.id)?.phone_ok, 1);
  const rev = listRevisions(victim.id)[0];
  assert.ok(rev && rev.field === "phone");
  const entry = db().get<{ id: number }>("SELECT id FROM activity WHERE action = 'normalize_fields' ORDER BY id DESC LIMIT 1");
  assert.ok(entry && getActivity(db(), entry.id));

  assert.deepEqual(undoWrite(entry.id), { ok: true });
  const back = getContact(victim.id);
  assert.equal(back?.phone, victim.phone);
  assert.equal(back?.phone_ok, victim.phone_ok);
  assert.equal(listRevisions(victim.id)[0]?.reverted, 1);
});

test("merge refusals keep their exact words", () => {
  const free = segmentRows("all").filter((c) => c.in_open_pair === 0);
  const [a, b] = free;
  assert.ok(a && b);
  assert.equal(mergeContacts(a.id, a.id).error, "A contact cannot merge into itself.");
  assert.equal(mergeContacts(a.id, b.id).error, `No open identity pair proposes merging ${b.id} into ${a.id}.`);
  assert.equal(mergeContacts("nobody_1", "nobody_2").error, "One of those contacts is gone.");

  const pair = listOpenPairs(200).at(-1);
  assert.ok(pair);
  assert.equal(
    mergeContacts(pair.drop_id, pair.keep_id).error,
    `No open identity pair proposes merging ${pair.keep_id} into ${pair.drop_id}.`,
  );
  assert.equal(mergeContacts(pair.keep_id, pair.drop_id).ok, true);
  assert.equal(mergeContacts(pair.keep_id, pair.drop_id).error, `${pair.drop_id} is already merged.`);
  assert.equal(
    mergeContacts(pair.drop_id, pair.keep_id).error,
    `${pair.drop_id} is already merged into ${pair.keep_id}.`,
  );
});

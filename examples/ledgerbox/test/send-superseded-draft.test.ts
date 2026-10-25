/**
 * Sending a reminder retires the drafts it replaced. `send_reminder` sends the newest unsent
 * draft, so a gentle draft followed by a firm one sends the firm one, and the gentle one was
 * replaced by it, not approved. Left unsent in the table, a second Send dispatched it: a letter
 * to the client nobody had read since a newer draft took its place.
 *
 *   node --import ./test/register.mjs --test "test/**\/*.test.ts"
 */
import assert from "node:assert/strict";
import { setTimeout as sleep } from "node:timers/promises";
import { test } from "node:test";
import { tempHome } from "./tmp-home";

tempHome("ledgerbox-superseded-test-");
const { db } = await import("../lib/db");
const { draftReminderAction, sendReminderAction } = await import("../app/actions");

const unsent = (invoiceId: string): number =>
  db().get<{ n: number }>("SELECT COUNT(*) AS n FROM reminders WHERE invoice_id = ? AND sent_at IS NULL", [invoiceId])!.n;

test("a second Send does not dispatch the draft the first one replaced", async () => {
  const gentle = await draftReminderAction("inv_0002", "gentle");
  assert.equal(gentle.ok, true, gentle.message);
  // Draft ids and their order are stamped to the millisecond.
  await sleep(5);
  const firm = await draftReminderAction("inv_0002", "firm");
  assert.equal(firm.ok, true, firm.message);
  assert.equal(unsent("inv_0002"), 2);

  const sent = await sendReminderAction("inv_0002");
  assert.equal(sent.ok, true, sent.message);
  assert.equal(sent.subject, (firm.draft as { subject: string }).subject, "the newest draft is the one that goes");
  assert.equal(unsent("inv_0002"), 0, "the replaced draft is retired with the send");

  const again = await sendReminderAction("inv_0002");
  assert.equal(again.ok, false, `a second Send went out: ${again.message}`);
  assert.match(again.message, /Draft a reminder first/);
});

test("a send leaves another invoice's drafts alone", async () => {
  // Any chaseable invoice other than the one sent - not one the statement looks to have paid,
  // which the chase now refuses (lib/chase.ts).
  const other = await draftReminderAction("inv_0029", "gentle");
  assert.equal(other.ok, true, other.message);
  await sleep(5);
  await draftReminderAction("inv_0002", "gentle");
  const sent = await sendReminderAction("inv_0002");
  assert.equal(sent.ok, true, sent.message);
  assert.equal(unsent("inv_0029"), 1);
});

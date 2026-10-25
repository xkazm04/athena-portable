/**
 * Never chase money already on the statement (scan-sweep challenge, 2026-10-25,
 * ledgerbox-domain-lib/B).
 *
 * 13 of the 52 overdue invoices on the seeded books have a strong, unambiguous credit sitting on
 * the statement whose best fit is that invoice - several of them quoting the invoice number in the
 * memo. `draft_reminder` drafted a firm letter to each of those clients anyway and `send_reminder`
 * sent it, because the chase never asked what the reconciliation table already knew. The chase
 * now waits while the statement holds the money, names the credit to apply instead, and only
 * warns where the credit could be for more than one invoice.
 *
 *   node --import ./test/register.mjs --test "test/**\/*.test.ts"
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import type { InvoiceRow } from "../lib/types";
import { tempHome } from "./tmp-home";

// Own scratch cwd, own seeded copy: `openDb` resolves the file from `process.cwd()/data`.
tempHome("ledgerbox-chase-paid-");

// Every top-level await happens before the first `test()` (see `tmp-home.ts` on why).
const { db, getInvoice, listInvoices } = await import("../lib/db");
const actions = await import("../app/actions");
const { statusOf } = await import("../lib/lanes/read");
const { buildSheet } = await import("../lib/lanes");

const IRONWOOD_MEMO = "SEPA CR IRONWOOD STUDIO INV LB-2026-0104";

function row(number: string): InvoiceRow {
  const r = listInvoices().find((x) => x.number === number);
  assert.ok(r, `${number} is seeded`);
  return r;
}

const reminderRows = (invoiceId: string) =>
  db().all<{ id: string; sent_at: string | null }>("SELECT id, sent_at FROM reminders WHERE invoice_id = ?", [
    invoiceId,
  ]);

/** The settling credit as the result carries it; absent on the base ActionResult shape. */
const settlingOf = (result: object) => (result as { settling_credit?: { line_id: string } }).settling_credit;

test("case 1 - a firm chase of LB-2026-0104 is refused and names the Ironwood credit to apply", async () => {
  const before = reminderRows("inv_0104").length;
  const result = await actions.draftReminderAction("LB-2026-0104", "firm");
  assert.equal(result.ok, false, result.message);
  assert.ok(result.message.includes(IRONWOOD_MEMO), result.message);
  assert.ok(result.message.includes("$17,775.00"), result.message);
  assert.ok(result.message.includes("28 Jun"), result.message);
  assert.ok(result.message.includes("bl_00062"), result.message);
  assert.equal(settlingOf(result)?.line_id, "bl_00062");
  assert.equal(reminderRows("inv_0104").length, before, "no reminder row is written");
});

test("case 2 - 'every invoice over 30 days, draft a chase for each': exactly the six paid ones are refused", async () => {
  const over30 = listInvoices().filter(
    (r) => r.days_overdue > 30 && r.balance_cents > 0 && r.state !== "disputed",
  );
  assert.equal(over30.length, 35);
  const refused: string[] = [];
  for (const r of over30) {
    const result = await actions.draftReminderAction(r.id, "firm");
    if (result.ok) continue;
    const credit = settlingOf(result);
    assert.ok(credit, `${r.number} is refused for its credit, not for something else: ${result.message}`);
    assert.ok(result.message.includes(credit.line_id), result.message);
    refused.push(r.number);
  }
  assert.deepEqual(
    refused.sort(),
    ["LB-2026-0042", "LB-2026-0085", "LB-2026-0100", "LB-2026-0104", "LB-2026-0112", "LB-2026-0115"],
  );
});

test("case 3 - Quarry House: refused naming the $3,090.00 credit and its $35.00 gap, then the remainder chases", async () => {
  const refused = await actions.draftReminderAction("LB-2026-0910", "gentle");
  assert.equal(refused.ok, false, refused.message);
  assert.ok(refused.message.includes("$3,090.00"), refused.message);
  assert.ok(refused.message.includes("short by $35.00"), refused.message);
  const lineId = settlingOf(refused)?.line_id;
  assert.ok(lineId, "the refusal hands over the line to apply");

  const matched = await actions.matchAction("inv_0910", lineId);
  assert.equal(matched.ok, true, matched.message);
  assert.equal(getInvoice("inv_0910")!.balance_cents, 3500);
  const remainder = await actions.draftReminderAction("LB-2026-0910", "gentle");
  assert.equal(remainder.ok, true, remainder.message);
  assert.ok(remainder.draft?.body.includes("$35.00"), "the letter asks for the $35.00 that is left");
});

test("case 4 - a letter drafted before the statement import is not sent after it", async () => {
  const id = "rem_inv_0104_before_import";
  const now = new Date().toISOString();
  db().run(
    "INSERT INTO reminders (id, invoice_id, tone, recipient, subject, body, created_at, sent_at) VALUES (?, 'inv_0104', 'firm', 'ap@ironwood.example', 'LB-2026-0104', 'Please pay.', ?, NULL)",
    [id, now],
  );
  const result = await actions.sendReminderAction("inv_0104");
  assert.equal(result.ok, false, result.message);
  assert.ok(result.message.includes(IRONWOOD_MEMO), result.message);
  assert.equal(settlingOf(result)?.line_id, "bl_00062");
  const stored = db().get<{ sent_at: string | null }>("SELECT sent_at FROM reminders WHERE id = ?", [id]);
  assert.equal(stored?.sent_at, null, "the row stays unsent");
});

test("case 5 - Kestrel's ambiguous credit does not block, it warns and names both invoices", async () => {
  const result = await actions.draftReminderAction("inv_0900", "gentle");
  assert.equal(result.ok, true, result.message);
  assert.ok(result.message.includes("$4,800.00"), result.message);
  assert.ok(result.message.includes("LB-2026-0900"), result.message);
  assert.ok(result.message.includes("LB-2026-0901"), result.message);
  assert.ok(result.message.includes("check before sending"), result.message);
});

test("case 6 (guard) - a weak, likely or elsewhere-best credit does not block the chase", async () => {
  const { chaseVerdict } = await import("../lib/chase");
  const me = { id: "inv_A", number: "LB-A" };
  const line = { id: "bl_X", memo: "TRANSFER FROM ACME", amount_cents: 100_000, posted_at: "2026-07-01T00:00:00.000Z" };
  const offer = (invoice_id: string, number: string, confidence: "strong" | "likely" | "weak", standing: "best" | "claimed_elsewhere") => ({
    invoice_id,
    number,
    confidence,
    standing,
  });
  for (const confidence of ["likely", "weak"] as const) {
    assert.equal(chaseVerdict(me, [{ line, offers: [offer("inv_A", "LB-A", confidence, "best")] }]), null, confidence);
  }
  const elsewhere = { line, offers: [offer("inv_B", "LB-B", "strong", "best"), offer("inv_A", "LB-A", "strong", "claimed_elsewhere")] };
  assert.equal(chaseVerdict(me, [elsewhere]), null, "best fit is another invoice");
  // And the positive control, so the nulls above cannot come from a verdict that never blocks.
  const mine = chaseVerdict(me, [{ line, offers: [offer("inv_A", "LB-A", "strong", "best")] }]);
  assert.equal(mine?.block, true);
});

test("case 7 - LB-2026-0104's status leads with lateness and ends 'Looks paid', not 'could belong here'", () => {
  const status = buildSheet().lanes.flatMap((l) => l.marks).find((m) => m.number === "LB-2026-0104")!.status;
  assert.ok(status.startsWith("67 days past due"), status);
  assert.ok(
    status.endsWith(`Looks paid: $17,775.00 arrived 28 Jun as "${IRONWOOD_MEMO}" - apply it before chasing.`),
    status,
  );
  assert.ok(!status.includes("could belong here"), status);
  // Without a settling credit the sentence is what it was.
  assert.ok(statusOf(row("LB-2026-0104")).includes("could belong here"));
});

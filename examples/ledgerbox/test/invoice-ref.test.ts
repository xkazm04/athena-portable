/**
 * One invoice, two names: the id a tool is built on (`inv_0002`) and the number a person and a
 * model read off the screen (`LB-2026-0002`). A live run called `draft_reminder("LB-2026-0002")`
 * and was told "That invoice is gone"; this pins the resolver every invoice-taking tool shares.
 *
 *   node --import ./test/register.mjs --test "test/**\/*.test.ts"
 */
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { REF_HINT, resolveInvoiceRef } from "../lib/invoice-ref";
import { BOOKS_CAPABILITIES, type Capability } from "../lib/manifest";

process.chdir(mkdtempSync(join(tmpdir(), "ledgerbox-ref-test-")));
const { getInvoice, findInvoiceId } = await import("../lib/db");
const { draftReminderAction, markPaidAction, sendReminderAction, categorizeAction, voidInvoiceAction } =
  await import("../app/actions");

const BOOKS = [
  { id: "inv_0002", number: "LB-2026-0002" },
  { id: "inv_0910", number: "LB-2026-0910" },
];

test("an id, a number and a differently-cased number all resolve to the id", () => {
  for (const ref of ["inv_0002", "INV_0002", " inv_0002 ", "LB-2026-0002", "lb-2026-0002", "Lb-2026-0002"]) {
    assert.deepEqual(resolveInvoiceRef(ref, BOOKS), { ok: true, id: "inv_0002" }, ref);
  }
});

test("an unknown reference names both forms and an example, never just 'gone'", () => {
  for (const ref of ["INV-118", "", "inv_9999", undefined, 42]) {
    const r = resolveInvoiceRef(ref, BOOKS);
    assert.equal(r.ok, false);
    if (r.ok) continue;
    assert.match(r.error, /No invoice matches/);
    assert.match(r.error, /inv_0002/);
    assert.match(r.error, /LB-2026-0002/);
    assert.ok(!/is gone/.test(r.error));
  }
  const r = resolveInvoiceRef("INV-118", BOOKS);
  assert.equal(!r.ok && r.error, `No invoice matches "INV-118". ${REF_HINT}`);
});

test("every manifest parameter that takes an invoice says both forms", () => {
  const all: readonly Capability[] = BOOKS_CAPABILITIES;
  const taking = all
    .flatMap((c) => c.parameters)
    .filter((p) => /invoice id|Invoice ids/i.test(p.description ?? ""));
  assert.ok(taking.length >= 6);
  for (const p of taking) {
    assert.match(String(p.description), /LB-2026-/, `${p.name}: ${p.description}`);
  }
});

test("the database finds a number the same way it finds an id", () => {
  assert.equal(findInvoiceId("LB-2026-0002"), "inv_0002");
  assert.equal(findInvoiceId("inv_0002"), "inv_0002");
  assert.equal(findInvoiceId("INV-118"), undefined);
  assert.equal(getInvoice("inv_0002")?.number, "LB-2026-0002");
});

test("every invoice action takes a number, and answers a stranger with the hint", async () => {
  const drafted = await draftReminderAction("LB-2026-0002", "gentle");
  assert.equal(drafted.ok, true, drafted.message);
  assert.equal((drafted.draft as { invoice_id: string }).invoice_id, "inv_0002");

  const sent = await sendReminderAction("lb-2026-0002");
  assert.equal(sent.ok, true, sent.message);

  const paid = await markPaidAction("LB-2026-0002", 1);
  assert.equal(paid.ok, true, paid.message);

  const filed = await categorizeAction(["LB-2026-0910", "inv_0002"], "design");
  assert.equal(filed.ok, true, filed.message);
  assert.match(filed.message, /Filed 2 under/);

  for (const result of [
    await draftReminderAction("INV-118", "gentle"),
    await sendReminderAction("INV-118"),
    await markPaidAction("INV-118", 1),
    await voidInvoiceAction("INV-118"),
  ]) {
    assert.equal(result.ok, false);
    assert.equal(result.message, `No invoice matches "INV-118". ${REF_HINT}`);
  }
});

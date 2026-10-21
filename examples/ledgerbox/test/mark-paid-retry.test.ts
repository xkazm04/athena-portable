/**
 * A retried or double-clicked manual payment is recorded once.
 *
 *   node --import ./test/register.mjs --test test/mark-paid-retry.test.ts
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { tempHome } from "./tmp-home";

tempHome("ledgerbox-mark-paid-retry-");

const { COUNTED_OUT, db, listInvoices } = await import("../lib/db");
const { markPaidAction } = await import("../app/actions");

const rows = (invoice: string) =>
  db().get<{ n: number }>("SELECT COUNT(*) AS n FROM payments WHERE invoice_id = ? AND note = 'Recorded by hand.'", [
    invoice,
  ])!.n;
const trail = () => db().get<{ n: number }>("SELECT COUNT(*) AS n FROM activity WHERE action = 'mark_paid'")!.n;

test("a second identical markPaidAction within seconds is refused and writes nothing", async () => {
  const target = listInvoices().find(
    (r) => r.balance_cents > 300 && !COUNTED_OUT.includes(r.state) && r.state !== "draft",
  );
  assert.ok(target, "the seed leaves an invoice with a balance owing");

  const first = await markPaidAction(target.id, 100);
  assert.equal(first.ok, true, first.message);
  const paymentsAfterFirst = rows(target.id);
  const trailAfterFirst = trail();

  const again = await markPaidAction(target.id, 100);
  assert.equal(again.ok, false);
  assert.equal(rows(target.id), paymentsAfterFirst, "no second payments row");
  assert.equal(trail(), trailAfterFirst, "no second Trail entry");

  const other = await markPaidAction(target.id, 101);
  assert.equal(other.ok, true, "a different amount is a different payment");
  assert.equal(rows(target.id), paymentsAfterFirst + 1);
});

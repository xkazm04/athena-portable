/**
 * The actor argument is checked at runtime. `Actor` does not exist once compiled, and a server
 * action is an endpoint a caller can reach with any value, so each action refuses anything but
 * "user" or "athena" before it writes to the Trail or the matches table.
 *
 *   node --import ./test/register.mjs --test test/actor-validated.test.ts
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { tempHome } from "./tmp-home";

tempHome("ledgerbox-actor-validated-");

const { COUNTED_OUT, db, listInvoices, unappliedLines } = await import("../lib/db");
const actions = await import("../app/actions");
const { listActivity } = await import("@athena/demo-kit/activity");

const trailRows = () => listActivity(db(), 1000).length;
const matchRows = () => db().get<{ n: number }>("SELECT COUNT(*) AS n FROM matches")!.n;
const bad = "root" as never;

test("every action with an actor refuses one that is not user or athena, and writes nothing", async () => {
  const invoice = listInvoices().find(
    (r) => r.balance_cents > 200 && !COUNTED_OUT.includes(r.state) && r.state !== "draft",
  );
  const line = unappliedLines().find((l) => l.direction === "in");
  assert.ok(invoice && line, "the seed leaves an invoice owing and a credit to apply");

  const calls: [string, () => Promise<{ ok: boolean; message: string }>][] = [
    ["categorizeAction", () => actions.categorizeAction([invoice.id], "design", bad)],
    ["matchAction", () => actions.matchAction(invoice.id, line.id, bad)],
    ["unmatchAction", () => actions.unmatchAction(invoice.id, line.id, bad)],
    ["markPaidAction", () => actions.markPaidAction(invoice.id, 100, bad)],
    ["draftReminderAction", () => actions.draftReminderAction(invoice.id, "gentle", bad)],
    ["sendReminderAction", () => actions.sendReminderAction(invoice.id, bad)],
    ["voidInvoiceAction", () => actions.voidInvoiceAction(invoice.id, bad)],
    ["exportSummaryAction", () => actions.exportSummaryAction("quarter", bad)],
  ];

  for (const [name, call] of calls) {
    const trail = trailRows();
    const matches = matchRows();
    const result = await call();
    assert.equal(result.ok, false, `${name} accepted actor "root"`);
    assert.match(result.message, /Unknown actor "root" - one of user, athena\./, name);
    assert.equal(trailRows(), trail, `${name} wrote a Trail row`);
    assert.equal(matchRows(), matches, `${name} wrote a matches row`);
  }
});

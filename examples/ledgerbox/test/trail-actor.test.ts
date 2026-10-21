/**
 * Who the Trail names. A tool handler passes "athena" as the trailing argument; a page leaves it
 * off and is "user". The argument is caller-supplied, which a scratch example host accepts (ADR 0018).
 *
 *   node --import ./test/register.mjs --test test/trail-actor.test.ts
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { tempHome } from "./tmp-home";

tempHome("ledgerbox-trail-actor-");

const { COUNTED_OUT, db, listInvoices, unappliedLines } = await import("../lib/db");
const { draftReminderAction, markPaidAction, matchAction } = await import("../app/actions");
const { listActivity } = await import("@athena/demo-kit/activity");

const latest = (action: string) => listActivity(db(), 200).find((e) => e.action === action);

/** Two (invoice, credit) pairs that do not share an invoice or a line, each small enough to apply. */
const twoPairs = () => {
  const owed = listInvoices().filter(
    (r) => r.balance_cents > 0 && !COUNTED_OUT.includes(r.state) && r.state !== "draft",
  );
  const credits = unappliedLines().filter((l) => l.direction === "in");
  const pairs: { invoice: string; line: string }[] = [];
  for (const invoice of owed) {
    const line = credits.find(
      (l) => l.amount_cents <= invoice.balance_cents && !pairs.some((p) => p.line === l.id),
    );
    if (line && !pairs.some((p) => p.invoice === invoice.id)) pairs.push({ invoice: invoice.id, line: line.id });
    if (pairs.length === 2) return pairs as [(typeof pairs)[number], (typeof pairs)[number]];
  }
  throw new Error("the seed leaves two appliable credits");
};

test("matchAction names the actor in the Trail and on the matches row", async () => {
  const [byDefault, byAthena] = twoPairs();

  const first = await matchAction(byDefault.invoice, byDefault.line);
  assert.equal(first.ok, true, first.message);
  assert.equal(latest("match_bank_line")?.actor, "user", "no argument reads as the person");
  assert.equal(
    db().get<{ actor: string }>("SELECT actor FROM matches WHERE line_id = ?", [byDefault.line])!.actor,
    "user",
  );

  const second = await matchAction(byAthena.invoice, byAthena.line, "athena");
  assert.equal(second.ok, true, second.message);
  assert.equal(latest("match_bank_line")?.actor, "athena");
  assert.equal(
    db().get<{ actor: string }>("SELECT actor FROM matches WHERE line_id = ?", [byAthena.line])!.actor,
    "athena",
  );
});

test("markPaidAction names the actor in the Trail", async () => {
  const [a, b] = listInvoices().filter(
    (r) => r.balance_cents > 200 && !COUNTED_OUT.includes(r.state) && r.state !== "draft",
  );
  assert.ok(a && b, "the seed leaves invoices with a balance owing");

  assert.equal((await markPaidAction(a.id, 100)).ok, true);
  assert.equal(latest("mark_paid")?.actor, "user");

  assert.equal((await markPaidAction(b.id, 100, "athena")).ok, true);
  assert.equal(latest("mark_paid")?.actor, "athena");
});

test("draftReminderAction names the actor in the Trail", async () => {
  const [a, b] = listInvoices().filter(
    (r) => r.balance_cents > 0 && !COUNTED_OUT.includes(r.state) && r.state !== "disputed",
  );
  assert.ok(a && b, "the seed leaves invoices that can be chased");

  const byDefault = await draftReminderAction(a.id, "gentle");
  assert.equal(byDefault.ok, true, byDefault.message);
  assert.equal(latest("draft_reminder")?.actor, "user");

  const byAthena = await draftReminderAction(b.id, "firm", "athena");
  assert.equal(byAthena.ok, true, byAthena.message);
  assert.equal(latest("draft_reminder")?.actor, "athena");
});

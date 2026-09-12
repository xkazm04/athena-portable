/**
 * Act 1 of the demo, pinned: "Reconcile August and chase anything over 30 days."
 *
 * `books.test.ts` guards the arithmetic. This file guards the READ SURFACE - the facts the app
 * has to put in front of an agent so the agent can make the calls the story needs without
 * guessing, and without the app making the judgement for it. Each test stands for one beat, and
 * for a way the beat silently stops working: an ambiguous credit that reads as a confident match,
 * a shortfall that only exists inside an English clause, a trading name that has to be re-derived
 * from the memo every month, a client who has paid 80% and looks exactly like one who has paid
 * nothing, a draft with no address on it, a close with no title.
 *
 * Nothing here asserts a DECISION. There is no test that Solstice is skipped; there is a test
 * that the books say how much they paid and when they last paid it.
 *
 *   node --import ./test/register.mjs --test "test/**\/*.test.ts"
 */
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { PINEGROVE_ALIAS, QUIET_CLIENT, STUDIO, companyByName } from "@athena/demo-kit/seed";
import { annotationsFor } from "@athena/demo-kit/webmcp";

// Own scratch cwd, own seeded copy: `openDb` resolves the file from `process.cwd()/data`.
process.chdir(mkdtempSync(join(tmpdir(), "ledgerbox-journey-")));

const { getInvoice, listClients, listInvoices, unappliedCredits } = await import("../lib/db");
const { draftReminderAction, exportSummaryAction, matchAction, sendReminderAction } =
  await import("../app/actions");
const { TOOL_CLASSES } = await import("../lib/tool-classes");
const { isMostlyPaid } = await import("../lib/filter");

/**
 * The statement as the seed leaves it, read ONCE before any test applies a credit.
 *
 * The tests below share one seeded database in one process, and the alias test deliberately
 * reconciles a line. Counting the opening set here rather than inside a test keeps the census
 * honest regardless of what has run before it.
 */
const AT_OPEN = unappliedCredits();

const creditFor = (lineId: string) => {
  const found = unappliedCredits().find((c) => c.line.id === lineId);
  assert.ok(found, `${lineId} is an unapplied credit in the seed`);
  return found;
};

/** The one credit whose memo carries a trading name rather than the name on the invoice. */
const aliasCredit = () => {
  const hits = unappliedCredits().filter((c) => c.counterparty_alias !== null);
  assert.equal(hits.length, 1, "exactly one unapplied credit arrives under a trading name");
  return hits[0]!;
};

test("the Kestrel credit that fits two identical retainers is flagged, and names both", () => {
  // Two Kestrel retainers, same month, same amount. The credit fits either equally well, so the
  // books must SAY so: a caller that reads only `could_be[0]` would otherwise apply $4,800 to a
  // coin-flip and never know it had made one.
  const kestrel = unappliedCredits().filter((c) => c.ambiguous);
  assert.equal(kestrel.length, 1, "one credit in the books is ambiguous, and only one");
  const credit = kestrel[0]!;

  assert.equal(credit.line.amount_cents, 480_000);
  assert.deepEqual(
    credit.suggestions.map((h) => h.invoice_id).sort(),
    ["inv_0900", "inv_0901"],
    "both retainers are offered, by id, not just the winner",
  );
  for (const hit of credit.suggestions) {
    assert.equal(hit.client_name, "Kestrel Labs");
    assert.equal(hit.confidence, "strong", "both are strong - that is exactly why it is ambiguous");
  }
  // And the flag is not simply "more than one candidate": a credit with a clear leader is not it.
  const leader = creditFor("bl_00010");
  assert.ok(leader.suggestions.length > 1 && !leader.ambiguous);
});

test("the Quarry House credit says how far short it falls, as a number", () => {
  const credit = creditFor("bl_00119");
  const best = credit.suggestions[0]!;

  assert.equal(best.invoice_id, "inv_0910");
  assert.equal(best.client_name, "Quarry House");
  // $3,125.00 owed, $3,090.00 arrived: the wire fee. The shortfall is a field, not a sentence to
  // parse - a caller has to be able to decide whether $35 is worth chasing without a regex.
  assert.equal(best.short_by_cents, 3_500);
  assert.equal(credit.short_by_cents, 3_500);
  assert.match(best.evidence.join("; "), /short by \$35\.00/);
  // A credit that covers the balance exactly carries no shortfall at all, rather than a zero.
  assert.equal(creditFor("bl_00028").short_by_cents, null);
});

test("the Pinegrove credit surfaces the trading name it arrived under", async () => {
  const credit = aliasCredit();
  const alias = PINEGROVE_ALIAS.bank;

  // The alias is the registry's, not a string this app invented: TidyCRM spells the same company
  // `Pinegrove Coop`, and a fact learned here has to be checkable there.
  assert.equal(credit.counterparty_alias, alias);
  assert.match(credit.line.memo, new RegExp(alias));
  const best = credit.suggestions[0]!;
  assert.equal(best.client_name, "Pinegrove Collective");
  assert.equal(best.counterparty_alias, alias);
  assert.match(best.evidence.join("; "), /pays as "PINEGROVE COOP"/);

  // And the alias survives the match itself, which is where the fact is worth remembering.
  const result = await matchAction(best.invoice_id, credit.line.id);
  assert.equal(result.ok, true, result.message);
  assert.equal(result.counterparty_alias, alias);
  assert.match(result.message, /Pinegrove Collective banks as "PINEGROVE COOP"/);

  // The books hold it too, so the next month's reconciliation does not re-derive it.
  const client = listClients().find((c) => c.name === "Pinegrove Collective")!;
  assert.equal(client.bank_alias, alias);
  assert.equal(
    listClients().filter((c) => c.bank_alias !== null).length,
    1,
    "one client banks under another name; the rest are themselves",
  );
});

test("the client who paid 80% and went quiet is legible as facts, not as advice", () => {
  const rows = listInvoices().filter((r) => r.client_name === QUIET_CLIENT);
  const retainer = rows.find((r) => r.id === "inv_0920")!;
  assert.ok(retainer, "the seed carries Solstice's summer retainer");

  // Over 30 days past due, so the chase beat WILL reach it. Everything needed to decide otherwise
  // is on the row itself.
  assert.ok(retainer.days_overdue > 30, `${retainer.days_overdue}d overdue`);
  assert.equal(retainer.state, "partial");
  assert.equal(retainer.paid_ratio, 0.8, "the ratio is stated, not left to be divided out");
  assert.equal(retainer.paid_cents, 1_000_000);
  assert.equal(retainer.balance_cents, 250_000);
  assert.ok(retainer.last_payment_at, "and when the money last moved");
  assert.ok(retainer.last_payment_at! < "2026-09-01", "which was a while ago - the 'went quiet' half");
  assert.equal(isMostlyPaid(retainer), true);

  // The signal is a property of the row, not a hard-coded client: another invoice of theirs sits
  // below the threshold and is not flagged, so nothing here reads as "skip Solstice".
  const partPaid = rows.find((r) => r.id === "inv_0116")!;
  assert.ok(partPaid.paid_ratio > 0 && partPaid.paid_ratio < 0.7);
  assert.equal(isMostlyPaid(partPaid), false);
});

test("a draft is a whole message: to, subject, body, on the client's own domain", async () => {
  const oldest = listInvoices()
    .filter((r) => r.days_overdue > 30 && r.balance_cents > 0 && r.state !== "disputed")
    .sort((a, b) => b.days_overdue - a.days_overdue)[0]!;
  assert.ok(oldest, "the seed leaves invoices more than 30 days past due");

  const result = await draftReminderAction(oldest.id, "firm");
  assert.equal(result.ok, true, result.message);
  const draft = result.draft!;
  assert.ok(draft, "the draft comes back with the answer, not only as a row in the database");

  // The send is carried by a connector outside the page, so half a message is not approvable.
  const registry = companyByName(oldest.client_name)!;
  assert.equal(draft.to, registry.contact.email, "addressed to the registry contact, not a generated one");
  assert.equal(draft.to_name, registry.contact.name);
  assert.match(draft.to, /@[a-z0-9-]+\.example$/, "on the client's own .example domain");
  assert.equal(draft.to.split("@")[1], registry.domain);
  assert.equal(draft.from, STUDIO.inbox, "and from the studio's shared inbox");
  assert.match(draft.subject, new RegExp(oldest.number));
  assert.ok(draft.body.includes(draft.to_name.split(" ")[0]!), "the body opens to the person");
  assert.match(draft.body, new RegExp(STUDIO.name), "and signs off as the studio");
  assert.equal(draft.tone, "firm");

  // The stored row carries the same address, so the GATED send records who it reached rather
  // than deriving a recipient of its own a second time.
  const sent = await sendReminderAction(oldest.id);
  assert.equal(sent.ok, true, sent.message);
  assert.equal(sent.to, draft.to);
  assert.equal(sent.subject, draft.subject);
  assert.match(sent.message, new RegExp(draft.to));
});

test("the close comes back as a page: a title and a markdown body", async () => {
  const result = await exportSummaryAction("2026-08");
  assert.equal(result.ok, true, result.message);
  assert.equal(result.title, "August 2026 close");
  const markdown = result.markdown!;
  assert.ok(markdown, "a page needs a body as well as a name");
  assert.ok(markdown.startsWith("# August 2026 close"), "whose heading is the title");
  assert.match(markdown, /\| Outstanding \| \$/, "the figures survive as a table, not as padding");
  assert.match(markdown, /## Still owed/);
  // The bounded-output contract, in the one artefact a person pastes somewhere else.
  assert.match(markdown, /\(showing \d+ of \d+/);
  // The plain-text form is still there for the reports view, and says the same thing.
  assert.match(result.body!, /Ledgerbox summary - August 2026/);
});

test("every capability's annotations match the class the app claims for it", () => {
  const AUTO = { readOnly: true, gated: false };
  // The four branches of the kit's gate rule, in the only two shapes this app registers: a read
  // is readOnlyHint, a reversible data write is BOTH hints false (branch 4, AUTO - not unknown),
  // and anything irreversible or outward is consequential.
  const expected: Record<string, { readOnly: boolean; gated: boolean }> = {
    read_books: AUTO,
    read_inbox: AUTO,
    read_invoice: AUTO,
    read_credits: AUTO,
    read_clients: AUTO,
    navigate: AUTO,
    open_invoice: AUTO,
    select: AUTO,
    set_period: AUTO,
    categorize: { readOnly: false, gated: false },
    match_bank_line: { readOnly: false, gated: false },
    unmatch: { readOnly: false, gated: false },
    draft_reminder: { readOnly: false, gated: false },
    export_summary: { readOnly: false, gated: false },
    mark_paid: { readOnly: false, gated: true },
    send_reminder: { readOnly: false, gated: true },
    void_invoice: { readOnly: false, gated: true },
  };

  assert.deepEqual(
    Object.keys(TOOL_CLASSES).sort(),
    Object.keys(expected).sort(),
    "the table and this list name the same seventeen tools",
  );

  for (const [name, want] of Object.entries(expected)) {
    const annotations = annotationsFor(TOOL_CLASSES[name as keyof typeof TOOL_CLASSES]);
    assert.equal(annotations.readOnlyHint, want.readOnly, `${name}: readOnlyHint`);
    assert.equal(annotations.consequentialHint, want.gated, `${name}: consequentialHint`);
    // Neither key may be dropped, including when its value is false: absent annotations read as
    // unknown to a consumer, and unknown is gated.
    assert.equal(typeof annotations.readOnlyHint, "boolean", `${name}: readOnlyHint is present`);
    assert.equal(typeof annotations.consequentialHint, "boolean", `${name}: consequentialHint is present`);
  }

  // The three money gates are gates because of WHAT THEY ARE, and that has to stay true.
  assert.equal(TOOL_CLASSES.send_reminder.sideEffects, "external");
  assert.equal(TOOL_CLASSES.mark_paid.reversible, false);
  assert.equal(TOOL_CLASSES.void_invoice.reversible, false);
});

test("the reconciliation working set is the credits with exactly one reading", () => {
  const credits = AT_OPEN;
  const unambiguous = credits.filter((c) => !c.ambiguous && c.suggestions.length > 0);
  const unexplained = credits.filter((c) => c.suggestions.length === 0);

  assert.equal(credits.length, 19, "nineteen credits sit on the statement with nothing posted");
  assert.equal(unambiguous.length, 14, "fourteen can be applied without asking");
  assert.equal(credits.filter((c) => c.ambiguous).length, 1);
  // A credit no invoice claims is not unambiguous, it is unexplained, and it must not be swept
  // into the working set by a filter that only asks whether the top two are close.
  assert.equal(unexplained.length, 4);
  for (const credit of unexplained) assert.equal(credit.ambiguous, false);
  assert.equal(unambiguous.length + unexplained.length + 1, credits.length);

  // An invoice with an overdue balance carries the contact a reminder would go to, so the chase
  // beat never needs a second read to address one.
  const overdue = listInvoices().filter((r) => r.days_overdue > 30 && r.balance_cents > 0);
  assert.ok(overdue.length > 30, `${overdue.length} invoices are more than 30 days past due`);
  for (const row of overdue) {
    assert.match(row.client_email, /@[a-z0-9-]+\.example$/);
    assert.equal(row.client_email, companyByName(row.client_name)!.contact.email);
    assert.equal(row.client_contact, companyByName(row.client_name)!.contact.name);
  }
});

test("the books belong to one named studio", () => {
  assert.equal(STUDIO.name, "Halden Studio");
  const invoice = getInvoice(listInvoices()[0]!.id)!;
  // Every draft goes out from the studio inbox, whatever the client.
  assert.ok(invoice.client_email.endsWith(".example"));
  assert.ok(!invoice.client_email.endsWith(STUDIO.domain), "clients are not the studio");
});

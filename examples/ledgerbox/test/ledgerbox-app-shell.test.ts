/**
 * The app shell's own agreements, pinned (scan-sweep stabilize, 2026-10-16).
 *
 * `app/actions.ts` is where an agent's tool call, or a person's click, becomes a write to the
 * books, so each test here is a statement about what a call may change: which invoices money can
 * be applied to, which a letter may chase, what a server action accepts from a caller that did not
 * come through the tool layer. Plus the one thing the project config promises about itself: the
 * Node it runs on. Each one was seen red on the tree before its fix.
 *
 *   node --import ./test/register.mjs --test "test/**\/*.test.ts"
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { tempHome } from "./tmp-home";

// Own scratch cwd, own seeded copy: `openDb` resolves the file from `process.cwd()/data`.
tempHome("ledgerbox-app-shell-");

const { db, listInvoices } = await import("../lib/db");
const actions = await import("../app/actions");

/** How many reminder rows - drafted or sent - an invoice has. */
function remindersOf(invoiceId: string): number {
  return db().get<{ n: number }>("SELECT COUNT(*) AS n FROM reminders WHERE invoice_id = ?", [invoiceId])!.n;
}

/** An invoice in `state` that nothing else in this file has touched, largest balance first. */
const used = new Set<string>();
function fresh(state: string): ReturnType<typeof listInvoices>[number] {
  const row = listInvoices()
    .filter((r) => r.state === state && !used.has(r.id) && !r.has_draft_reminder)
    .sort((a, b) => b.balance_cents - a.balance_cents)[0];
  assert.ok(row, `the seed has an unused ${state} invoice`);
  used.add(row.id);
  return row;
}

/** `22.18.0` -> [22, 18, 0]. */
function parse(version: string): [number, number, number] {
  const [major = 0, minor = 0, patch = 0] = version.replace(/^v/, "").split(".").map(Number);
  return [major, minor, patch];
}

function compare(a: string, b: string): number {
  const [x, y] = [parse(a), parse(b)];
  for (let i = 0; i < 3; i += 1) if (x[i] !== y[i]) return x[i]! - y[i]!;
  return 0;
}

/**
 * Whether `version` is inside an `engines` range. Only the comparators a range here is written
 * with - `||`, `>=`, `>`, `<`, `<=`, `^` - and a form this does not know fails the test rather than
 * being read as "anything".
 */
function satisfies(range: string, version: string): boolean {
  return range.split("||").some((alternative) =>
    alternative
      .trim()
      .split(/\s+/)
      .every((comparator) => {
        const m = /^(>=|<=|>|<|\^)?(\d+(?:\.\d+){0,2})$/.exec(comparator);
        if (!m) throw new Error(`engines comparator ${JSON.stringify(comparator)} is not one this test reads`);
        const [, op = "", bound = ""] = m;
        const c = compare(version, bound);
        if (op === ">=") return c >= 0;
        if (op === ">") return c > 0;
        if (op === "<=") return c <= 0;
        if (op === "<") return c < 0;
        if (op === "^") return c >= 0 && parse(version)[0] === parse(bound)[0];
        return c === 0;
      }),
  );
}

/**
 * What `pnpm test` and the app itself need from Node, and where each line got it: the first
 * release that has it in the 22 line and in the current line (`null` = never in that line).
 *
 * - `module.registerHooks` - `test/register.mjs` (`@types/node` module.d.ts: since v22.15.0).
 * - `module.stripTypeScriptTypes` - `test/register.mjs`, for `.tsx` (module.d.ts: since v22.13.0).
 * - `.ts` loaded with no flag - `package.json`'s test script runs `test/**\/*.test.ts` with no
 *   `--experimental-strip-types`; type stripping is on by default from v22.18.0 (Node changelog).
 * - `node:sqlite` with no flag - every read of the books (`@athena/demo-kit/db`); `node:sqlite`
 *   arrived in v22.5.0 behind `--experimental-sqlite`, and the flag went in v22.13.0.
 * - `DatabaseSync#isTransaction` - the kit's `withTx` rollback (sqlite.d.ts: since v24.0.0; the
 *   Node changelog has it in v22.16.0). Without it a failed write is never rolled back.
 */
const NEEDS: { what: string; since: Record<number, string | null> }[] = [
  { what: "module.registerHooks", since: { 22: "22.15.0", 23: "23.5.0", 24: "24.0.0" } },
  { what: "module.stripTypeScriptTypes", since: { 22: "22.13.0", 23: "23.2.0", 24: "24.0.0" } },
  { what: ".ts with no flag", since: { 22: "22.18.0", 23: "23.6.0", 24: "24.0.0" } },
  { what: "node:sqlite with no flag", since: { 22: "22.13.0", 23: "23.4.0", 24: "24.0.0" } },
  { what: "DatabaseSync#isTransaction", since: { 22: "22.16.0", 23: null, 24: "24.0.0" } },
];

function runsOn(version: string): string[] {
  const major = parse(version)[0];
  return NEEDS.filter(({ since }) => {
    const first = major in since ? since[major] : major > 24 ? "0.0.0" : null;
    return first === null || first === undefined || compare(version, first) < 0;
  }).map(({ what }) => what);
}

test("the Node range package.json declares is one the tests and the books actually run on", () => {
  const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as {
    engines?: { node?: string };
  };
  const range = pkg.engines?.node;
  assert.ok(range, "package.json declares engines.node");
  // Every boundary in the table, on both sides, plus the majors around them.
  const probes = ["20.19.0", "22.5.0", "22.12.0", "22.13.0", "22.15.0", "22.17.1", "22.18.0", "22.20.0",
    "23.0.0", "23.5.0", "23.6.0", "23.11.0", "24.0.0", "24.12.0", "25.0.0"];
  for (const version of probes) {
    const missing = runsOn(version);
    assert.equal(
      satisfies(range, version),
      missing.length === 0,
      missing.length === 0
        ? `${range} refuses Node ${version}, which has everything the app and its tests need`
        : `${range} admits Node ${version}, which lacks ${missing.join(", ")}`,
    );
  }
  // And the Node running this test is one the range admits.
  assert.ok(satisfies(range, process.versions.node), `${range} admits the running Node ${process.versions.node}`);
});

test("no reminder is drafted or sent for an invoice nobody owes: a draft, or a void", async () => {
  // `draft_reminder` asked only about the balance and a dispute, so the seed's draft (never sent
  // to the client, out of every total) got a dunning letter, and `send_reminder` sent it. A void
  // invoice was turned away as "settled", which is not why.
  const draft = fresh("draft");
  const drafted = await actions.draftReminderAction(draft.id, "gentle");
  assert.equal(drafted.ok, false, drafted.message);
  assert.match(drafted.message, new RegExp(`${draft.number} is a draft - it has not been sent to the client`));
  assert.equal(remindersOf(draft.id), 0, "no reminder row for the draft");

  const voided = fresh("void");
  const onVoid = await actions.draftReminderAction(voided.id, "gentle");
  assert.equal(onVoid.ok, false);
  assert.match(onVoid.message, new RegExp(`${voided.number} is void`));

  // A letter that already exists does not get through either: one drafted while the invoice was
  // open and still unsent when it was voided, and one left on the draft from before this rule.
  const open = fresh("open");
  assert.equal((await actions.draftReminderAction(open.id, "gentle")).ok, true);
  assert.equal((await actions.voidInvoiceAction(open.id)).ok, true);
  const sendVoid = await actions.sendReminderAction(open.id);
  assert.equal(sendVoid.ok, false, sendVoid.message);
  assert.match(sendVoid.message, new RegExp(`${open.number} is void`));
  db().run(
    "INSERT INTO reminders (id, invoice_id, tone, recipient, subject, body, created_at, sent_at) VALUES (?, ?, 'gentle', 'a@b.example', 's', 'b', ?, NULL)",
    ["rem_probe_draft", draft.id, new Date().toISOString()],
  );
  const sendDraft = await actions.sendReminderAction(draft.id);
  assert.equal(sendDraft.ok, false, sendDraft.message);
  assert.equal(
    db().get<{ n: number }>("SELECT COUNT(*) AS n FROM reminders WHERE invoice_id IN (?, ?) AND sent_at IS NOT NULL", [draft.id, open.id])!.n,
    0,
    "nothing was stamped sent",
  );
});

/** Payment rows and applied bank lines an invoice carries. */
function moneyOn(invoiceId: string): { payments: number; matches: number } {
  const handle = db();
  return {
    payments: handle.get<{ n: number }>("SELECT COUNT(*) AS n FROM payments WHERE invoice_id = ?", [invoiceId])!.n,
    matches: handle.get<{ n: number }>("SELECT COUNT(*) AS n FROM matches WHERE invoice_id = ?", [invoiceId])!.n,
  };
}

/** An incoming bank line nobody has applied, no larger than `cap`. */
function creditUpTo(cap: number): { id: string; amount_cents: number } {
  const line = db().get<{ id: string; amount_cents: number }>(
    `SELECT id, amount_cents FROM bank_lines
     WHERE direction = 'in' AND amount_cents <= ? AND id NOT IN (SELECT line_id FROM matches)
     ORDER BY amount_cents DESC LIMIT 1`,
    [cap],
  );
  assert.ok(line, `an unapplied credit of at most ${cap}`);
  return line;
}

test("no money is recorded or applied against an invoice nobody owes: a draft, or a void", async () => {
  // `mark_paid` refused only a void and `match_bank_line` neither, so $10.00 - or a whole bank
  // credit - landed on the seed's draft, which no total counts: money applied that shows nowhere.
  // mark_paid is PERMANENT, so not even Undo took it back.
  const draft = listInvoices().find((r) => r.state === "draft")!;
  const voided = listInvoices().find((r) => r.state === "void")!;
  for (const invoice of [draft, voided]) {
    const before = moneyOn(invoice.id);
    const paid = await actions.markPaidAction(invoice.id, 1000);
    assert.equal(paid.ok, false, `mark_paid on ${invoice.state}: ${paid.message}`);
    assert.match(paid.message, new RegExp(`${invoice.number} is (a draft - it has not been sent|void)`));
    const credit = creditUpTo(Math.max(invoice.balance_cents, 1_000_000));
    const matched = await actions.matchAction(invoice.id, credit.id);
    assert.equal(matched.ok, false, `match on ${invoice.state}: ${matched.message}`);
    assert.match(matched.message, new RegExp(`${invoice.number} is (a draft - it has not been sent|void)`));
    assert.deepEqual(moneyOn(invoice.id), before, `nothing landed on the ${invoice.state}`);
  }
});

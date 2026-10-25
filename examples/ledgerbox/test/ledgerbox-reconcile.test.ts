/**
 * One reconciliation table: a credit is offered only where it could be for (scan-sweep challenge,
 * 2026-10-25, ledgerbox-domain-lib/A).
 *
 * The relation "this credit could settle this invoice" used to be computed three times: the row's
 * `candidate_count` and the card's candidates by two invoice-side passes, and the credits strip and
 * `read_credits` by a credit-side pass that alone knew about ambiguity. So a credit that scored 99
 * for one invoice and 54 for another was, on the credit side, clearly the first one's - and on the
 * invoice side still counted, carded and offered on the second, where applying it would settle the
 * wrong invoice and leave the right one chaseable. `lib/reconcile.ts` scores every pair once and
 * gives each a standing; every reader below reads that one table.
 *
 *   node --import ./test/register.mjs --test "test/**\/*.test.ts"
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import type { WebMCPToolSpec } from "@athena/demo-kit/webmcp";
import type { ZoomNav } from "@athena/demo-kit/zoom";

import type { BankLine } from "../lib/types";
import { tempHome } from "./tmp-home";

// Own scratch cwd, own seeded copy: `openDb` resolves the file from `process.cwd()/data`.
tempHome("ledgerbox-reconcile-");

// Every top-level await happens before the first `test()` (see `tmp-home.ts` on why).
const { DETAIL_CANDIDATES } = await import("../lib/constants");
const { getInvoiceDetail, lineSuggestions, listInvoices, unappliedCredits } = await import("../lib/db");
const { buildBooks, buildSheet } = await import("../lib/lanes");
const { matchesFilterClient } = await import("../lib/filter");
const { statusOf } = await import("../lib/lanes/read");
const { NO_FILTER } = await import("../components/lanes/model");

/* ---------------------------------------- read_invoice, driven through its own handler */

const registered = new Map<string, WebMCPToolSpec>();
const RECORDER = Symbol.for("ledgerbox.test.reconcile.recorder");
(globalThis as Record<symbol, unknown>)[RECORDER] = {
  register(spec: WebMCPToolSpec) {
    registered.set(spec.name, spec);
  },
  act(name: string) {
    throw new Error(`a read reached ${name}`);
  },
};
const moduleOf = (source: string) => `data:text/javascript,${encodeURIComponent(source)}`;
const recorder = `globalThis[Symbol.for("ledgerbox.test.reconcile.recorder")]`;
const actions = await import("../app/actions");
const actionNames = Object.keys(actions).filter(
  (k) => typeof (actions as Record<string, unknown>)[k] === "function",
);
const kitWebmcp = import.meta.resolve("@athena/demo-kit/webmcp");
(globalThis as Record<symbol, unknown>)[Symbol.for("ledgerbox.test.standIns")] = {
  scope: new URL("../components/lanes/tools/", import.meta.url).href,
  modules: {
    react: moduleOf("export const useMemo = (make) => make();"),
    "next/navigation": moduleOf("export const useRouter = () => ({ refresh() {} });"),
    "@athena/demo-kit/ui": moduleOf("export const useToast = () => ({ toast() {} });"),
    "@athena/demo-kit/webmcp": moduleOf(
      [
        `export { bounded, boundedPage, PAGE } from ${JSON.stringify(new URL("bounded.ts", kitWebmcp).href)};`,
        `export const useWebMCPTool = (spec) => ${recorder}.register(spec);`,
      ].join("\n"),
    ),
    "@/app/actions": moduleOf(
      actionNames.map((n) => `export const ${n} = () => ${recorder}.act(${JSON.stringify(n)});`).join("\n"),
    ),
  },
};
const { BooksTools } = await import("../components/lanes/tools/BooksTools");
const noop = () => {};
BooksTools({
  sheet: buildSheet(),
  books: buildBooks(),
  nav: { state: { focus: { level: 0, group: null, item: null } } } as unknown as ZoomNav,
  filter: NO_FILTER,
  setFilter: noop,
  picked: [],
  setPicked: noop,
  period: "2026-08",
  setPeriod: noop,
});

/* ----------------------------------------------------------------------- helpers */

const byNumber = (number: string) => {
  const row = listInvoices().find((r) => r.number === number);
  assert.ok(row, `${number} is in the seeded books`);
  return row;
};
const creditFor = (lineId: string) => {
  const found = unappliedCredits().find((c) => c.line.id === lineId);
  assert.ok(found, `${lineId} is an unapplied credit`);
  return found;
};

const line = (over: Partial<BankLine> = {}): BankLine => ({
  id: "L",
  posted_at: "2026-07-15T00:00:00.000Z",
  memo: "TRANSFER FROM ACME WORKS",
  amount_cents: 1_000_000,
  direction: "in",
  source_file: "synthetic.csv",
  ...over,
});
const invoice = (id: string, clientName: string, balanceCents: number, dueAt: string) => ({
  id,
  invoice: { number: `N-${id}`, amount_cents: balanceCents, due_at: dueAt },
  clientName,
  balanceCents,
});

/* --------------------------------------------------------------------- the cases */

test("case 1 - a credit that clearly fits A is offered to A, and only marked against B", async () => {
  const { reconcile } = await import("../lib/reconcile");
  const L = line();
  // A: exact amount, client name in the memo, posted on the due date -> 60 + 25 + 14.
  const A = invoice("A", "Acme Works", 1_000_000, "2026-07-15T00:00:00.000Z");
  // B: another client, within 1% (not a wire fee), posted on its due date -> 40 + 14.
  const B = invoice("B", "Other Company", 1_008_000, "2026-07-15T00:00:00.000Z");
  const table = reconcile([A, B], [L]);

  const reading = table.byCredit("L")!;
  assert.deepEqual(
    reading.offers.map((o) => [o.invoice_id, o.score, o.standing, o.claimed_by?.invoice_id ?? null]),
    [
      ["A", 99, "best", null],
      ["B", 54, "claimed_elsewhere", "A"],
    ],
  );
  assert.equal(reading.ambiguous, false);
  assert.deepEqual(table.byInvoice("A").map((c) => c.line.id), ["L"]);
  assert.deepEqual(table.byInvoice("B"), [], "B is not offered a credit that is plainly A's");
});

test("case 2 - a real contender (inside AMBIGUOUS_GAP) is contested on both sides, and both count it", async () => {
  const { reconcile } = await import("../lib/reconcile");
  const L = line();
  const A = invoice("A", "Acme Works", 1_000_000, "2026-07-15T00:00:00.000Z");
  // B: same client, exact amount, posted 10 days after its due date -> 60 + 25 + 8 = 93.
  const B = invoice("B", "Acme Works", 1_000_000, "2026-07-05T00:00:00.000Z");
  const table = reconcile([A, B], [L]);

  const reading = table.byCredit("L")!;
  assert.deepEqual(
    reading.offers.map((o) => [o.invoice_id, o.score, o.standing]),
    [
      ["A", 99, "contested"],
      ["B", 93, "contested"],
    ],
  );
  assert.equal(reading.ambiguous, true);
  assert.deepEqual(table.byInvoice("A").map((c) => c.line.id), ["L"]);
  assert.deepEqual(table.byInvoice("B").map((c) => c.line.id), ["L"]);
});

test("case 3 - LB-2026-0057 no longer advertises Ironwood's $43,650 credit that is plainly LB-2026-0115's", () => {
  const credit = creditFor("bl_00072");
  assert.equal(credit.suggestions[0]!.number, "LB-2026-0115");
  assert.equal(credit.suggestions[0]!.score, 99);

  const row = byNumber("LB-2026-0057");
  assert.equal(row.candidate_count, 0, "the row counts no credit");
  const card = getInvoiceDetail(row.id)!;
  assert.ok(!card.candidates.some((c) => c.line.id === "bl_00072"), "the card offers no bl_00072");
  assert.equal(matchesFilterClient(row, "unmatched"), false, "the 'unmatched' filter does not light it");
  assert.doesNotMatch(statusOf(row), /could belong here/);
});

test("case 4 - LB-2026-0047 no longer offers Copperline's credit that scores 99 for LB-2026-0015", () => {
  const row = byNumber("LB-2026-0047");
  assert.equal(row.candidate_count, 0);
  assert.ok(!getInvoiceDetail(row.id)!.candidates.some((c) => c.line.id === "bl_00010"));
});

test("case 5 (guard) - the two Kestrel retainers each still carry the ambiguous credit", () => {
  for (const id of ["inv_0900", "inv_0901"]) {
    assert.ok(
      getInvoiceDetail(id)!.candidates.some((c) => c.line.id === "bl_00118"),
      `${id} still offers bl_00118`,
    );
  }
  const credit = creditFor("bl_00118");
  assert.equal(credit.ambiguous, true);
  assert.deepEqual(credit.suggestions.map((s) => s.invoice_id).sort(), ["inv_0900", "inv_0901"]);
});

test("case 6 - on every seeded invoice the row, the credits and the card agree on one count", () => {
  const suggestions = lineSuggestions();
  const standings = new Set(["best", "contested", "claimed_elsewhere"]);
  for (const hits of Object.values(suggestions)) {
    for (const h of hits) assert.ok(standings.has(h.standing), `${h.number} carries a standing`);
  }
  for (const row of listInvoices()) {
    const offered = Object.values(suggestions).filter((hits) =>
      hits.some((h) => h.invoice_id === row.id && h.standing !== "claimed_elsewhere"),
    ).length;
    assert.equal(row.candidate_count, offered, `${row.number}: row vs credit side`);
    assert.equal(
      getInvoiceDetail(row.id)!.candidates.length,
      Math.min(offered, DETAIL_CANDIDATES),
      `${row.number}: card vs credit side`,
    );
  }
});

test("case 7 - Copperline's runner-up stays visible on the credit side, marked as claimed by LB-2026-0015", () => {
  const credit = creditFor("bl_00010");
  assert.deepEqual(
    credit.suggestions.map((s) => s.number),
    ["LB-2026-0015", "LB-2026-0047"],
  );
  assert.equal(credit.ambiguous, false);
  assert.equal(credit.suggestions[0]!.standing, "best");
  assert.equal(credit.suggestions[1]!.standing, "claimed_elsewhere");
  assert.equal(credit.suggestions[1]!.claimed_by?.number, "LB-2026-0015");
});

test("case 8 - read_invoice agrees with the row, and db.ts scores nothing itself", async () => {
  const spec = registered.get("read_invoice");
  assert.ok(spec, "read_invoice is registered");
  const answer = (await spec.handler({ id: "LB-2026-0057" }, {})) as {
    invoice: { candidates: number };
    candidate_lines: { showing: number; of: number; items: unknown[] };
  };
  assert.equal(answer.invoice.candidates, 0);
  assert.deepEqual(answer.candidate_lines.items, [], "no credit offered that the row does not count");
  assert.equal(answer.candidate_lines.of, answer.invoice.candidates);

  const source = readFileSync(new URL("../lib/db.ts", import.meta.url), "utf8");
  assert.doesNotMatch(source, /\bcandidatesFor\s*\(/, "db.ts reads reconcile(), not candidatesFor");
  assert.doesNotMatch(source, /\bscoreCandidate\s*\(/, "db.ts reads reconcile(), not scoreCandidate");
});

/**
 * The union the one shipped page registers, and the read layer the Lanes answers with.
 *
 * Ledgerbox mounts two registration files on one route — `components/lanes/tools/LanesTools.tsx`
 * for the view and `components/lanes/tools/BooksTools.tsx` for the money. Two files, one
 * `document.modelContext`, so the failure this file exists to catch is a NAME COLLISION: two
 * registrations under one name means whichever mounts second silently replaces the first, and the
 * manifest a browser agent reads would be missing a capability the surface claims. A test can see
 * that, because the union lives in `lib/manifest.ts` and not inside the JSX.
 *
 * The second half is the class. `lib/tool-classes.ts` is the single source of the two design 5.1
 * flags; `journey.test.ts` checks every row of that table against `annotationsFor`. What is
 * checked here is the GATED SET — exactly three, and exactly those three — because that is the
 * claim the surface prints and the one a "smoother demo" would quietly edit.
 *
 * The last half is pure: the read helpers behind `read_view` and `search_invoices`, exercised
 * against a hand-built sheet so they can be checked without a database, a browser or a build.
 *
 *   node --import ./test/register.mjs --test "test/**\/*.test.ts"
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import { annotationsFor } from "@athena/demo-kit/webmcp";

import {
  BOOKS_CAPABILITIES,
  CAPABILITIES,
  REGISTER,
  VIEW_CAPABILITIES,
  isAuto,
  registration,
} from "../lib/manifest";
import { TOOL_CLASSES } from "../lib/tool-classes";
import { heatOf } from "../lib/lanes/heat";
import type { LnMark, LnSheet } from "../components/lanes/model";
import { matches } from "../components/lanes/model";
import { laneRead, markRead, totalsRead } from "../components/lanes/tools/read";
import { filterState, searchLanes } from "../components/lanes/tools/search";

/** The three acts that cannot be taken back, or that reach a person. Nothing else may join them. */
const GATED = ["mark_paid", "send_reminder", "void_invoice"];

test("the union the page registers has no duplicate names", () => {
  const names = CAPABILITIES.map((c) => c.name);
  assert.equal(
    new Set(names).size,
    names.length,
    `two registrations share a name: ${names.filter((n, i) => names.indexOf(n) !== i).join(", ")}`,
  );
  // Both halves are in it, and the union is the sum of them: a tool mounted on the page but left
  // off the manifest is the drawer nobody opened with the door painted on.
  assert.equal(names.length, VIEW_CAPABILITIES.length + BOOKS_CAPABILITIES.length);
  assert.equal(names.length, 23);
  assert.deepEqual(
    [...names].sort(),
    Object.keys(TOOL_CLASSES).sort(),
    "the manifest and the class table name the same tools",
  );
});

test("exactly three capabilities are GATED, and they are the money and the person", () => {
  const gated = REGISTER.filter((t) => !t.auto).map((t) => t.name);
  assert.deepEqual([...gated].sort(), [...GATED].sort());
  for (const name of GATED) {
    const annotations = annotationsFor(TOOL_CLASSES[name as keyof typeof TOOL_CLASSES]);
    assert.equal(annotations.consequentialHint, true, `${name} is consequential`);
  }
  // And the rule is applied, not typed: every AUTO row satisfies it, reads included.
  for (const row of REGISTER) {
    assert.equal(row.auto, isAuto(TOOL_CLASSES[row.name]), `${row.name}: the class is derived`);
  }
  // The Lanes' own layer looks and moves. An agent holding only it can read the practice and
  // change nothing in it.
  for (const c of VIEW_CAPABILITIES) {
    assert.equal(annotationsFor(TOOL_CLASSES[c.name]).readOnlyHint, true, `${c.name} is a read`);
  }
});

test("every parameter that addresses the app is bounded: an enum, or a cap", () => {
  for (const capability of CAPABILITIES) {
    const spec = registration(capability.name);
    // `registration` carries the class from the table, never from the call site.
    assert.deepEqual(
      { reversible: spec.reversible, sideEffects: spec.sideEffects },
      TOOL_CLASSES[capability.name],
      `${capability.name}: the class comes from lib/tool-classes.ts`,
    );
    for (const p of spec.parameters) {
      if (p.type === "string[]") {
        assert.ok(p.maxItems, `${capability.name}.${p.name}: an array parameter needs a cap`);
      }
    }
  }
});

/* ------------------------------------------------------------------ the read layer, pure */

const MARK = (over: Partial<LnMark> & Pick<LnMark, "id" | "number">): LnMark => {
  const base = {
    clientId: "cl_1",
    clientName: "Pinegrove Collective",
    category: "design" as const,
    issuedAt: "2026-07-01T00:00:00.000Z",
    dueAt: "2026-07-31T00:00:00.000Z",
    amountCents: 250_000,
    paidCents: 0,
    balanceCents: 250_000,
    state: "open" as const,
    daysOverdue: 0,
    candidateCount: 0,
    remindersSent: 0,
    hasDraft: false,
    x: 0.5,
    weight: 0.5,
    row: 0,
    status: "Within terms.",
    ...over,
  };
  return { ...base, heat: heatOf(base.state, base.daysOverdue) };
};

const LATE = MARK({ id: "inv_0001", number: "LB-2026-0001", daysOverdue: 61, candidateCount: 1 });
const SOON = MARK({ id: "inv_0002", number: "LB-2026-0002", amountCents: 900_000, balanceCents: 900_000 });
const PAID = MARK({
  id: "inv_0003",
  number: "LB-2026-0003",
  state: "paid",
  paidCents: 250_000,
  balanceCents: 0,
});

const SHEET: LnSheet = {
  lanes: [
    {
      id: "design",
      label: "Design",
      blurb: "Studio design work, billed on delivery.",
      marks: [LATE, SOON, PAID],
      rows: 1,
      count: 3,
      invoicedCents: 1_400_000,
      collectedCents: 250_000,
      owedCents: 1_150_000,
      lateCents: 250_000,
      lateCount: 1,
      worstDays: 61,
      heat: "alert",
    },
  ],
  axis: {
    startIso: "2026-06-01T00:00:00.000Z",
    endIso: "2026-09-15T00:00:00.000Z",
    todayX: 0.8,
    months: [],
  },
  clients: [{ id: "cl_1", name: "Pinegrove Collective", count: 3 }],
  totals: {
    invoiceCount: 3,
    invoicedCents: 1_400_000,
    collectedCents: 250_000,
    outstandingCents: 1_150_000,
    overdueCents: 250_000,
    overdueCount: 1,
    disputedCount: 0,
    unmatchedCount: 1,
  },
  details: {},
};

test("a mark reads as money in units and never as layout", () => {
  const read = markRead(LATE);
  assert.equal(read.balance, 2_500, "minor units are divided exactly once, in the reader");
  assert.equal(read.amount, 2_500);
  assert.equal(read.days_overdue, 61);
  assert.equal(read.heat, "long overdue");
  assert.equal(read.due, "2026-07-31", "a date, not a timestamp");
  // The cross-app key, so a fact filed in TidyCRM can find this invoice.
  assert.equal(read.client_domain, "pinegrove-collective.example");
  for (const forbidden of ["x", "weight", "row"]) {
    assert.ok(!(forbidden in read), `${forbidden} is how a mark is drawn, not what it is`);
  }
  assert.equal(laneRead(SHEET.lanes[0]!).still_open, 11_500);
  assert.equal(totalsRead(SHEET).outstanding, 11_500);
  assert.equal(totalsRead(SHEET).covering, "2026-06-01 to 2026-09-15");
});

test("search answers worst first, in the envelope, and rejects a state it never offered", () => {
  const all = searchLanes(SHEET, {});
  assert.equal(all.of, 3);
  assert.equal(all.showing, 3);
  assert.equal(all.items[0]?.id, "inv_0001", "most days overdue first");
  assert.equal(all.items[1]?.id, "inv_0002", "then most money still owed");
  assert.equal(all.items[0]?.area_label, "Design");

  // The filter's vocabulary, not the `state` column's: `overdue` is past due with a balance.
  assert.deepEqual(searchLanes(SHEET, { state: "overdue" }).items.map((i) => i.id), ["inv_0001"]);
  // A floor that admits everything is not a floor: 0 means "overdue at all".
  assert.equal(searchLanes(SHEET, { overdue_by: 0 }).of, 1);
  assert.equal(searchLanes(SHEET, { balance_over: 5_000 }).of, 1);
  assert.deepEqual(searchLanes(SHEET, { unmatched: true }).items.map((i) => i.id), ["inv_0001"]);
  assert.deepEqual(searchLanes(SHEET, { text: "0002" }).items.map((i) => i.id), ["inv_0002"]);

  // The refusals carry the enum the caller should have used. They are read off a union, so the
  // shape is narrowed by hand rather than asserted through an optional property that only one
  // branch has.
  const wrong = searchLanes(SHEET, { state: "settled" }) as {
    of: number;
    error?: string;
    states?: string[];
  };
  assert.equal(wrong.of, 0);
  assert.match(String(wrong.error), /No state called settled/);
  assert.ok(wrong.states?.includes("paid"), "and the enum it should have used");

  const noArea = searchLanes(SHEET, { area: "retainer" }) as { error?: string };
  assert.match(String(noArea.error), /No area called retainer/);
});

test("a filter dims rather than removes, and says how many it dimmed", () => {
  const state = filterState(SHEET, { state: "overdue", client: "all" });
  assert.equal(state.lit, 1);
  assert.equal(state.dimmed, 2);
  assert.match(state.note, /dims rather than removes/);
  // `unmatched` is a state the surface lights and `navigate("unmatched")` lands on, so it has to
  // mean the same thing in both: an invoice carrying a credit that might settle it.
  assert.equal(matches(LATE, { state: "unmatched", client: "all" }), true);
  assert.equal(matches(SOON, { state: "unmatched", client: "all" }), false);
});

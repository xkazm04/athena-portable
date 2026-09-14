/**
 * The three rules round 2 added to the view model, held where they are pure.
 *
 * PRESENCE — which invoices recede by default, and the fact that it is ONE
 * system rather than two. The filter already dimmed; "does this want a decision"
 * is the second reason to be at a value, and if these two ever become separate
 * channels the sheet has two dimming systems and neither is legible.
 *
 * THE STANDING GLYPH — the mapping from an invoice to the mark in the corner of
 * its L1 card, which has to agree with the glyph the same invoice carries at L0
 * or a reader learns the key twice.
 *
 * THE LEGEND-AS-FILTER — the counts the panel announces, which have to be the
 * counts the press actually produces. A panel that says 54 and lights 30 is
 * worse than one that says nothing.
 *
 * No DOM and no React: this is the whole reason these three live in `model/`.
 *
 *   node --import ./test/register.mjs --test "test/**\/*.test.ts"
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import {
  LEGEND,
  PRESENCE_OPACITY,
  STATE_FILTERS,
  STATUS_LABEL,
  legendCounts,
  legendSay,
  matches,
  needsDecision,
  presenceOf,
  statusOf,
  toggleState,
  type LnFilter,
  type LnMark,
  type LnSheet,
} from "../components/lanes/model";
import { flagOf } from "../components/lanes/swarm/marks";

const ALL: LnFilter = { state: "all", client: "all" };

/** A mark with the fields these rules read, and nothing the rules do not. */
function mark(over: Partial<LnMark>): LnMark {
  return {
    id: "inv_0001",
    number: "LB-2026-0001",
    clientId: "c1",
    clientName: "Halcyon Works",
    category: "design",
    issuedAt: "2026-07-01T00:00:00.000Z",
    dueAt: "2026-07-31T00:00:00.000Z",
    amountCents: 100_00,
    paidCents: 0,
    balanceCents: 100_00,
    state: "open",
    daysOverdue: 0,
    candidateCount: 0,
    remindersSent: 0,
    hasDraft: false,
    heat: "watch",
    x: 0.5,
    weight: 0.5,
    row: 0,
    status: "within terms",
    ...over,
  };
}

/* ---------------------------------------------------------------- presence */

test("an invoice with nothing outstanding recedes; one asking for a decision does not", () => {
  // The three that ask: late, disputed, and a credit that would clear it.
  assert.equal(presenceOf(mark({ daysOverdue: 12 }), ALL), "lit");
  assert.equal(presenceOf(mark({ state: "disputed" }), ALL), "lit");
  assert.equal(presenceOf(mark({ candidateCount: 1 }), ALL), "lit");
  // And the ones where the right move is nothing.
  assert.equal(presenceOf(mark({ state: "paid", balanceCents: 0 }), ALL), "quiet");
  assert.equal(presenceOf(mark({}), ALL), "quiet", "inside its terms is not a decision");
  assert.equal(
    presenceOf(mark({ state: "void", balanceCents: 0, daysOverdue: 90 }), ALL),
    "quiet",
    "a voided invoice cannot be late at anybody",
  );
});

test("nothing outstanding is nothing to decide, whatever else is true of it", () => {
  // The trap: a settled invoice whose due date has passed still reports
  // `daysOverdue`. Reading lateness without reading the balance would light
  // forty of the hundred and twenty-four settled marks at full strength.
  assert.equal(needsDecision(mark({ state: "paid", balanceCents: 0, daysOverdue: 51 })), false);
});

test("the filter is the first half of presence, not a second dimming system", () => {
  const late = mark({ daysOverdue: 40, state: "open" });
  const settled = mark({ state: "paid", balanceCents: 0 });
  const onlySettled: LnFilter = { state: "paid", client: "all" };
  // Filtered out beats "this is screaming": an explicit narrowing is the
  // reader's own instruction and outranks the sheet's opinion.
  assert.equal(presenceOf(late, onlySettled), "dim");
  assert.equal(matches(late, onlySettled), false);
  // And a mark the filter keeps is still read for whether it wants anything.
  assert.equal(presenceOf(settled, onlySettled), "quiet");
});

test("the presence numbers and the presence tokens are the same three numbers", () => {
  // `Spread.tsx` reads the numbers because motion owns the inline opacity of a
  // morphing card; everything else reads the tokens. Two spellings of one value
  // is exactly how a dimming system quietly becomes two.
  const css = readFileSync(
    new URL("../components/lanes/style/base/tokens.css", import.meta.url),
    "utf8",
  );
  for (const [key, value] of Object.entries(PRESENCE_OPACITY)) {
    const found = new RegExp(`--ln-presence-${key}:\\s*([0-9.]+)`).exec(css);
    assert.ok(found, `--ln-presence-${key} is not declared in the token block`);
    assert.equal(Number(found[1]), value, `--ln-presence-${key} disagrees with PRESENCE_OPACITY`);
  }
});

/* ------------------------------------------------------------ the standing */

test("the standing glyph agrees with the flag the same invoice carries at L0", () => {
  // Three of the nine standings are also drawn on the swarm. If the two
  // orderings ever disagree, the same invoice is a `?` on one level and a `!`
  // on the next, and the reader learns the key twice.
  const disputed = mark({ state: "disputed" });
  const shouting = mark({ daysOverdue: 60 });
  const credited = mark({ candidateCount: 2 });
  assert.equal(statusOf(disputed), "disputed");
  assert.equal(flagOf(disputed), "?");
  assert.equal(statusOf(shouting), "long-overdue");
  assert.equal(flagOf(shouting), "!");
  assert.equal(statusOf(credited), "credit");
  assert.equal(flagOf(credited), "+");
});

test("every standing has a word, and the quiet ones are told apart", () => {
  const keys = [
    statusOf(mark({ state: "void", balanceCents: 0 })),
    statusOf(mark({ state: "draft" })),
    statusOf(mark({ state: "paid", balanceCents: 0 })),
    statusOf(mark({ paidCents: 40_00, balanceCents: 60_00 })),
    statusOf(mark({ daysOverdue: 3 })),
    statusOf(mark({})),
  ];
  assert.deepEqual(keys, ["void", "draft", "settled", "part-paid", "late", "within-terms"]);
  for (const key of keys) assert.ok(STATUS_LABEL[key], `${key} has no word`);
});

/* -------------------------------------------------------------- the legend */

test("the legend is built out of the enum the manifest already publishes", () => {
  // Nothing invented: a press has to move `filter.state` to a value
  // `set_filter` would accept, or a click and a call are two different filters.
  for (const entry of LEGEND) {
    assert.ok(STATE_FILTERS.includes(entry.state), `${entry.state} is not a STATE_FILTER`);
    assert.ok(entry.says.length > 0, `${entry.state} says nothing`);
  }
  assert.equal(LEGEND[0]?.state, "all", "the reset is the first entry");
});

test("the count a legend entry announces is the count its press produces", () => {
  const sheet = {
    lanes: [
      {
        marks: [
          mark({ id: "a", daysOverdue: 40 }),
          mark({ id: "b", state: "paid", balanceCents: 0 }),
          mark({ id: "c", state: "disputed" }),
          mark({ id: "d", candidateCount: 1 }),
        ],
      },
    ],
  } as unknown as LnSheet;
  const counts = legendCounts(sheet, "all");
  assert.equal(counts.all, 4);
  assert.equal(counts.overdue, 1);
  assert.equal(counts.disputed, 1);
  assert.equal(counts.unmatched, 1);
  assert.equal(counts.paid, 1);
  // The promise, checked the long way round: the count is what `matches` lights.
  for (const entry of LEGEND) {
    const lit = sheet.lanes[0]!.marks.filter((m) =>
      matches(m, { state: entry.state, client: "all" }),
    ).length;
    assert.equal(counts[entry.state], lit, `${entry.state} announces a count it does not light`);
  }
});

test("pressing an entry twice is the way back out", () => {
  const pressed = toggleState(ALL, "overdue");
  assert.equal(pressed.state, "overdue");
  assert.equal(toggleState(pressed, "overdue").state, "all");
  // And the client half of the filter is never touched by a state press.
  const withClient: LnFilter = { state: "all", client: "c1" };
  assert.equal(toggleState(withClient, "disputed").client, "c1");
});

test("the panel says what it did, and says it in invoices", () => {
  assert.match(legendSay("all", 124, 124), /all 124/);
  assert.match(legendSay("overdue", 54, 124), /54 of 124/);
});

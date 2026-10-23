/**
 * The replay's pure helpers — README section 14; ADR 0040. A bench run's trace is grouped into
 * portal visits for the rail, each turn coloured by what it did, and the money tallied as it plays.
 */
import { expect, test } from "vitest";

import { edgeRank, kindOf, parsePlaybook, type TraceTurn } from "@/lib/playbooks";
import { CATEGORIES } from "@/lib/playbook-taxonomy";

import { fixtures } from "./fixtures";
import {
  categoryCounts,
  filterLedger,
  selectPlaybooks,
  sortLedger,
  tallyOf,
  verdictOf,
  type PlaybookActions,
  type PlaybookView,
} from "./model";
import { fixtureIds, initialOpenFor } from "./fixtures";
import { foundBy, readsOf, turnState, visitsOf } from "./replay";
import { PLAYBOOKS } from "@/lib/playbooks.shipped";

const turn = (portal: string, over: Partial<TraceTurn> = {}): TraceTurn => ({
  portal,
  user: "",
  continued: false,
  said: "",
  saidChars: 0,
  reads: [],
  cards: [],
  ...over,
});

test("consecutive turns in one portal are one visit; a return is a new one", () => {
  const visits = visitsOf([turn("A"), turn("A"), turn("B"), turn("A")]);
  expect(visits).toEqual([
    { portal: "A", from: 0, to: 1 },
    { portal: "B", from: 2, to: 2 },
    { portal: "A", from: 3, to: 3 },
  ]);
  expect(visitsOf([])).toEqual([]);
});

test("a turn is coloured by its worst card, then by whether it read", () => {
  const card = (outcome: TraceTurn["cards"][number]["outcome"]) => ({
    action: "file",
    key: "K",
    outcome,
    valueUsd: 10,
  });
  expect(turnState(turn("A", { cards: [card("correct"), card("trap")] }))).toBe("wrong");
  expect(turnState(turn("A", { cards: [card("neutral")] }))).toBe("filed");
  expect(turnState(turn("A", { reads: ["list"] }))).toBe("read");
  expect(turnState(turn("A"))).toBe("spoke");
});

test("the tally counts right cards only, up to the turn shown", () => {
  const trace = [
    turn("A", { cards: [{ action: "f", key: "1", outcome: "correct", valueUsd: 75 }] }),
    turn("A", { cards: [{ action: "f", key: "2", outcome: "trap", valueUsd: 40 }] }),
    turn("B", { cards: [{ action: "f", key: "3", outcome: "correct", valueUsd: 0.1 }] }),
  ];
  expect(foundBy(trace, 0)).toBe(75);
  expect(foundBy(trace, 1)).toBe(75);
  expect(foundBy(trace, 2)).toBe(75.1);
});

test("the tally counts money back only: a card of another kind or a weight is never found money", () => {
  const trace = [
    turn("A", { cards: [{ action: "refund", key: "1", outcome: "correct", valueUsd: 75 }] }),
    turn("A", { cards: [{ action: "screen", key: "2", outcome: "correct", valueUsd: 1000 }] }),
    turn("B", { cards: [{ action: "lien", key: "3", outcome: "correct", valueUsd: 36000 }] }),
  ];
  const kinds: Record<string, "count" | "money_protected"> = { screen: "count", lien: "money_protected" };
  const kind = (tool: string) => kinds[tool] ?? "money_back";
  expect(foundBy(trace, 2, kind)).toBe(75);
});

/** A playbook with a money-back tool, an exposure tool and a weighted tool, benched once. */
const MIXED = parsePlaybook(
  {
    id: "mixed",
    economics: {
      value_usd: 380000,
      per: "year",
      value_kind: "money_protected",
      kinds: { refund: "money_back", lien: "money_protected", screen: "count", bogus: "dollars" },
      example_usd: 120,
    },
  },
  {
    run_at: "2026-10-22T00:00:00Z",
    verdict: { word: "exceeds", reasons: [] },
    score: { found: 3, eligible: 4, value_total_usd: 37320, value_found_usd: 37120, false_claims: 0 },
    cards: [
      { action: "refund", key: "R1", outcome: "correct", value_usd: 120 },
      { action: "lien", key: "L1", outcome: "correct", value_usd: 36000 },
      { action: "screen", key: "S1", outcome: "correct", value_usd: 1000 },
      { action: "refund", key: "R2", outcome: "trap", value_usd: 50 },
    ],
    missed: [{ action: "refund", key: "R3", value_usd: 200 }],
  },
)!;

test("a playbook's kinds are read per answer-key tool, money back where it says nothing", () => {
  expect(MIXED.economics.valueKind).toBe("money_protected");
  expect(MIXED.economics.exampleUsd).toBe(120);
  expect(kindOf(MIXED, "lien")).toBe("money_protected");
  expect(kindOf(MIXED, "screen")).toBe("count");
  // A kind the contract does not name is dropped, and an unlisted tool is money back.
  expect(kindOf(MIXED, "bogus")).toBe("money_back");
  expect(kindOf(MIXED, "never-heard-of")).toBe("money_back");
  // Absent is null, never zero.
  expect(parsePlaybook({ id: "bare" })!.economics.exampleUsd).toBeNull();
  expect(parsePlaybook({ id: "bare" })!.economics.valueKind).toBe("money_back");
});

test("a run is tallied by kind, and the totals and the verdict sum money back only", () => {
  const tally = tallyOf(MIXED)!;
  expect(tally.money_back).toEqual({ found: 120, total: 320, n: 1, of: 2 });
  expect(tally.money_protected).toEqual({ found: 36000, total: 36000, n: 1, of: 1 });
  expect(tally.count).toEqual({ found: 1000, total: 1000, n: 1, of: 1 });
  const model = selectPlaybooks([MIXED], NOOP);
  expect(model.totals.foundUsd).toBe(120);
  const v = model.items[0]!.verdict;
  expect(v.sentence).toContain("$120 back of $320");
  expect(v.sentence).toContain("$36,000 of $36,000 protected");
  // The weight is a count of items, never a dollar figure.
  expect(v.sentence).not.toContain("1,000");
});

test("the time saved counts the person's review beside her run", () => {
  const p = parsePlaybook(
    { id: "t", economics: { value_usd: 1, per: "year", manual_minutes: 360 } },
    { run_at: "x", wall_s: 240, your_time_s: 300, verdict: { word: "meets" }, score: {} },
  )!;
  // 360 min by hand against 4 min of her run plus 5 of your review: 40×, not the bare 90×.
  expect(selectPlaybooks([p], NOOP).items[0]!.speed).toBe("40× faster");
});

test("reads are named in words, each once with its count", () => {
  expect(readsOf(turn("A", { reads: ["list_stops", "search_mail", "list_stops"] }))).toEqual([
    { name: "list stops", times: 2 },
    { name: "search mail", times: 1 },
  ]);
});

test("the totals are the catalogue line's and the surface's: how many, benched, over the bar, found", () => {
  // Three playbooks, the flights one unbenched: what the two benched runs found, and one beat its bar.
  expect(fixtures.typical.totals).toEqual({ count: 3, benched: 2, exceeds: 1, foundUsd: 551.4 });
});

test("a film is current while it films the bench's run, stale once the bench moved on", () => {
  const byId = (id: string) => fixtures.typical.items.find((v) => v.id === id)!;
  const current = byId("carrier-refunds").evidence;
  expect(current?.current).toBe(true);
  expect(current?.standing.label).toBe("Current");
  expect(current?.length).toBe("1:11");
  const stale = byId("chargeback-evidence").evidence;
  expect(stale?.current).toBe(false);
  expect(stale?.standing.label).toBe("Stale");
  expect(stale?.standing.sentence).toContain("the latest is of 2026-10-07");
  expect(byId("flight-compensation").evidence).toBeNull();
});

test("every shipped playbook has a fixture that opens its layer, generated from the shipped set", () => {
  for (const p of PLAYBOOKS) {
    expect(fixtureIds, p.id).toContain(`shipped:${p.id}`);
    expect(initialOpenFor(`shipped:${p.id}`)).toBe(p.id);
  }
  expect(initialOpenFor("shipped:no-such-playbook")).toBeNull();
});

// -- the ledger (ADR 0096) -------------------------------------------------------------------------

const NOOP: PlaybookActions = { copy: () => Promise.resolve(), open: () => {}, hand: () => {} };

/** Views through the same reader and selector the shipped set goes through, in the edge's order. */
function ledger(...raws: Record<string, unknown>[]): PlaybookView[] {
  const books = raws.map((r) => parsePlaybook({ title: String(r.id), ...r })!);
  books.sort((a, b) => edgeRank(b) - edgeRank(a) || a.title.localeCompare(b.title));
  return [...selectPlaybooks(books, NOOP).items];
}

const ITEMS = ledger(
  { id: "a", category: "freight", job: "recover", edge: { difficulty: 5, usefulness: 5 }, economics: { value_usd: 100, per: "month", manual_minutes: 60 } },
  { id: "b", category: "freight", job: "contest", edge: { difficulty: 4, usefulness: 4 }, economics: { value_usd: 1200, per: "year", manual_minutes: 300 } },
  { id: "c", category: "health", job: "recover", edge: { difficulty: 3, usefulness: 3 }, economics: { value_usd: 5000, per: "year", manual_minutes: 60 } },
  { id: "d", job: "recover", edge: { difficulty: 2, usefulness: 2 }, economics: { value_usd: 1200, per: "year", manual_minutes: 10 } },
  { id: "e", category: "nowhere", job: "nothing", edge: { difficulty: 1, usefulness: 1 }, economics: { value_usd: 1, per: "run", manual_minutes: 5 } },
);
const ids = (views: readonly PlaybookView[]) => views.map((v) => v.id);

test("the rail counts every area, zero included, plus all and the uncategorised", () => {
  const all = categoryCounts(ITEMS, "all");
  expect(all.all).toBe(5);
  expect(all.uncategorised).toBe(2);
  expect(all.byCategory.freight).toBe(2);
  expect(all.byCategory.health).toBe(1);
  expect(Object.keys(all.byCategory).sort()).toEqual(CATEGORIES.map((c) => c.id).sort());
  expect(all.byCategory.family).toBe(0);
  expect(categoryCounts([], "all")).toEqual({ all: 0, uncategorised: 0, byCategory: Object.fromEntries(CATEGORIES.map((c) => [c.id, 0])) });
});

test("the rail's counts are what a click would show under the job in force", () => {
  const recover = categoryCounts(ITEMS, "recover");
  expect(recover.all).toBe(3);
  expect(recover.byCategory.freight).toBe(1);
  expect(recover.byCategory.health).toBe(1);
  expect(recover.uncategorised).toBe(1);
  for (const c of CATEGORIES) {
    expect(recover.byCategory[c.id], c.id).toBe(filterLedger(ITEMS, { category: c.id, job: "recover" }).length);
  }
  expect(categoryCounts(ITEMS, "comply").all).toBe(0);
});

test("the ledger filters by area and job, keeping the order it was given", () => {
  expect(ids(filterLedger(ITEMS, { category: "all", job: "all" }))).toEqual(["a", "b", "c", "d", "e"]);
  expect(ids(filterLedger(ITEMS, { category: "freight", job: "all" }))).toEqual(["a", "b"]);
  expect(ids(filterLedger(ITEMS, { category: "all", job: "recover" }))).toEqual(["a", "c", "d"]);
  expect(ids(filterLedger(ITEMS, { category: "freight", job: "contest" }))).toEqual(["b"]);
  expect(filterLedger(ITEMS, { category: "family", job: "all" })).toEqual([]);
});

test("the edge order is the shipped order, best first ascending and its exact reverse descending", () => {
  const shuffled = [ITEMS[3], ITEMS[0], ITEMS[4], ITEMS[2], ITEMS[1]];
  expect(ids(sortLedger(shuffled, { key: "edge", dir: "asc" }))).toEqual(["a", "b", "c", "d", "e"]);
  expect(ids(sortLedger(shuffled, { key: "edge", dir: "desc" }))).toEqual(["e", "d", "c", "b", "a"]);
  expect(ids(shuffled)).toEqual(["d", "a", "e", "c", "b"]);
});

test("value is the money back a year, a month counting twelve; a tie keeps the edge's order either way", () => {
  // a: 1,200 a year from 100 a month, tied with b and d at 1,200. e is worth 1 a run, not a year:
  // it comes after the yearly money back whichever way the column runs.
  expect(ids(sortLedger(ITEMS, { key: "value", dir: "desc" }))).toEqual(["c", "a", "b", "d", "e"]);
  expect(ids(sortLedger(ITEMS, { key: "value", dir: "asc" }))).toEqual(["a", "b", "d", "c", "e"]);
});

test("most value puts an estimate that is not money back a year after the money back, by its own figure", () => {
  const rows = ledger(
    { id: "back", edge: { difficulty: 1, usefulness: 1 }, economics: { value_usd: 500, per: "year" } },
    { id: "lien", edge: { difficulty: 5, usefulness: 5 }, economics: { value_usd: 380000, per: "year", value_kind: "money_protected" } },
    { id: "fine", edge: { difficulty: 4, usefulness: 4 }, economics: { value_usd: 5000, per: "year", value_kind: "penalty_avoided" } },
    { id: "episode", edge: { difficulty: 3, usefulness: 3 }, economics: { value_usd: 40000, per: "episode" } },
  );
  expect(ids(sortLedger(rows, { key: "value", dir: "desc" }))).toEqual(["back", "lien", "episode", "fine"]);
});

test("time is the hours by hand; a tie keeps the edge's order either way", () => {
  expect(ids(sortLedger(ITEMS, { key: "time", dir: "desc" }))).toEqual(["b", "a", "c", "d", "e"]);
  expect(ids(sortLedger(ITEMS, { key: "time", dir: "asc" }))).toEqual(["e", "d", "a", "c", "b"]);
});

test("sorting is stable over equal playbooks and never touches its input", () => {
  const twins = ledger(
    { id: "t2", title: "Twin", edge: { difficulty: 3, usefulness: 3 } },
    { id: "t1", title: "Twin", edge: { difficulty: 3, usefulness: 3 } },
  );
  for (const key of ["edge", "value", "time"] as const) {
    expect(ids(sortLedger(twins, { key, dir: "asc" })), key).toEqual(["t1", "t2"]);
  }
  expect(ids(twins)).toEqual(["t2", "t1"]);
});

test("the model carries the load's problem, none by default", () => {
  expect(selectPlaybooks([], NOOP).problem).toBeNull();
  const failed = selectPlaybooks([], NOOP, false, "the playbooks could not be read: offline");
  expect(failed.problem).toBe("the playbooks could not be read: offline");
  expect(failed.loading).toBe(false);
});

/** ADR 0128: a raw bench.json with a keyed latest run and the given history lines. */
function benched(word: string, history: Record<string, unknown>[], extra: Record<string, unknown> = {}) {
  const p = parsePlaybook(
    { id: "runs" },
    {
      run_at: "2026-10-22T00:00:00Z",
      comparable: "sha256:aaaa",
      verdict: { word, reasons: [] },
      score: { found: 3, eligible: 3, false_claims: 0 },
      history,
      ...extra,
    },
  );
  return p!.bench!;
}

test("the verdict says how many comparable runs it stands on, and n=1 where there is one", () => {
  const three = benched("exceeds", [
    { run_at: "2026-10-20T00:00:00Z", comparable: "sha256:aaaa", verdict: "meets" },
    { run_at: "2026-10-21T00:00:00Z", comparable: "sha256:aaaa", verdict: "exceeds" },
    // Another key, and a line a rescore superseded: neither is counted.
    { run_at: "2026-10-01T00:00:00Z", comparable: "sha256:bbbb", verdict: "exceeds" },
    { run_at: "2026-10-02T00:00:00Z", comparable: "sha256:aaaa", verdict: "exceeds", superseded_by: { rescored_at: "x" } },
  ]);
  expect(three.runs).toEqual({ n: 3, exceeds: 2 });
  const v = verdictOf(three);
  expect(v.runs).toBe("beat its bar in 2 of 3 test runs");
  expect(v.sample).toBe("");
  expect(v.sentence).toMatch(/^Beat its bar in 2 of 3 test runs: 3 of 3 found, no false claims\.$/);

  // A run benched before keys were kept stands alone, whatever its history says.
  const legacy = benched("exceeds", [{ run_at: "2026-10-20T00:00:00Z", verdict: "exceeds" }], { comparable: undefined });
  expect(legacy.runs).toEqual({ n: 1, exceeds: 1 });
  const one = verdictOf(legacy);
  expect(one.runs).toBe("one test run");
  expect(one.sample).toBe("n=1");
  expect(one.sentence).toMatch(/^Beat its bar in its one test run:/);

  const short = verdictOf(benched("short", [], { score: { found: 3, eligible: 10, false_claims: 0 } }));
  expect(short.label).toBe("Falls short");
  expect(short.sentence).toMatch(/^Fell short: 3 of 10 found, no false claims, one test run\./);
  expect(short.runs).toBe("one test run");
});

test("unbenched claims nothing: no runs, no sample", () => {
  const v = verdictOf(null);
  expect(v.runs).toBe("");
  expect(v.sample).toBe("");
});

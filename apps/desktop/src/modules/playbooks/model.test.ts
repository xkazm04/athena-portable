/**
 * The replay's pure helpers — README section 14; ADR 0040. A bench run's trace is grouped into
 * portal visits for the rail, each turn coloured by what it did, and the money tallied as it plays.
 */
import { expect, test } from "vitest";

import { edgeRank, parsePlaybook, type TraceTurn } from "@/lib/playbooks";
import { CATEGORIES } from "@/lib/playbook-taxonomy";

import { fixtures } from "./fixtures";
import {
  categoryCounts,
  filterLedger,
  foundBy,
  readsOf,
  selectPlaybooks,
  sortLedger,
  turnState,
  verdictOf,
  visitsOf,
  type PlaybookActions,
  type PlaybookView,
} from "./model";
import { fixtureIds, initialOpenFor } from "./fixtures";
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

test("value is the money a year, a month counting twelve; a tie keeps the edge's order either way", () => {
  // a: 1,200 a year from 100 a month, tied with b and d at 1,200.
  expect(ids(sortLedger(ITEMS, { key: "value", dir: "desc" }))).toEqual(["c", "a", "b", "d", "e"]);
  expect(ids(sortLedger(ITEMS, { key: "value", dir: "asc" }))).toEqual(["e", "a", "b", "d", "c"]);
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
  expect(v.runs).toBe("exceeds in 2 of 3");
  expect(v.sample).toBe("");
  expect(v.sentence).toContain("It exceeds in 2 of 3 comparable runs.");

  // A run benched before keys were kept stands alone, whatever its history says.
  const legacy = benched("exceeds", [{ run_at: "2026-10-20T00:00:00Z", verdict: "exceeds" }], { comparable: undefined });
  expect(legacy.runs).toEqual({ n: 1, exceeds: 1 });
  const one = verdictOf(legacy);
  expect(one.runs).toBe("exceeds in 1 of 1");
  expect(one.sample).toBe("n=1");
  expect(one.sentence).toMatch(/One run so far\.$/);

  expect(verdictOf(benched("short", [])).runs).toBe("exceeds in 0 of 1");
});

test("unbenched claims nothing: no runs, no sample", () => {
  const v = verdictOf(null);
  expect(v.runs).toBe("");
  expect(v.sample).toBe("");
});

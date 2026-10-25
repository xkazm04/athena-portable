/**
 * The runs behind a verdict — ADR 0128, README section 14. `runsBehind` lists every run a bench.json
 * holds, counted or left out by the rule `comparableRuns` applies, each left-out row with its why;
 * `worstOf` says what the badge leaves out of the counted runs.
 */
import { describe, expect, test } from "vitest";

import { comparableRuns, parsePlaybook, type Bench } from "@/lib/playbooks";
import { PLAYBOOKS } from "@/lib/playbooks.shipped";

import { fixtures } from "./fixtures";
import { tallyOf, verdictOf } from "./model";
import { runsBehind, worstOf } from "./runs";

const KEY = "sha256:8df559e0049439f1";

/** The latest run as `comparableRuns` takes it. */
const head = (b: Bench) => ({ comparable: b.comparable, verdict: b.verdict.word, runAt: b.runAt, rescoredAt: b.rescoredAt });

function bench(raw: Record<string, unknown>): Bench {
  return parsePlaybook({ id: "runs" }, raw)!.bench!;
}

/** The shape of playbooks/cpg-deductions/bench.json: a keyed latest that exceeded, two unkeyed lines
 *  from an earlier world, and two lines under its key, one of them short with a false claim and a trap. */
const cpg = () =>
  bench({
    run_at: "2026-10-22T09:11:43Z",
    model: "sonnet",
    comparable: KEY,
    verdict: { word: "exceeds", reasons: [] },
    score: { found: 7, eligible: 7, false_claims: 0, traps_filed: 0 },
    history: [
      { run_at: "2026-10-07T23:21:47Z", model: "sonnet", verdict: "short", found: 7, eligible: 7, false_claims: 1 },
      { run_at: "2026-10-07T23:28:15Z", model: "sonnet", verdict: "exceeds", found: 7, eligible: 7, false_claims: 0, traps_filed: 0, wall_s: 253.9 },
      { run_at: "2026-10-22T09:03:32Z", model: "sonnet", comparable: KEY, verdict: "exceeds", found: 6, eligible: 7, false_claims: 0, traps_filed: 0, wall_s: 244, note: "ADR 0128 repeat runs" },
      { run_at: "2026-10-22T09:07:19Z", model: "sonnet", comparable: KEY, verdict: "short", found: 6, eligible: 7, false_claims: 1, traps_filed: 1, wall_s: 226.5, note: "ADR 0128 repeat runs" },
    ],
  });

describe("runsBehind", () => {
  test("case 1: every run newest first, the latest and the runs under its key counted, the rest with why", () => {
    const b = cpg();
    const rows = runsBehind(b);
    expect(rows.map((r) => r.runAt)).toEqual([
      "2026-10-22T09:11:43Z",
      "2026-10-22T09:07:19Z",
      "2026-10-22T09:03:32Z",
      "2026-10-07T23:28:15Z",
      "2026-10-07T23:21:47Z",
    ]);
    expect(rows.map((r) => r.counted)).toEqual([true, true, true, false, false]);
    expect(rows.map((r) => r.latest)).toEqual([true, false, false, false, false]);
    expect(rows.slice(0, 3).map((r) => r.why)).toEqual(["", "", ""]);
    for (const r of rows.slice(3)) expect(r.why).toBe("an earlier world, command or scorer: not comparable");
    const counted = rows.filter((r) => r.counted);
    expect(counted).toHaveLength(b.runs.n);
    expect(b.runs.n).toBe(3);
    expect(counted.filter((r) => r.verdict === "exceeds")).toHaveLength(b.runs.exceeds);
    expect(b.runs.exceeds).toBe(2);
  });

  test("case 2: a line a rescore replaced is not counted and says so; the rescored run's own line has no row", () => {
    const b = bench({
      run_at: "2026-10-20T10:00:00Z",
      rescored_at: "2026-10-21T08:00:00Z",
      comparable: "sha256:aaaa",
      verdict: { word: "exceeds" },
      history: [
        { run_at: "2026-10-19T10:00:00Z", comparable: "sha256:aaaa", verdict: "exceeds", superseded_by: { rescored_at: "2026-10-21T08:00:00Z" } },
        // The latest run itself, as it scored before the rescore.
        { run_at: "2026-10-20T10:00:00Z", comparable: "sha256:aaaa", verdict: "short" },
      ],
    });
    const rows = runsBehind(b);
    expect(rows).toHaveLength(2);
    expect(rows[0]!.latest).toBe(true);
    expect(rows[1]!.counted).toBe(false);
    expect(rows[1]!.why).toBe("replaced by the rescore of 2026-10-21");
    expect(rows.filter((r) => r.counted)).toHaveLength(comparableRuns(head(b), b.history).n);
  });

  test("case 3: an unkeyed latest stands alone, and every earlier line was benched before runs were keyed", () => {
    const b = bench({
      run_at: "2026-10-07T10:00:00Z",
      verdict: { word: "meets" },
      history: [
        { run_at: "2026-10-05T10:00:00Z", verdict: "exceeds" },
        { run_at: "2026-10-06T10:00:00Z", comparable: "sha256:aaaa", verdict: "exceeds" },
      ],
    });
    const rows = runsBehind(b);
    expect(rows.map((r) => r.counted)).toEqual([true, false, false]);
    for (const r of rows.slice(1)) expect(r.why).toBe("benched before runs were keyed");
  });
});

describe("worstOf", () => {
  test("case 4: the counted runs that fell short, and what the worst of them filed", () => {
    const w = worstOf(runsBehind(cpg()).filter((r) => r.counted));
    expect(w).toEqual({
      shortIn: 1,
      of: 3,
      falseClaims: 1,
      trapsFiled: 1,
      words: "1 of 3 counted runs fell short; the worst filed 1 false claim and 1 trap",
    });
    const clean = runsBehind(cpg()).filter((r) => r.counted && r.verdict === "exceeds");
    expect(worstOf(clean).words).toBe("");
  });
});

test("case 5: a history line's traps filed and wall time are read, and a line without them is unmeasured", () => {
  const b = cpg();
  const unmeasured = b.history.find((h) => h.runAt === "2026-10-07T23:21:47Z")!;
  expect(unmeasured.trapsFiled).toBeNull();
  expect(unmeasured.wallS).toBeNull();
  const keyed = b.history.find((h) => h.runAt === "2026-10-22T09:07:19Z")!;
  expect(keyed.trapsFiled).toBe(1);
  expect(keyed.wallS).toBe(226.5);
  const row = runsBehind(b).find((r) => r.runAt === "2026-10-07T23:21:47Z")!;
  expect(row.trapsFiled).toBeNull();
  expect(row.traps).toBe("–");
  expect(runsBehind(b).find((r) => r.runAt === "2026-10-22T09:03:32Z")!.traps).toBe("0");
});

test("case 6: shipped, the counted rows reconcile with the n and the exceeds every verdict states", () => {
  const benched = PLAYBOOKS.filter((p) => p.bench !== null);
  expect(benched.length).toBeGreaterThan(80);
  for (const p of benched) {
    const counted = runsBehind(p.bench!).filter((r) => r.counted);
    expect(counted.length, p.id).toBe(p.bench!.runs.n);
    expect(counted.filter((r) => r.verdict === "exceeds").length, p.id).toBe(p.bench!.runs.exceeds);
  }
});

/** What `verdictOf` said for every fixture on the tree before this change (captured there). */
const FIXTURE_VERDICTS_BEFORE: Record<string, [label: string, sentence: string]> = {
  "carrier-refunds": ["Beats its bar", "Beat its bar in its one test run: 5 of 5 found, $96.40 back of $96.40, no false claims."],
  "chargeback-evidence": [
    "Falls short",
    "Fell short: 3 of 4 found, $455 back of $612, 1 false claim, one test run. took 27.3 min, expected at most 25",
  ],
  "flight-compensation": ["Not tested", "No test run yet, so nothing here is measured."],
};

test("case 7 (guard): this change leaves verdictOf's output as it was, for the fixtures and the shipped set", () => {
  // The fixtures: the words verdictOf gave them before this change (the fixture's added history is unkeyed).
  for (const v of fixtures["typical"]!.items) {
    expect([v.verdict.label, v.verdict.sentence], v.id).toEqual(FIXTURE_VERDICTS_BEFORE[v.id]);
  }
  // The shipped set: the same inputs as before this change (history lines without the fields it reads)
  // give the same verdict as today's.
  for (const p of PLAYBOOKS.filter((b) => b.bench !== null)) {
    const b = p.bench!;
    const history = b.history.map((h) => {
      const line: Partial<typeof h> = { ...h };
      delete line.trapsFiled;
      delete line.wallS;
      return line;
    }) as unknown as Bench["history"];
    const before: Bench = { ...b, history, runs: comparableRuns(head(b), history) };
    expect(verdictOf(b, tallyOf(p), p.rank), p.id).toEqual(verdictOf(before, tallyOf(p, before), p.rank));
  }
});

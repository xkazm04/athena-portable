/**
 * The pilot report's comparison mode, tested over recorded CaseReports: no daemon, no browser,
 * no model. The live pilot (`../shadowrunr/shadowrunr.live.e2e.test.ts`) only finds the previous
 * run and passes it in, so every rule a comparison follows is pinned here.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { comparePilot, pilotMarkdown, previousReport, type CaseReport, type PilotRun } from "./pilot";

function report(id: string, over: Partial<CaseReport> & { before?: number; unknown?: string[]; cost?: number } = {}): CaseReport {
  const { before = 2, unknown = [], cost = 0.1, ...rest } = over;
  return {
    id,
    prompt: `prompt for ${id}`,
    start: "#/home",
    ok: true,
    failures: [],
    wall_ms: 12_000,
    turns: 3,
    tool_calls: [{ name: "host.shadowrunr.where_am_i", params: {}, ok: true, error: null }],
    page_calls: [],
    hashes: ["#/home", "#/next"],
    cards_filed: [],
    cards_approved: [],
    final_answer: "an answer",
    run_error: null,
    ledger: { rows: 1, cost_usd: cost, rounds: 2, input_tokens: 100, output_tokens: 50 },
    orientation: {
      calls_before_content: before,
      first_content_call: "read_bible",
      unknown_tool_named: unknown.length > 0,
      unknown_tools: unknown,
    },
    ...rest,
  };
}

const run = (stamp: string, cases: CaseReport[]): PilotRun => ({ stamp, cases });
const IDS = ["cold-orientation", "review-walkthrough", "shape-malakor", "analyze-sims"];
const baseline = () => IDS.map((id) => report(id));

describe("pilot comparison", () => {
  it("case 1: fewer calls before content on an ok case is 'better' with its delta, and so is the run", () => {
    const prev = run("2026-10-20T10-00-00-000Z", baseline().map((r) => (r.id === "shape-malakor" ? report(r.id, { before: 4 }) : r)));
    const curr = baseline().map((r) => (r.id === "shape-malakor" ? report(r.id, { before: 1 }) : r));
    const cmp = comparePilot(prev, curr);
    const row = cmp.rows.find((r) => r.id === "shape-malakor");
    expect(row?.verdict).toBe("better");
    expect(row?.before_content_delta).toBe(-3);
    expect(cmp.verdict).toBe("better");
  });

  it("case 2: ok -> not ok is 'regressed', names the new failures, and makes the run 'worse'", () => {
    const prev = run("2026-10-20T10-00-00-000Z", baseline().map((r) => (r.id === "analyze-sims" ? r : report(r.id, { before: 5 }))));
    // Every other case improved; the one failure still decides the run.
    const curr = baseline().map((r) =>
      r.id === "analyze-sims" ? report(r.id, { ok: false, failures: ["no final answer arrived"] }) : report(r.id, { before: 0 }),
    );
    const cmp = comparePilot(prev, curr);
    const row = cmp.rows.find((r) => r.id === "analyze-sims");
    expect(row?.verdict).toBe("regressed");
    expect(row?.new_failures).toEqual(["no final answer arrived"]);
    expect(cmp.verdict).toBe("worse");
  });

  it("case 3: a newly named unknown tool is 'regressed' even when orientation got faster", () => {
    const prev = run("2026-10-20T10-00-00-000Z", baseline().map((r) => (r.id === "review-walkthrough" ? report(r.id, { before: 6, unknown: ["host.shadowrunr.old"] }) : r)));
    const curr = baseline().map((r) =>
      r.id === "review-walkthrough" ? report(r.id, { before: 1, unknown: ["host.shadowrunr.old", "host.shadowrunr.open_session"] }) : r,
    );
    const cmp = comparePilot(prev, curr);
    const row = cmp.rows.find((r) => r.id === "review-walkthrough");
    expect(row?.verdict).toBe("regressed");
    expect(row?.new_unknown_tools).toEqual(["host.shadowrunr.open_session"]);
    expect(cmp.verdict).toBe("worse");
  });

  it("case 4: cost and turn deltas count only cases ok in both runs, and the summary says over how many", () => {
    const prev = run("2026-10-20T10-00-00-000Z", [
      report("a", { cost: 0.1, turns: 3 }),
      report("b", { cost: 0.2, turns: 4 }),
      report("c", { cost: 0.3, turns: 5, ok: false, failures: ["the page never navigated"] }),
      report("d", { cost: 0.4, turns: 6 }),
    ]);
    const curr = [
      report("a", { cost: 0.15, turns: 2 }),
      report("b", { cost: 0.1, turns: 4 }),
      report("c", { cost: 0.05, turns: 1 }),
      report("d", { cost: 0.01, turns: 1, ok: false, failures: ["no final answer arrived"] }),
    ];
    const cmp = comparePilot(prev, curr);
    expect(cmp.cost_over).toEqual({ n: 2, m: 4 });
    expect(cmp.cost_delta_usd).toBeCloseTo(-0.05, 10);
    expect(cmp.turns_delta).toBe(-1);
    const c = cmp.rows.find((r) => r.id === "c");
    const d = cmp.rows.find((r) => r.id === "d");
    expect(c?.cost_usd).toBe(0.05);
    expect(c?.cost_delta_usd).toBeNull();
    expect(c?.turns_delta).toBeNull();
    expect(d?.cost_usd).toBe(0.01);
    expect(d?.cost_delta_usd).toBeNull();
    expect(cmp.summary).toContain("cost over 2 of 4 cases");
  });

  it("case 5: a case only in curr is 'new', only in prev is 'gone', and neither enters a delta", () => {
    const prev = run("2026-10-20T10-00-00-000Z", [report("a", { cost: 0.1 }), report("old-case", { cost: 9, turns: 40 })]);
    const curr = [report("a", { cost: 0.1 }), report("new-case", { cost: 7, turns: 30 })];
    const cmp = comparePilot(prev, curr);
    expect(cmp.added).toEqual(["new-case"]);
    expect(cmp.gone).toEqual(["old-case"]);
    expect(cmp.rows.find((r) => r.id === "new-case")?.verdict).toBe("new");
    expect(cmp.rows.find((r) => r.id === "old-case")?.verdict).toBe("gone");
    expect(cmp.cost_over).toEqual({ n: 1, m: 1 });
    expect(cmp.cost_delta_usd).toBe(0);
    expect(cmp.turns_delta).toBe(0);
    expect(cmp.verdict).toBe("same");
    expect(cmp.summary).toContain("new: new-case");
    expect(cmp.summary).toContain("gone: old-case");
  });

  it("case 6 (guard): with no previous run the markdown is exactly today's report", () => {
    const reports = [report("a"), report("b", { ok: false, failures: ["no final answer arrived"], unknown: ["host.x.y"] })];
    const today = [
      "# Pilot",
      "",
      "| case | ok | turns | calls | before content | first content call | unknown tool | cards (approved) | cost USD | wall s |",
      "|---|---|---|---|---|---|---|---|---|---|",
      "| a | yes | 3 | 1 | 2 | read_bible | no | 0 (0) | 0.1000 | 12.0 |",
      "| b | NO | 3 | 1 | 2 | read_bible | host.x.y | 0 (0) | 0.1000 | 12.0 |",
      "",
    ];
    const md = pilotMarkdown("Pilot", reports, null);
    expect(md.startsWith(today.join("\n"))).toBe(true);
    expect(md).toBe(pilotMarkdown("Pilot", reports));
    expect(md).not.toContain("Since");
  });

  describe("case 7: previousReport", () => {
    let root = "";
    afterEach(() => {
      if (root) rmSync(root, { recursive: true, force: true });
      root = "";
    });
    const put = (stamp: string, body: string | null) => {
      mkdirSync(join(root, stamp), { recursive: true });
      if (body !== null) writeFileSync(join(root, stamp, "report.json"), body, "utf-8");
    };

    it("picks the newest earlier report and skips missing or unparseable ones", () => {
      root = mkdtempSync(join(tmpdir(), "pilot-out-"));
      put("2026-10-01T09-00-00-000Z", JSON.stringify({ stamp: "2026-10-01T09-00-00-000Z", cases: [report("a")] }));
      put("2026-10-02T09-00-00-000Z", JSON.stringify({ stamp: "2026-10-02T09-00-00-000Z", cases: [report("b")] }));
      put("2026-10-03T09-00-00-000Z", "{ not json");
      put("2026-10-04T09-00-00-000Z", null);
      put("2026-10-05T09-00-00-000Z", JSON.stringify({ stamp: "2026-10-05T09-00-00-000Z", cases: [report("c")] }));
      const prev = previousReport(root, "2026-10-05T09-00-00-000Z");
      expect(prev?.stamp).toBe("2026-10-02T09-00-00-000Z");
      expect(prev?.cases.map((c) => c.id)).toEqual(["b"]);
    });

    it("returns null when nothing earlier qualifies, or the folder does not exist", () => {
      root = mkdtempSync(join(tmpdir(), "pilot-out-"));
      put("2026-10-03T09-00-00-000Z", "{ not json");
      put("2026-10-04T09-00-00-000Z", null);
      put("2026-10-09T09-00-00-000Z", JSON.stringify({ stamp: "2026-10-09T09-00-00-000Z", cases: [] }));
      expect(previousReport(root, "2026-10-05T09-00-00-000Z")).toBeNull();
      expect(previousReport(join(root, "absent"), "2026-10-05T09-00-00-000Z")).toBeNull();
    });
  });

  it("case 8: the markdown opens with the one-word verdict, then a 'Since' table above today's summary", () => {
    const prev = run("2026-10-20T10-00-00-000Z", [report("shape-malakor", { before: 4, cost: 0.3, turns: 5 })]);
    const curr = [report("shape-malakor", { before: 1, cost: 0.2, turns: 3, cards_filed: [{ id: "c1", action: "a", params: {}, rationale: "r" }] })];
    const cmp = comparePilot(prev, curr);
    const md = pilotMarkdown("Pilot", curr, cmp);
    const lines = md.split("\n");
    expect(lines[0]).toBe("# Pilot");
    expect(lines[2]).toBe("better");
    const since = lines.indexOf("## Since 2026-10-20T10-00-00-000Z");
    const today = lines.findIndex((l) => l.startsWith("| case | ok |"));
    expect(since).toBeGreaterThan(2);
    expect(today).toBeGreaterThan(since);
    expect(md).toContain("| case | verdict | before content | turns | cards | cost USD |");
    expect(md).toContain("| shape-malakor | better | -3 | -2 | +1 | -0.1000 |");
  });
});

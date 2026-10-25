/**
 * The live pilot's report, for any app Athena drives (`/open verify`, level 2). The question a
 * pilot answers is not "does the wiring work" (the scripted suite gates that) but "does she
 * orient smoothly and spend her turns on content", so almost nothing is asserted and everything
 * is reported: per case, its turns, every tool call, the hashes visited, the cards filed and
 * approved, the final answer, the wall time and the ledger's cost, plus the orientation measure.
 *
 * `../shadowrunr/shadowrunr.live.e2e.test.ts` is the first user. A new app's pilot supplies its
 * `appId`, its orientation tools and its cases, and reuses the rest.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import type { FetchLike } from "@/lib/api";

/** One case: a fresh conversation that starts on `start` and is sent `prompt`. */
export interface PilotCase {
  id: string;
  start: string;
  prompt: string;
  /** The answer is about where she already is, so staying put is right (default: she must navigate). */
  stays?: boolean;
}

/** The fields of a tool call the report reads (`loop.ts` `ToolCallRecord` carries more). */
export interface PilotToolCall {
  name: string;
  params: Record<string, unknown>;
  ok: boolean | null;
  error: string | null;
}

export interface Orientation {
  /** Calls before the first content-bearing one; equal to the call count when there was none. */
  calls_before_content: number;
  first_content_call: string | null;
  unknown_tool_named: boolean;
  unknown_tools: string[];
}

export interface CaseReport {
  id: string;
  prompt: string;
  start: string;
  ok: boolean;
  failures: string[];
  wall_ms: number;
  /** `POST /run` requests: the first message, each continuation, each post-approval turn. */
  turns: number;
  tool_calls: PilotToolCall[];
  /** The page tools that ran, in order, as the relay answered them. */
  page_calls: Array<{ name: string; input: Record<string, unknown>; ok: boolean; error: string | null }>;
  hashes: string[];
  cards_filed: Array<{ id: string; action: string; params: Record<string, unknown>; rationale: string }>;
  cards_approved: string[];
  final_answer: string;
  run_error: unknown;
  ledger: { rows: number; cost_usd: number; rounds: number; input_tokens: number; output_tokens: number };
  orientation: Orientation;
}

/**
 * The orientation measure: how many calls she made before her first content-bearing one (any
 * call outside `orientTools`), and whether she named a tool of this app that does not exist.
 * `known` is the set of short names the page listed; calls arrive as `host.<appId>.<name>`.
 */
export function orientationOf(
  calls: readonly PilotToolCall[],
  known: ReadonlySet<string>,
  appId: string,
  orientTools: ReadonlySet<string>,
): Orientation {
  const prefix = `host.${appId}.`;
  const short = (name: string) => (name.startsWith(prefix) ? name.slice(prefix.length) : name);
  const first = calls.findIndex((c) => !orientTools.has(short(c.name)));
  const unknown = calls
    .filter((c) => (c.name.startsWith(prefix) && !known.has(short(c.name))) || /unknown_ref/.test(c.error ?? ""))
    .map((c) => c.name);
  return {
    calls_before_content: first === -1 ? calls.length : first,
    first_content_call: first === -1 ? null : short(calls[first].name),
    unknown_tool_named: unknown.length > 0,
    unknown_tools: [...new Set(unknown)],
  };
}

/** One run as `out/<stamp>/report.json` holds it. */
export interface PilotRun {
  stamp: string;
  cases: CaseReport[];
}

/**
 * A case's verdict against the previous run. `regressed` (ok lost, or a tool name she invented
 * that she had not before) outranks any efficiency gain; `better`/`worse` compare the calls she
 * spent before content; `new`/`gone` are cases only one run has, never part of a delta.
 */
export type CaseVerdict = "better" | "worse" | "same" | "regressed" | "new" | "gone";

export interface CaseComparison {
  id: string;
  verdict: CaseVerdict;
  /** curr - prev; null for a case only one run has. */
  before_content_delta: number | null;
  cards_delta: number | null;
  /** curr - prev, only for a case ok in BOTH runs (outcome-conditioned); null otherwise. */
  turns_delta: number | null;
  cost_delta_usd: number | null;
  /** This run's cost, reported even when it is excluded from the delta (0 for a gone case's absent run). */
  cost_usd: number;
  /** Failure strings this run has that the previous one did not. */
  new_failures: string[];
  /** Unknown tools this run named that the previous one did not. */
  new_unknown_tools: string[];
}

export interface PilotComparison {
  prev_stamp: string;
  verdict: "better" | "worse" | "same";
  rows: CaseComparison[];
  /** Cost and turn deltas are summed over `n` cases ok in both runs, of `m` cases both runs have. */
  cost_over: { n: number; m: number };
  cost_delta_usd: number;
  turns_delta: number;
  added: string[];
  gone: string[];
  /** One line: the counts, the cost basis, and any case set difference. */
  summary: string;
}

const newOf = (now: readonly string[], before: readonly string[]) => now.filter((x) => !before.includes(x));

function compareCase(prev: CaseReport, curr: CaseReport): CaseComparison {
  const before_content_delta = curr.orientation.calls_before_content - prev.orientation.calls_before_content;
  const both = prev.ok && curr.ok;
  const new_failures = newOf(curr.failures, prev.failures);
  const new_unknown_tools = newOf(curr.orientation.unknown_tools, prev.orientation.unknown_tools);
  let verdict: CaseVerdict;
  if ((prev.ok && !curr.ok) || new_unknown_tools.length > 0) verdict = "regressed";
  else if (!prev.ok && curr.ok) verdict = "better";
  else if (!both) verdict = "same";
  else verdict = before_content_delta < 0 ? "better" : before_content_delta > 0 ? "worse" : "same";
  return {
    id: curr.id,
    verdict,
    before_content_delta,
    cards_delta: curr.cards_filed.length - prev.cards_filed.length,
    turns_delta: both ? curr.turns - prev.turns : null,
    cost_delta_usd: both ? curr.ledger.cost_usd - prev.ledger.cost_usd : null,
    cost_usd: curr.ledger.cost_usd,
    new_failures,
    new_unknown_tools,
  };
}

function lonely(r: CaseReport, verdict: "new" | "gone"): CaseComparison {
  return {
    id: r.id,
    verdict,
    before_content_delta: null,
    cards_delta: null,
    turns_delta: null,
    cost_delta_usd: null,
    cost_usd: verdict === "new" ? r.ledger.cost_usd : 0,
    new_failures: [],
    new_unknown_tools: [],
  };
}

/**
 * This run against the previous one, by rules that cannot reward failing cheaply (ADR 0218):
 * any regressed case makes the run `worse`; otherwise the run is `better` or `worse` by which of
 * the two kinds of case outnumbers the other, and `same` on a tie. Cost and turns are compared
 * only over cases that reached an answer in both runs; cases only one run has are named, never
 * averaged over.
 */
export function comparePilot(prev: PilotRun, curr: readonly CaseReport[]): PilotComparison {
  const before = new Map(prev.cases.map((r) => [r.id, r]));
  const now = new Set(curr.map((r) => r.id));
  const rows: CaseComparison[] = curr.map((r) => {
    const p = before.get(r.id);
    return p ? compareCase(p, r) : lonely(r, "new");
  });
  for (const p of prev.cases) if (!now.has(p.id)) rows.push(lonely(p, "gone"));

  const count = (v: CaseVerdict) => rows.filter((r) => r.verdict === v).length;
  const paired = rows.filter((r) => r.verdict !== "new" && r.verdict !== "gone");
  const costed = paired.filter((r) => r.cost_delta_usd !== null);
  const cost_delta_usd = costed.reduce((n, r) => n + (r.cost_delta_usd ?? 0), 0);
  const turns_delta = costed.reduce((n, r) => n + (r.turns_delta ?? 0), 0);
  const added = rows.filter((r) => r.verdict === "new").map((r) => r.id);
  const gone = rows.filter((r) => r.verdict === "gone").map((r) => r.id);
  const net = count("better") - count("worse");
  const verdict = count("regressed") > 0 ? "worse" : net > 0 ? "better" : net < 0 ? "worse" : "same";

  const parts = [
    `${count("better")} better, ${count("worse")} worse, ${count("regressed")} regressed, ${count("same")} same`,
    `cost over ${costed.length} of ${paired.length} cases: ${signedUsd(cost_delta_usd)} USD, ${signed(turns_delta)} turns`,
  ];
  if (added.length > 0) parts.push(`new: ${added.join(", ")}`);
  if (gone.length > 0) parts.push(`gone: ${gone.join(", ")}`);
  return {
    prev_stamp: prev.stamp,
    verdict,
    rows,
    cost_over: { n: costed.length, m: paired.length },
    cost_delta_usd,
    turns_delta,
    added,
    gone,
    summary: parts.join("; "),
  };
}

function signed(n: number | null): string {
  if (n === null) return "n/a";
  return n > 0 ? `+${n}` : String(n);
}

function signedUsd(n: number | null): string {
  if (n === null) return "n/a";
  const s = n.toFixed(4);
  return n > 0 && s !== "0.0000" ? `+${s}` : s === "-0.0000" ? "0.0000" : s;
}

/**
 * The newest `outRoot/<stamp>/report.json` whose stamp sorts before `currentStamp` (the stamps
 * are ISO times, so they sort as strings). A folder whose report is missing or unreadable is
 * skipped, not fatal: a run that died before its first flush leaves an empty folder.
 */
export function previousReport(outRoot: string, currentStamp: string): PilotRun | null {
  let stamps: string[];
  try {
    stamps = readdirSync(outRoot, { withFileTypes: true })
      .filter((d) => d.isDirectory() && d.name < currentStamp)
      .map((d) => d.name)
      .sort()
      .reverse();
  } catch {
    return null;
  }
  for (const stamp of stamps) {
    try {
      const body = JSON.parse(readFileSync(join(outRoot, stamp, "report.json"), "utf-8")) as Partial<PilotRun>;
      if (Array.isArray(body.cases)) return { stamp: typeof body.stamp === "string" ? body.stamp : stamp, cases: body.cases };
    } catch {
      // Missing or unparseable: try the next older run.
    }
  }
  return null;
}

/** The comparison section: the one-line summary and a per-case table of deltas. */
function comparisonLines(cmp: PilotComparison): string[] {
  return [
    `## Since ${cmp.prev_stamp}`,
    "",
    cmp.summary,
    "",
    "| case | verdict | before content | turns | cards | cost USD |",
    "|---|---|---|---|---|---|",
    ...cmp.rows.map((r) => {
      const why = [...r.new_failures, ...r.new_unknown_tools.map((t) => `unknown tool ${t}`)];
      const verdict = why.length > 0 ? `${r.verdict} (${why.join("; ")})` : r.verdict;
      const cost = r.cost_delta_usd === null ? `n/a (${r.cost_usd.toFixed(4)})` : signedUsd(r.cost_delta_usd);
      return `| ${r.id} | ${verdict} | ${signed(r.before_content_delta)} | ${signed(r.turns_delta)} | ${signed(r.cards_delta)} | ${cost} |`;
    }),
    "",
  ];
}

/**
 * The report as markdown: one summary table, then one section per case. With a comparison, the
 * first line under the title is the run's one-word verdict and a "Since" table precedes the
 * summary; without one the report is exactly the single-run report.
 */
export function pilotMarkdown(title: string, reports: readonly CaseReport[], comparison?: PilotComparison | null): string {
  const lines = [
    `# ${title}`,
    "",
    ...(comparison ? [comparison.verdict, "", ...comparisonLines(comparison)] : []),
    "| case | ok | turns | calls | before content | first content call | unknown tool | cards (approved) | cost USD | wall s |",
    "|---|---|---|---|---|---|---|---|---|---|",
    ...reports.map(
      (r) =>
        `| ${r.id} | ${r.ok ? "yes" : "NO"} | ${r.turns} | ${r.tool_calls.length} | ${r.orientation.calls_before_content} | ${r.orientation.first_content_call ?? "-"} | ${r.orientation.unknown_tool_named ? r.orientation.unknown_tools.join(", ") : "no"} | ${r.cards_filed.length} (${r.cards_approved.length}) | ${r.ledger.cost_usd.toFixed(4)} | ${(r.wall_ms / 1000).toFixed(1)} |`,
    ),
    "",
  ];
  for (const r of reports) {
    lines.push(`## ${r.id}`, "", `Starts on \`${r.start}\`. Prompt: "${r.prompt}"`, "");
    if (r.failures.length > 0) lines.push(`**Failed:** ${r.failures.join("; ")}`, "");
    lines.push("Tool calls:", "");
    for (const c of r.tool_calls) {
      const end = c.ok === null ? "no answer" : c.ok ? "ok" : `error: ${c.error}`;
      lines.push(`1. \`${c.name}\` \`${JSON.stringify(c.params).slice(0, 300)}\` (${end})`);
    }
    lines.push("", `Hashes visited: ${r.hashes.map((h) => `\`${h}\``).join(" -> ")}`, "");
    if (r.cards_filed.length > 0) {
      lines.push("Cards:", "");
      for (const c of r.cards_filed) lines.push(`- \`${c.action}\` (${r.cards_approved.includes(c.id) ? "approved" : "not approved"}): ${c.rationale}`);
      lines.push("");
    }
    lines.push(
      `Ledger: ${r.ledger.rows} rows, ${r.ledger.rounds} rounds, ${r.ledger.input_tokens} in / ${r.ledger.output_tokens} out tokens, $${r.ledger.cost_usd.toFixed(4)}.`,
      "",
      "Final answer:",
      "",
      ...r.final_answer.split("\n").map((l) => `> ${l}`),
      "",
    );
  }
  return lines.join("\n");
}

/**
 * The real `fetch`, taken at import, before `./setup.ts` swaps in its 90 s turn deadline: a live
 * round on the CLI can take longer than that. The same shape of guard is kept with a longer
 * ceiling: a request that is safe to repeat gets one retry, `/run` and `/decisions` get none.
 */
const REAL_FETCH = globalThis.fetch;
const TURN_DEADLINE_MS = 10 * 60_000;
const DEADLINE_MS = 60_000;
export const liveFetch: FetchLike = async (input, init) => {
  const turn = input.includes("/run") || input.includes("/decisions/");
  const method = (init?.method ?? "GET").toUpperCase();
  const attempts = !turn && (method === "GET" || input.endsWith("/manifest")) ? 2 : 1;
  let last: unknown;
  for (let i = 0; i < attempts; i += 1) {
    const abort = AbortSignal.timeout(turn ? TURN_DEADLINE_MS : DEADLINE_MS);
    try {
      const signal = init?.signal ? AbortSignal.any([init.signal, abort]) : abort;
      return await REAL_FETCH(input, { ...init, signal });
    } catch (error) {
      last = error;
      if (!abort.aborted) throw error;
    }
  }
  throw last;
};

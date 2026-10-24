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

/** The report as markdown: one summary table, then one section per case. */
export function pilotMarkdown(title: string, reports: readonly CaseReport[]): string {
  const lines = [
    `# ${title}`,
    "",
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

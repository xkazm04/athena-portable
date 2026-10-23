/**
 * The live pilot: Athena on the operator's signed-in Claude CLI drives the Shadowrunr console
 * through four use cases. Skipped unless `ATHENA_LIVE=1`; it spends quota (four conversations).
 *
 * The question it answers is not "does the wiring work" — the scripted suite gates that — but
 * "does she orient smoothly and spend her turns on content". So almost nothing here is asserted.
 * Every case is reported to `out/<UTC stamp>/report.{json,md}`: its turns, every tool call (name,
 * args, ok or error), the hashes visited, the cards filed and approved, the final answer, the
 * wall time and the ledger's cost, plus the orientation measure — how many calls she made before
 * her first content-bearing one (anything but where_am_i, app_map and go_to) — and whether she
 * ever named a tool that does not exist.
 *
 * A case fails only when the page never navigated (except a case marked `stays`), a call errored on an unknown tool, or no
 * final answer arrived.
 *
 * GATED cards are approved by the harness, which is safe because every write lands on the
 * scratch copy of the characters, the runs and the data dir (support/shadowrunr.ts). The
 * Shadowrunr daemon is `--scripted`, so `start_sim` stays keyless too.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import type { FetchLike } from "@/lib/api";
import { resetRunForTests, useRun } from "@/stores/run";
import type { Daemon } from "../support/daemon";

import { startLiveDaemon } from "./support/athena";
import { launchBrowser, openConsole, type ConsolePage } from "./support/browser";
import { APP_ID, toolCallsOf, wireLoop, type ToolCallRecord } from "./support/loop";
import {
  OVERLORD,
  makeScratch,
  missingPieces,
  removeScratch,
  serveConsole,
  startShadowDaemon,
  treeDigest,
  type ConsoleServer,
  type Scratch,
  type ShadowDaemon,
} from "./support/shadowrunr";

/**
 * The real `fetch`, taken before `../support/setup.ts` swaps in its 90 s turn deadline: a live
 * round on the CLI can take longer than that. The same shape of guard is kept with a longer
 * ceiling: a request that is safe to repeat gets one retry, `/run` and `/decisions` get none.
 */
const REAL_FETCH = globalThis.fetch;
const TURN_DEADLINE_MS = 10 * 60_000;
const DEADLINE_MS = 60_000;
const liveFetch: FetchLike = async (input, init) => {
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

const LIVE = process.env.ATHENA_LIVE === "1";
const missing = missingPieces();
const HERE = dirname(fileURLToPath(import.meta.url));
const ORIENTATION_TOOLS = new Set(["where_am_i", "app_map", "go_to"]);
const MAX_APPROVALS = 8;
const CASE_TIMEOUT_MS = 30 * 60_000;

interface PilotCase {
  id: string;
  start: string;
  prompt: string;
  /** The answer is about where she already is, so staying put is right (default: she must navigate). */
  stays?: boolean;
}

/** Four fresh conversations, each starting on a different page. */
const CASES: readonly PilotCase[] = [
  { id: "cold-orientation", start: "#/segments", prompt: "Where are we, and what can you help me with here?", stays: true },
  {
    id: "review-walkthrough",
    start: "#/characters",
    prompt: "Show me the latest sandbox session and walk me through its weakest moment, then note what you'd change as feedback.",
  },
  { id: "shape-malakor", start: "#/review", prompt: "Read Malakor's bible and tone rules and propose one sharper edit to the bible." },
  { id: "analyze-sims", start: "#/brain", prompt: "Start a scripted sim and tell me how its verdict compares to the last tournament." },
];

interface CaseReport {
  id: string;
  prompt: string;
  start: string;
  ok: boolean;
  failures: string[];
  wall_ms: number;
  /** `POST /run` requests: the first message, each continuation, each post-approval turn. */
  turns: number;
  tool_calls: ToolCallRecord[];
  /** The page tools that ran, in order, as the relay answered them. */
  page_calls: Array<{ name: string; input: Record<string, unknown>; ok: boolean; error: string | null }>;
  hashes: string[];
  cards_filed: Array<{ id: string; action: string; params: Record<string, unknown>; rationale: string }>;
  cards_approved: string[];
  final_answer: string;
  run_error: unknown;
  ledger: { rows: number; cost_usd: number; rounds: number; input_tokens: number; output_tokens: number };
  orientation: {
    /** Calls before the first content-bearing one; equal to the call count when there was none. */
    calls_before_content: number;
    first_content_call: string | null;
    unknown_tool_named: boolean;
    unknown_tools: string[];
  };
}

function orientationOf(calls: readonly ToolCallRecord[], known: ReadonlySet<string>): CaseReport["orientation"] {
  const short = (name: string) => (name.startsWith(`host.${APP_ID}.`) ? name.slice(`host.${APP_ID}.`.length) : name);
  const first = calls.findIndex((c) => !ORIENTATION_TOOLS.has(short(c.name)));
  const unknown = calls
    .filter((c) => (c.name.startsWith(`host.${APP_ID}.`) && !known.has(short(c.name))) || /unknown_ref/.test(c.error ?? ""))
    .map((c) => c.name);
  return {
    calls_before_content: first === -1 ? calls.length : first,
    first_content_call: first === -1 ? null : short(calls[first].name),
    unknown_tool_named: unknown.length > 0,
    unknown_tools: [...new Set(unknown)],
  };
}

function markdownOf(stamp: string, reports: readonly CaseReport[]): string {
  const lines = [
    `# Athena drives Shadowrunr: live pilot ${stamp}`,
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

describe.skipIf(!LIVE || missing.length > 0)("Athena drives Shadowrunr (live pilot)", () => {
  let scratch: Scratch;
  let shadow: ShadowDaemon;
  let web: ConsoleServer;
  let cp: ConsolePage;
  let athena: Daemon | null = null;
  let outDir: string;
  let stamp: string;
  let realBefore = "";
  const reports: CaseReport[] = [];

  const flush = () => {
    writeFileSync(join(outDir, "report.json"), JSON.stringify({ stamp, cases: reports }, null, 2), "utf-8");
    writeFileSync(join(outDir, "report.md"), markdownOf(stamp, reports), "utf-8");
  };

  beforeAll(async () => {
    realBefore = treeDigest(join(OVERLORD, "characters"));
    stamp = new Date().toISOString().replace(/[:.]/g, "-");
    outDir = join(HERE, "out", stamp);
    mkdirSync(outDir, { recursive: true });
    scratch = makeScratch();
    shadow = await startShadowDaemon(scratch);
    web = await serveConsole();
    cp = await openConsole(await launchBrowser(), web.origin, shadow.url);
  }, 300_000);

  afterEach(async () => {
    resetRunForTests();
    const d = athena;
    athena = null;
    await d?.stop();
  });

  afterAll(async () => {
    if (outDir) flush();
    await cp?.close().catch(() => undefined);
    await cp?.browser.close().catch(() => undefined);
    await web?.stop().catch(() => undefined);
    await shadow?.stop().catch(() => undefined);
    if (scratch) removeScratch(scratch.root);
  });

  for (const c of CASES) {
    it(
      c.id,
      async () => {
        await cp.goHash(c.start);
        athena = await startLiveDaemon();
        const w = await wireLoop(athena, cp, liveFetch);
        const known = new Set(w.listed.tools.map((t) => t.name));
        const approved: string[] = [];
        const filed = new Map<string, CaseReport["cards_filed"][number]>();
        const noteCards = () => {
          for (const card of useRun.getState().cards) {
            filed.set(card.id, { id: card.id, action: card.action, params: card.params, rationale: card.rationale });
          }
        };
        const t0 = Date.now();

        await useRun.getState().send(c.prompt);
        noteCards();
        // Approve every card, one at a time, each of whose continuations may file more.
        for (let i = 0; i < MAX_APPROVALS && useRun.getState().cards.length > 0; i += 1) {
          const card = useRun.getState().cards[0];
          await useRun.getState().answer(card.id, "approve");
          approved.push(card.id);
          noteCards();
        }
        const wall = Date.now() - t0;

        const state = useRun.getState();
        const calls = toolCallsOf(w.wire);
        let ledger: CaseReport["ledger"] = { rows: 0, cost_usd: 0, rounds: 0, input_tokens: 0, output_tokens: 0 };
        try {
          const page = (await w.api().ledger()) as { rows?: Array<Record<string, unknown>> };
          const rows = page.rows ?? [];
          const sum = (k: string) => rows.reduce((n, r) => n + (typeof r[k] === "number" ? (r[k] as number) : 0), 0);
          ledger = { rows: rows.length, cost_usd: sum("cost_usd"), rounds: sum("rounds"), input_tokens: sum("input_tokens"), output_tokens: sum("output_tokens") };
        } catch {
          // A ledger that cannot be read is reported as zero rows, not a failed case.
        }
        const finalAnswer = state.transcript.filter((e) => e.kind === "assistant").at(-1)?.text.trim() ?? "";
        const orientation = orientationOf(calls, known);
        const failures: string[] = [];
        if (!c.stays && w.hashes.length < 2) failures.push("the page never navigated");
        if (orientation.unknown_tool_named && calls.some((x) => /unknown_ref/.test(x.error ?? ""))) {
          failures.push(`a call errored on an unknown tool: ${orientation.unknown_tools.join(", ")}`);
        }
        if (finalAnswer === "") failures.push("no final answer arrived");

        reports.push({
          id: c.id,
          prompt: c.prompt,
          start: c.start,
          ok: failures.length === 0,
          failures,
          wall_ms: wall,
          turns: w.wire.to("/run").length,
          tool_calls: calls,
          page_calls: w.calls.map((p) => ({ name: p.name, input: p.input, ok: p.ok, error: p.error })),
          hashes: w.hashes,
          cards_filed: [...filed.values()],
          cards_approved: approved,
          final_answer: finalAnswer,
          run_error: state.error,
          ledger,
          orientation,
        });
        flush();

        // The only three things a live case is failed for; everything else is in the report.
        expect(failures).toEqual([]);
      },
      CASE_TIMEOUT_MS,
    );
  }

  it("never touched the real characters/", () => {
    expect(treeDigest(join(OVERLORD, "characters"))).toBe(realBefore);
  });
});

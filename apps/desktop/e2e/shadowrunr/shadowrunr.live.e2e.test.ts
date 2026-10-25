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
 * When out/ holds an earlier run, the report opens with its verdict against it (better, worse or
 * same) and a per-case table of deltas (`comparePilot`, ADR 0218).
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

import { resetRunForTests, useRun } from "@/stores/run";
import type { Daemon } from "../support/daemon";
import {
  comparePilot,
  liveFetch,
  orientationOf,
  pilotMarkdown,
  previousReport,
  type CaseReport,
  type PilotCase,
  type PilotRun,
} from "../support/pilot";

import { startLiveDaemon } from "./support/athena";
import { launchBrowser, openConsole, type ConsolePage } from "./support/browser";
import { APP_ID, toolCallsOf, wireLoop } from "./support/loop";
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

const LIVE = process.env.ATHENA_LIVE === "1";
const missing = missingPieces();
const HERE = dirname(fileURLToPath(import.meta.url));
const ORIENTATION_TOOLS: ReadonlySet<string> = new Set(["where_am_i", "app_map", "go_to"]);
const MAX_APPROVALS = 8;
const CASE_TIMEOUT_MS = 30 * 60_000;

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

  /** The newest earlier run in out/, found once in beforeAll; null on a first run. */
  let baseline: PilotRun | null = null;

  const flush = () => {
    // Recomputed on every flush, so a run cut short still says how far it got against the last one.
    const comparison = baseline ? comparePilot(baseline, reports) : null;
    const body = comparison ? { stamp, cases: reports, comparison } : { stamp, cases: reports };
    writeFileSync(join(outDir, "report.json"), JSON.stringify(body, null, 2), "utf-8");
    writeFileSync(join(outDir, "report.md"), pilotMarkdown(`Athena drives Shadowrunr: live pilot ${stamp}`, reports, comparison), "utf-8");
  };

  beforeAll(async () => {
    realBefore = treeDigest(join(OVERLORD, "characters"));
    stamp = new Date().toISOString().replace(/[:.]/g, "-");
    outDir = join(HERE, "out", stamp);
    baseline = previousReport(join(HERE, "out"), stamp);
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
        const orientation = orientationOf(calls, known, APP_ID, ORIENTATION_TOOLS);
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

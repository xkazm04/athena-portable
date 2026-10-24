/**
 * README section 3.2 (one turn end to end) and section 4 (connectors), against an application that
 * is not ours: Athena drives a real, production-built Gravitone (the sibling `gravitone-gcloud`
 * checkout) over both of the doors it opens to an agent.
 *
 *  A. **MCP.** Athena's daemon (a recorded engine, everything else shipped) lists Gravitone's
 *     `POST /api/mcp` tools from `ATHENA_HOME/mcp.json`, calls `gt_read` and `gt_launch` in one
 *     turn, and Gravitone's own ledger records the write as `agent:athena`.
 *  B. **The page.** Gravitone's studio registers `where_am_i`, `go_to` and `open` on the bridge
 *     `inject.js` provides; the daemon proposes them (recorded turns), the harness runs each
 *     `tool.call` on the page and carries the answer back in the next `POST /run`, and the screen
 *     moves. An address off the studio's origin is refused by the page and moves nothing.
 *  C. **Live** (`JOURNEY_GRAVITONE_LIVE=1`): the signed-in `claude` CLI decides the same navigation.
 *
 * OPT-IN. Nothing here runs in `pnpm test`: `playwright.config.ts` leaves this file out unless
 * `JOURNEY_GRAVITONE=1` or the file is named, and it skips itself without `JOURNEY_GRAVITONE=1` or
 * a Gravitone checkout (`GRAVITONE_DIR`, default `../gravitone-gcloud`). `src/gravitone.ts` says how
 * that checkout is left as it was found.
 */
import { existsSync, mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test, type Page } from "@playwright/test";
import { decide, manifestOf } from "@athena/bridge/gate";
import {
  CONTINUE,
  op,
  round,
  startDaemon,
  writeTranscript,
  type ChannelEvent,
  type Daemon,
  type ToolResultRow,
} from "../src/daemon.ts";
import { ATHENA_ROOT, startGravitone, unavailable, type Gravitone, type Teardown } from "../src/gravitone.ts";
import { call, installBridge, list, type ListAnswer } from "../src/relay.ts";

const here = dirname(fileURLToPath(import.meta.url));
const SHOTS = resolve(here, "..", "shots");
const NAV = ["go_to", "open", "where_am_i"];
const MCP_CLIENT = join(ATHENA_ROOT, "src", "athena", "connectors", "mcp", "service.py");

const wanted = process.env.JOURNEY_GRAVITONE === "1";
const missing = wanted ? unavailable() : null;

test.describe.configure({ mode: "serial" });
test.skip(!wanted, "opt-in: set JOURNEY_GRAVITONE=1 to drive a real Gravitone");
test.skip(missing !== null, missing ?? "");

let gravitone: Gravitone | null = null;
let teardown: Teardown | null = null;
const daemons: Daemon[] = [];

test.beforeAll(async () => {
  test.setTimeout(35 * 60_000);
  gravitone = await startGravitone((line) => console.log(line));
  console.log(`gravitone: build ${gravitone.built}`);
});

test.afterEach(async () => {
  for (const daemon of daemons.splice(0)) await daemon.stop();
});

test.afterAll(async () => {
  for (const daemon of daemons.splice(0)) await daemon.stop();
  if (!gravitone) return;
  teardown = await gravitone.stop();
  gravitone = null;
  console.log(`teardown: tsconfig status ${JSON.stringify(teardown.tsconfigStatus)}, port free ${teardown.portFree}`);
  expect(teardown.tsconfigStatus, "the gravitone checkout's tsconfig.json is restored").toBe("");
  expect(teardown.portFree, "nothing is left on the gravitone port").toBe(true);
});

function booted(): Gravitone {
  if (!gravitone) throw new Error("gravitone did not boot");
  return gravitone;
}

/** Enter the studio the way the landing's "Enter locally" does, then open the Floor with the bridge on. */
async function enterStudio(page: Page, origin: string): Promise<ListAnswer> {
  await installBridge(page);
  await page.goto(`${origin}/`, { waitUntil: "domcontentloaded" });
  const entry = await page.evaluate(async () => {
    const response = await fetch("/api/session", { method: "PUT" });
    return { status: response.status, body: await response.text() };
  });
  if (entry.status !== 200) {
    throw new Error(`local entry refused (STOP, do not change gravitone): ${entry.status} ${entry.body}`);
  }
  await page.goto(`${origin}/floor`, { waitUntil: "domcontentloaded" });
  expect(new URL(page.url()).pathname, "local entry admits the studio").toBe("/floor");
  // The tools register from a React effect after hydration; re-list until all three are there.
  const deadline = Date.now() + 60_000;
  for (;;) {
    const answer = await list(page);
    if (NAV.every((name) => answer.tools.some((tool) => tool.name === name))) return answer;
    if (Date.now() > deadline) throw new Error(`studio tools never registered; saw ${answer.tools.map((t) => t.name).join(", ")}`);
    await page.waitForTimeout(250);
  }
}

/** Register the page's own manifest, so the daemon's session origin is the studio's. */
async function register(daemon: Daemon, answer: ListAnswer): Promise<Record<string, unknown>> {
  return daemon.manifest(manifestOf(answer.page, answer.tools));
}

interface HostCall {
  readonly event: ChannelEvent;
  readonly bare: string;
  readonly params: Record<string, unknown>;
  readonly ok: boolean;
  readonly output: string;
}

interface Exchange {
  readonly events: ChannelEvent[];
  readonly calls: HostCall[];
  readonly next: ToolResultRow[];
  readonly finished: ChannelEvent | undefined;
  /** Each card this exchange approved, with the daemon's `POST /decisions/<id>` reply. */
  readonly approved: Array<{ readonly card: ChannelEvent; readonly reply: Record<string, unknown> }>;
}

/**
 * One `POST /run` and everything the surface owes it: run each host `tool.call` on the page, answer
 * a card only when it names an expected tool (approve, then run its `execute`), and return the rows
 * the next request carries. A card for anything else fails the test.
 */
async function exchange(
  daemon: Daemon,
  page: Page,
  origin: string,
  message: string,
  results: ToolResultRow[],
  cardsAllowed: readonly string[] = [],
): Promise<Exchange> {
  const events = await daemon.run({
    origin,
    message,
    surface: "panel",
    host_state: { page_url: page.url(), page_title: await page.title() },
    tool_results: results,
  });
  const error = events.find((e) => e.kind === "turn.error");
  expect(error, `the turn ended well: ${JSON.stringify(error)}\n${daemon.stderr().slice(-2000)}`).toBeUndefined();
  const calls: HostCall[] = [];
  const next: ToolResultRow[] = [];
  const approved: Exchange["approved"] = [];
  const runOnPage = async (event: ChannelEvent) => {
    const name = String(event.name);
    const bare = name.replace(/^host\.gravitone\./, "");
    const params = (event.params ?? {}) as Record<string, unknown>;
    const answer = await call(page, bare, params);
    const output = answer.ok ? answer.output : answer.error;
    calls.push({ event, bare, params, ok: answer.ok, output });
    next.push({
      call_id: String(event.call_id),
      name,
      ok: answer.ok,
      output,
      tier: Number(event.tier ?? 1),
      ...(answer.ok ? {} : { error: answer.reason ?? "engine_error" }),
    });
  };
  const pending = new Set(
    events.filter((e) => e.kind === "decision.requested").map((e) => String(e.action)),
  );
  for (const event of events) {
    if (event.kind === "tool.call" && String(event.name).startsWith("host.gravitone.") && !pending.has(String(event.name))) {
      await runOnPage(event);
    }
    if (event.kind === "decision.requested") {
      const action = String(event.action);
      expect(cardsAllowed, `an unexpected card was filed for ${action}`).toContain(action);
      const reply = await daemon.decide(String(event.id), "approve", origin);
      approved.push({ card: event, reply });
      for (const run of (reply.execute ?? []) as ChannelEvent[]) {
        if (String(run.name).startsWith("host.gravitone.")) await runOnPage({ ...run, kind: "tool.call" });
      }
    }
  }
  return { events, calls, next, finished: events.find((e) => e.kind === "turn.finished"), approved };
}

async function shot(page: Page, name: string): Promise<string> {
  mkdirSync(SHOTS, { recursive: true });
  const path = join(SHOTS, `gravitone-${name}.png`);
  await page.screenshot({ path });
  console.log(`screenshot: ${path}`);
  return path;
}

/** Gravitone's own ledger, newest first, read with the agent's bearer (`GET /api/ledger?format=jsonl`). */
async function gravitoneLedger(g: Gravitone): Promise<Array<{ seq?: number; type?: string; actor?: { kind?: string; id?: string } }>> {
  const response = await fetch(`${g.origin}/api/ledger?format=jsonl`, { headers: { Authorization: `Bearer ${g.token}` } });
  expect(response.status, "gravitone's ledger door admits the act token").toBe(200);
  return (await response.text())
    .split("\n")
    .filter((line) => line.trim())
    .map((line) => JSON.parse(line) as { seq?: number; type?: string; actor?: { kind?: string; id?: string } });
}

const pathOf = (page: Page): string => {
  const url = new URL(page.url());
  return `${url.pathname}${url.search}`;
};

// -- A. MCP ----------------------------------------------------------------------------------------

test("athena establishes MCP with gravitone", async ({ page }, info) => {
  test.skip(!existsSync(MCP_CLIENT), "Athena's MCP client (src/athena/connectors/mcp) has not landed");
  const g = booted();
  const transcript = writeTranscript(info.outputPath("mcp.ndjson"), "test A, MCP to gravitone", [
    round(`Reading the studio.\n${op("connector.gravitone.gt_read", { op: "projects" }, "how many projects exist")}`),
    round(
      `Composing one.\n${op(
        "connector.gravitone.gt_launch",
        { op: "compose", recipe: "article/post", title: "athena e2e" },
        "the user asked for an article project",
      )}`,
    ),
    round("Composed the article project athena e2e."),
  ]);
  const daemon = await startDaemon({
    mode: "scripted",
    transcript,
    mcpServers: [{ id: "gravitone", url: `${g.origin}/api/mcp`, token_env: "GRAVITONE_MCP_TOKEN" }],
    env: { GRAVITONE_MCP_TOKEN: g.token },
  });
  daemons.push(daemon);

  const connectors = JSON.stringify(await daemon.get("/connectors"));
  expect(connectors, "GET /connectors lists the gravitone MCP server").toContain("gravitone");
  expect(connectors, "the token never reaches /connectors").not.toContain(g.token);

  const answer = await enterStudio(page, g.origin);
  const registered = await register(daemon, answer);
  expect(registered.origin).toBe(g.origin);

  // `gt_launch` is GATED, not AUTO: in Gravitone's family projection a tool's annotations are the
  // most severe of its ops' (registry.ts), and gt_launch holds `discard` (destructiveHint) and the
  // launches (openWorldHint), so ADR 0123's mapping files a card. The harness approves exactly that
  // card, as the user would, and the approved call runs in the daemon on `POST /decisions/<id>`.
  const turn = await exchange(
    daemon,
    page,
    g.origin,
    "How many projects are there? Then compose an article called athena e2e.",
    [],
    ["connector.gravitone.gt_launch"],
  );
  const results = turn.events.filter((e) => e.kind === "tool.result");
  const read = results.find((e) => e.name === "connector.gravitone.gt_read");
  expect(read, `a gt_read tool.result; got ${JSON.stringify(results)}`).toBeDefined();
  expect(read?.ok, `gt_read ok: ${String(read?.output)}`).toBe(true);
  expect(String(read?.output)).toContain('"projects"');
  const held = results.find((e) => e.name === "connector.gravitone.gt_launch");
  expect(held?.error, `gt_launch waits on its card: ${JSON.stringify(held)}`).toBe("pending_approval");
  expect(turn.approved.map((a) => String(a.card.action)), "exactly one card, for gt_launch").toEqual(["connector.gravitone.gt_launch"]);
  const reply = turn.approved[0]?.reply ?? {};
  const launched = JSON.stringify(reply);
  console.log(`gt_launch decision reply: ${launched.slice(0, 600)}`);
  expect(reply.status, "the card is approved").toBe("approved");
  expect(launched, "the token never reaches the decision reply").not.toContain(g.token);
  // The server's JSON may arrive nested in a string (fenced output), so read it unescaped.
  const flat = launched.replace(/\\/g, "");
  const id = /"id"\s*:\s*"([^"]+)"\s*,\s*"view"\s*:\s*"\/projects\//.exec(flat)?.[1];
  expect(id, `compose answered a project id: ${launched.slice(0, 600)}`).toBeTruthy();
  expect(launched).toContain(`/projects/${String(id)}`);
  expect(turn.finished, "the turn finished").toBeDefined();
  expect(turn.calls, "no page call in an MCP turn").toHaveLength(0);
  for (const event of turn.events) expect(JSON.stringify(event)).not.toContain(g.token);

  const rows = await gravitoneLedger(g);
  const mine = rows.filter((row) => row.actor?.kind === "agent" && row.actor.id === "athena" && JSON.stringify(row).includes(String(id)));
  console.log(`gravitone ledger: ${rows.length} events, ${mine.length} by agent:athena for ${String(id)} (${mine.map((r) => r.type).join(", ")})`);
  expect(mine.length, "gravitone's ledger records the compose as agent:athena").toBeGreaterThan(0);
});

// -- B. the page ----------------------------------------------------------------------------------

test("athena navigates gravitone's studio", async ({ page }, info) => {
  const g = booted();
  const answer = await enterStudio(page, g.origin);
  expect(answer.page.app_id).toBe("gravitone");
  expect(answer.tools.map((t) => t.name).sort(), "the studio registers exactly its three navigation tools").toEqual(NAV);
  for (const tool of answer.tools) expect(decide(tool).cls, `${tool.name} is AUTO by its own flags`).toBe("AUTO");

  // The Ledger opens on its newest event and writes it into the address (`Ledger.tsx` replaceState to
  // `/ledger?ev=<seq>`). Gravitone's `arrive` counts a page's own added query as arrived (afd36f3e, found
  // by this test), so `go_to ledger` answers with the address the page settled on.
  const LEDGER = /^\/ledger(\?ev=\d+)?$/;
  const at = (path: string, want: string | RegExp): boolean => (typeof want === "string" ? path === want : want.test(path));
  const transcript = writeTranscript(info.outputPath("nav.ndjson"), "test B, studio navigation", [
    round(`Let me see where the studio is.\n${op("host.gravitone.where_am_i", {}, "find the current screen")}`),
    round(`You are on the Floor. Showing Runs.\n${op("host.gravitone.go_to", { section: "runs" }, "the user asked for Runs")}`),
    round(`Now the Library.\n${op("host.gravitone.go_to", { section: "library" }, "the user asked for the Library")}`),
    round(`And the Ledger.\n${op("host.gravitone.go_to", { section: "ledger" }, "the user asked for the Ledger")}`),
    round(`Trying an outside address.\n${op("host.gravitone.open", { path: "https://example.com" }, "probe the open guard")}`),
    round("Done: Runs, then the Library, then the Ledger. The outside address was refused."),
  ]);
  const daemon = await startDaemon({ mode: "scripted", transcript, connectors: false });
  daemons.push(daemon);

  const registered = await register(daemon, answer);
  const catalogued = (registered.tools as Array<{ name: string; class: string }>).map((t) => `${t.name}:${t.class}`).sort();
  expect(catalogued).toEqual(["host.gravitone.go_to:AUTO", "host.gravitone.open:AUTO", "host.gravitone.where_am_i:AUTO"]);

  await shot(page, "0-floor");
  const steps: Array<{ tool: string; params: Record<string, unknown>; path: string | RegExp; section: string | null; refused?: boolean }> = [
    { tool: "where_am_i", params: {}, path: "/floor", section: "floor" },
    { tool: "go_to", params: { section: "runs" }, path: "/projects/runs", section: "runs" },
    { tool: "go_to", params: { section: "library" }, path: "/library", section: "library" },
    { tool: "go_to", params: { section: "ledger" }, path: LEDGER, section: "ledger" },
    { tool: "open", params: { path: "https://example.com" }, path: LEDGER, section: null, refused: true },
  ];

  let results: ToolResultRow[] = [];
  for (const [index, step] of steps.entries()) {
    const turn = await exchange(daemon, page, g.origin, index === 0 ? "Show me Runs, then the Library, then the Ledger." : CONTINUE, results);
    expect(turn.calls.map((c) => c.bare), `step ${index + 1}: one ${step.tool} call`).toEqual([step.tool]);
    const done = turn.calls[0] as HostCall;
    expect(done.params).toEqual(step.params);
    expect(done.ok, `step ${index + 1}: the bridge answered`).toBe(true);
    const out = JSON.parse(done.output) as { path?: string; section?: string; heading?: string | null; error?: string };
    // The page's own heading, without the counts drawn in it (the live run once read "Compositions00").
    if (step.section === "runs") expect(out.heading, "Runs answers its h1, not a side panel's title").toBe("Runs · every resource");
    if (step.refused) {
      expect(out.error, `step ${index + 1}: open refuses an outside address`).toContain("not a studio address");
    } else {
      expect(at(out.path ?? "", step.path), `step ${index + 1}: the answer names where the studio is: ${done.output}`).toBe(true);
      expect(out.section).toBe(step.section);
    }
    const screen = pathOf(page);
    expect(at(screen, step.path), `step ${index + 1}: the screen (${screen}) is at ${String(step.path)}`).toBe(true);
    await shot(page, `${index + 1}-${step.tool}-${step.refused ? "refused" : screen.replace(/\W+/g, "_").replace(/^_/, "")}`);
    results = turn.next;
  }

  const last = await exchange(daemon, page, g.origin, CONTINUE, results);
  expect(last.calls).toHaveLength(0);
  expect(String(last.finished?.text)).toContain("Done: Runs, then the Library, then the Ledger.");
  expect(pathOf(page)).toMatch(LEDGER);
});

// -- C. live ----------------------------------------------------------------------------------------

test("live: claude decides the navigation", async ({ page }) => {
  test.skip(process.env.JOURNEY_GRAVITONE_LIVE !== "1", "live: set JOURNEY_GRAVITONE_LIVE=1 (spends the signed-in claude CLI)");
  test.skip(!existsSync(MCP_CLIENT), "Athena's MCP client (src/athena/connectors/mcp) has not landed");
  test.setTimeout(20 * 60_000);
  const g = booted();
  const daemon = await startDaemon({
    mode: "real",
    ...(process.env.JOURNEY_GRAVITONE_MODEL ? { model: process.env.JOURNEY_GRAVITONE_MODEL } : {}),
    mcpServers: [{ id: "gravitone", url: `${g.origin}/api/mcp`, token_env: "GRAVITONE_MCP_TOKEN" }],
    env: { GRAVITONE_MCP_TOKEN: g.token },
  });
  daemons.push(daemon);
  const answer = await enterStudio(page, g.origin);
  await register(daemon, answer);

  const expected = ["connector.gravitone.gt_read", "host.gravitone.where_am_i", "host.gravitone.go_to", "host.gravitone.open"];
  const named: string[] = [];
  const seen = new Set<string>();
  let results: ToolResultRow[] = [];
  let message = "In Gravitone, check over MCP how many projects exist, then show me the Runs screen and then the Library.";
  let finalText = "";
  for (let i = 0; i < 8; i += 1) {
    const turn = await exchange(daemon, page, g.origin, message, results, expected);
    // A page call is a `tool.call`; a connector call may surface only as its `tool.result`. One name per call id.
    for (const event of turn.events) {
      if (event.kind !== "tool.call" && event.kind !== "tool.result") continue;
      const key = String(event.call_id);
      if (seen.has(key)) continue;
      seen.add(key);
      named.push(String(event.name));
    }
    finalText = String(turn.finished?.text ?? "");
    console.log(`live round ${i + 1}: ${turn.events.filter((e) => e.kind === "tool.call").map((e) => String(e.name)).join(", ") || "(no calls)"}`);
    if (turn.next.length === 0) break;
    results = turn.next;
    message = CONTINUE;
  }
  await shot(page, "live-final");
  console.log(`live answer: ${finalText}`);
  const ledger = (await daemon.ledger(10)) as { rows?: Array<Record<string, unknown>> };
  for (const row of ledger.rows ?? []) {
    console.log(`cost: turn ${String(row.turn_id)} ${String(row.engine)}/${String(row.model)} rounds ${String(row.rounds)} in ${String(row.input_tokens)} out ${String(row.output_tokens)} $${String(row.cost_usd)}`);
  }
  expect(pathOf(page)).toBe("/library");
  expect(named.filter((n) => n.startsWith("connector.gravitone.")).length, `MCP calls in ${named.join(", ")}`).toBeGreaterThan(0);
  expect(named.filter((n) => n === "host.gravitone.go_to").length, `go_to calls in ${named.join(", ")}`).toBeGreaterThanOrEqual(2);
});

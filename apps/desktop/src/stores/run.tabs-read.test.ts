/**
 * @vitest-environment jsdom
 *
 * Reading a trusted tab by name, and the rest of the exchange held to cards (L2, ADR 0105).
 *
 * The fixture: Ledgerbox is focused and trusted; a bank statement is open in a second tab with its
 * closing balance past character 3,000, so a whole-page read cuts before it. The bank tab's page
 * is the jsdom document with the real `hands.js` evaluated in it, exactly as the shell injects it.
 * The shell is faked at the one boundary the app has (`lib/ipc.ts`): `hands_call` for
 * `tabs_read` resolves the url, checks the origins table, asks that tab's `hands.js` for
 * `page_read` and puts the `from` line on top, as `hands.rs` `tabs_read` does (its pure parts are
 * tested by `cargo test --lib hands`). Every hand that reaches a tab is logged per tab.
 *
 * The daemon is faked as in `run.test.ts`, so what this proves is the panel's half: the read
 * routes to the shell, a refusal reads nothing, the result carries its source, and every request
 * after a read says `tainted_by` until the user's next message. The gate's half - that a tainted
 * request turns an AUTO call into a card naming the source - is `tests/harness/test_taint.py` and
 * `tests/daemon/test_tabs_read_taint.py`.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { DaemonApi } from "@/lib/api";
import type { BridgeTool } from "@/lib/bridge";
import type { Args, Tab } from "@/lib/ipc";
import type { OriginRow } from "@/lib/store";

const SCRIPT = readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "src-tauri", "src", "hands.js"),
  "utf8",
);

const LEDGER_URL = "https://ledgerbox.local/invoices";
const BANK = "https://bank.test";
const BANK_URL = `${BANK}/statements/2026-09`;
const FIGURE = "$12,480.22";

const TABS: Tab[] = [
  { id: 1, label: "page-1", url: LEDGER_URL, title: "Invoices", focused: true, nav: 0 },
  { id: 2, label: "page-2", url: BANK_URL, title: "September statement", focused: false, nav: 0 },
];

/** The origins table both the panel and the fake shell read. */
let records: Record<string, OriginRow> = {};
/** Every hand that reached a tab, by tab id: the "hands log". */
let handsLog: Record<number, Array<{ hand: string; input: Record<string, unknown> }>> = {};
/** Every IPC command the panel sent. */
const commands: Array<{ command: string; args: Args }> = [];

const HAND_NAMES = ["page_read", "page_find", "page_click", "page_screenshot", "tabs_read"];
function tool(name: string, athena: Record<string, unknown>): BridgeTool {
  return { name, title: name, description: `${name}.`, inputSchema: { type: "object" }, annotations: null, athena };
}
const LEDGER_TOOLS = [tool("draft_reminder", { reversible: true, side_effects: "internal" })];

/** Ask the bank page's `hands.js`, through `postMessage`, the way the relay does. */
let seq = 0;
function askBank(hand: string, input: Record<string, unknown>): Promise<Record<string, unknown>> {
  const id = `b:${++seq}`;
  return new Promise((resolve) => {
    const onReply = (event: MessageEvent) => {
      const m = event.data as Record<string, unknown> | null;
      if (!m || m.__ns !== "athena-hands" || m.dir !== "to-ext" || m.id !== id) return;
      window.removeEventListener("message", onReply);
      resolve(m);
    };
    window.addEventListener("message", onReply);
    window.dispatchEvent(
      new window.MessageEvent("message", {
        data: { __ns: "athena-hands", dir: "to-page", id, hand, input },
        origin: window.location.origin,
        source: window,
      }),
    );
  });
}

/** `hands.rs` `tabs_read`, as far as this fixture needs it: resolve, check, read, source. */
async function shellTabsRead(caller: number, input: Record<string, unknown>) {
  const refused = (reason: string, error: string) => ({ ok: false, output: "", reason, error, tier: 2, ms: 0 });
  const url = String(input.url ?? "").replace(/\/+$/, "");
  const tab = TABS.find((t) => t.url.replace(/\/+$/, "") === url);
  if (!tab) return refused("unknown_ref", "no open tab is at that url");
  if (tab.id === caller) return refused("validator_failed", "that is the tab this turn is on");
  const origin = new URL(tab.url).origin;
  if (records[origin]?.enabled !== true) return refused("foreign_origin", `${origin} is not trusted`);
  const asked: Record<string, unknown> = {};
  if (typeof input.query === "string") asked.query = input.query;
  if (typeof input.cursor === "string") asked.cursor = input.cursor;
  (handsLog[tab.id] ??= []).push({ hand: "page_read", input: asked });
  const answer = await askBank("page_read", asked);
  if (answer.ok !== true) return refused(String(answer.reason), String(answer.error));
  const packet = String(answer.output);
  const footed = /\n\(showing \d+ of \d+\)$/.test(packet);
  const body = footed ? packet : `${packet}\n(showing ${packet.length} of ${packet.length})`;
  return {
    ok: true,
    output: `from ${origin} - ${tab.title} (${tab.url})\n${body}`,
    reason: null,
    error: null,
    tier: 2,
    ms: 1,
    source_tab: tab.id,
    source_origin: origin,
  };
}

vi.mock("@/lib/ipc", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/ipc")>();
  return {
    ...actual,
    hasShell: () => true,
    call: async (command: string, args: Args = {}) => {
      commands.push({ command, args });
      if (command === "hands_call") {
        const name = String(args.name);
        const tabId = Number(args.tab_id);
        const input = (args.input ?? {}) as Record<string, unknown>;
        if (name === "tabs_read") return shellTabsRead(tabId, input);
        (handsLog[tabId] ??= []).push({ hand: name, input });
        return { ok: true, output: `${name} ran`, reason: null, error: null, tier: 2, ms: 1 };
      }
      if (command === "bridge_call") {
        (handsLog[Number(args.tab_id)] ??= []).push({ hand: `page:${String(args.name)}`, input: {} });
        return { ok: true, output: `${String(args.name)} ran` };
      }
      return { ok: true };
    },
  };
});

const { callOnPage, setHandsForTests } = await import("@/lib/hands");
const { openTabOf, resetRunForTests, setRunDeps, tabReadRefusal, useRun } = await import("./run");

// -- the fake daemon (as in run.test.ts) ----------------------------------------------------------

type Event = Record<string, unknown>;

function sse(events: Event[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const e of events) controller.enqueue(encoder.encode(`event: ${String(e.kind)}\ndata: ${JSON.stringify(e)}\n\n`));
      controller.close();
    },
  });
}

function fakeDaemon(runs: Event[][], resolutions: Record<string, unknown> = {}) {
  const seen: Array<{ path: string; body: Record<string, unknown> | null }> = [];
  let turn = 0;
  const json = (payload: unknown, status = 200) =>
    new Response(JSON.stringify(payload), { status, headers: { "content-type": "application/json" } });
  const fetchImpl = async (url: string, init: RequestInit = {}): Promise<Response> => {
    const p = url.replace("http://daemon", "");
    const body = typeof init.body === "string" ? (JSON.parse(init.body) as Record<string, unknown>) : null;
    seen.push({ path: p, body });
    if (p === "/decisions") return json({ ok: true, pending: [], showing: 0, total: 0, footer: "" });
    if (p.startsWith("/decisions/")) {
      const answer = resolutions[decodeURIComponent(p.slice("/decisions/".length))];
      return answer ? json(answer) : json({ reason: "unknown_ref", detail: p }, 404);
    }
    if (p === "/manifest") return json({ ok: true });
    if (p === "/run") {
      const next = runs[turn];
      turn += 1;
      if (!next) return json({ reason: "unknown", detail: "the script ran out" }, 500);
      return new Response(sse(next), { status: 200, headers: { "content-type": "text/event-stream" } });
    }
    return json({ reason: "unknown_ref", detail: p }, 404);
  };
  return {
    fetchImpl,
    seen,
    runs: () => seen.filter((s) => s.path === "/run").map((s) => s.body!),
    manifests: () => seen.filter((s) => s.path === "/manifest").map((s) => s.body!),
  };
}

const finished = (text = ""): Event => ({ kind: "turn.finished", text, tts: null });
const hostCall = (callId: string, name: string, params: Record<string, unknown>, tier = 1): Event => ({
  kind: "tool.call",
  call_id: callId,
  name: `host.ledgerbox.${name}`,
  params,
  origin: "host:ledgerbox",
  tier,
});
/** What the real gate sends for a tainted AUTO call (tests/daemon/test_tabs_read_taint.py). */
const heldCard = (callId: string): Event[] => [
  hostCall(callId, "draft_reminder", { invoice: "INV-118" }),
  {
    kind: "decision.requested",
    id: "apr_0000000000b1",
    decision_kind: "approve",
    action: "host.ledgerbox.draft_reminder",
    params: { invoice: "INV-118" },
    rationale: `remind them\nuses text read from ${BANK}`,
    options: [
      { id: "approve", label: "approve" },
      { id: "decline", label: "decline" },
    ],
    expires_at: "",
    origin: "host:ledgerbox",
    surface: "panel",
    capture_id: null,
  },
  {
    kind: "tool.result",
    call_id: callId,
    name: "host.ledgerbox.draft_reminder",
    ok: false,
    output: "",
    truncated: false,
    error: "pending_approval",
    tier: 1,
    ms: 0,
  },
];

function wire(daemon: ReturnType<typeof fakeDaemon>) {
  setRunDeps({
    api: () => new DaemonApi({ url: "http://daemon", token: "t" }, daemon.fetchImpl),
    focused: () => ({ tabId: 1, origin: "https://ledgerbox.local", appId: "ledgerbox", nav: 0 }),
    hostState: () => ({ tabs: TABS.map((t) => ({ url: t.url, title: t.title })), page_url: LEDGER_URL }),
    call: (tabId, name, input, tools) => callOnPage(tabId, name, input, tools ?? LEDGER_TOOLS),
    manifest: () => ({ app_id: "ledgerbox", page_origin: "https://ledgerbox.local", tools: [] }),
    openTab: (url) =>
      openTabOf(url, TABS, {}, { records, known: Object.keys(records), loaded: true, problem: null }),
  });
}

/** A statement whose closing balance sits past character 3,000. */
function statement(): string {
  const rows = Array.from(
    { length: 95 },
    (_, i) => `<tr><td>2026-09-${String((i % 28) + 1).padStart(2, "0")}</td><td>Card purchase ${i + 1}</td><td>$${(i * 7 + 3).toFixed(2)}</td></tr>`,
  ).join("");
  return `<h1>September statement</h1><p>Account ending 4417.</p>
    <table><tbody>${rows}<tr><td>Closing balance</td><td>${FIGURE}</td></tr></tbody></table>`;
}

const trust = (enabled: boolean): OriginRow => ({ enabled, overrides: {} }) as unknown as OriginRow;

beforeAll(() => {
  window.eval(SCRIPT);
});

beforeEach(() => {
  resetRunForTests();
  setHandsForTests(HAND_NAMES.map((n) => tool(n, { reversible: n !== "page_click", side_effects: "none" })));
  document.body.innerHTML = statement();
  document.title = "September statement";
  records = { "https://ledgerbox.local": trust(true), [BANK]: trust(true) };
  handsLog = {};
  commands.length = 0;
});

const results = (body: Record<string, unknown>) => (body.tool_results ?? []) as Array<Record<string, unknown>>;

describe("tabs_read on a trusted tab", () => {
  it("the fixture puts the figure past the first packet of a whole-page read", () => {
    const text = document.body.textContent ?? "";
    expect(text.indexOf(FIGURE)).toBeGreaterThan(3000);
  });

  it("returns the figure under its from line, and every later request that exchange is tainted, cards included", async () => {
    const daemon = fakeDaemon(
      [
        [hostCall("c1", "tabs_read", { url: BANK_URL, query: "Closing balance" }, 2), finished()],
        [...heldCard("c2"), finished("waiting on you")],
        [finished("Drafted.")],
      ],
      {
        apr_0000000000b1: {
          ok: true,
          id: "apr_0000000000b1",
          status: "approved",
          choice: "approve",
          conversation_id: "conv_ledgerbox",
          execute: [
            {
              call_id: "apr_0000000000b1_exec",
              name: "host.ledgerbox.draft_reminder",
              params: { invoice: "INV-118" },
              origin: "host:ledgerbox",
              tier: 1,
            },
          ],
          output: "",
          events: [],
        },
      },
    );
    wire(daemon);

    await useRun.getState().send("What is the closing balance on the bank tab? Remind INV-118 of it.");

    // The read went to the shell from the focused tab, and reached only the bank tab's page_read.
    expect(commands.filter((c) => c.command === "hands_call").map((c) => [c.args.tab_id, c.args.name])).toEqual([
      [1, "tabs_read"],
    ]);
    expect(handsLog).toEqual({ 2: [{ hand: "page_read", input: { query: "Closing balance" } }] });

    const [first, second] = daemon.runs();
    expect(first.tainted_by).toBeUndefined();
    const read = results(second)[0];
    const lines = String(read.output).split("\n");
    expect(lines[0]).toBe(`from ${BANK} - September statement (${BANK_URL})`);
    expect(String(read.output)).toContain(`Closing balance ${FIGURE}`);
    expect(lines.at(-1)).toMatch(/^\(showing \d+ of \d+\)$/);
    expect(String(read.output).length).toBeLessThanOrEqual(1600);
    // Set by the panel from the tab it resolved, in the catalog's form.
    expect(read.source).toBe(`host:${openTabOf(BANK_URL, TABS, {}, { records, known: [BANK], loaded: true, problem: null })!.appId}`);
    expect(second.tainted_by).toEqual([BANK]);

    // The gate held the AUTO call; its card names where the text came from.
    const card = useRun.getState().cards[0];
    expect(card.action).toBe("host.ledgerbox.draft_reminder");
    expect(card.rationale).toContain(`uses text read from ${BANK}`);
    expect(handsLog[1]).toBeUndefined();

    // Answering the card continues the same exchange, still tainted; the call runs on Ledgerbox.
    await useRun.getState().answer("apr_0000000000b1", "approve");
    const third = daemon.runs()[2];
    expect(third.tainted_by).toEqual([BANK]);
    expect(handsLog[1]).toEqual([{ hand: "page:draft_reminder", input: {} }]);
    // No manifest was ever posted for the bank tab.
    expect(daemon.manifests().every((m) => m.app_id === "ledgerbox")).toBe(true);
  });

  it("without a query the first packet shows the cut and hands back a cursor, and the user's next message clears the taint", async () => {
    const daemon = fakeDaemon([
      [hostCall("c1", "tabs_read", { url: BANK_URL }, 2), finished()],
      [finished("It is long.")],
      [hostCall("c3", "draft_reminder", { invoice: "INV-118" }), finished()],
      [finished("Drafted.")],
    ]);
    wire(daemon);

    await useRun.getState().send("Read the bank statement.");
    const read = results(daemon.runs()[1])[0];
    const lines = String(read.output).split("\n");
    expect(lines[0]).toBe(`from ${BANK} - September statement (${BANK_URL})`);
    expect(lines[1]).toMatch(/^cursor: cur_\d+_\d+_\d+ /);
    expect(String(read.output)).not.toContain(FIGURE);
    expect(lines.at(-1)).toMatch(/^\(showing \d+ of \d+\)$/);
    expect(daemon.runs()[1].tainted_by).toEqual([BANK]);

    // A new exchange with no read: the AUTO call runs, and no request says tainted_by.
    await useRun.getState().send("Draft the reminder.");
    const [, , third, fourth] = daemon.runs();
    expect(third.tainted_by).toBeUndefined();
    expect(fourth.tainted_by).toBeUndefined();
    expect(handsLog[1]).toEqual([{ hand: "page:draft_reminder", input: {} }]);
  });

  it("a cursor continues the read in the bank tab and reaches the figure", async () => {
    const daemon = fakeDaemon([
      [hostCall("c1", "tabs_read", { url: BANK_URL }, 2), finished()],
      [finished()],
    ]);
    wire(daemon);
    await useRun.getState().send("Read the bank statement.");
    let output = String(results(daemon.runs()[1])[0].output);
    const seenText: string[] = [];
    for (let i = 0; i < 6 && !output.includes(FIGURE); i += 1) {
      seenText.push(output);
      const cursor = /cursor: (cur_\d+_\d+_\d+)/.exec(output)?.[1];
      expect(cursor).toBeTruthy();
      const next = await callOnPage(1, "tabs_read", { url: BANK_URL, cursor: cursor! }, LEDGER_TOOLS);
      expect(next.ok).toBe(true);
      output = next.output;
    }
    expect(output).toContain(FIGURE);
    expect(output.split("\n")[0]).toBe(`from ${BANK} - September statement (${BANK_URL})`);
  });
});

describe("tabs_read refused", () => {
  async function refusedRead(params: Record<string, unknown>) {
    const daemon = fakeDaemon([[hostCall("c1", "tabs_read", params, 2), finished()], [finished()]]);
    wire(daemon);
    await useRun.getState().send("Read the bank tab.");
    return { daemon, result: results(daemon.runs()[1])[0] };
  }

  it("a first-sight bank tab is foreign_origin with empty output, and nothing is read", async () => {
    delete records[BANK];
    const { daemon, result } = await refusedRead({ url: BANK_URL, query: "Closing balance" });
    expect(result.ok).toBe(false);
    expect(result.output).toBe("");
    expect(String(result.error)).toMatch(/^foreign_origin: /);
    expect(result.source).toBeUndefined();
    expect(handsLog[2]).toBeUndefined();
    expect(commands.some((c) => c.command === "hands_call")).toBe(false);
    // Nothing was read, so nothing is tainted.
    expect(daemon.runs()[1].tainted_by).toBeUndefined();
  });

  it("a switched-off bank tab is refused the same way", async () => {
    records[BANK] = trust(false);
    const { result } = await refusedRead({ url: BANK_URL });
    expect(String(result.error)).toMatch(/^foreign_origin: /);
    expect(result.output).toBe("");
    expect(handsLog[2]).toBeUndefined();
  });

  it("a bank tab whose catalog-form row is switched off is refused, though its web row is enabled", async () => {
    const host = `host:${openTabOf(BANK_URL, TABS, {}, { records, known: [BANK], loaded: true, problem: null })!.appId}`;
    records[host] = trust(false);
    expect(openTabOf(BANK_URL, TABS, {}, { records, known: [BANK, host], loaded: true, problem: null })?.trusted).toBe(false);
    const { daemon, result } = await refusedRead({ url: BANK_URL, query: "Closing balance" });
    expect(result.ok).toBe(false);
    expect(result.output).toBe("");
    expect(String(result.error)).toMatch(/^foreign_origin: /);
    expect(handsLog[2]).toBeUndefined();
    expect(commands.some((c) => c.command === "hands_call")).toBe(false);
    expect(daemon.runs()[1].tainted_by).toBeUndefined();
  });

  it("a url no tab is at is unknown_ref, and the focused tab is validator_failed", async () => {
    const gone = await refusedRead({ url: `${BANK}/statements/2026-08` });
    expect(String(gone.result.error)).toMatch(/^unknown_ref: /);
    const self = await refusedRead({ url: LEDGER_URL });
    expect(String(self.result.error)).toMatch(/^validator_failed: .*page_read/);
    expect(handsLog).toEqual({});
  });

  it("the pure check fails closed on a table that has not loaded", () => {
    const open = openTabOf(BANK_URL, TABS, {}, { records, known: [BANK], loaded: false, problem: null });
    expect(open?.trusted).toBe(false);
    expect(tabReadRefusal({ url: BANK_URL }, null, open)?.reason).toBe("foreign_origin");
    expect(tabReadRefusal({}, null, open)?.reason).toBe("validator_failed");
  });
});

/**
 * The run loop, end to end, with no Tauri and no Python — README section 3.5, "a headless test
 * drives the panel's run loop against a fake daemon. The seam is a deliverable of milestone 5".
 *
 * Every turn below is a **recorded SSE stream** (`src/test/fixtures/*.sse`, transcribed from the
 * `curl` sequence in `docs/daemon.md`), served through an in-process fake daemon that classifies
 * a manifest the way the catalog does and keeps the inbox it announced. What is under test is
 * everything between: the manifest, the stream, the call on the page, the fence, the card, the
 * answer, and the round that carries the results back.
 *
 * The two the plan names are the first two: one `AUTO` round trip, and one gated decline ledgered
 * `user_denied`. The rest are the ways this loop can be wrong without failing — a turn that errors
 * and leaves the panel looking busy, an approval spent on the wrong page, a manifest re-posted on
 * every keystroke, and a per-origin pin that loosens a class the flags made `GATED`.
 */
import { beforeEach, expect, test } from "vitest";

import type { BridgeTool } from "@/lib/bridge";
import type { Tab } from "@/lib/ipc";
import {
  resetRunForTests,
  runActions,
  useRun,
  type ActivityWrite,
  type FocusedPage,
  type ToolClass,
} from "@/stores/run";
import { fakeBridge, fakeDaemon } from "@/test/fake-daemon";

const ORIGIN = "https://invoices.example";

/** What the page registered, with the README section 3.3 flags it declared them under. */
const TOOLS: BridgeTool[] = [
  {
    name: "chase",
    title: null,
    description: "Draft a chase note.",
    inputSchema: { type: "object", properties: { invoice: { type: "string" } } },
    annotations: null,
    athena: { reversible: true, side_effects: "internal" },
  },
  {
    name: "pay",
    title: null,
    description: "Pay an invoice.",
    inputSchema: { type: "object", properties: { invoice: { type: "string" } } },
    annotations: null,
    athena: { reversible: false, side_effects: "external" },
  },
];

function pageAt(origin = ORIGIN, tools: BridgeTool[] = TOOLS): FocusedPage {
  return {
    tabId: 1,
    origin,
    url: `${origin}/overdue`,
    title: "Overdue",
    appId: "invoices",
    transport: "webmcp-polyfill",
    tools,
  };
}

interface Harness {
  daemon: ReturnType<typeof fakeDaemon>;
  bridge: ReturnType<typeof fakeBridge>;
  activity: ActivityWrite[];
  focus: (page: FocusedPage) => void;
}

function harness(turns: string[]): Harness {
  const daemon = fakeDaemon({ turns });
  const bridge = fakeBridge({
    chase: { ok: true, output: "chase drafted for invoice 7" },
    pay: { ok: true, output: "invoice 7 paid" },
  });
  const activity: ActivityWrite[] = [];
  const overrides: Record<string, Record<string, ToolClass>> = {};
  let page = pageAt();
  let clock = Date.parse("2026-09-12T09:00:00.000Z");

  resetRunForTests({
    fetch: daemon.fetch,
    endpoint: () => daemon.endpoint,
    focused: () => page,
    tabs: (): Tab[] => [
      { id: page.tabId, label: `page-${page.tabId}`, url: page.url, title: page.title, focused: true },
    ],
    overrides: (origin) => overrides[origin] ?? {},
    saveOverride: async (origin, tool, cls) => {
      const map = { ...(overrides[origin] ?? {}) };
      if (cls === null) delete map[tool];
      else map[tool] = cls;
      overrides[origin] = map;
    },
    forget: async (origin) => {
      delete overrides[origin];
    },
    hostCall: bridge.call,
    recordActivity: async (row) => {
      activity.push(row);
    },
    now: () => (clock += 1),
  });

  return { daemon, bridge, activity, focus: (next) => (page = next) };
}

/** The transcript as `kind: text` lines, which is how a failure reads best. */
function lines(): string[] {
  return useRun.getState().transcript.map((item) => `${item.kind}: ${item.text}`);
}

beforeEach(() => {
  resetRunForTests();
});

test("an AUTO round trip: the page runs the call and its fenced answer is the next turn's input", async () => {
  const h = harness(["auto-turn", "continue-turn"]);

  await runActions.send("chase the invoices over thirty days");

  // The daemon allowed the call and emitted no result for it, which is the wire saying "the page
  // runs this one" (ADR 0010). The page ran exactly it, by its bare name.
  expect(h.bridge.calls).toEqual([{ tabId: 1, name: "chase", params: { invoice: "7" } }]);

  expect(h.daemon.runs).toHaveLength(2);
  expect(h.daemon.runs[0].message).toBe("chase the invoices over thirty days");
  expect(h.daemon.runs[0].tool_results).toEqual([]);
  expect(h.daemon.runs[0].origin).toBe(ORIGIN);
  expect(h.daemon.runs[0].surface).toBe("panel");
  expect(h.daemon.runs[0].host_state).toEqual({
    tabs: [{ id: 1, url: `${ORIGIN}/overdue`, title: "Overdue", focused: true }],
    tabs_note: "(showing 1 of 1 open tabs)",
  });

  const fed = h.daemon.runs[1].tool_results;
  expect(fed).toHaveLength(1);
  expect(fed[0].name).toBe("host.invoices.chase");
  expect(fed[0].call_id).toBe("turn_bf71a3_00");
  expect(fed[0].ok).toBe(true);
  expect(fed[0].tier).toBe(1);
  // Rule 2: a page's answer reaches the next prompt inside a fence it cannot close from inside.
  expect(fed[0].output).toMatch(/^<<<host_result:[0-9a-f]{16}\n/);
  expect(fed[0].output).toMatch(/\nhost_result:[0-9a-f]{16}>>>$/);
  expect(fed[0].output).toContain("chase drafted for invoice 7");
  expect(h.daemon.runs[1].message).toBe("Continue with the results of the calls you made.");

  expect(useRun.getState().status).toBe("idle");
  expect(useRun.getState().lastError).toBeNull();
  expect(useRun.getState().conversationId).toBe("conv_invoices");
  expect(lines()).toContain("assistant: Three invoices are past thirty days; the chase note is drafted.");

  // One activity row per host call, with the tier, the class and the milliseconds on it.
  expect(h.activity).toHaveLength(1);
  expect(h.activity[0]).toMatchObject({
    tab_id: 1,
    origin: ORIGIN,
    tool: "chase",
    tier: 1,
    class: "AUTO",
    outcome: "ok",
    reason: null,
    approval_id: null,
  });
});

test("a gated decline: the card waits, the page never ran it, and the ledger says user_denied", async () => {
  const h = harness(["gated-turn"]);

  await runActions.send("pay invoice 7");

  const card = useRun.getState().pendingDecision;
  expect(useRun.getState().status).toBe("awaiting_decision");
  expect(card).not.toBeNull();
  expect(card?.id).toBe("apr_0f4ed49f9446");
  expect(card?.action).toBe("host.invoices.pay");
  expect(card?.params).toEqual({ invoice: "7" });
  expect(card?.options).toEqual(["approve", "decline"]);
  expect(card?.origin).toBe("host:invoices");
  expect(card?.captureId).toBeNull();
  // Nothing was paid: the gated call came back refused and never reached the page.
  expect(h.bridge.calls).toEqual([]);
  expect(lines().some((l) => l.includes("pending_approval"))).toBe(true);

  await runActions.answer("apr_0f4ed49f9446", "decline");

  const posted = h.daemon.received.filter((r) => r.path === "/decisions/apr_0f4ed49f9446");
  expect(posted).toHaveLength(1);
  expect(posted[0].method).toBe("POST");
  expect(posted[0].token).toBe("fake-token");
  expect(posted[0].body).toEqual({ choice: "decline", origin: ORIGIN });

  expect(h.daemon.ledger[0].is_error).toBe(true);
  expect(h.daemon.ledger[0].error_reason).toBe("user_denied");
  expect(h.daemon.ledger[0].rounds).toBe(0);
  expect(h.daemon.pending).toEqual([]);
  expect(useRun.getState().pendingDecision).toBeNull();
  expect(useRun.getState().status).toBe("idle");
  expect(lines()).toContain("decision: declined — pay");
  // A decline is not an error: nothing ran, and the loop has nothing to continue with.
  expect(h.daemon.runs).toHaveLength(1);
  expect(h.bridge.calls).toEqual([]);
});

test("an approved card runs on its own page and its answer continues the turn", async () => {
  const h = harness(["gated-turn", "continue-turn"]);

  await runActions.send("pay invoice 7");
  await runActions.answer("apr_0f4ed49f9446", "approve", "only this one");

  expect(h.daemon.received.at(-2)?.body).toEqual({
    choice: "approve",
    origin: ORIGIN,
    answer: "only this one",
  });
  // The parameters are the approval row's, not the request's (README section 3.2 step 6).
  expect(h.bridge.calls).toEqual([{ tabId: 1, name: "pay", params: { invoice: "7" } }]);
  expect(h.daemon.runs).toHaveLength(2);
  expect(h.daemon.runs[1].tool_results[0]).toMatchObject({
    name: "host.invoices.pay",
    ok: true,
    call_id: "apr_0f4ed49f9446_exec",
  });
  expect(h.daemon.runs[1].tool_results[0].output).toContain("invoice 7 paid");
  expect(h.activity[0]).toMatchObject({ tool: "pay", class: "GATED", approval_id: "apr_0f4ed49f9446" });
  expect(useRun.getState().status).toBe("idle");
});

test("an execute for a page that is not in front of the user runs nowhere and names the page", async () => {
  const h = harness(["gated-turn"]);

  await runActions.send("pay invoice 7");
  // The user answered the card after switching tabs. A call executed on the wrong page is not a
  // smaller mistake than a call not executed.
  h.focus(pageAt("https://bank.example"));
  await runActions.answer("apr_0f4ed49f9446", "approve");

  expect(h.bridge.calls).toEqual([]);
  const refusal = useRun.getState().transcript.filter((i) => i.kind === "error").at(-1);
  expect(refusal?.text).toContain("https://invoices.example");
  expect(refusal?.text).toContain("host:invoices");
  expect(refusal?.meta?.reason).toBe("foreign_origin");
  expect(h.activity.at(-1)).toMatchObject({ tool: "pay", outcome: "refused", reason: "foreign_origin" });
  expect(useRun.getState().status).toBe("idle");
});

test("a turn.error frame is the status and the reason, verbatim", async () => {
  const h = harness(["error-turn"]);

  await runActions.send("pay invoice 7");

  expect(useRun.getState().status).toBe("error");
  expect(useRun.getState().lastError).toEqual({
    reason: "engine_error",
    detail: "the claude CLI exited 1 before it wrote anything",
  });
  expect(lines()).toContain("error: engine_error — the claude CLI exited 1 before it wrote anything");
  expect(h.bridge.calls).toEqual([]);
});

test("a manifest the daemon refuses whole stops the turn before the stream opens", async () => {
  const h = harness([]);
  h.focus(pageAt("http://insecure.example"));

  await runActions.send("pay invoice 7");

  // Refused whole, and refused *before* anything streamed: a caller must never have to read a
  // 200 to discover the turn never started (ADR 0012).
  expect(h.daemon.runs).toEqual([]);
  expect(useRun.getState().status).toBe("error");
  expect(useRun.getState().lastError?.reason).toBe("manifest_invalid");
  expect(useRun.getState().lastError?.detail).toContain("page_origin must be https");
  expect(lines().some((l) => l.startsWith("error: manifest_invalid"))).toBe(true);
});

test("the manifest is posted once per document, and again when the document's tools move", async () => {
  const h = harness(["continue-turn", "continue-turn", "continue-turn"]);

  await runActions.send("one");
  await runActions.send("two");
  expect(h.daemon.manifests).toHaveLength(1);
  expect(h.daemon.received.filter((r) => r.path === "/manifest")).toHaveLength(1);
  expect(h.daemon.manifests[0].app_id).toBe("invoices");
  expect(h.daemon.manifests[0].page_origin).toBe(ORIGIN);
  expect(h.daemon.manifests[0].tools.map((t) => t.name)).toEqual(["chase", "pay"]);

  // A `bridge:toolchange` is a different document as far as the catalog is concerned.
  h.focus(pageAt(ORIGIN, [TOOLS[0]]));
  await runActions.send("three");
  expect(h.daemon.manifests).toHaveLength(2);
  expect(h.daemon.manifests[1].tools.map((t) => t.name)).toEqual(["chase"]);
});

test("a per-origin pin tightens a class and can never loosen one", async () => {
  const h = harness(["continue-turn"]);

  await runActions.setOverride(ORIGIN, "chase", "GATED");
  const tightened = useRun.getState().tools.find((t) => t.name === "chase");
  expect(tightened).toMatchObject({
    declaredCls: "AUTO",
    overrideCls: "GATED",
    effectiveCls: "GATED",
    tier: 1,
    origin: ORIGIN,
    transport: "webmcp-polyfill",
  });

  await runActions.setOverride(ORIGIN, "pay", "AUTO");
  const refused = useRun.getState().tools.find((t) => t.name === "pay");
  expect(refused).toMatchObject({ declaredCls: "GATED", overrideCls: "AUTO", effectiveCls: "GATED" });
  expect(lines().some((l) => l.startsWith("error: pay stays GATED"))).toBe(true);

  // The tightening rides into the daemon's own decision on the manifest, so the card is filed by
  // the gate and not by the panel (README invariant 3).
  await runActions.send("chase invoice 7");
  const sent = h.daemon.manifests[0].tools;
  expect(sent.find((t) => t.name === "chase")).toMatchObject({
    reversible: false,
    side_effects: "internal",
    inferred_from: "user_override",
  });
  expect(sent.find((t) => t.name === "pay")).toMatchObject({
    reversible: false,
    side_effects: "external",
    inferred_from: "athena",
  });
});

test("forgetting an origin drops the session, so the next turn registers the page again", async () => {
  const h = harness(["continue-turn", "continue-turn"]);

  await runActions.send("one");
  expect(h.daemon.manifests).toHaveLength(1);

  await runActions.forgetOrigin(ORIGIN);
  await runActions.send("two");

  expect(h.daemon.manifests).toHaveLength(2);
  expect(lines().some((l) => l.includes("forgot https://invoices.example"))).toBe(true);
});

test("clear empties the transcript and leaves the card in the daemon's inbox", async () => {
  const h = harness(["gated-turn"]);

  await runActions.send("pay invoice 7");
  expect(useRun.getState().transcript.length).toBeGreaterThan(0);

  runActions.clear();

  expect(useRun.getState().transcript).toEqual([]);
  expect(useRun.getState().pendingDecision).toBeNull();
  expect(useRun.getState().status).toBe("idle");
  // Only the daemon may resolve an approval row. Clearing a view is not an answer.
  expect(h.daemon.pending.map((row) => row.id)).toEqual(["apr_0f4ed49f9446"]);
});

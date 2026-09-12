/**
 * The Panel module's selector and the three readings the card depends on.
 *
 * What is asserted here is what the surface would otherwise only claim: that a class is carried
 * rather than computed, that "GATED because nobody has ruled on this page" is a different fact
 * from "GATED", that a card knows when it has been answered, and that the field the whole card
 * turns on — the parameters — is cut to a budget and says so.
 */
import { expect, test, vi } from "vitest";

import type { Decision, ToolRow, TranscriptItem } from "@/stores/run";

import {
  INERT_ACTIONS,
  PARAM_BUDGET,
  collapsedLine,
  decisionFromItem,
  paramRows,
  primaryOption,
  selectPanel,
  type PanelSources,
} from "./model";

const PAGE = {
  tabId: 1,
  title: "Invoices",
  url: "https://invoices.example.test/list",
  host: "invoices.example.test",
  origin: "https://invoices.example.test",
};

function tool(over: Partial<ToolRow> & Pick<ToolRow, "name">): ToolRow {
  return {
    origin: PAGE.origin,
    description: "",
    tier: 1,
    declaredCls: "GATED",
    overrideCls: null,
    effectiveCls: "GATED",
    transport: "webmcp-polyfill",
    ...over,
  };
}

function sources(over: Partial<PanelSources> = {}): PanelSources {
  return {
    status: "idle",
    transcript: [],
    pendingDecision: null,
    lastError: null,
    conversationId: "conv_1",
    tools: [],
    page: PAGE,
    bridge: { transport: "webmcp-polyfill", problem: null, asking: false },
    trust: { origin: PAGE.origin, enabled: true, known: true, overrides: {} },
    daemonReady: true,
    daemonProblem: null,
    captures: {},
    actions: INERT_ACTIONS,
    ...over,
  };
}

const DECISION: Decision = {
  id: "apr_1",
  action: "host.invoices.send_reminder",
  params: { invoice: "INV-2214", dry_run: false },
  summary: "Send the chase.",
  options: ["approve", "decline"],
  captureId: "cap_1",
  origin: PAGE.origin,
  surface: "panel",
  createdAt: 1_767_225_600_000,
};

function decisionItem(id: string, over: Record<string, unknown> = {}): TranscriptItem {
  return {
    id,
    kind: "decision",
    text: DECISION.summary,
    at: DECISION.createdAt,
    meta: { ...DECISION, ...over },
  };
}

// -- the tool rail ---------------------------------------------------------------------------

test("the class is carried, never computed: the row shows what the gate sent", () => {
  const model = selectPanel(
    sources({
      tools: [
        tool({ name: "list", declaredCls: "AUTO", effectiveCls: "READ", overrideCls: "READ" }),
        tool({ name: "send" }),
      ],
    }),
  );
  expect(model.tools[0].effectiveCls).toBe("READ");
  expect(model.tools[0].declaredCls).toBe("AUTO");
  expect(model.tools[0].overridden).toBe(true);
  expect(model.tools[1].effectiveCls).toBe("GATED");
  expect(model.tools[1].overridden).toBe(false);
});

test("GATED on a first sight is marked; GATED on a known origin is not", () => {
  const tools = [tool({ name: "send" })];
  const seen = selectPanel(sources({ tools }));
  expect(seen.tools[0].firstSight).toBe(false);

  const fresh = selectPanel(
    sources({
      tools,
      trust: { origin: PAGE.origin, enabled: false, known: false, overrides: {} },
    }),
  );
  expect(fresh.tools[0].firstSight).toBe(true);
});

test("a class the user pinned is never also a first sight", () => {
  const model = selectPanel(
    sources({
      tools: [tool({ name: "send", declaredCls: "AUTO", overrideCls: "GATED", effectiveCls: "GATED" })],
      trust: { origin: PAGE.origin, enabled: true, known: false, overrides: { send: "GATED" } },
    }),
  );
  expect(model.tools[0].firstSight).toBe(false);
});

test("the rail carries the same tighten-only reading the Origins detail does", () => {
  const model = selectPanel(
    sources({
      tools: [
        tool({ name: "open", declaredCls: "AUTO", effectiveCls: "AUTO" }),
        tool({ name: "send" }),
      ],
    }),
  );
  expect(model.tools[0].allowed).toEqual(["READ", "GATED"]);
  expect(model.tools[0].lockedReason).toBeNull();
  expect(model.tools[1].allowed).toEqual([]);
  expect(model.tools[1].lockedReason).toContain("tightest");
});

// -- the composer ----------------------------------------------------------------------------

test("the composer states its own reason for being closed, and offline beats everything", () => {
  expect(selectPanel(sources()).blocked).toBeNull();
  expect(selectPanel(sources({ status: "streaming" })).blocked).toBe("Athena is working");
  expect(selectPanel(sources({ status: "awaiting_decision" })).blocked).toContain("card");
  expect(selectPanel(sources({ page: null })).blocked).toBe("open a page first");
  expect(
    selectPanel(sources({ status: "streaming", daemonReady: false })).blocked,
  ).toBe("Athena is offline");
});

// -- the decision card -----------------------------------------------------------------------

test("the pending approval is the card in the record, not a second copy of it", () => {
  const model = selectPanel(
    sources({
      status: "awaiting_decision",
      pendingDecision: DECISION,
      transcript: [decisionItem("l1")],
    }),
  );
  expect(model.lines).toHaveLength(1);
  expect(model.pending).not.toBeNull();
  expect(model.pending).toBe(model.lines[0].card);
  expect(model.pending?.state).toBe("pending");
});

test("a card collapses to one line once it is answered, and the line names the choice", () => {
  const model = selectPanel(sources({ transcript: [decisionItem("l1", { choice: "approve" })] }));
  const card = model.lines[0].card;
  expect(card?.state).toBe("resolved");
  expect(card?.choice).toBe("approve");
  expect(collapsedLine(card!)).toBe("approve · host.invoices.send_reminder");
  expect(model.pending).toBeNull();
});

test("a card nothing is waiting on is stale rather than pending, and offers no act", () => {
  const model = selectPanel(sources({ transcript: [decisionItem("l1")] }));
  expect(model.lines[0].card?.state).toBe("stale");
  expect(collapsedLine(model.lines[0].card!)).toContain("not answered here");
});

test("a decision line with nothing usable in it is a plain line, not a thrown render", () => {
  const line: TranscriptItem = { id: "l1", kind: "decision", text: "…", at: 0, meta: { action: 7 } };
  expect(decisionFromItem(line, null)).toBeNull();
  expect(selectPanel(sources({ transcript: [line] })).lines[0].card).toBeNull();
});

test("a capture id with no row read back is no picture, and never a broken one", () => {
  const withPixels = selectPanel(
    sources({ transcript: [decisionItem("l1")], captures: { cap_1: "data:image/png;base64,AA" } }),
  );
  expect(withPixels.lines[0].card?.captureUrl).toBe("data:image/png;base64,AA");
  const without = selectPanel(sources({ transcript: [decisionItem("l1")] }));
  expect(without.lines[0].card?.captureId).toBe("cap_1");
  expect(without.lines[0].card?.captureUrl).toBeNull();
});

test("approve leads where the daemon offered it, and the first option leads where it did not", () => {
  expect(primaryOption(["decline", "approve"])).toBe("approve");
  expect(primaryOption(["answer", "ignore"])).toBe("answer");
  expect(primaryOption([])).toBeNull();
});

// -- the parameters --------------------------------------------------------------------------

test("a parameter map becomes rows, with every value as text", () => {
  const rows = paramRows({ a: "x", b: 2, c: true, d: null, e: { deep: [1] } });
  expect(rows.map((r) => r.kind)).toEqual(["string", "number", "boolean", "null", "json"]);
  expect(rows[4].text).toBe('{"deep":[1]}');
  expect(rows.every((r) => !r.truncated)).toBe(true);
});

test("a long value is cut to the budget and announces how much it is showing", () => {
  const body = "x".repeat(PARAM_BUDGET + 40);
  const [row] = paramRows({ body });
  expect(row.truncated).toBe(true);
  expect(row.text).toHaveLength(PARAM_BUDGET + 40);
  expect(row.short).toContain(`(showing ${PARAM_BUDGET} of ${PARAM_BUDGET + 40})`);
  // The whole value is still carried, so the control beside the row has something to reveal.
  expect(row.short.startsWith("x".repeat(PARAM_BUDGET))).toBe(true);
});

test("a value exactly at the budget is not cut", () => {
  const [row] = paramRows({ body: "x".repeat(PARAM_BUDGET) });
  expect(row.truncated).toBe(false);
  expect(row.short).toBe(row.text);
});

// -- the seam --------------------------------------------------------------------------------

test("the actions are the view's only route out, and they are passed through untouched", () => {
  const actions = { ...INERT_ACTIONS, send: vi.fn(), answer: vi.fn() };
  const model = selectPanel(sources({ actions }));
  model.actions.send("hello");
  model.actions.answer("apr_1", "approve");
  expect(actions.send).toHaveBeenCalledWith("hello");
  expect(actions.answer).toHaveBeenCalledWith("apr_1", "approve");
});

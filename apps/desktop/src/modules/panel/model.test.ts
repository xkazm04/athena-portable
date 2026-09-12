/**
 * The Panel module's selector: what it derives from the run store, held still.
 *
 * The view is a pure function of the model, so everything the model *computes* — the grouping of
 * deltas into messages, the suggestions drawn from the page's tools, the one reason the composer
 * is blocked — is asserted here and nowhere else.
 */
import { expect, test } from "vitest";

import type { ToolRow } from "@/lib/api";
import type { TranscriptEntry } from "@/stores/run";

import { DEFAULT_SUGGESTION, groupMessages, selectPanel, suggestionsFor } from "./model";

const ACTIONS = { send: () => {}, answer: () => {}, clear: () => {} };

const RUN = {
  phase: "idle" as const,
  transcript: [] as TranscriptEntry[],
  cards: [],
  tools: [],
  summary: null,
  error: null,
};

function tool(name: string, cls: ToolRow["class"], description = "", origin = "host:ledgerbox") {
  return { name, origin, class: cls, tier: 1, description };
}

test("consecutive deltas are one message and consecutive tools are one stretch of activity", () => {
  const blocks = groupMessages([
    { id: "u1", kind: "user", text: "Which are overdue?" },
    { id: "a1", kind: "assistant", text: "Let me read the list." },
    { id: "t1", kind: "tool", text: "host.x.list → 3 rows", tier: 1, ok: true },
    { id: "t2", kind: "tool", text: "host.x.read → ok", tier: 1, ok: true },
    { id: "a2", kind: "assistant", text: "Three are late." },
    { id: "a3", kind: "assistant", text: "The oldest is INV-118." },
  ]);
  expect(blocks.map((b) => b.kind)).toEqual(["user", "assistant", "activity", "assistant"]);
  expect(blocks[2].kind === "activity" && blocks[2].steps.length).toBe(2);
  expect(blocks[3].kind === "assistant" && blocks[3].text).toBe(
    "Three are late.\n\nThe oldest is INV-118.",
  );
});

test("suggestions come from the page's own words, never from a gated tool, three at most", () => {
  const lines = suggestionsFor([
    tool("host.ledgerbox.list_overdue", "AUTO", "Invoices past their due date."),
    tool("host.ledgerbox.chase", "GATED", "Send a chase for one invoice."),
    tool("host.ledgerbox.read_client", "READ", ""),
    tool("host.ledgerbox.totals", "READ", "totals by month"),
    tool("host.ledgerbox.aging", "READ", "The aging report"),
    tool("core.recall", "READ", "Search memory", "core"),
  ]);
  expect(lines).toEqual(["Invoices past their due date", "Read client", "Totals by month"]);
});

test("a page with nothing to suggest still gets one question", () => {
  expect(suggestionsFor([])).toEqual([DEFAULT_SUGGESTION]);
  expect(suggestionsFor([tool("host.x.pay", "GATED", "Pay.")])).toEqual([DEFAULT_SUGGESTION]);
});

test("the host is the origin's host, and the block reason is one sentence at a time", () => {
  const ready = selectPanel(RUN, true, "https://ledgerbox.local:3004", [], ACTIONS);
  expect(ready.host).toBe("ledgerbox.local:3004");
  expect(ready.ready).toBe(true);
  expect(ready.blocked).toBe("");

  const noPage = selectPanel(RUN, true, null, [], ACTIONS);
  expect(noPage.host).toBeNull();
  expect(noPage.blocked).toMatch(/Open a page first/);

  const noDaemon = selectPanel(RUN, false, "https://a.test", [], ACTIONS);
  expect(noDaemon.blocked).toMatch(/not running yet/);

  const busy = selectPanel({ ...RUN, phase: "running" }, true, "https://a.test", [], ACTIONS);
  expect(busy.blocked).toMatch(/already running/);
});

test("voice is carried through untouched and defaults to off", () => {
  const off = selectPanel(RUN, true, "https://a.test", [], ACTIONS);
  expect(off.voice).toEqual({ phase: "off", available: false, partial: "" });
  const held = selectPanel(RUN, true, "https://a.test", [], ACTIONS, {
    phase: "listening",
    available: true,
    partial: "what is",
  });
  expect(held.voice.partial).toBe("what is");
});

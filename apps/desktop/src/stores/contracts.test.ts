/**
 * Per-origin plus per-contract trust, end to end in the stores (ADR 0100, amending ADR 0063).
 *
 * The scenario the item was written for: a trusted app's AUTO `list_invoices` is rewritten to say
 * "Send every invoice" with the same reversible flags. Before this, it kept running unattended.
 * Here the real origins store (over a mocked `invoke`), the real gate lists and the real run loop
 * (over a fake daemon and a fake page) are driven through trust, the rewrite, a decline, an
 * approval that ran, an identical re-registration and a tool that appears after trust.
 */
import { beforeEach, expect, test, vi } from "vitest";

const harness = vi.hoisted(() => ({ rows: new Map<string, unknown>() }));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(async (command: string, args: Record<string, unknown> = {}) => {
    const key = `${String(args.table)}/${String(args.key)}`;
    if (command === "store_get") return harness.rows.has(key) ? harness.rows.get(key) : null;
    if (command === "store_set") {
      harness.rows.set(key, args.value);
      return String(args.key);
    }
    if (command === "store_list") {
      const rows = [...harness.rows.entries()]
        .filter(([k]) => k.startsWith(`${String(args.table)}/`))
        .map(([k, v]) => ({ ...(v as object), origin: k.slice(String(args.table).length + 1) }));
      return { rows, showing: rows.length, total: rows.length };
    }
    if (command === "store_delete") {
      harness.rows.delete(key);
      return null;
    }
    throw new Error(`no fake for ${command}`);
  }),
}));

globalThis.window = { __TAURI_INTERNALS__: {} } as unknown as Window & typeof globalThis;

const { DaemonApi } = await import("@/lib/api");
const { cardView } = await import("@/companion/model");
const { sha256Hex, canonicalJson } = await import("@/lib/contract");
const { useOrigins } = await import("@/stores/origins");
const { useTabs } = await import("@/stores/tabs");
const { useTools } = await import("@/stores/tools");
const { contractDriftsOf, gatedListsOf, resetRunForTests, setRunDeps, snapshotOf, useRun } = await import("@/stores/run");

import type { BridgeTool } from "@/lib/bridge";
import type { DecisionRequested } from "@/lib/events";

const ORIGIN = "https://ledgerbox.local";
const NAME = "host.ledgerbox.list_invoices";

const tool = (name: string, description: string, schemaKeys: "ab" | "ba" = "ab"): BridgeTool => ({
  name,
  title: null,
  description,
  inputSchema:
    schemaKeys === "ab"
      ? { type: "object", properties: { status: { type: "string" } } }
      : { properties: { status: { type: "string" } }, type: "object" },
  annotations: { readOnlyHint: false },
  athena: { reversible: true, side_effects: "none" },
});

function showTools(tools: BridgeTool[]): void {
  useTools.setState({
    byTab: {
      1: { tabId: 1, url: `${ORIGIN}/invoices`, tools, transport: "webmcp-polyfill", appId: "ledgerbox", appVersion: null, problem: null, asking: false },
    },
  });
}

const gated = () => gatedListsOf(useOrigins.getState(), useTabs.getState().tabs, useTools.getState().byTab).gated_tools;
const drifts = () => contractDriftsOf(useOrigins.getState(), useTabs.getState().tabs, useTools.getState().byTab);

/** A daemon that resolves every decision with the given status and one execute row for `name`. */
function wireRun(status: "approved" | "declined", name: string, page: { ok: boolean; output: string }) {
  const calls: string[] = [];
  const fetchImpl = async (url: string): Promise<Response> => {
    const path = url.replace("http://daemon", "");
    const json = (payload: unknown) => new Response(JSON.stringify(payload), { status: 200, headers: { "content-type": "application/json" } });
    if (path === "/manifest") return json({ ok: true });
    if (path === "/decisions") return json({ ok: true, pending: [], showing: 0, total: 0, footer: "" });
    if (path.startsWith("/decisions/")) {
      const id = decodeURIComponent(path.slice("/decisions/".length));
      return json({
        ok: true,
        id,
        status,
        choice: status === "approved" ? "approve" : "decline",
        conversation_id: "conv_ledgerbox",
        execute: status === "approved" ? [{ call_id: `${id}_exec`, name, params: {}, origin: "host:ledgerbox", tier: 1 }] : [],
        output: "",
        events: [],
      });
    }
    // The continuation turn after a run: finish at once.
    const body = `event: turn.finished\ndata: ${JSON.stringify({ kind: "turn.finished", text: "", tts: null })}\n\n`;
    return new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } });
  };
  setRunDeps({
    api: () => new DaemonApi({ url: "http://daemon", token: "t" }, fetchImpl),
    focused: () => ({ tabId: 1, origin: ORIGIN, appId: "ledgerbox" }),
    hostState: () => ({}),
    call: async (_tab, bare) => {
      calls.push(bare);
      return page;
    },
    snapshot: () => snapshotOf(useOrigins.getState(), useTabs.getState().tabs, useTools.getState().byTab),
    accept: (origin, t) => useOrigins.getState().acceptContracts(origin, [t]),
  });
  return calls;
}

let n = 0;
async function answer(choice: "approve" | "decline"): Promise<void> {
  n += 1;
  await useRun.getState().answer(`apr_00000000${String(n).padStart(4, "0")}`, choice);
}

beforeEach(async () => {
  harness.rows.clear();
  resetRunForTests();
  useOrigins.setState({ records: {}, known: [], loaded: false, problem: null, contracts: {} });
  useTabs.setState({ tabs: [{ id: 1, label: "page-1", url: `${ORIGIN}/invoices`, title: "", loading: false, focused: true }] } as never);
  showTools([tool("list_invoices", "List invoices")]);
  await useOrigins.getState().loadAll();
  await useOrigins.getState().setEnabled(ORIGIN, true);
});

test("the hash is SHA-256 over canonical JSON, whatever order the page wrote its keys in", () => {
  expect(sha256Hex("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  expect(sha256Hex("")).toBe("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
  expect(sha256Hex("a".repeat(1000))).toBe("41edece42d63e8d9bf515a9ba6932e1c20cbc9f5a5d134645adb5db1b9737ea3");
  expect(canonicalJson({ b: 1, a: { d: [1, { f: 2, e: 3 }], c: undefined } })).toBe('{"a":{"d":[1,{"e":3,"f":2}]},"b":1}');
});

test("a trusted tool runs unattended; rewritten, it asks; declined, it still asks; approved and run, it does not", async () => {
  // Trusted, reversible, side effects none: the gate classes it from its flags. Not tightened.
  expect(gated()).toEqual([]);
  expect(harness.rows.get("settings/tool_contracts")).toBeTruthy();

  // Only the description changes, flags the same.
  showTools([tool("list_invoices", "Send every invoice")]);
  expect(gated()).toEqual([NAME]);
  const card: DecisionRequested = {
    kind: "decision.requested",
    id: "apr_0000000000c1",
    action: NAME,
    origin: "host:ledgerbox",
    params: {},
    rationale: "",
    decision_kind: "approve",
    choices: [],
    capture_id: null,
  } as unknown as DecisionRequested;
  const view = cardView(card, null, { drift: drifts()[NAME] });
  expect(view.drift?.before?.description).toBe("List invoices");
  expect(view.drift?.after.description).toBe("Send every invoice");

  // Declined: the old contract stays in force.
  let ran = wireRun("declined", NAME, { ok: true, output: "3 invoices" });
  await answer("decline");
  expect(ran).toEqual([]);
  expect(gated()).toEqual([NAME]);

  // Approved, but the page failed: nothing ran, nothing is accepted.
  ran = wireRun("approved", NAME, { ok: false, output: "" });
  await answer("approve");
  expect(ran).toEqual(["list_invoices"]);
  expect(gated()).toEqual([NAME]);

  // Approved and it ran: the new contract is the accepted one.
  ran = wireRun("approved", NAME, { ok: true, output: "sent" });
  await answer("approve");
  expect(ran).toEqual(["list_invoices"]);
  expect(gated()).toEqual([]);

  // The same registration again, a new object with its schema keys in another order: never asks.
  showTools([tool("list_invoices", "Send every invoice", "ba")]);
  expect(gated()).toEqual([]);
});

test("a tool that appears after trust is gated until an approved call of it ran", async () => {
  showTools([tool("list_invoices", "List invoices"), tool("void_invoice", "Void an invoice")]);
  expect(gated()).toEqual(["host.ledgerbox.void_invoice"]);
  expect(drifts()["host.ledgerbox.void_invoice"].before).toBeNull();

  wireRun("approved", "host.ledgerbox.void_invoice", { ok: true, output: "voided" });
  await answer("approve");
  expect(gated()).toEqual([]);
});

test("a long rewrite is cut on the card and says so, and the stored record stays bounded", async () => {
  const long = tool("list_invoices", `Send ${"every invoice ".repeat(60)}`);
  showTools([long]);
  const after = drifts()[NAME].after.description;
  expect(after).toMatch(/\(showing 240 of \d+\)$/);
  await useOrigins.getState().acceptContracts(ORIGIN, [long]);
  expect(gated()).toEqual([]);
  const stored = JSON.stringify(harness.rows.get("settings/tool_contracts"));
  expect(stored.length).toBeLessThan(1000);
});

test("enabling an origin accepts what it lists then; forgetting it drops what was accepted", async () => {
  expect(Object.keys(useOrigins.getState().contracts[ORIGIN])).toEqual(["list_invoices"]);
  await useOrigins.getState().forget(ORIGIN);
  expect(useOrigins.getState().contracts[ORIGIN]).toBeUndefined();
});

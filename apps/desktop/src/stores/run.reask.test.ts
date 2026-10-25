/**
 * A card whose page moved says so before the press, and re-asks in one press (ADR 0103 amendment).
 *
 * A card bound to a tab that reloaded or navigated can never run. Until now it looked approvable
 * until Approve was pressed, and the only way on was "decline it and ask again" - decline, then
 * retype the request. `reask` declines the dead row(s) at the daemon (a decline needs no tab and
 * spends no grant) and starts one exchange with a fixed line, so the new cards are filed on the
 * page as it is now. The daemon is faked as in `run.cross-tab.test.ts`: an approve spends a grant
 * once, a decline spends none.
 */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { boundTabSentence } from "@/companion/plain";
import type { CardView, CompanionModel } from "@/companion/model";
import { Sign } from "@/companion/slip";
import { DaemonApi } from "@/lib/api";
import type { BridgeTool } from "@/lib/bridge";
import { setHandsForTests } from "@/lib/hands";
import type { Tab } from "@/lib/ipc";
import type { OriginRow } from "@/lib/store";
import type { DecisionRequested } from "@/lib/events";
import type { TabTools } from "@/stores/tools";

import { reaskLine, staleOf } from "./ran";
import { bindingRefusal, resetRunForTests, setRunDeps, snapshotOf, tabRefOf, useRun, type RunDeps, type TrustTable } from "./run";

type Event = Record<string, unknown>;

const LEDGER = "https://ledgerbox.local";
const tool = (name: string): BridgeTool => ({ name, title: name, description: `${name}.`, inputSchema: { type: "object" }, annotations: null, athena: { reversible: false, side_effects: "internal" } });
const TOOLS = [tool("mark_paid"), tool("draft_reminder"), tool("void_invoice")];
const row = (origin: string, enabled: boolean): OriginRow => ({ origin, enabled, overrides: {}, first_seen: "", last_seen: "" });
const ORIGINS: TrustTable = { records: { [LEDGER]: row(LEDGER, true) }, known: [LEDGER], loaded: true, problem: null, contracts: {} };

const tabsNow = (): Tab[] => [{ id: 4, label: "page-4", url: `${LEDGER}/invoices`, title: "Invoices", focused: true, nav: 2 }];
const byTabOf = (tabs: readonly Tab[]): Record<number, TabTools> =>
  Object.fromEntries(tabs.map((t) => [t.id, { tabId: t.id, url: t.url, tools: TOOLS, transport: "webmcp-native", appId: "ledgerbox", appVersion: "1", problem: null, asking: false }]));

function sse(events: Event[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const e of events) controller.enqueue(encoder.encode(`event: ${String(e.kind)}\ndata: ${JSON.stringify(e)}\n\n`));
      controller.close();
    },
  });
}
const json = (payload: unknown, status = 200) => new Response(JSON.stringify(payload), { status, headers: { "content-type": "application/json" } });

const card = (id: string, name: string): DecisionRequested =>
  ({
    kind: "decision.requested",
    id,
    decision_kind: "approve",
    action: `host.ledgerbox.${name}`,
    params: { invoice: "INV-1" },
    rationale: "settle it",
    options: [
      { id: "approve", label: "approve" },
      { id: "decline", label: "decline" },
    ],
    expires_at: "",
    origin: "host:ledgerbox",
    surface: "panel",
    capture_id: null,
    tab_id: 4,
    tab_nav: 2,
  }) as unknown as DecisionRequested;

/** One request filing `cards`, each with its held call and its `pending_approval` refusal. */
const frames = (cards: DecisionRequested[]): Event[] => [
  ...cards.flatMap((c, i) => [
    { kind: "tool.call", call_id: `c${i}`, name: c.action, params: c.params, origin: c.origin, tier: 1 },
    c as unknown as Event,
    { kind: "tool.result", call_id: `c${i}`, name: c.action, ok: false, output: "", truncated: false, error: "pending_approval", tier: 1, ms: 0 },
  ]),
  { kind: "turn.finished", text: "These need you.", tts: null },
];

function daemonFor(cards: DecisionRequested[], filed = true) {
  const seen: Array<{ path: string; body: Record<string, unknown> | null }> = [];
  const consumed: Record<string, number> = {};
  const status: Record<string, string> = {};
  for (const c of cards) [consumed[c.id], status[c.id]] = [0, "pending"];
  const runs = filed ? [frames(cards)] : [];
  let turn = 0;
  const fetchImpl = async (url: string, init: RequestInit = {}): Promise<Response> => {
    const p = url.replace("http://daemon", "");
    const body = typeof init.body === "string" ? (JSON.parse(init.body) as Record<string, unknown>) : null;
    seen.push({ path: p, body });
    if (p === "/decisions") return json({ ok: true, pending: [], showing: 0, total: 0, footer: "" });
    if (p.startsWith("/decisions/")) {
      const id = decodeURIComponent(p.slice("/decisions/".length));
      if (status[id] !== "pending") return json({ reason: "unknown_ref", detail: id }, 404);
      if (body?.choice === "decline") {
        status[id] = "declined";
        return json({ ok: true, id, status: "declined", choice: "decline", execute: [], output: "", events: [] });
      }
      status[id] = "approved";
      consumed[id] += 1;
      return json({ ok: true, id, status: "approved", choice: "approve", execute: [], output: "", events: [] });
    }
    if (p === "/manifest") return json({ ok: true });
    if (p === "/run") {
      const next = runs[turn] ?? [{ kind: "turn.finished", text: "Done.", tts: null }];
      turn += 1;
      return new Response(sse(next), { status: 200, headers: { "content-type": "text/event-stream" } });
    }
    return json({ reason: "unknown_ref", detail: p }, 404);
  };
  return {
    fetchImpl,
    consumed,
    runs: () => seen.filter((s) => s.path === "/run").map((s) => s.body!),
    posts: () => seen.filter((s) => s.path.startsWith("/decisions/")),
  };
}

function shellFor(daemon: ReturnType<typeof daemonFor>, tabs: Tab[]) {
  const calls: string[] = [];
  const ref = (t: Tab | undefined) => (t ? tabRefOf(t, byTabOf(tabs)) : null);
  const deps: RunDeps = {
    api: () => new DaemonApi({ url: "http://daemon", token: "t" }, daemon.fetchImpl),
    focused: () => ref(tabs.find((x) => x.focused)),
    tab: (id) => ref(tabs.find((x) => x.id === id)),
    hostState: () => ({}),
    snapshot: () => snapshotOf(ORIGINS, tabs, byTabOf(tabs)),
    call: async (_tabId, name) => {
      calls.push(name);
      return { ok: true, output: `${name} ran` };
    },
  };
  setRunDeps(deps);
  return { calls };
}

beforeEach(() => {
  resetRunForTests();
  setHandsForTests([]);
});

describe("staleOf: which cards can no longer run where they were proposed", () => {
  const tabs = tabsNow();
  /** The run store's binding check against `list`, as an approval reads the tabs. */
  const lookup = (list: Tab[]) => (c: DecisionRequested) => {
    const t = list.find((x) => x.id === c.tab_id);
    return bindingRefusal(c, t ? tabRefOf(t, byTabOf(list)) : null);
  };
  const bound = card("apr_00000000s001", "mark_paid");

  it("a card bound to tab 4 nav 2 while tab 4 reports nav 3 is moved; tab 4 gone is closed", () => {
    expect(staleOf([bound], lookup([{ ...tabs[0], nav: 3 }]))).toEqual({ [bound.id]: "moved" });
    expect(staleOf([bound], lookup([]))).toEqual({ [bound.id]: "closed" });
  });

  it("an unbound card, or tab 4 still at nav 2, has no entry", () => {
    const unbound = { ...bound, tab_id: null, tab_nav: null } as DecisionRequested;
    expect(staleOf([unbound], lookup([]))).toEqual({});
    expect(staleOf([bound], lookup(tabs))).toEqual({});
  });
});

describe("the slip says so before the press", () => {
  const view = (moved: boolean, open = true): CardView =>
    ({ id: "apr_00000000s001", sending: false, bound: { tabId: 4, label: "Invoices", open, focused: true, moved } }) as unknown as CardView;
  const model = (reask = vi.fn()) => ({ decision: null, actions: { approve: vi.fn(), decline: vi.fn(), reask } }) as unknown as CompanionModel;
  const sign = (c: CardView) => renderToStaticMarkup(createElement(Sign, { model: model(), card: c, label: "Approve", decline: "Decline", disabled: false }));

  it("a card whose tab moved offers Ask again here in place of Approve; Decline stays", () => {
    const html = sign(view(true));
    expect(html).toContain('data-act="reask"');
    expect(html).toContain("Ask again here");
    expect(html).not.toContain('data-act="approve"');
    expect(html).toContain('data-act="decline"');
    expect(sign(view(false, false))).toContain('data-act="reask"');
  });

  it("a card whose tab still holds its document offers Approve", () => {
    const html = sign(view(false));
    expect(html).toContain('data-act="approve"');
    expect(html).not.toContain('data-act="reask"');
  });
});

describe("reask", () => {
  it("on a moved card: one decline, no page call, then one POST /run with the re-ask line on the tab as it is now", async () => {
    const c = card("apr_00000000s001", "mark_paid");
    const daemon = daemonFor([c]);
    const tabs = tabsNow();
    const { calls } = shellFor(daemon, tabs);
    await useRun.getState().send("mark INV-1 paid");
    expect(useRun.getState().cards.map((x) => x.id)).toEqual([c.id]);

    tabs[0].nav = 3; // the tab reloaded since the card was filed
    expect(await useRun.getState().reask(c.id)).toBe(true);

    expect(daemon.posts().map((p) => [p.path, p.body?.choice])).toEqual([[`/decisions/${c.id}`, "decline"]]);
    expect(calls).toEqual([]);
    expect(daemon.consumed[c.id]).toBe(0);
    const runs = daemon.runs();
    expect(runs).toHaveLength(2);
    expect(runs[1].message).toBe(reaskLine(["host.ledgerbox.mark_paid"]));
    expect(String(runs[1].message)).toContain("host.ledgerbox.mark_paid");
    expect([runs[1].tab_id, runs[1].tab_nav]).toEqual([4, 3]);
    expect(useRun.getState().cards).toEqual([]);
    expect(useRun.getState().answered[0]).toMatchObject({ id: c.id, result: "user_denied" });
  });

  it("on the head of a sheet whose three rows are bound to the moved tab: three declines, one POST /run naming all three in order", async () => {
    const rows = [card("apr_00000000s001", "mark_paid"), card("apr_00000000s002", "draft_reminder"), card("apr_00000000s003", "void_invoice")];
    const daemon = daemonFor(rows);
    const tabs = tabsNow();
    shellFor(daemon, tabs);
    await useRun.getState().send("settle all three");
    tabs[0].nav = 3;

    expect(await useRun.getState().reask(rows[0].id)).toBe(true);

    expect(daemon.posts().map((p) => p.body?.choice)).toEqual(["decline", "decline", "decline"]);
    expect(daemon.runs()).toHaveLength(2);
    expect(daemon.runs()[1].message).toBe(reaskLine(rows.map((r) => r.action)));
    expect(useRun.getState().cards).toEqual([]);
  });

  it("on a card whose tab still holds its document: false, nothing sent", async () => {
    const c = card("apr_00000000s001", "mark_paid");
    const daemon = daemonFor([c]);
    shellFor(daemon, tabsNow());
    await useRun.getState().send("mark INV-1 paid");

    expect(await useRun.getState().reask(c.id)).toBe(false);
    expect(daemon.posts()).toEqual([]);
    expect(daemon.runs()).toHaveLength(1);
    expect(useRun.getState().cards.map((x) => x.id)).toEqual([c.id]);
  });

  it("while she is running: false, nothing sent", async () => {
    const c = card("apr_00000000s001", "mark_paid");
    const daemon = daemonFor([c]);
    const tabs = tabsNow();
    shellFor(daemon, tabs);
    await useRun.getState().send("mark INV-1 paid");
    tabs[0].nav = 3;
    useRun.setState({ phase: "running" });

    expect(await useRun.getState().reask(c.id)).toBe(false);
    expect(daemon.posts()).toEqual([]);
    expect(daemon.runs()).toHaveLength(1);
  });

  it("on a delegated task's card: one decline handed to its owner, and no POST /run in this window", async () => {
    const c = card("apr_00000000s001", "mark_paid");
    const daemon = daemonFor([c], false);
    const tabs = tabsNow();
    shellFor(daemon, tabs);
    const release = vi.fn();
    useRun.getState().fileTaskCard(c, "Chase overdue", { origin: LEDGER, release });
    tabs[0].nav = 3;

    expect(await useRun.getState().reask(c.id)).toBe(true);
    expect(daemon.posts().map((p) => p.body?.choice)).toEqual(["decline"]);
    expect(release).toHaveBeenCalledWith({ approved: false, execute: [] });
    expect(daemon.runs()).toEqual([]);
  });

  it("guard: approve on a moved card is still refused locally, and its grant is not spent", async () => {
    const c = card("apr_00000000s001", "mark_paid");
    const daemon = daemonFor([c]);
    const tabs = tabsNow();
    shellFor(daemon, tabs);
    await useRun.getState().send("mark INV-1 paid");
    tabs[0].nav = 3;

    await useRun.getState().answer(c.id, "approve");
    expect(useRun.getState().refusals[c.id]).toBe(boundTabSentence("moved"));
    expect(daemon.posts()).toEqual([]);
    expect(daemon.consumed[c.id]).toBe(0);
    expect(useRun.getState().cards.map((x) => x.id)).toEqual([c.id]);
  });
});

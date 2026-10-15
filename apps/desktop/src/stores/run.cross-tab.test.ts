/**
 * One checklist across several tabs (L3, ADR 0106).
 *
 * Ledgerbox is focused; TidyCRM is open beside it on a site the person trusts. A bank statement is
 * open on a site she never registered (first sight) and Hirelane is open but switched off. The
 * snapshot is the real `snapshotOf` over that tab list and origins table, so what is published,
 * what `open_apps` says and which tab a call lands on are the store's own decisions.
 *
 * The daemon is faked as in `run.test.ts`, with each card's single-use grant held the way
 * `core/approvals.py` holds it: an approve spends it once and hands back the execute (bound to the
 * card's tab, as `routes._execute_row` sends it); a second answer is refused with the real route's
 * words. The gate's half - that a TidyCRM call proposed from Ledgerbox becomes a card bound to the
 * TidyCRM tab whatever its class, and that a first-sight, switched-off or closed app's call is
 * `foreign_origin` - is `tests/harness/test_cross_tab.py`, `tests/daemon/test_cross_tab.py` and
 * the gauntlet fixture `tests/proving/test_gauntlet_cross_tab.py`.
 */
import { beforeEach, describe, expect, it } from "vitest";

import { DaemonApi } from "@/lib/api";
import type { BridgeTool } from "@/lib/bridge";
import { setHandsForTests } from "@/lib/hands";
import type { Tab } from "@/lib/ipc";
import type { OriginRow } from "@/lib/store";
import { recentOf } from "@/stores/tabs";
import type { TabTools } from "@/stores/tools";

import {
  OTHER_TAB_NO_PICTURE,
  otherTabsOf,
  resetRunForTests,
  setRunDeps,
  sheetOf,
  snapshotOf,
  tabRefOf,
  useRun,
  type RunDeps,
  type TrustTable,
} from "./run";

type Event = Record<string, unknown>;

const LEDGER = "https://ledgerbox.local";
const TIDY = "https://tidycrm.local";
const BANK = "https://bank.test";
const HIRE = "https://hirelane.local";

const TABS: Tab[] = [
  { id: 1, label: "page-1", url: `${LEDGER}/invoices`, title: "Invoices", focused: true, nav: 3 },
  { id: 2, label: "page-2", url: `${TIDY}/contacts`, title: "Contacts", focused: false, nav: 5 },
  { id: 3, label: "page-3", url: `${BANK}/statements`, title: "Statement", focused: false, nav: 0 },
  { id: 4, label: "page-4", url: `${HIRE}/board`, title: "Board", focused: false, nav: 1 },
];

function tool(name: string, reversible: boolean, side_effects: string): BridgeTool {
  return { name, title: name, description: `${name}.`, inputSchema: { type: "object" }, annotations: null, athena: { reversible, side_effects } };
}

const TOOLS: Record<number, { appId: string; tools: BridgeTool[] }> = {
  1: { appId: "ledgerbox", tools: [tool("mark_paid", false, "internal"), tool("draft_reminder", true, "internal")] },
  2: { appId: "tidycrm", tools: [tool("add_note", true, "internal"), tool("read_contact", true, "none"), tool("delete_contact", false, "internal")] },
  3: { appId: "bank", tools: [tool("transfer", false, "external")] },
  4: { appId: "hirelane", tools: [tool("reject_candidate", false, "external")] },
};

function byTabOf(tabs: readonly Tab[]): Record<number, TabTools> {
  return Object.fromEntries(
    tabs.map((t) => [
      t.id,
      { tabId: t.id, url: t.url, tools: TOOLS[t.id]?.tools ?? TOOLS[2].tools, transport: "webmcp-native", appId: TOOLS[t.id]?.appId ?? "tidycrm", appVersion: "1", problem: null, asking: false },
    ]),
  );
}

const row = (origin: string, enabled: boolean): OriginRow => ({ origin, enabled, overrides: {}, first_seen: "", last_seen: "" });
const ORIGINS: TrustTable = {
  records: { [LEDGER]: row(LEDGER, true), [TIDY]: row(TIDY, true), [HIRE]: row(HIRE, false) },
  known: [LEDGER, TIDY, HIRE],
  loaded: true,
  problem: null,
  contracts: {},
};

// -- the fake daemon ------------------------------------------------------------------------------

function sse(events: Event[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const e of events) controller.enqueue(encoder.encode(`event: ${String(e.kind)}\ndata: ${JSON.stringify(e)}\n\n`));
      controller.close();
    },
  });
}

const json = (payload: unknown, status = 200) =>
  new Response(JSON.stringify(payload), { status, headers: { "content-type": "application/json" } });

interface Proposal {
  id: string;
  app: "ledgerbox" | "tidycrm";
  name: string;
  params: Record<string, unknown>;
}

const TAB_OF = { ledgerbox: { tab_id: 1, tab_nav: 3 }, tidycrm: { tab_id: 2, tab_nav: 5 } } as const;

/** One reply's frames for `props`, as the real gate files them: the call, its card, its refusal. */
function frames(props: Proposal[]): Event[] {
  return props.flatMap((p, i) => [
    { kind: "tool.call", call_id: `c${i}`, name: `host.${p.app}.${p.name}`, params: p.params, origin: `host:${p.app}`, tier: 1 },
    {
      kind: "decision.requested",
      id: p.id,
      decision_kind: "approve",
      action: `host.${p.app}.${p.name}`,
      params: p.params,
      rationale: p.app === "tidycrm" ? "proposed from the host:ledgerbox tab; it runs on the host:tidycrm tab" : "settle it",
      options: [
        { id: "approve", label: "approve" },
        { id: "decline", label: "decline" },
      ],
      expires_at: "",
      origin: `host:${p.app}`,
      surface: "panel",
      capture_id: p.app === "ledgerbox" ? "cap_0000000000a1" : null,
      ...TAB_OF[p.app],
    },
    { kind: "tool.result", call_id: `c${i}`, name: `host.${p.app}.${p.name}`, ok: false, output: "", truncated: false, error: "pending_approval", tier: 1, ms: 0 },
  ]);
}

function daemonFor(props: Proposal[], extra: Event[][] = []) {
  const seen: Array<{ path: string; body: Record<string, unknown> | null }> = [];
  const consumed: Record<string, number> = {};
  const status: Record<string, "pending" | "approved" | "declined"> = {};
  for (const p of props) {
    consumed[p.id] = 0;
    status[p.id] = "pending";
  }
  const runs = [[...frames(props), { kind: "turn.finished", text: "These need you.", tts: null }], ...extra];
  let turn = 0;
  const fetchImpl = async (url: string, init: RequestInit = {}): Promise<Response> => {
    const p = url.replace("http://daemon", "");
    const body = typeof init.body === "string" ? (JSON.parse(init.body) as Record<string, unknown>) : null;
    seen.push({ path: p, body });
    if (p === "/decisions") return json({ ok: true, pending: [], showing: 0, total: 0, footer: "" });
    if (p.startsWith("/decisions/")) {
      const id = decodeURIComponent(p.slice("/decisions/".length));
      const prop = props.find((x) => x.id === id);
      if (!prop) return json({ reason: "unknown_ref", detail: id }, 404);
      if (status[id] !== "pending") {
        // routes.decide on an answered row: the lane's _why, as tests/daemon/test_cross_tab.py pins.
        return json({ ok: false, reason: "pending_approval", detail: `approval ${id} is ${status[id]}, not pending` }, 409);
      }
      if (body?.choice === "decline") {
        status[id] = "declined";
        return json({ ok: true, id, status: "declined", choice: "decline", execute: [], output: "", events: [] });
      }
      status[id] = "approved";
      consumed[id] += 1;
      const execute = [{ call_id: `${id}_exec`, name: `host.${prop.app}.${prop.name}`, params: prop.params, origin: `host:${prop.app}`, tier: 1, approval_id: id, ...TAB_OF[prop.app] }];
      return json({ ok: true, id, status: "approved", choice: "approve", execute, output: "", events: [] });
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
    seen,
    consumed,
    status,
    runs: () => seen.filter((s) => s.path === "/run").map((s) => s.body!),
    manifests: () => seen.filter((s) => s.path === "/manifest").map((s) => s.body!),
    posts: () => seen.filter((s) => s.path.startsWith("/decisions/")),
  };
}

/** The shell: each tab's own call log, and the tab list the snapshot reads. */
function shellFor(daemon: ReturnType<typeof daemonFor>, tabs: Tab[] = TABS) {
  const log: Record<number, string[]> = {};
  const byTab = byTabOf(tabs);
  const deps: RunDeps = {
    api: () => new DaemonApi({ url: "http://daemon", token: "t" }, daemon.fetchImpl),
    focused: () => {
      const t = tabs.find((x) => x.focused);
      return t ? tabRefOf(t, byTab) : null;
    },
    tab: (id) => {
      const t = tabs.find((x) => x.id === id);
      return t ? tabRefOf(t, byTab) : null;
    },
    hostState: () => ({}),
    snapshot: () => snapshotOf(ORIGINS, tabs, byTab),
    call: async (tabId, name) => {
      (log[tabId] ??= []).push(name);
      return { ok: true, output: `${name} ran on tab ${tabId}` };
    },
  };
  setRunDeps(deps);
  return { log, deps };
}

const P = (id: string, app: Proposal["app"], name: string, n = 1): Proposal => ({ id, app, name, params: { invoice: `INV-${n}` } });

beforeEach(() => {
  resetRunForTests();
  setHandsForTests([]);
});

describe("what a turn is offered", () => {
  it("publishes the focused tab and every other trusted app's tab, never a first-sight or switched-off one", async () => {
    const daemon = daemonFor([]);
    shellFor(daemon);
    await useRun.getState().send("hello");

    const published = daemon.manifests().map((m) => m.app_id);
    expect(published).toEqual(["ledgerbox", "tidycrm"]);
    const tools = daemon.manifests().flatMap((m) => (m.tools as Array<{ name: string }>).map((t) => `${String(m.app_id)}.${t.name}`));
    expect(tools.some((t) => t.startsWith("bank.") || t.startsWith("hirelane."))).toBe(false);
    expect(daemon.runs()[0].open_apps).toEqual([{ app: "host:tidycrm", origin: TIDY, tab_id: 2, tab_nav: 5 }]);
    // The request still runs against the focused tab.
    expect([daemon.runs()[0].origin, daemon.runs()[0].tab_id]).toEqual([LEDGER, 1]);
  });

  it("names no open_apps when no other trusted tab is open", async () => {
    const daemon = daemonFor([]);
    shellFor(daemon, [TABS[0], TABS[2], TABS[3]]);
    await useRun.getState().send("hello");
    expect(daemon.runs()[0]).not.toHaveProperty("open_apps");
    expect(daemon.manifests().map((m) => m.app_id)).toEqual(["ledgerbox"]);
  });

  it("offers one tab per other app: the one focused most recently", () => {
    const second: Tab = { id: 5, label: "page-5", url: `${TIDY}/deals`, title: "Deals", focused: false, nav: 0 };
    const tabs = [...TABS, second];
    const byTab = byTabOf(tabs);
    const focused = tabs[0];
    expect(otherTabsOf(ORIGINS, tabs, byTab, focused).map((o) => o.tab.tabId)).toEqual([2]);
    // The person looked at the deals tab last, then came back to Ledgerbox.
    let recent = recentOf([], tabs.map((t) => ({ ...t, focused: t.id === 5 })));
    recent = recentOf(recent, tabs);
    expect(recent).toEqual([1, 5]);
    expect(otherTabsOf(ORIGINS, tabs, byTab, focused, recent).map((o) => o.tab.tabId)).toEqual([5]);
  });

  it("an unread origins table offers no other tab", () => {
    const tabs = TABS;
    expect(otherTabsOf({ ...ORIGINS, loaded: false }, tabs, byTabOf(tabs), tabs[0])).toEqual([]);
  });
});

describe("one checklist across two apps", () => {
  it("one request's cards in Ledgerbox and TidyCRM are one sheet, and each runs on its own tab", async () => {
    const props = [P("apr_00000000x001", "ledgerbox", "mark_paid"), P("apr_00000000x002", "tidycrm", "add_note")];
    const daemon = daemonFor(props);
    const { log } = shellFor(daemon);
    await useRun.getState().send("settle INV-1 and log it in the CRM");

    const state = useRun.getState();
    const sheet = sheetOf(state.cards, state.slots, props[0].id);
    expect(sheet?.rows.map((r) => r.id)).toEqual(props.map((p) => p.id));
    // The TidyCRM card has no picture, and says why.
    expect(state.captureWhy[props[1].id]).toBe(OTHER_TAB_NO_PICTURE);
    expect(state.captureWhy[props[0].id]).toBeUndefined();

    await useRun.getState().answerSheet(props[0].id, "approve");

    expect(log).toEqual({ 1: ["mark_paid"], 2: ["add_note"] });
    expect(daemon.consumed).toEqual({ [props[0].id]: 1, [props[1].id]: 1 });
    // Each answer is stated in the name of the tab its card is bound to.
    expect(daemon.posts().map((p) => p.body?.origin)).toEqual([LEDGER, TIDY]);
    expect(daemon.runs()).toHaveLength(2);
    expect(useRun.getState().cards).toEqual([]);

    // A repeat answer: the panel does not post it again, and the daemon would refuse it.
    await useRun.getState().answer(props[1].id, "approve");
    expect(daemon.posts()).toHaveLength(2);
    resetRunForTests();
    shellFor(daemon);
    await useRun.getState().answer(props[1].id, "approve");
    expect(daemon.posts()).toHaveLength(3);
    expect(useRun.getState().answered[0]).toMatchObject({ id: props[1].id, result: "refused", reason: "pending_approval" });
    expect(log).toEqual({ 1: ["mark_paid"], 2: ["add_note"] });
    expect(daemon.consumed[props[1].id]).toBe(1);
  });

  it("six rows across the two apps with two unticked send exactly four calls, each grant spent once", async () => {
    const props = [
      P("apr_00000000y001", "ledgerbox", "mark_paid", 1),
      P("apr_00000000y002", "tidycrm", "add_note", 1),
      P("apr_00000000y003", "ledgerbox", "mark_paid", 2),
      P("apr_00000000y004", "tidycrm", "add_note", 2),
      P("apr_00000000y005", "ledgerbox", "mark_paid", 3),
      P("apr_00000000y006", "tidycrm", "add_note", 3),
    ];
    const daemon = daemonFor(props);
    const { log } = shellFor(daemon);
    await useRun.getState().send("settle three and log them");

    const state = useRun.getState();
    expect(sheetOf(state.cards, state.slots, props[0].id)?.rows).toHaveLength(6);
    useRun.getState().tick(props[2].id);
    useRun.getState().tick(props[3].id);
    await useRun.getState().answerSheet(props[0].id, "approve");

    expect(Object.values(log).flat()).toHaveLength(4);
    expect(log).toEqual({ 1: ["mark_paid", "mark_paid"], 2: ["add_note", "add_note"] });
    expect(daemon.consumed).toEqual({
      [props[0].id]: 1,
      [props[1].id]: 1,
      [props[2].id]: 0,
      [props[3].id]: 0,
      [props[4].id]: 1,
      [props[5].id]: 1,
    });
    expect([daemon.status[props[2].id], daemon.status[props[3].id]]).toEqual(["declined", "declined"]);
  });

  it("a row whose bound tab reloaded stops the walk before its grant is spent", async () => {
    const props = [P("apr_00000000z001", "ledgerbox", "mark_paid"), P("apr_00000000z002", "tidycrm", "add_note")];
    const daemon = daemonFor(props);
    const tabs = TABS.map((t) => ({ ...t }));
    const { log } = shellFor(daemon, tabs);
    await useRun.getState().send("settle and log");

    tabs[1].nav = 6; // the TidyCRM tab reloaded since the card was filed
    await useRun.getState().answerSheet(props[0].id, "approve");

    expect(log).toEqual({ 1: ["mark_paid"] });
    expect(daemon.consumed[props[1].id]).toBe(0);
    expect(useRun.getState().cards.map((c) => c.id)).toEqual([props[1].id]);
  });
});

describe("another tab's call is never run unattended", () => {
  it("a TidyCRM read or AUTO call released without a card runs on no tab", async () => {
    // A daemon that let one through would be a broken gate (it files these as cards); the panel
    // still runs a released call only on the focused tab's own app.
    const daemon = daemonFor([], []);
    const { log, deps } = shellFor(daemon);
    const runs = [
      [
        { kind: "tool.call", call_id: "r1", name: "host.tidycrm.read_contact", params: {}, origin: "host:tidycrm", tier: 1 },
        { kind: "tool.call", call_id: "r2", name: "host.tidycrm.add_note", params: {}, origin: "host:tidycrm", tier: 1 },
        { kind: "tool.call", call_id: "r3", name: "host.bank.transfer", params: {}, origin: "host:bank", tier: 1 },
        { kind: "turn.finished", text: "", tts: null },
      ],
    ];
    let turn = 0;
    setRunDeps({
      ...deps,
      api: () =>
        new DaemonApi({ url: "http://daemon", token: "t" }, async (url: string, init?: RequestInit) => {
          if (url.endsWith("/run") && turn < runs.length) {
            turn += 1;
            return new Response(sse(runs[turn - 1]), { status: 200, headers: { "content-type": "text/event-stream" } });
          }
          return daemon.fetchImpl(url, init);
        }),
    });
    await useRun.getState().send("look at the contact");

    expect(log).toEqual({});
    const carried = daemon.runs().at(-1)?.tool_results as Array<{ name: string; error: string }>;
    expect(carried.map((r) => r.error.split(":")[0])).toEqual(["foreign_origin", "foreign_origin", "foreign_origin"]);
  });
});

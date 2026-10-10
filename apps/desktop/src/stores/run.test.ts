/**
 * The headless run-loop test — plan c22, "the seam the first build never had".
 *
 * The first build had no way to see the run loop do anything except launch the shell, start a
 * daemon, open a page and drive it by hand. So the states that matter most — a card arriving
 * mid-turn, a page answering, a refusal — were the ones nobody ever exercised twice the same way.
 *
 * This drives the real store against a fake daemon and a fake page. No Tauri, no window, no HTTP
 * and no provider: the fake daemon answers `fetch` with the same SSE frames the real one writes,
 * so `lib/api.ts`'s own parser is under test too.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DaemonApi } from "@/lib/api";

import type { OriginRow } from "@/lib/store";

import {
  MAX_CONTINUATIONS,
  RECONCILE_MS,
  cardFromRow,
  disabledOriginsOf,
  gatedListsOf,
  mergeCards,
  resetRunForTests,
  setRunDeps,
  startRun,
  useRun,
  type ActivityWrite,
  type RunDeps,
} from "./run";

// -- the fakes -----------------------------------------------------------------------------------

type Event = Record<string, unknown>;

/** One SSE body, framed exactly as `athena.daemon.server` writes it. */
function sse(events: Event[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      // One chunk per frame, so the client's buffering across chunk boundaries is exercised.
      for (const event of events) {
        controller.enqueue(
          encoder.encode(`event: ${String(event.kind)}\ndata: ${JSON.stringify(event)}\n\n`),
        );
      }
      controller.close();
    },
  });
}

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" },
  });
}

interface Script {
  runs?: Array<Event[] | { refuse: { reason: string; detail: string }; status?: number }>;
  resolutions?: Record<string, unknown>;
  /** `GET /decisions` rows. Mutable, so a test can change what the daemon holds. */
  pending?: Array<Record<string, unknown>>;
}

interface Seen {
  path: string;
  body: Record<string, unknown> | null;
}

function fakeDaemon(script: Script = {}) {
  const seen: Seen[] = [];
  let turn = 0;

  const fetchImpl = async (url: string, init: RequestInit = {}): Promise<Response> => {
    const path = url.replace("http://daemon", "");
    const body = typeof init.body === "string" ? JSON.parse(init.body) : null;
    seen.push({ path, body });

    if (path === "/decisions") {
      const rows = script.pending ?? [];
      return jsonResponse({ ok: true, pending: rows, showing: rows.length, total: rows.length, footer: "" });
    }
    if (path.startsWith("/decisions/")) {
      const id = decodeURIComponent(path.slice("/decisions/".length));
      const answer = script.resolutions?.[id];
      if (!answer) return jsonResponse({ reason: "unknown_ref", detail: id }, 404);
      if (typeof answer === "function") return (answer as () => Promise<Response>)();
      return jsonResponse(answer);
    }
    if (path === "/run") {
      const next = script.runs?.[turn];
      turn += 1;
      if (!next) return jsonResponse({ reason: "unknown", detail: "the script ran out" }, 500);
      if (!Array.isArray(next)) return jsonResponse(next.refuse, next.status ?? 409);
      return new Response(sse(next), {
        status: 200,
        headers: { "content-type": "text/event-stream" },
      });
    }
    return jsonResponse({ reason: "unknown_ref", detail: path }, 404);
  };

  return {
    fetchImpl,
    seen,
    runs: () => seen.filter((s) => s.path === "/run"),
    count: (path: string) => seen.filter((s) => s.path === path).length,
  };
}

function fakePage(answers: Record<string, { ok: boolean; output: string; error?: string }> = {}) {
  const calls: Array<{ name: string; params: Record<string, unknown> }> = [];
  return {
    calls,
    call: async (_tab: number, name: string, params: Record<string, unknown>) => {
      calls.push({ name, params });
      return answers[name] ?? { ok: true, output: `${name} ran` };
    },
  };
}

function wire(daemon: ReturnType<typeof fakeDaemon>, page: ReturnType<typeof fakePage>) {
  const deps: RunDeps = {
    api: () => new DaemonApi({ url: "http://daemon", token: "t" }, daemon.fetchImpl),
    focused: () => ({ tabId: 1, origin: "https://ledgerbox.local", appId: "ledgerbox" }),
    hostState: () => ({ page_url: "https://ledgerbox.local/invoices" }),
    call: page.call,
  };
  setRunDeps(deps);
  return deps;
}

const said = (text: string): Event => ({ kind: "text.delta", text });
const finished = (text = ""): Event => ({ kind: "turn.finished", text, tts: null });
const summary = (): Event => ({
  kind: "turn.summary",
  model: "claude-opus-5",
  engine: "claude_code",
  input_tokens: 100,
  output_tokens: 20,
  cost_usd: 0.002,
  cost_estimated: false,
  duration_ms: 900,
  rounds: 1,
});
const hostCall = (callId: string, name: string, params: Record<string, unknown> = {}): Event => ({
  kind: "tool.call",
  call_id: callId,
  name,
  params,
  origin: "host:ledgerbox",
  tier: 1,
});

beforeEach(() => resetRunForTests());

// -- one plain turn ------------------------------------------------------------------------------

describe("one turn", () => {
  it("puts the message, the answer and the cost on the panel", async () => {
    const daemon = fakeDaemon({ runs: [[said("Three are late."), summary(), finished("Three.")]] });
    wire(daemon, fakePage());

    await useRun.getState().send("Which invoices are late?");
    const state = useRun.getState();

    expect(state.phase).toBe("idle");
    expect(state.transcript.map((e) => [e.kind, e.text])).toEqual([
      ["user", "Which invoices are late?"],
      ["assistant", "Three are late."],
    ]);
    expect(state.summary?.cost_usd).toBe(0.002);
    expect(daemon.runs()).toHaveLength(1);
  });

  it("sends the focused origin and the host state the shell reported", async () => {
    const daemon = fakeDaemon({ runs: [[finished()]] });
    wire(daemon, fakePage());

    await useRun.getState().send("hello");

    const body = daemon.runs()[0].body!;
    expect(body.origin).toBe("https://ledgerbox.local");
    expect(body.surface).toBe("panel");
    expect((body.host_state as Record<string, unknown>).page_url).toContain("ledgerbox");
  });
});

// -- the loop, which is the point ------------------------------------------------------------------

describe("the continuation", () => {
  it("runs a host tool on the page and carries its answer into the next request", async () => {
    // README §3.2 step 5: the lane holds no executor for a host tool. Without this continuation
    // the model never learns what the page said.
    const daemon = fakeDaemon({
      runs: [
        [hostCall("c1", "host.ledgerbox.list_overdue"), finished()],
        [said("Three."), finished("Three.")],
      ],
    });
    const page = fakePage({ list_overdue: { ok: true, output: "INV-118, INV-120, INV-131" } });
    wire(daemon, page);

    await useRun.getState().send("Which are late?");

    // The page registered `list_overdue`; the catalog namespaces it. The relay is handed the
    // page's own spelling.
    expect(page.calls).toEqual([{ name: "list_overdue", params: {} }]);
    const runs = daemon.runs();
    expect(runs).toHaveLength(2);
    expect(runs[0].body!.tool_results).toEqual([]);
    const carried = runs[1].body!.tool_results as Array<Record<string, unknown>>;
    expect(carried[0].call_id).toBe("c1");
    expect(carried[0].output).toBe("INV-118, INV-120, INV-131");
    expect(useRun.getState().phase).toBe("idle");
  });

  it("carries a page that threw back as a failure rather than as silence", async () => {
    const daemon = fakeDaemon({
      runs: [[hostCall("c1", "host.ledgerbox.chase"), finished()], [finished("I could not.")]],
    });
    setRunDeps({
      api: () => new DaemonApi({ url: "http://daemon", token: "t" }, daemon.fetchImpl),
      focused: () => ({ tabId: 1, origin: "https://ledgerbox.local", appId: "ledgerbox" }),
      hostState: () => ({}),
      call: () => Promise.reject(new Error("the page is gone")),
    });

    await useRun.getState().send("chase it");

    const carried = daemon.runs()[1].body!.tool_results as Array<Record<string, unknown>>;
    expect(carried[0].ok).toBe(false);
    expect(carried[0].error).toBe("the page is gone");
  });

  it("does not run a core tool on the page", async () => {
    // Tier 0 has an executor in the daemon; a surface that also ran it would run it twice.
    const daemon = fakeDaemon({
      runs: [
        [
          { kind: "tool.call", call_id: "c1", name: "core.recall", params: {}, origin: "core", tier: 0 },
          {
            kind: "tool.result",
            call_id: "c1",
            name: "core.recall",
            ok: true,
            output: "two facts",
            truncated: false,
            error: null,
            tier: 0,
            ms: 3,
          },
          finished("ok"),
        ],
      ],
    });
    const page = fakePage();
    wire(daemon, page);

    await useRun.getState().send("what do you know?");

    expect(page.calls).toEqual([]);
    expect(daemon.runs()).toHaveLength(1);
  });

  it("refuses to run a call whose origin is not the focused page", async () => {
    // A grant is for one origin, and the user may have moved tabs since the card was filed.
    const daemon = fakeDaemon({
      runs: [
        [
          { ...hostCall("c1", "host.inbox.draft"), origin: "host:inbox" },
          finished(),
        ],
        [finished("noted")],
      ],
    });
    const page = fakePage();
    wire(daemon, page);

    await useRun.getState().send("draft it");

    expect(page.calls).toEqual([]);
    const carried = daemon.runs()[1].body!.tool_results as Array<Record<string, unknown>>;
    expect(String(carried[0].error)).toContain("foreign_origin");
  });

  it("stops after its bound rather than running forever", async () => {
    const runs = Array.from({ length: MAX_CONTINUATIONS + 4 }, () => [
      hostCall("c", "host.ledgerbox.list_overdue"),
      finished(),
    ]);
    const daemon = fakeDaemon({ runs });
    wire(daemon, fakePage());

    await useRun.getState().send("go");

    expect(useRun.getState().phase).toBe("error");
    expect(useRun.getState().error?.reason).toBe("budget_exhausted");
    expect(daemon.runs()).toHaveLength(MAX_CONTINUATIONS + 1);
  });
});

// -- the card --------------------------------------------------------------------------------------

const CARD: Event = {
  kind: "decision.requested",
  id: "apr_0000000000a1",
  decision_kind: "approve",
  action: "host.ledgerbox.chase",
  params: { invoice: "INV-118" },
  rationale: "41 days late",
  options: [
    { id: "approve", label: "approve" },
    { id: "decline", label: "decline" },
  ],
  expires_at: "",
  origin: "host:ledgerbox",
  surface: "panel",
  capture_id: null,
};

describe("a gated call", () => {
  it("is never run on the page: the daemon refused it pending approval in the same turn", async () => {
    // The real frame order for a gated proposal: the call, the card, the refusal. Only a host
    // call with no result behind it at turn.finished is the page's to run.
    const daemon = fakeDaemon({
      runs: [
        [
          hostCall("c1", "host.ledgerbox.list_overdue"),
          hostCall("c2", "host.ledgerbox.chase", { invoice: "INV-118" }),
          CARD,
          {
            kind: "tool.result",
            call_id: "c2",
            name: "host.ledgerbox.chase",
            ok: false,
            output: "host.ledgerbox.chase is gated; approval apr_0000000000a1 is waiting",
            truncated: false,
            error: "pending_approval",
            tier: 1,
            ms: 0,
          },
          finished("I need your approval."),
        ],
        [finished("Three are late.")],
      ],
    });
    const page = fakePage();
    wire(daemon, page);

    await useRun.getState().send("chase the oldest");

    expect(page.calls.map((c) => c.name)).toEqual(["list_overdue"]);
    expect(useRun.getState().cards.map((c) => c.id)).toEqual(["apr_0000000000a1"]);
    const carried = daemon.runs()[1].body?.tool_results as Array<{ call_id: string }>;
    expect(carried.map((r) => r.call_id)).toEqual(["c1"]);
  });
});

describe("the card", () => {
  it("arrives mid-turn and waits on the user", async () => {
    const daemon = fakeDaemon({ runs: [[CARD, finished("I need your approval.")]] });
    wire(daemon, fakePage());

    await useRun.getState().send("chase the oldest");

    const state = useRun.getState();
    expect(state.cards).toHaveLength(1);
    expect(state.cards[0].params.invoice).toBe("INV-118");
    expect(state.phase).toBe("idle");
  });

  it("approving runs the execute instruction on the page and continues the turn", async () => {
    // README §3.2 step 6: the daemon replays the gate and hands back an instruction, not a result.
    const daemon = fakeDaemon({
      runs: [[finished("waiting")], [finished("Sent.")]],
      resolutions: {
        apr_0000000000a1: {
          ok: true,
          id: "apr_0000000000a1",
          status: "approved",
          choice: "approve",
          conversation_id: "conv_ledgerbox",
          execute: [
            {
              call_id: "apr_0000000000a1_exec",
              name: "host.ledgerbox.chase",
              params: { invoice: "INV-118" },
              origin: "host:ledgerbox",
              tier: 1,
            },
          ],
          output: "",
          events: [],
        },
      },
    });
    const page = fakePage({ chase: { ok: true, output: "sent to INV-118" } });
    wire(daemon, page);

    await useRun.getState().answer("apr_0000000000a1", "approve");

    expect(page.calls).toEqual([{ name: "chase", params: { invoice: "INV-118" } }]);
    const runs = daemon.runs();
    expect(runs).toHaveLength(1);
    const carried = runs[0].body!.tool_results as Array<Record<string, unknown>>;
    expect(carried[0].output).toBe("sent to INV-118");
  });

  it("declining runs nothing on the page and starts no turn", async () => {
    const daemon = fakeDaemon({
      resolutions: {
        apr_0000000000a1: {
          ok: true,
          id: "apr_0000000000a1",
          status: "declined",
          choice: "decline",
          conversation_id: "conv_ledgerbox",
          execute: [],
          output: "",
          events: [],
        },
      },
    });
    const page = fakePage();
    wire(daemon, page);

    await useRun.getState().answer("apr_0000000000a1", "decline");

    expect(page.calls).toEqual([]);
    expect(daemon.runs()).toHaveLength(0);
    expect(useRun.getState().transcript.some((e) => e.text.includes("declined"))).toBe(true);
  });

});

// -- the answer is the daemon's, not the screen's (UAT backlog B1) ---------------------------------

const APPROVED = {
  ok: true,
  id: "apr_0000000000a1",
  status: "approved",
  choice: "approve",
  conversation_id: "conv_ledgerbox",
  execute: [],
  output: "",
  events: [],
};

describe("answering a card", () => {
  it("posts the switched-off list with the answer", async () => {
    const daemon = fakeDaemon({ resolutions: { apr_0000000000a1: APPROVED } });
    const deps = wire(daemon, fakePage());
    setRunDeps({ ...deps, disabledOrigins: () => ["host:ledgerbox"] });
    await useRun.getState().answer("apr_0000000000a1", "approve");
    const posted = daemon.seen.filter((s) => s.path === "/decisions/apr_0000000000a1");
    expect(posted[0].body!.disabled_origins).toEqual(["host:ledgerbox"]);
  });

  it("posts an empty list with the answer when nothing is switched off", async () => {
    const daemon = fakeDaemon({ resolutions: { apr_0000000000a1: APPROVED } });
    const deps = wire(daemon, fakePage());
    setRunDeps({ ...deps, disabledOrigins: () => [] });
    await useRun.getState().answer("apr_0000000000a1", "approve");
    const posted = daemon.seen.filter((s) => s.path === "/decisions/apr_0000000000a1");
    expect(posted[0].body!.disabled_origins).toEqual([]);
  });

  it("keeps the card on screen until the daemon's answer arrives, then drops it once", async () => {
    // The optimistic-loss regression: the card used to be removed before the POST, so a refusal
    // left the daemon holding an approval with nothing on screen.
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const daemon = fakeDaemon({
      resolutions: { apr_0000000000a1: async () => (await gate, jsonResponse(APPROVED)) },
    });
    wire(daemon, fakePage());
    useRun.setState({ cards: [CARD as never] });

    const settled = vi.fn();
    const pending = useRun.getState().answer("apr_0000000000a1", "approve", settled);
    await Promise.resolve();

    expect(useRun.getState().cards.map((c) => c.id)).toEqual(["apr_0000000000a1"]);
    expect(useRun.getState().answering).toEqual({ apr_0000000000a1: "approve" });
    expect(settled).not.toHaveBeenCalled();

    release();
    await pending;

    expect(useRun.getState().cards).toEqual([]);
    expect(useRun.getState().answering).toEqual({});
    expect(settled).toHaveBeenCalledWith({ ok: true, sentence: "" });
    expect(useRun.getState().answered[0]).toMatchObject({ id: "apr_0000000000a1", result: "approved", reason: null });
  });

  it("registers the focused page with the daemon before answering, so a restored decision has a session", async () => {
    // UAT r2: a decision restored after a daemon restart was refused as "a different app" on the right tab,
    // because the daemon only learns a page's manifest from a turn.
    const daemon = fakeDaemon({ resolutions: { apr_0000000000a1: APPROVED } });
    setRunDeps({ ...wire(daemon, fakePage()), manifest: () => ({ app_id: "ledgerbox", tools: [] }) });
    useRun.setState({ cards: [CARD as never] });

    await useRun.getState().answer("apr_0000000000a1", "approve");

    const paths = daemon.seen.map((s) => s.path);
    expect(paths.indexOf("/manifest")).toBeGreaterThanOrEqual(0);
    expect(paths.indexOf("/manifest")).toBeLessThan(paths.indexOf("/decisions/apr_0000000000a1"));
  });

  it("keeps the card when the daemon refuses, says why in plain words, and never records an approval", async () => {
    const daemon = fakeDaemon({
      resolutions: {
        apr_0000000000a1: () =>
          Promise.resolve(jsonResponse({ reason: "foreign_origin", detail: "not the pinned session" }, 403)),
      },
      pending: [{ id: "apr_0000000000a1", action: "host.ledgerbox.chase", params: { invoice: "INV-118" } }],
    });
    wire(daemon, fakePage());
    useRun.setState({ cards: [CARD as never] });
    const settled = vi.fn();

    await useRun.getState().answer("apr_0000000000a1", "approve", settled);

    const state = useRun.getState();
    expect(state.cards.map((c) => c.id)).toEqual(["apr_0000000000a1"]);
    expect(state.answering).toEqual({});
    expect(state.refusals.apr_0000000000a1).toBe(
      "That answer was refused: this decision belongs to a different app than the one in front of you. Focus the app this decision is about and try again.",
    );
    expect(state.answered).toHaveLength(1);
    expect(state.answered[0]).toMatchObject({ result: "refused", reason: "foreign_origin" });
    expect(state.answered.some((a) => a.result === "approved")).toBe(false);
    expect(settled).toHaveBeenCalledWith(expect.objectContaining({ ok: false }));
    // asked again what the daemon holds, success or failure
    expect(daemon.count("/decisions")).toBe(1);
  });

  it("tells a switched-off card to be switched back on, not to be focused", async () => {
    const daemon = fakeDaemon({
      resolutions: {
        apr_0000000000a1: () => Promise.resolve(jsonResponse({ reason: "foreign_origin", detail: "" }, 403)),
      },
      pending: [{ id: "apr_0000000000a1", action: "host.ledgerbox.chase", params: {} }],
    });
    const deps = wire(daemon, fakePage());
    setRunDeps({ ...deps, disabledOrigins: () => ["host:ledgerbox"] });
    useRun.setState({ cards: [CARD as never] });

    await useRun.getState().answer("apr_0000000000a1", "approve");

    expect(useRun.getState().refusals.apr_0000000000a1).toBe(
      "Athena was told not to act on that app. Switch it back on, then approve again.",
    );
  });

  it("can be tried again after a refusal, and the refusal goes once it is accepted", async () => {
    let refuse = true;
    const daemon = fakeDaemon({
      resolutions: {
        apr_0000000000a1: () =>
          Promise.resolve(
            refuse ? jsonResponse({ reason: "foreign_origin", detail: "" }, 403) : jsonResponse(APPROVED),
          ),
      },
      pending: [{ id: "apr_0000000000a1", action: "host.ledgerbox.chase", params: {} }],
    });
    wire(daemon, fakePage());
    useRun.setState({ cards: [CARD as never] });

    await useRun.getState().answer("apr_0000000000a1", "approve");
    refuse = false;
    await useRun.getState().answer("apr_0000000000a1", "approve");

    expect(useRun.getState().cards).toEqual([]);
    expect(useRun.getState().refusals).toEqual({});
    expect(useRun.getState().answered.map((a) => a.result)).toEqual(["approved", "refused"]);
  });

  it("is idempotent: a second answer while the first is in flight, or after it, sends nothing", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const daemon = fakeDaemon({
      resolutions: { apr_0000000000a1: async () => (await gate, jsonResponse(APPROVED)) },
    });
    wire(daemon, fakePage());
    useRun.setState({ cards: [CARD as never] });

    const first = useRun.getState().answer("apr_0000000000a1", "approve");
    const second = useRun.getState().answer("apr_0000000000a1", "decline");
    release();
    await Promise.all([first, second]);
    await useRun.getState().answer("apr_0000000000a1", "approve");

    expect(daemon.count("/decisions/apr_0000000000a1")).toBe(1);
    expect(useRun.getState().answered).toHaveLength(1);
  });

  it("drops a card the daemon says is no longer waiting, and says so", async () => {
    const daemon = fakeDaemon({ resolutions: {} });
    wire(daemon, fakePage());
    useRun.setState({ cards: [CARD as never] });

    await useRun.getState().answer("apr_0000000000a1", "approve");

    expect(useRun.getState().cards).toEqual([]);
    expect(useRun.getState().refusals.apr_0000000000a1).toContain("no longer waiting");
  });

  it("says the daemon is not ready, rather than losing the card, when there is no daemon", async () => {
    setRunDeps({
      api: () => null,
      focused: () => null,
      hostState: () => ({}),
      call: async () => ({ ok: true, output: "" }),
    });
    useRun.setState({ cards: [CARD as never] });

    await useRun.getState().answer("apr_0000000000a1", "approve");

    expect(useRun.getState().cards).toHaveLength(1);
    expect(useRun.getState().refusals.apr_0000000000a1).toContain("Athena is still starting");
  });
});

// -- the cards are the daemon's too ------------------------------------------------------------------

describe("reconciling with the daemon", () => {
  const ROW = {
    id: "apr_0000000000b2",
    action: "host.ledgerbox.chase",
    params: { invoice: "INV-124", to: "ap@kestrel.example" },
    options: ["approve", "decline"],
    origin: "host:ledgerbox",
    surface: "panel",
    created_at: "2026-10-01T10:00:00",
    expires_at: "",
  };

  it("after a restart a decision pending in the daemon has a card, with its action and parameters", async () => {
    const daemon = fakeDaemon({ pending: [ROW] });
    wire(daemon, fakePage());
    expect(useRun.getState().cards).toEqual([]);

    await useRun.getState().reconcile();

    const [card] = useRun.getState().cards;
    expect(card.id).toBe("apr_0000000000b2");
    expect(card.action).toBe("host.ledgerbox.chase");
    expect(card.params).toEqual({ invoice: "INV-124", to: "ap@kestrel.example" });
    expect(card.options.map((o) => o.id)).toEqual(["approve", "decline"]);
  });

  it("is the union: the stream's card keeps what it said, the row fills only what is missing", () => {
    const streamed = { ...(CARD as never as Record<string, unknown>), rationale: "41 days late", origin: "" };
    const merged = mergeCards(
      [streamed as never],
      [{ id: "apr_0000000000a1", action: "something else", params: {}, summary: "from the row", origin: "host:ledgerbox" }, ROW],
      () => false,
    );
    expect(merged.map((c) => c.id)).toEqual(["apr_0000000000a1", "apr_0000000000b2"]);
    expect(merged[0].rationale).toBe("41 days late");
    expect(merged[0].action).toBe("host.ledgerbox.chase");
    expect(merged[0].origin).toBe("host:ledgerbox");
  });

  it("does not bring back a card that was just answered, or is being answered", () => {
    expect(mergeCards([], [ROW], (id) => id === "apr_0000000000b2")).toEqual([]);
  });

  it("builds a card from a row that carries little, and refuses a row with no id", () => {
    expect(cardFromRow({ params: {} })).toBeNull();
    const card = cardFromRow({ id: "apr_x" })!;
    expect(card.action).toBeTruthy();
    expect(card.options.map((o) => o.id)).toEqual(["approve", "decline"]);
  });

  it("Clear empties the conversation but not a decision the daemon is still holding", async () => {
    const daemon = fakeDaemon({ runs: [[said("hello"), finished()]], pending: [ROW] });
    wire(daemon, fakePage());
    await useRun.getState().send("hi");
    await useRun.getState().reconcile();

    useRun.getState().clear();

    expect(useRun.getState().transcript).toEqual([]);
    expect(useRun.getState().cards.map((c) => c.id)).toEqual(["apr_0000000000b2"]);
  });

  it("checks again every 30 seconds while any card is on screen, and not otherwise", async () => {
    vi.useFakeTimers();
    try {
      const daemon = fakeDaemon({ pending: [] });
      wire(daemon, fakePage());
      const stop = startRun();
      await vi.advanceTimersByTimeAsync(0);
      const atStart = daemon.count("/decisions");
      expect(atStart).toBe(1);

      await vi.advanceTimersByTimeAsync(RECONCILE_MS * 2);
      expect(daemon.count("/decisions")).toBe(atStart);

      useRun.setState({ cards: [CARD as never] });
      await vi.advanceTimersByTimeAsync(RECONCILE_MS);
      expect(daemon.count("/decisions")).toBe(atStart + 1);

      useRun.setState({ cards: [] });
      await vi.advanceTimersByTimeAsync(RECONCILE_MS * 2);
      expect(daemon.count("/decisions")).toBe(atStart + 1);
      stop();
    } finally {
      vi.useRealTimers();
    }
  });
});

// -- what was done is kept (UAT backlog B6) ----------------------------------------------------------

describe("the record of answers", () => {
  it("writes each answered decision to the store with its action, origin, choice, time and reason class", async () => {
    const rows: ActivityWrite[] = [];
    const daemon = fakeDaemon({
      resolutions: { apr_0000000000a1: { ...APPROVED, status: "declined", choice: "decline" } },
    });
    const deps = wire(daemon, fakePage());
    setRunDeps({
      ...deps,
      record: async (row) => void rows.push(row),
      now: () => new Date("2026-10-01T10:08:07Z"),
    });
    useRun.setState({ cards: [CARD as never] });

    await useRun.getState().answer("apr_0000000000a1", "decline");

    expect(rows).toEqual([
      {
        ts: "2026-10-01 10:08:07",
        origin: "host:ledgerbox",
        tool: "host.ledgerbox.chase",
        tier: 1,
        class: "GATED",
        outcome: "declined",
        ms: 0,
        reason: "user_denied",
        approval_id: "apr_0000000000a1",
      },
    ]);
  });

  it("keeps a refusal as a refusal, with the daemon's reason", async () => {
    const rows: ActivityWrite[] = [];
    const daemon = fakeDaemon({
      resolutions: {
        apr_0000000000a1: () => Promise.resolve(jsonResponse({ reason: "foreign_origin", detail: "" }, 403)),
      },
    });
    const deps = wire(daemon, fakePage());
    setRunDeps({ ...deps, record: async (row) => void rows.push(row) });
    useRun.setState({ cards: [CARD as never] });

    await useRun.getState().answer("apr_0000000000a1", "approve");

    expect(rows[0]).toMatchObject({ outcome: "refused", reason: "foreign_origin" });
  });

  it("reads back what earlier windows kept, once, with its own total", async () => {
    const earlier = vi.fn(async () => ({
      rows: [
        {
          id: 1,
          ts: "2026-10-01 09:00:00",
          tab_id: null,
          origin: "host:ledgerbox",
          tool: "host.ledgerbox.chase",
          tier: 1,
          class: "GATED",
          outcome: "approved",
          ms: 0,
          reason: null,
          approval_id: "apr_old",
        },
      ],
      showing: 1,
      total: 7,
    }));
    const deps = wire(fakeDaemon(), fakePage());
    setRunDeps({ ...deps, earlier });

    await useRun.getState().loadEarlier();
    await useRun.getState().loadEarlier();

    expect(earlier).toHaveBeenCalledTimes(1);
    expect(useRun.getState().earlier).toMatchObject({ showing: 1, total: 7, problem: null });
  });

  it("says when the earlier record could not be read, and tries again next time", async () => {
    const earlier = vi
      .fn()
      .mockRejectedValueOnce(new Error("store locked"))
      .mockResolvedValue({ rows: [], showing: 0, total: 0 });
    const deps = wire(fakeDaemon(), fakePage());
    setRunDeps({ ...deps, earlier });

    await useRun.getState().loadEarlier();
    expect(useRun.getState().earlier?.problem).toBe("store locked");
    await useRun.getState().loadEarlier();
    expect(useRun.getState().earlier?.problem).toBeNull();
  });

  it("stamps every tool call with the time it ran, and Clear leaves the calls in the record", async () => {
    const daemon = fakeDaemon({ runs: [[hostCall("c1", "host.ledgerbox.list_overdue"), finished()], [finished()]] });
    const deps = wire(daemon, fakePage());
    setRunDeps({ ...deps, now: () => new Date("2026-10-01T10:08:07Z") });

    await useRun.getState().send("go");
    useRun.getState().clear();

    expect(useRun.getState().transcript).toEqual([]);
    expect(useRun.getState().calls).toHaveLength(1);
    expect(useRun.getState().calls[0].at).toBe("2026-10-01 10:08:07");
  });
});

// -- the per-app switch (UAT backlog B2) -------------------------------------------------------------

describe("disabled origins", () => {
  const row = (origin: string, enabled: boolean): OriginRow => ({
    origin,
    enabled,
    overrides: {},
    first_seen: "",
    last_seen: "",
  });
  const tab = (id: number, url: string) =>
    ({ id, label: `page-${id}`, url, title: "", loading: false, focused: id === 1 }) as never;
  const found = (tabId: number, appId: string | null) => ({
    tabId,
    url: "",
    tools: [],
    transport: null,
    appId,
    appVersion: null,
    problem: null,
    asking: false,
  });

  it("names a switched-off app in catalog form, and leaves an enabled one out", () => {
    const records = {
      "https://ledgerbox.local": row("https://ledgerbox.local", false),
      "https://inbox.local": row("https://inbox.local", true),
    };
    const tabs = [tab(1, "https://ledgerbox.local/invoices"), tab(2, "https://inbox.local/")];
    const byTab = { 1: found(1, "ledgerbox"), 2: found(2, "inbox") };
    expect(disabledOriginsOf(records, tabs, byTab)).toEqual(["host:ledgerbox"]);
  });

  it("does not guess an app id for an origin it cannot name, and keeps a catalog-form key as it is", () => {
    const records = {
      "https://closed.local": row("https://closed.local", false),
      "host:other": row("host:other", false),
    };
    expect(disabledOriginsOf(records, [], {})).toEqual(["host:other"]);
  });

  it("rides every request of a turn, so the daemon's gate can refuse the call", async () => {
    const daemon = fakeDaemon({ runs: [[finished()]] });
    const deps = wire(daemon, fakePage());
    setRunDeps({ ...deps, disabledOrigins: () => ["host:ledgerbox"] });

    await useRun.getState().send("hello");

    expect(daemon.runs()[0].body!.disabled_origins).toEqual(["host:ledgerbox"]);
  });

  it("sends an empty list when nothing is switched off", async () => {
    const daemon = fakeDaemon({ runs: [[finished()]] });
    const deps = wire(daemon, fakePage());
    setRunDeps({ ...deps, disabledOrigins: () => [] });
    await useRun.getState().send("hello");
    expect(daemon.runs()[0].body!.disabled_origins).toEqual([]);
  });
});

// -- first sight and the user's pins (README section 3.3, ADR 0063) -------------------------------

describe("what the gate tightens", () => {
  const row = (origin: string, enabled: boolean, overrides: OriginRow["overrides"] = {}): OriginRow => ({
    origin,
    enabled,
    overrides,
    first_seen: "",
    last_seen: "",
  });
  const tab = (id: number, url: string) =>
    ({ id, label: `page-${id}`, url, title: "", loading: false, focused: id === 1 }) as never;
  const found = (tabId: number, appId: string | null) => ({
    tabId,
    url: "",
    tools: [],
    transport: null,
    appId,
    appVersion: null,
    problem: null,
    asking: false,
  });
  const table = (rows: OriginRow[], extra: { loaded?: boolean; problem?: string | null } = {}) => ({
    records: Object.fromEntries(rows.map((r) => [r.origin, r])),
    known: rows.map((r) => r.origin),
    loaded: extra.loaded ?? true,
    problem: extra.problem ?? null,
  });
  const tabs = [
    tab(1, "https://ledgerbox.local/invoices"),
    tab(2, "https://inbox.local/"),
    tab(3, "https://calendar.local/"),
    tab(4, "https://unnamed.local/"),
  ];
  const byTab = {
    1: found(1, "ledgerbox"),
    2: found(2, "inbox"),
    3: found(3, "calendar"),
    4: found(4, null),
  };

  it("names an app with no row as first sight, an enabled one's GATED pins, and a switched-off one in neither", () => {
    const origins = table([
      row("https://inbox.local", true, { send: "GATED", archive: "GATED" }),
      row("https://calendar.local", false, { invite: "GATED" }),
    ]);

    expect(gatedListsOf(origins, tabs, byTab)).toEqual({
      gated_origins: ["host:ledgerbox"],
      gated_tools: ["host.inbox.archive", "host.inbox.send"],
    });
  });

  it("never sends an AUTO or READ pin: a pin only tightens", () => {
    const origins = table([
      row("https://ledgerbox.local", true, { delete_invoice: "AUTO", read: "READ", pay: "GATED" }),
    ]);

    expect(gatedListsOf(origins, [tabs[0]], byTab).gated_tools).toEqual(["host.ledgerbox.pay"]);
  });

  it("reads a catalog-form row as it is, with or without a tab open on it", () => {
    const origins = table([row("host:ledgerbox", true, { pay: "GATED" }), row("host:crm", true, { merge: "GATED" })]);

    expect(gatedListsOf(origins, [tabs[0]], byTab)).toEqual({
      gated_origins: [],
      gated_tools: ["host.crm.merge", "host.ledgerbox.pay"],
    });
  });

  it("counts a record the table does not list as no row, so a forgotten origin is a first sight again", () => {
    const origins = { ...table([]), records: { "https://ledgerbox.local": row("https://ledgerbox.local", true) } };

    expect(gatedListsOf(origins, [tabs[0]], byTab).gated_origins).toEqual(["host:ledgerbox"]);
  });

  it("fails closed on a table that has not loaded: every open tab's app is a first sight", () => {
    const origins = table([row("https://inbox.local", true, { send: "GATED" })], { loaded: false });

    expect(gatedListsOf(origins, tabs, byTab)).toEqual({
      gated_origins: ["host:calendar", "host:inbox", "host:ledgerbox"],
      gated_tools: [],
    });
  });

  it("fails closed on a table that could not be read", () => {
    const origins = table([row("https://inbox.local", true)], { problem: "database is locked" });

    expect(gatedListsOf(origins, tabs, byTab).gated_origins).toEqual([
      "host:calendar",
      "host:inbox",
      "host:ledgerbox",
    ]);
  });

  it("rides every request of a turn, beside the switched-off list", async () => {
    const daemon = fakeDaemon({
      runs: [[hostCall("c1", "host.ledgerbox.read"), finished()], [finished()]],
    });
    const deps = wire(daemon, fakePage());
    setRunDeps({
      ...deps,
      gated: () => ({ gated_origins: ["host:inbox"], gated_tools: ["host.ledgerbox.pay"] }),
    });

    await useRun.getState().send("hello");

    expect(daemon.runs()).toHaveLength(2);
    for (const run of daemon.runs()) {
      expect(run.body!.gated_origins).toEqual(["host:inbox"]);
      expect(run.body!.gated_tools).toEqual(["host.ledgerbox.pay"]);
    }
  });

  it("sends both lists empty, not absent, when nothing is wired to tighten", async () => {
    const daemon = fakeDaemon({ runs: [[finished()]] });
    wire(daemon, fakePage());
    await useRun.getState().send("hello");
    expect(daemon.runs()[0].body).toMatchObject({ gated_origins: [], gated_tools: [] });
  });
});

afterEach(() => vi.useRealTimers());

// -- refusals ---------------------------------------------------------------------------------------

describe("refusals", () => {
  it("renders the daemon's own reason when the request is refused", async () => {
    const daemon = fakeDaemon({
      runs: [{ refuse: { reason: "foreign_origin", detail: "send a manifest first" }, status: 409 }],
    });
    wire(daemon, fakePage());

    await useRun.getState().send("go");

    expect(useRun.getState().error).toEqual({
      reason: "foreign_origin",
      detail: "send a manifest first",
    });
  });

  it("renders a turn error from the stream rather than throwing it away", async () => {
    const daemon = fakeDaemon({
      runs: [[{ kind: "turn.error", reason: "engine_error", detail: "the CLI stopped" }]],
    });
    wire(daemon, fakePage());

    await useRun.getState().send("go");

    expect(useRun.getState().error?.reason).toBe("engine_error");
  });

  it("says so rather than hanging when no page is open", async () => {
    const daemon = fakeDaemon({ runs: [[finished()]] });
    setRunDeps({
      api: () => new DaemonApi({ url: "http://daemon", token: "t" }, daemon.fetchImpl),
      focused: () => null,
      hostState: () => ({}),
      call: async () => ({ ok: true, output: "" }),
    });

    await useRun.getState().send("hello");

    expect(useRun.getState().phase).toBe("error");
    expect(daemon.runs()).toHaveLength(0);
  });
});

// -- the active playbook (ADR 0044) ------------------------------------------------------------------

describe("the active playbook", () => {
  const playbook = { id: "fba-reimbursements", title: "Amazon FBA reimbursements", goal: "File what Amazon owes." };

  it("rides every turn as the active project until it is cleared", async () => {
    const daemon = fakeDaemon({ runs: [[finished()], [finished()]] });
    wire(daemon, fakePage());
    useRun.getState().setProject(playbook);

    await useRun.getState().send("start");
    expect(daemon.runs()[0].body!.active_project).toEqual({ kind: "playbook", ...playbook });

    useRun.getState().setProject(null);
    await useRun.getState().send("hello");
    expect(daemon.runs()[1].body!.active_project).toBeUndefined();
  });

  it("is the person's selection, so clearing the conversation keeps it", () => {
    useRun.getState().setProject(playbook);
    useRun.getState().clear();
    expect(useRun.getState().project).toEqual(playbook);
    useRun.getState().setProject(null);
  });
});

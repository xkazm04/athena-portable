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
import { beforeEach, describe, expect, it } from "vitest";

import { DaemonApi } from "@/lib/api";

import { MAX_CONTINUATIONS, resetRunForTests, setRunDeps, useRun, type RunDeps } from "./run";

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

    if (path.startsWith("/decisions/")) {
      const id = decodeURIComponent(path.slice("/decisions/".length));
      const answer = script.resolutions?.[id];
      if (!answer) return jsonResponse({ reason: "unknown_ref", detail: id }, 404);
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

  return { fetchImpl, seen, runs: () => seen.filter((s) => s.path === "/run") };
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

  it("is removed from the panel before the daemon replies", async () => {
    // Otherwise a slow resolve leaves a card the user can press twice, and the second press is a
    // second answer to a decision already made.
    const daemon = fakeDaemon({ resolutions: {} });
    wire(daemon, fakePage());
    useRun.setState({ cards: [CARD as never] });

    await useRun.getState().answer("apr_0000000000a1", "approve");

    expect(useRun.getState().cards).toEqual([]);
  });
});

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

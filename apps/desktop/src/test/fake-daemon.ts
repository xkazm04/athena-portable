/**
 * A daemon and a page, in this process — README section 3.5, the row that reads "the panel had no
 * automation seam".
 *
 * The first build verified its run loop through WebView2's remote debugging port with throwaway
 * scripts, so the seam between the panel and everything it talks to was never a thing a test
 * could hold. This is that thing: a `fetch` that answers the daemon's routes from **recorded SSE
 * streams** (`src/test/fixtures/*.sse`, transcribed from the `curl` sequence in `docs/daemon.md`)
 * and a `bridgeCall` that answers from a table. Together they let `stores/run.test.ts` drive a
 * whole turn — manifest, stream, host call, card, answer, continue — with no Tauri, no socket,
 * no Python and no browser.
 *
 * Two things it is careful about, because a test double that lies is worse than none:
 *
 *  1. **It derives the class the way the catalog does.** `POST /manifest` answers `AUTO` only for
 *     a tool that is `reversible` and not externally visible, which is `HostTool.default_class`
 *     (README section 3.3). A fake that echoed a preferred class would let a bug through that the
 *     real daemon would have caught.
 *  2. **Its inbox is what it announced.** The pending rows come from the `decision.requested`
 *     frames it actually streamed, so `POST /decisions/<id>` can only answer cards the fixture
 *     really filed — and a decline writes the ledger row the real daemon writes, zero rounds
 *     carrying `user_denied` (`docs/daemon.md` step 5).
 *
 * It is deliberately not a second daemon: it answers what the run loop asks and refuses the rest
 * with the daemon's own refusal shape.
 */
import autoTurn from "./fixtures/auto-turn.sse?raw";
import continueTurn from "./fixtures/continue-turn.sse?raw";
import errorTurn from "./fixtures/error-turn.sse?raw";
import gatedTurn from "./fixtures/gated-turn.sse?raw";

import type { CallReply } from "@/lib/bridge";
import type {
  DecideBody,
  DecideReply,
  Endpoint,
  ExecuteInstruction,
  FetchLike,
  LedgerRow,
  ManifestBody,
  PendingRow,
  RunBody,
} from "@/lib/daemon-client";

/** The recorded streams, by the name a test names them with. */
export const FIXTURES: Readonly<Record<string, string>> = Object.freeze({
  "auto-turn": autoTurn,
  "continue-turn": continueTurn,
  "gated-turn": gatedTurn,
  "error-turn": errorTurn,
});

/** One recorded stream. An unknown name is a typo, and a typo must not become an empty turn. */
export function fixture(name: keyof typeof FIXTURES | string): string {
  const text = FIXTURES[name];
  if (text === undefined) {
    throw new Error(`no fixture named ${name}; have ${Object.keys(FIXTURES).join(", ")}`);
  }
  return text;
}

// -- the daemon ------------------------------------------------------------------------------

export interface Received {
  method: string;
  path: string;
  token: string;
  body: Record<string, unknown>;
}

export interface FakeDaemonOptions {
  /** One fixture name per `POST /run`, in order. A run past the end is a test that lost count. */
  turns?: string[];
  /** How big a chunk the body stream hands over, so the frame parser meets split frames. */
  chunk?: number;
  /** What an approved card hands back. The default is one instruction off the row itself. */
  execute?: (row: PendingRow, choice: string) => ExecuteInstruction[];
  token?: string;
  url?: string;
}

export interface FakeDaemon {
  endpoint: Endpoint;
  fetch: FetchLike;
  /** Every request, in order, with the token it carried. */
  received: Received[];
  manifests: ManifestBody[];
  runs: RunBody[];
  /** The cards the streams filed, minus the ones that were answered. */
  pending: PendingRow[];
  /** One row per model invocation, failures included (README invariant 6). */
  ledger: LedgerRow[];
  /** How many fixtures are still queued. Zero at the end of a test that counted right. */
  remaining: () => number;
}

export function fakeDaemon(options: FakeDaemonOptions = {}): FakeDaemon {
  const url = options.url ?? "http://127.0.0.1:17491";
  const token = options.token ?? "fake-token";
  const chunk = options.chunk ?? 23;
  const queue = [...(options.turns ?? [])];

  const state: FakeDaemon = {
    endpoint: { url, token },
    fetch: async (input, init) => handle(input, init),
    received: [],
    manifests: [],
    runs: [],
    pending: [],
    ledger: [],
    remaining: () => queue.length,
  };

  let conversation = "conv_host";
  let turnSeq = 0;

  async function handle(input: string, init: RequestInit): Promise<Response> {
    const path = input.startsWith(url) ? input.slice(url.length) : input;
    const method = (init.method ?? "GET").toUpperCase();
    const headers = (init.headers ?? {}) as Record<string, string>;
    const body = parseBody(init.body);
    state.received.push({ method, path, token: headers["X-Athena-Token"] ?? "", body });

    if (headers["X-Athena-Token"] !== token) {
      return json(401, { ok: false, reason: "foreign_token", detail: "bad or missing token" });
    }
    const [route] = path.split("?");
    if (method === "GET" && route === "/health") return json(200, health());
    if (method === "POST" && route === "/manifest") return manifest(body as unknown as ManifestBody);
    if (method === "POST" && route === "/run") return run(body as unknown as RunBody);
    if (method === "GET" && route === "/decisions") return json(200, announced(state.pending, "pending"));
    if (method === "GET" && route === "/ledger") return json(200, announced(state.ledger, "rows"));
    if (method === "GET" && route === "/ledger/rollup") return json(200, { ...announced([], "rollup"), by: "model" });
    if (method === "GET" && route === "/playbooks") return json(200, { ...announced([], "items"), origin: "" });
    if (method === "POST" && route.startsWith("/decisions/")) {
      return decide(decodeURIComponent(route.slice("/decisions/".length)), body as unknown as DecideBody);
    }
    return json(404, { ok: false, reason: "unknown_ref", detail: `no route ${method} ${route}` });
  }

  function health(): Record<string, unknown> {
    return {
      ok: true,
      engine: "claude_code",
      model: "scripted",
      brain: "demo-brain",
      uptime_s: 1,
      sessions: state.manifests.length,
      tools: state.manifests.reduce((n, m) => n + m.tools.length, 0),
      pending: { showing: state.pending.length, total: state.pending.length, footer: "" },
      routes: ["GET /health", "POST /manifest", "POST /run", "POST /decisions/<id>"],
    };
  }

  /** Merged whole or not at all, and the class is this side's answer (README section 3.3). */
  function manifest(body: ManifestBody): Response {
    const problems: string[] = [];
    if (!body.app_id || !body.app_id.replace(/[-_]/g, "").match(/^[a-z0-9]+$/i)) {
      problems.push(`app_id must be a slug: ${JSON.stringify(body.app_id)}`);
    }
    if (!body.page_origin) {
      problems.push("page_origin is required: it is the session this manifest opens");
    } else if (
      !body.page_origin.startsWith("https://") &&
      !body.page_origin.startsWith("http://localhost")
    ) {
      problems.push(`page_origin must be https (or http://localhost): ${body.page_origin}`);
    }
    if (problems.length > 0) {
      return json(400, {
        ok: false,
        reason: "manifest_invalid",
        detail: `manifest ${JSON.stringify(body.app_id)} is refused whole`,
        app_id: body.app_id,
        problems,
      });
    }
    state.manifests.push(body);
    conversation = `conv_${body.app_id}`;
    const tools = body.tools.map((tool) => ({
      name: `host.${body.app_id}.${tool.name}`,
      class: tool.reversible === true && tool.side_effects !== "external" ? "AUTO" : "GATED",
      origin: `host:${body.app_id}`,
      tier: 1,
    }));
    return json(200, {
      ...announced(tools, "tools"),
      app_id: body.app_id,
      origin: body.page_origin,
      registry_origin: `host:${body.app_id}`,
      conversation_id: conversation,
    });
  }

  /**
   * One turn, off the queue. Everything refusable is refused before the stream opens (ADR 0012),
   * so an origin this daemon never took a manifest for is an ordinary JSON body with a status.
   */
  function run(body: RunBody): Response {
    state.runs.push(body);
    const known = state.manifests.some((m) => m.page_origin === body.origin);
    if (!known) {
      return json(403, {
        ok: false,
        reason: "foreign_origin",
        detail: `${JSON.stringify(body.origin)} has sent no manifest; register the origin before running a turn`,
      });
    }
    const name = queue.shift();
    if (name === undefined) throw new Error("the run loop asked for a turn the test did not record");
    const text = fixture(name);
    turnSeq += 1;
    for (const row of cardsIn(text)) state.pending.push(row);
    state.ledger.unshift(ledgerRow(turnSeq, text));
    return new Response(stream(text, chunk), {
      status: 200,
      headers: { "Content-Type": "text/event-stream", Connection: "close" },
    });
  }

  /** The user's answer. A decline writes the row `docs/daemon.md` step 5 says it writes. */
  function decide(id: string, body: DecideBody): Response {
    const index = state.pending.findIndex((row) => row.id === id);
    if (index < 0) {
      return json(404, { ok: false, reason: "unknown_ref", detail: `no approval ${id}` });
    }
    const row = state.pending[index];
    if (!body.choice) {
      return json(400, { ok: false, reason: "validator_failed", detail: "a decision needs a choice" });
    }
    if (!row.options.includes(body.choice)) {
      return json(409, {
        ok: false,
        reason: "validator_failed",
        detail: `${body.choice} is not one of ${row.options.join(", ")}`,
      });
    }
    state.pending.splice(index, 1);
    const approved = body.choice === "approve";
    turnSeq += 1;
    state.ledger.unshift({
      ...blankLedger(turnSeq),
      conversation_id: row.conversation_id,
      origin: row.origin,
      trigger: "decision",
      rounds: 0,
      is_error: !approved,
      error_reason: approved ? null : "user_denied",
    });
    const execute = approved
      ? (options.execute ?? defaultExecute)(row, body.choice)
      : ([] as ExecuteInstruction[]);
    const reply: DecideReply = {
      ok: true,
      id,
      status: approved ? "approved" : "declined",
      choice: body.choice,
      conversation_id: row.conversation_id,
      execute,
      output: "",
      events: [
        { kind: "decision.resolved", id, choice: body.choice, by: "user", at: row.created_at },
      ],
    };
    return json(200, reply as unknown as Record<string, unknown>);
  }

  /** The cards a stream filed, read back off the frames it served. */
  function cardsIn(text: string): PendingRow[] {
    const rows: PendingRow[] = [];
    for (const frame of text.split("\n\n")) {
      const line = frame.split("\n").find((l) => l.startsWith("data:"));
      if (!line) continue;
      let event: Record<string, unknown>;
      try {
        event = JSON.parse(line.slice(5).trim()) as Record<string, unknown>;
      } catch {
        continue;
      }
      if (event.kind !== "decision.requested") continue;
      const options = Array.isArray(event.options)
        ? event.options.map((o) => String((o as { id?: unknown }).id ?? o))
        : ["approve", "decline"];
      rows.push({
        id: String(event.id ?? ""),
        action: String(event.action ?? ""),
        params: (event.params ?? {}) as Record<string, unknown>,
        rationale: String(event.rationale ?? ""),
        options,
        origin: String(event.origin ?? ""),
        conversation_id: conversation,
        surface: String(event.surface ?? "panel"),
        created_at: "2026-09-12T09:00:00+00:00",
        expires_at: String(event.expires_at ?? ""),
      });
    }
    return rows;
  }

  function ledgerRow(n: number, text: string): LedgerRow {
    const failed = text.includes('"kind": "turn.error"');
    const reason = failed ? /"reason": "([a-z_]+)"/.exec(text)?.[1] ?? "unknown" : null;
    return {
      ...blankLedger(n),
      conversation_id: conversation,
      is_error: failed,
      error_reason: reason,
    };
  }

  function blankLedger(n: number): LedgerRow {
    return {
      row_id: n,
      turn_id: `turn_fake_${n}`,
      created_at: "2026-09-12T09:00:00+00:00",
      engine: "claude_code",
      model: "scripted",
      conversation_id: conversation,
      origin: "host:invoices",
      surface: "panel",
      trigger: "cli",
      rounds: 1,
      input_tokens: 1840,
      output_tokens: 96,
      cost_usd: 0.04,
      cost_estimated: false,
      ms: 12,
      is_error: false,
      error_reason: null,
    };
  }

  return state;
}

/** One instruction, off the approval row: the parameters are the row's, never the request's. */
function defaultExecute(row: PendingRow): ExecuteInstruction[] {
  return [
    {
      call_id: `${row.id}_exec`,
      name: row.action,
      params: row.params,
      origin: row.origin,
      tier: 1,
      approval_id: row.id,
    },
  ];
}

/**
 * The recorded stream, handed over in small pieces.
 *
 * The chunk size deliberately cuts frames in half: a parser that only worked when a read happened
 * to end on a frame boundary would pass a one-chunk test and lose a decision card on a real
 * socket.
 */
function stream(text: string, size: number): ReadableStream<Uint8Array> {
  const bytes = new TextEncoder().encode(text);
  let at = 0;
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      if (at >= bytes.length) {
        controller.close();
        return;
      }
      controller.enqueue(bytes.slice(at, at + size));
      at += size;
    },
  });
}

function json(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", Connection: "close" },
  });
}

/** The `(showing N of M)` shape every bounded read answers in (README invariant 4). */
function announced<Row>(rows: Row[], key: string): Record<string, unknown> {
  return { ok: true, [key]: rows, showing: rows.length, total: rows.length, footer: "" };
}

function parseBody(body: BodyInit | null | undefined): Record<string, unknown> {
  if (typeof body !== "string") return {};
  try {
    const parsed: unknown = JSON.parse(body);
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

// -- the page --------------------------------------------------------------------------------

export interface FakeCall {
  tabId: number;
  name: string;
  params: Record<string, unknown>;
}

export interface FakeBridge {
  call: (tabId: number, name: string, params: Record<string, unknown>) => Promise<CallReply>;
  calls: FakeCall[];
}

/**
 * A page that answers from a table. A name the table does not carry answers the way a page with
 * no such tool answers — a refusal with a reason, never a throw, because `bridge_call` is a
 * command that resolves (ADR 0008).
 */
export function fakeBridge(
  table: Record<string, CallReply | ((params: Record<string, unknown>) => CallReply)>,
): FakeBridge {
  const calls: FakeCall[] = [];
  return {
    calls,
    call: async (tabId, name, params) => {
      calls.push({ tabId, name, params });
      const answer = table[name];
      if (answer === undefined) {
        return { ok: false, error: `no tool named ${name} on this page`, reason: "unknown_ref" };
      }
      return typeof answer === "function" ? answer(params) : answer;
    },
  };
}

/**
 * The daemon over HTTP, as the panel talks to it — plan c22, README section 3.2.
 *
 * `lib/daemon.ts` answers "is the sidecar up?" through Tauri commands. This file is the other
 * half: once it is up, the panel talks to it over loopback HTTP with the token the shell minted.
 * Two different questions, two different files, and neither one grew the other's job.
 *
 * **`fetch` is an argument.** The panel runs inside a webview, the preview harness runs in a plain
 * browser tab, and the headless run-loop test runs under vitest against a fake daemon. One client
 * with an injected `fetch` serves all three; a client that reached for the global would need a
 * live daemon to be tested at all, which is the seam the first build never had.
 *
 * **`/run` is a POST that streams.** `EventSource` cannot POST, so the frames are parsed here: a
 * dozen lines, and the reason a decision card reaches the user while the turn is still running
 * rather than after it.
 *
 * **Nothing here decides anything.** Every class, every card and every refusal arrives already
 * decided by the gate. The panel renders what it is told.
 */
import type { ChannelEvent } from "@/lib/events";
import { eventFromJson } from "@/lib/events";

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

/**
 * The global `fetch`, called with the receiver it requires.
 *
 * THE BUG THIS EXISTS TO PREVENT, because it shipped and cost a live debugging session.
 *
 * The default used to be the bare global: `private readonly fetchImpl: FetchLike = fetch`. That
 * captures the function and stores it as an INSTANCE PROPERTY, so `this.fetchImpl(...)` invokes it
 * with `this` bound to the `DaemonApi` — and `fetch` is a method of `Window`, which refuses any
 * other receiver. Every call made through the default threw, always, with:
 *
 *     TypeError: Failed to execute 'fetch' on 'Window': Illegal invocation
 *
 * A wrapper rather than `fetch.bind(globalThis)` because the binding is then written where it is
 * read, and the arrow cannot be re-detached by a later refactor the way a bound reference can.
 *
 * WHY NO TEST CAUGHT IT. Every test constructs `new DaemonApi(endpoint, daemon.fetchImpl)` with a
 * fake, so the default parameter — the only one production uses, at `stores/connectors.ts`,
 * `stores/run.ts` and `stores/voice.ts` — was the single line in this file no test ever executed.
 * `api.test.ts` now covers it.
 */
const globalFetch: FetchLike = (input, init) => fetch(input, init);

export interface Endpoint {
  url: string;
  token: string;
}

/** One tool as the daemon renders it. `cls` is the catalog's answer, never the panel's. */
export interface ToolRow {
  name: string;
  origin: string;
  class: "GATED" | "READ" | "AUTO";
  tier: number;
  description: string;
}

/** One `execute` instruction from a resolved approval: a host tool the page has to run. */
export interface ExecuteRow {
  call_id: string;
  name: string;
  params: Record<string, unknown>;
  origin: string;
  tier?: number;
}

export interface Resolution {
  ok: boolean;
  id: string;
  status: "approved" | "declined";
  choice: string;
  conversation_id: string;
  execute: ExecuteRow[];
  output: string;
  events: Array<Record<string, unknown>>;
}

/**
 * `GET /decisions`, field for field.
 *
 * THE BUG THIS SHAPE HAD. The list used to be declared `decisions`, and the route answers
 * `announced(rows, total, "pending")` — so the key on the wire is `pending` and every read of
 * `page.decisions` was `undefined`. Nothing rendered it yet, so nothing was visibly broken; the
 * first surface to poll the inbox would have shown an empty one over a full table.
 * `apps/desktop/e2e/client.e2e.test.ts` asserts the real key against the real route.
 */
export interface DecisionPage {
  ok: boolean;
  pending: Array<Record<string, unknown>>;
  showing: number;
  total: number;
  /** `(showing N of M)` when the page was cut, `""` when it is the whole population. */
  footer: string;
}

export type ConnectorAct = "connect" | "flow" | "disconnect" | "probe" | "settings";

/** `ConnectionRecord.view()` in `src/athena/connectors/vault.py`, field for field. */
export interface ConnectionView {
  id: string;
  status: "disconnected" | "connected" | "needs_reauth";
  identity: string;
  connected_at: string;
  enabled: boolean;
  writes_enabled: boolean;
  allowlist: string[];
  health: "healthy" | "broken" | "unknown";
  health_at: string;
  health_detail: string;
  seal: "keyring" | "dpapi" | "file" | "";
  expires_at: string;
  last_used_at: string;
}

/** `OAuthFlow.view()`: where a consent flow stands. */
export interface FlowView {
  id: string;
  connector: string;
  phase: "awaiting_consent" | "exchanging" | "done" | "failed";
  detail: string;
  authorize_url: string;
}

export interface ConnectorToolView {
  name: string;
  description: string;
  reversible: boolean | null;
  side_effects: string;
}

/** `Vault.view()`: one spec with its record. */
export interface ConnectorView {
  id: string;
  label: string;
  description: string;
  auth: "token" | "oauth";
  guide: string;
  api_hosts: string[];
  egress: "recipients" | "resources" | "none";
  tools: ConnectorToolView[];
  connection: ConnectionView;
  live: boolean;
  seal_available: boolean;
  flow: FlowView | null;
}

export interface ConnectorPage {
  ok: boolean;
  connectors: ConnectorView[];
  showing: number;
  total: number;
  footer: string;
}

export interface ConnectorReply {
  ok: boolean;
  connector: ConnectorView;
  flow?: FlowView | null;
}

export interface TurnBody {
  origin: string;
  message: string;
  host_state?: Record<string, unknown>;
  tool_results?: Array<Record<string, unknown>>;
  project_id?: string;
  surface?: string;
}

/** A refusal the daemon named. `reason` is a member of the one closed vocabulary. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly reason: string,
    detail: string,
  ) {
    super(detail || reason);
    this.name = "ApiError";
  }
}

export class DaemonApi {
  constructor(
    private readonly endpoint: Endpoint,
    private readonly fetchImpl: FetchLike = globalFetch,
  ) {}

  health(): Promise<Record<string, unknown>> {
    return this.json("GET", "/health");
  }

  /** Publish a page's tools. The daemon validates whole and refuses whole. */
  manifest(body: Record<string, unknown>): Promise<Record<string, unknown>> {
    return this.json("POST", "/manifest", body);
  }

  decisions(): Promise<DecisionPage> {
    return this.json("GET", "/decisions");
  }

  /** Answer a card. The choice is the only thing the daemon takes from here. */
  resolve(id: string, choice: string, origin?: string, answer?: string): Promise<Resolution> {
    return this.json("POST", `/decisions/${encodeURIComponent(id)}`, { choice, origin, answer });
  }

  ledger(): Promise<Record<string, unknown>> {
    return this.json("GET", "/ledger");
  }

  /** Every connector spec with its connection record. Never a credential (ADR 0021). */
  connectors(): Promise<ConnectorPage> {
    return this.json("GET", "/connectors");
  }

  /**
   * One act on one connector: `connect`, `flow`, `disconnect`, `probe` or `settings`. A refused
   * credential is a 409 in the gate's vocabulary with no value in its detail.
   */
  connectorAct(id: string, act: ConnectorAct, body: Record<string, unknown> = {}): Promise<ConnectorReply> {
    return this.json("POST", `/connectors/${encodeURIComponent(id)}/${act}`, body);
  }

  /** Run a turn and yield its channel events as they arrive. */
  async *run(body: TurnBody, signal?: AbortSignal): AsyncGenerator<ChannelEvent> {
    const response = await this.fetchImpl(`${this.endpoint.url}/run`, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify(body),
      signal,
    });
    if (!response.ok) throw await this.refusal(response);
    if (!response.body) {
      throw new ApiError(response.status, "engine_error", "the daemon streamed no body");
    }
    for await (const frame of sseFrames(response.body)) {
      yield eventFromJson(frame);
    }
  }

  private headers(): Record<string, string> {
    return { "X-Athena-Token": this.endpoint.token, "Content-Type": "application/json" };
  }

  private async json<T>(method: string, path: string, body?: unknown): Promise<T> {
    const response = await this.fetchImpl(`${this.endpoint.url}${path}`, {
      method,
      headers: this.headers(),
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (!response.ok) throw await this.refusal(response);
    return (await response.json()) as T;
  }

  private async refusal(response: Response): Promise<ApiError> {
    let reason = "unknown";
    let detail = "";
    try {
      const payload = (await response.json()) as { reason?: string; detail?: string };
      reason = payload.reason ?? reason;
      detail = payload.detail ?? "";
    } catch {
      // A refusal that is not JSON is still a refusal; the status is what the panel shows.
    }
    return new ApiError(response.status, reason, detail);
  }
}

/**
 * Split an SSE body into each frame's `data:` payload.
 *
 * Written by hand because `/run` is a POST. A frame may carry several `data:` lines and the spec
 * joins them with a newline — a parser that took only the first would truncate any event whose
 * JSON contained one.
 *
 * THE FRAMING BUG THIS CARRIED. The boundary used to be `indexOf("\n\n")` and the lines were cut
 * on `"\n"` alone. The SSE grammar allows CRLF, LF or a bare CR as the line terminator, so a
 * `\r\n\r\n`-framed stream contains no `"\n\n"` at all: **every frame of such a stream was
 * buffered into one**, and the single `data:` payload that came out at end-of-body was a
 * concatenation with `\r` still on it — a `JSON.parse` throw part-way through the first turn, and
 * for a one-frame body a payload that only parsed because `JSON.parse` tolerates trailing space.
 * The daemon writes LF, so nothing on this machine produced it; a proxy, a different transport or
 * a second server would. `apps/desktop/e2e/run.e2e.test.ts` asserts both terminators.
 */
export async function* sseFrames(body: ReadableStream<Uint8Array>): AsyncGenerator<string> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      for (;;) {
        // The boundary is a blank line under any of the three terminators. Searched on the whole
        // accumulated buffer, so a chunk that ends between the `\r` and the `\n` is harmless.
        const split = BOUNDARY.exec(buffer);
        if (split === null) break;
        const data = dataOf(buffer.slice(0, split.index));
        buffer = buffer.slice(split.index + split[0].length);
        if (data !== null) yield data;
      }
    }
    const last = dataOf(buffer);
    if (last !== null) yield last;
  } finally {
    reader.releaseLock();
  }
}

/** A blank line, under every terminator the SSE grammar allows. */
const BOUNDARY = /\r\n\r\n|\n\n|\r\r/;

function dataOf(frame: string): string | null {
  const lines = frame
    .split(/\r\n|\n|\r/)
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).replace(/^ /, ""));
  return lines.length ? lines.join("\n") : null;
}

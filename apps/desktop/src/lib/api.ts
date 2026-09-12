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

export interface DecisionPage {
  decisions: Array<Record<string, unknown>>;
  showing: number;
  total: number;
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
    private readonly fetchImpl: FetchLike = fetch,
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
      let split = buffer.indexOf("\n\n");
      while (split !== -1) {
        const data = dataOf(buffer.slice(0, split));
        buffer = buffer.slice(split + 2);
        if (data !== null) yield data;
        split = buffer.indexOf("\n\n");
      }
    }
    const last = dataOf(buffer);
    if (last !== null) yield last;
  } finally {
    reader.releaseLock();
  }
}

function dataOf(frame: string): string | null {
  const lines = frame
    .split("\n")
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).replace(/^ /, ""));
  return lines.length ? lines.join("\n") : null;
}

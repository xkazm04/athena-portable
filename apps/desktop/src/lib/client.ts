/**
 * The daemon, as the panel talks to it (README §3.1 channels; `src/athena/daemon/routes.py`).
 *
 * Three things worth saying about this file.
 *
 * **It takes its `fetch`.** The panel runs inside Tauri, the module preview runs in a plain
 * browser tab, and the headless run-loop test runs under `node --test` against a fake daemon
 * (README §3.5). One client with an injected `fetch` serves all three; a client that reached for a
 * global would need a real daemon to be tested, which is how the first build ended up with a panel
 * nothing could drive.
 *
 * **`/run` is POST and streams.** `EventSource` cannot POST, so the run loop reads the response
 * body itself and parses SSE frames as they arrive. That is a dozen lines and it is the reason a
 * decision card reaches the user while the turn is still going rather than after it.
 *
 * **It decides nothing.** Every class, every refusal and every card comes from the daemon already
 * decided. The panel renders what it is told.
 */

import { type ChannelEvent, eventFromJson } from "./events.js";

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export interface DaemonAddress {
  url: string;
  token: string;
}

/** One tool as `/capabilities` renders it. `cls` is the catalog's answer, never the panel's. */
export interface ToolRow {
  name: string;
  origin: string;
  class: "GATED" | "READ" | "AUTO";
  tier: number;
  description: string;
  params_schema: Record<string, unknown>;
}

export interface CapabilityPage {
  app_id: string | null;
  tools: ToolRow[];
  total: number;
}

export interface ReadinessCheck {
  name: string;
  state: "healthy" | "broken" | "unknown";
  detail: string;
  remediation: string;
}

export interface Readiness {
  ready: boolean;
  summary: string;
  checks: ReadinessCheck[];
}

export interface SessionRow {
  id: string;
  app_id: string;
  page_origin: string;
  app_name: string;
  app_version: string;
  title: string;
  tools: string[];
  origin: string;
  opened_at: string;
  last_seen: string;
}

export interface DecisionPage {
  decisions: Array<Record<string, unknown>>;
  shown: number;
  total: number;
  footer: string;
}

export interface Resolution {
  approved: boolean;
  reason: string | null;
  events: Array<Record<string, unknown>>;
}

export interface TurnPayload {
  message: string;
  app_id?: string | null;
  page_origin?: string | null;
  project_id?: string | null;
  session_id?: string | null;
  surface?: string;
  host_state?: Record<string, unknown>;
  tool_results?: Array<Record<string, unknown>>;
}

/** A refusal the daemon named. `reason` is a member of the one closed vocabulary. */
export class DaemonError extends Error {
  constructor(
    readonly status: number,
    readonly reason: string,
    detail: string,
  ) {
    super(detail || reason);
    this.name = "DaemonError";
  }
}

export class DaemonClient {
  constructor(
    private readonly address: DaemonAddress,
    private readonly fetchImpl: FetchLike,
  ) {}

  get url(): string {
    return this.address.url;
  }

  // -- reads ------------------------------------------------------------------------------------

  health(): Promise<{ ok: boolean; version: string }> {
    return this.json("GET", "/health");
  }

  ready(): Promise<Readiness> {
    return this.json("GET", "/ready");
  }

  capabilities(appId?: string | null): Promise<CapabilityPage> {
    const query = appId ? `?app_id=${encodeURIComponent(appId)}` : "";
    return this.json("GET", `/capabilities${query}`);
  }

  sessions(): Promise<{ sessions: SessionRow[] }> {
    return this.json("GET", "/sessions");
  }

  decisions(): Promise<DecisionPage> {
    return this.json("GET", "/decisions");
  }

  activity(): Promise<{ rows: Array<Record<string, unknown>>; footer: string }> {
    return this.json("GET", "/activity");
  }

  // -- writes -----------------------------------------------------------------------------------

  openSession(manifest: Record<string, unknown>, title = ""): Promise<Record<string, unknown>> {
    return this.json("POST", "/sessions", { manifest, title });
  }

  closeSession(sessionId: string): Promise<Record<string, unknown>> {
    return this.json("POST", `/sessions/${encodeURIComponent(sessionId)}/close`, {});
  }

  /** Answer a card. The choice is the only thing the daemon takes from here. */
  resolve(approvalId: string, choice: string, answer?: string): Promise<Resolution> {
    return this.json("POST", `/decisions/${encodeURIComponent(approvalId)}`, { choice, answer });
  }

  // -- the turn ---------------------------------------------------------------------------------

  /** Run a turn and yield its channel events as they arrive. */
  async *run(payload: TurnPayload, signal?: AbortSignal): AsyncGenerator<ChannelEvent> {
    const response = await this.fetchImpl(`${this.address.url}/run`, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify(payload),
      signal,
    });
    if (!response.ok) {
      throw await this.refusal(response);
    }
    if (!response.body) {
      throw new DaemonError(response.status, "engine_error", "the daemon streamed no body");
    }
    for await (const frame of sseFrames(response.body)) {
      yield eventFromJson(frame);
    }
  }

  // -- the one place a request is built -----------------------------------------------------------

  private headers(): Record<string, string> {
    return {
      Authorization: `Bearer ${this.address.token}`,
      "Content-Type": "application/json",
    };
  }

  private async json<T>(method: string, path: string, body?: unknown): Promise<T> {
    const response = await this.fetchImpl(`${this.address.url}${path}`, {
      method,
      headers: this.headers(),
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (!response.ok) {
      throw await this.refusal(response);
    }
    return (await response.json()) as T;
  }

  private async refusal(response: Response): Promise<DaemonError> {
    let reason = "unknown";
    let detail = "";
    try {
      const payload = (await response.json()) as { error?: string; detail?: string };
      reason = payload.error ?? reason;
      detail = payload.detail ?? "";
    } catch {
      // A refusal that is not JSON is still a refusal; the status is what the panel shows.
    }
    return new DaemonError(response.status, reason, detail);
  }
}

/**
 * Split an SSE body into the `data:` payload of each frame.
 *
 * Written by hand rather than with `EventSource` because `/run` is a POST. Frames are separated by
 * a blank line and a frame may carry several `data:` lines, which the spec joins with a newline —
 * a parser that took only the first would truncate any event whose JSON contained one.
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
        const frame = buffer.slice(0, split);
        buffer = buffer.slice(split + 2);
        const data = dataOf(frame);
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

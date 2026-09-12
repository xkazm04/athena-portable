/**
 * The daemon's eight routes, typed once — README section 3.2 ("how a turn flows") and ADR 0012
 * ("one turn is one SSE stream of channel events"). `docs/daemon.md` is the wire; this file is
 * that document in TypeScript and adds nothing to it.
 *
 * The shell proxies nothing: Rust spawns `athena serve`, learns its URL from the ready line and
 * holds the token (`lib/daemon.ts`), and the panel dials `127.0.0.1` itself with
 * `X-Athena-Token` — exactly the way a browser extension would.
 *
 * Three rules hold in here and are the reason it is a file rather than four `fetch` calls:
 *
 *  1. **A refusal is a typed error carrying the daemon's own words.** Every route answers a
 *     refusal in one shape, `{ok: false, reason, detail}`, where `reason` is a member of
 *     `ERROR_REASONS`. {@link DaemonError} carries both, so a caller renders the reason the
 *     daemon gave and never a paraphrase of it (README invariant 6).
 *  2. **`/run` is not buffered.** The daemon writes each frame the moment it is produced,
 *     because a decision card that arrives after the turn has ended is a card about a page that
 *     has moved on (ADR 0012). {@link runTurn} reads the body as a stream and yields frames as
 *     they close.
 *  3. **`fetch` is a parameter.** The headless run-loop test drives a whole turn against an
 *     in-process fake daemon (`src/test/fake-daemon.ts`) with no socket and no Python, which is
 *     the automation seam README section 3.5 says this build owes.
 *
 * Nothing here interprets a tool result. A result is untrusted host content; the surface fences
 * it on the way back (`stores/run.ts`) and the daemon fences it again before a model sees it.
 */
import { normalizeReason } from "@athena/bridge/gate";

/** Where the daemon is and what it wants on the header. `stores/daemon.ts` produces it. */
export interface Endpoint {
  url: string;
  token: string;
}

/** The one call shape this module needs, so a test can hand it a function and no socket. */
export type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

// -- refusals -------------------------------------------------------------------------------

/**
 * A route said no, or never answered.
 *
 * `reason` is always a member of the closed vocabulary — it goes through `normalizeReason` from
 * the gate, so a daemon that invents a word collapses to `unknown` here rather than reaching a
 * ledger column as a value nobody can group by (ADR 0009). `detail` is the daemon's sentence,
 * verbatim; `problems` is the list `POST /manifest` answers a refused manifest with.
 */
export class DaemonError extends Error {
  readonly reason: string;
  readonly detail: string;
  readonly status: number;
  readonly problems: readonly string[];

  constructor(reason: string, detail: string, status = 0, problems: readonly string[] = []) {
    super(detail || reason);
    this.name = "DaemonError";
    this.reason = normalizeReason(reason) ?? "unknown";
    this.detail = detail;
    this.status = status;
    this.problems = problems;
  }
}

// -- the frames ------------------------------------------------------------------------------

export interface TextDeltaFrame {
  kind: "text.delta";
  text: string;
}

export interface ToolCallFrame {
  kind: "tool.call";
  call_id: string;
  name: string;
  params: Record<string, unknown>;
  origin: string;
  tier: number;
}

export interface ToolResultFrame {
  kind: "tool.result";
  call_id: string;
  name: string;
  ok: boolean;
  output: string;
  truncated: boolean;
  error: string | null;
  tier: number;
  ms: number;
}

/**
 * A card. `tool` is `athena_decision`, the frontend-tool name a panel renders it as; it rides on
 * this frame rather than arriving as a second one, so the two readings cannot disagree (ADR 0012).
 */
export interface DecisionRequestedFrame {
  kind: "decision.requested";
  id: string;
  decision_kind: string;
  action: string;
  params: Record<string, unknown>;
  rationale: string;
  options: { id: string; label: string }[];
  expires_at: string;
  origin: string;
  surface: string;
  capture_id: string | null;
  tool: string;
}

export interface DecisionResolvedFrame {
  kind: "decision.resolved";
  id: string;
  choice: string;
  by: string;
  at: string;
}

export interface TurnSummaryFrame {
  kind: "turn.summary";
  model: string;
  engine: string;
  input_tokens: number;
  output_tokens: number;
  cost_usd: number | null;
  cost_estimated: boolean;
  duration_ms: number;
  rounds: number;
}

export interface TurnFinishedFrame {
  kind: "turn.finished";
  text: string;
  tts: string | null;
}

export interface TurnErrorFrame {
  kind: "turn.error";
  reason: string;
  detail: string;
}

/**
 * The eight kinds `contracts/channel.py` declares, and no ninth.
 *
 * The set is closed on purpose: ADR 0012 says a channel event *is* the wire, so a kind this
 * build has never heard of is a kind it cannot act on, and {@link parseFrame} drops it rather
 * than handing the store an object it would have to guess about. A ninth kind is a deliberate
 * change to `contracts/channel.py` and to this union, in that order.
 */
export type ChannelFrame =
  | TextDeltaFrame
  | ToolCallFrame
  | ToolResultFrame
  | DecisionRequestedFrame
  | DecisionResolvedFrame
  | TurnSummaryFrame
  | TurnFinishedFrame
  | TurnErrorFrame;

// -- the bodies ------------------------------------------------------------------------------

/** One tool the page registered, as `manifestOf` in the gate builds it. */
export interface ManifestToolBody {
  name: string;
  description: string;
  input_schema: unknown;
  reversible: boolean;
  side_effects: string;
  transport: string;
  inferred_from: string;
}

export interface ManifestBody {
  app_id: string;
  app_version: string;
  page_origin: string;
  generated_at: string;
  origin_kind: string;
  transport_detected: string;
  state_readables: unknown[];
  tools: ManifestToolBody[];
}

/** One executed call on the way back to the daemon (`lane/turn_frame.py::tool_results_from`). */
export interface ToolResultBody {
  call_id: string;
  name: string;
  ok: boolean;
  output: string;
  error: string | null;
  /** 1 the page's own tools, 2 the generic hands, 3 a connector (README section 3.4). */
  tier: number;
  ms: number;
}

export interface RunBody {
  message: string;
  origin: string;
  /** The open tabs, bounded and announced (README section 3.2 step 1). */
  host_state: Record<string, unknown>;
  /** What the page ran for the previous turn, or an empty list on the first. */
  tool_results: ToolResultBody[];
  surface: string;
  project_id?: string;
}

export interface DecideBody {
  choice: string;
  origin: string;
  /** What the user typed beside the button, or absent. Recorded, never merged into the grant. */
  answer?: string;
}

// -- the replies -----------------------------------------------------------------------------

/** The two halves of `(showing N of M)`, on every bounded read (README invariant 4). */
export interface Announced {
  ok: true;
  showing: number;
  total: number;
  footer: string;
}

export interface HealthReply extends Omit<Announced, "showing" | "total" | "footer"> {
  engine: string;
  model: string;
  brain: string;
  uptime_s: number;
  sessions: number;
  tools: number;
  pending: { showing: number; total: number; footer: string };
  routes: string[];
}

export interface ManifestToolReply {
  name: string;
  class: string;
  origin: string;
  tier: number;
}

export interface ManifestReply extends Announced {
  tools: ManifestToolReply[];
  app_id: string;
  origin: string;
  registry_origin: string;
  conversation_id: string;
}

export interface ExecuteInstruction {
  call_id: string;
  name: string;
  params: Record<string, unknown>;
  origin: string;
  tier: number;
  approval_id: string;
}

export interface DecideReply {
  ok: true;
  id: string;
  status: "approved" | "declined";
  choice: string;
  conversation_id: string;
  execute: ExecuteInstruction[];
  output: string;
  events: Record<string, unknown>[];
}

export interface PendingRow {
  id: string;
  action: string;
  params: Record<string, unknown>;
  rationale: string;
  options: string[];
  origin: string;
  conversation_id: string;
  surface: string;
  created_at: string;
  expires_at: string;
}

export interface DecisionsReply extends Announced {
  pending: PendingRow[];
}

export interface LedgerRow {
  row_id: number;
  turn_id: string;
  created_at: string;
  engine: string;
  model: string;
  conversation_id: string;
  origin: string;
  surface: string;
  trigger: string;
  rounds: number;
  input_tokens: number;
  output_tokens: number;
  cost_usd: number | null;
  cost_estimated: boolean;
  ms: number;
  is_error: boolean;
  error_reason: string | null;
}

export interface LedgerReply extends Announced {
  rows: LedgerRow[];
}

export interface RollupRow {
  key: string;
  turns: number;
  errors: number;
  rounds: number;
  input_tokens: number;
  output_tokens: number;
  cost_usd: number | null;
  ms: number;
}

export interface RollupReply extends Announced {
  rollup: RollupRow[];
  by: string;
}

export interface PlaybookItem {
  id: string;
  kind: string;
  excerpt: string;
  path: string;
  citations: number;
}

export interface PlaybooksReply extends Announced {
  items: PlaybookItem[];
  origin: string;
}

// -- the client ------------------------------------------------------------------------------

export interface DaemonClient {
  health(): Promise<HealthReply>;
  manifest(body: ManifestBody): Promise<ManifestReply>;
  /** One turn, frame by frame. The generator ends when the daemon closes the connection. */
  run(body: RunBody, signal?: AbortSignal): AsyncGenerator<ChannelFrame>;
  decide(id: string, body: DecideBody): Promise<DecideReply>;
  decisions(limit?: number): Promise<DecisionsReply>;
  ledger(limit?: number): Promise<LedgerReply>;
  ledgerRollup(by?: string): Promise<RollupReply>;
  playbooks(origin: string, limit?: number): Promise<PlaybooksReply>;
}

/**
 * A client for one daemon. `at` is read on every call rather than captured, so a caller may hold
 * a client across a restart; `fetchImpl` is the seam the headless test uses.
 */
export function daemonClient(at: Endpoint, fetchImpl: FetchLike = defaultFetch): DaemonClient {
  const get = <T>(path: string) => request<T>(fetchImpl, at, path, "GET", undefined);
  const post = <T>(path: string, body: unknown) => request<T>(fetchImpl, at, path, "POST", body);

  return {
    health: () => get<HealthReply>("/health"),
    manifest: (body) => post<ManifestReply>("/manifest", body),
    run: (body, signal) => runTurn(fetchImpl, at, body, signal),
    decide: (id, body) => post<DecideReply>(`/decisions/${encodeURIComponent(id)}`, body),
    decisions: (limit) => get<DecisionsReply>(`/decisions${query({ limit })}`),
    ledger: (limit) => get<LedgerReply>(`/ledger${query({ limit })}`),
    ledgerRollup: (by) => get<RollupReply>(`/ledger/rollup${query({ by })}`),
    playbooks: (origin, limit) => get<PlaybooksReply>(`/playbooks${query({ origin, limit })}`),
  };
}

const defaultFetch: FetchLike = (input, init) => fetch(input, init);

function headers(at: Endpoint, body: boolean): Record<string, string> {
  const base: Record<string, string> = { "X-Athena-Token": at.token, Accept: "application/json" };
  if (body) base["Content-Type"] = "application/json";
  return base;
}

function query(params: Record<string, string | number | undefined>): string {
  const parts = Object.entries(params)
    .filter(([, value]) => value !== undefined && value !== "")
    .map(([key, value]) => `${key}=${encodeURIComponent(String(value))}`);
  return parts.length === 0 ? "" : `?${parts.join("&")}`;
}

/**
 * One JSON route. A transport failure and a refusal end the same way — as a {@link DaemonError}
 * — because a caller that has to tell "the daemon said no" from "the daemon was not there" asks
 * the `reason`, and both are on it.
 */
async function request<T>(
  fetchImpl: FetchLike,
  at: Endpoint,
  path: string,
  method: "GET" | "POST",
  body: unknown,
): Promise<T> {
  let res: Response;
  try {
    res = await fetchImpl(`${at.url}${path}`, {
      method,
      headers: headers(at, body !== undefined),
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  } catch (e) {
    throw new DaemonError("engine_error", `${method} ${path} did not reach the daemon: ${say(e)}`);
  }
  const payload = await readJson(res);
  if (!res.ok || payload.ok === false) throw refusalOf(payload, res.status, `${method} ${path}`);
  return payload as T;
}

/** The refusal shape every route answers in, or the best sentence available when it did not. */
function refusalOf(payload: Refusal, status: number, what: string): DaemonError {
  const reason = typeof payload.reason === "string" ? payload.reason : "unknown";
  const detail =
    typeof payload.detail === "string" && payload.detail
      ? payload.detail
      : `${what} answered ${status}`;
  const problems = Array.isArray(payload.problems) ? payload.problems.map(String) : [];
  return new DaemonError(reason, detail, status, problems);
}

interface Refusal {
  ok?: unknown;
  reason?: unknown;
  detail?: unknown;
  problems?: unknown;
}

async function readJson(res: Response): Promise<Refusal & Record<string, unknown>> {
  try {
    const parsed: unknown = await res.json();
    if (parsed && typeof parsed === "object") return parsed as Refusal & Record<string, unknown>;
  } catch {
    // A body that is not JSON is a daemon that is not this one; the status carries the story.
  }
  return {};
}

/**
 * `POST /run`, read frame by frame off the body stream.
 *
 * Everything refusable is refused before the stream opens (ADR 0012) — an origin with no
 * manifest comes back as an ordinary JSON body with a status — so a non-2xx here is a
 * {@link DaemonError} and never a half-turn. Once the headers are out, the last frame is
 * `turn.finished` or `turn.error`, always, and the closed connection is the end of the body.
 */
async function* runTurn(
  fetchImpl: FetchLike,
  at: Endpoint,
  body: RunBody,
  signal?: AbortSignal,
): AsyncGenerator<ChannelFrame> {
  let res: Response;
  try {
    res = await fetchImpl(`${at.url}/run`, {
      method: "POST",
      headers: { ...headers(at, true), Accept: "text/event-stream" },
      body: JSON.stringify(body),
      ...(signal ? { signal } : {}),
    });
  } catch (e) {
    throw new DaemonError("engine_error", `POST /run did not reach the daemon: ${say(e)}`);
  }
  if (!res.ok) throw refusalOf(await readJson(res), res.status, "POST /run");
  if (!res.body) throw new DaemonError("engine_error", "POST /run answered 200 with no body", 200);

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    for (;;) {
      const { done, value } = await reader.read();
      buffer += decoder.decode(value ?? new Uint8Array(), { stream: !done });
      for (;;) {
        const cut = buffer.indexOf("\n\n");
        if (cut < 0) break;
        const frame = parseFrame(buffer.slice(0, cut));
        buffer = buffer.slice(cut + 2);
        if (frame) yield frame;
      }
      if (done) break;
    }
  } finally {
    // A caller that stopped early (a `break`, a thrown card) leaves the body open; cancelling is
    // what closes the socket, and the daemon's turn runs to its end either way (ADR 0012).
    await reader.cancel().catch(() => undefined);
  }
}

/**
 * One SSE frame to one channel event, or `null`.
 *
 * `data:` carries the whole event as one line of JSON and that line is the authority: `event:`
 * only repeats the `kind` already inside it, so this reads the JSON and uses the header for
 * nothing. Every field is coerced, because a frame is the one place in this app where a value
 * arrives from outside the type system.
 */
export function parseFrame(chunk: string): ChannelFrame | null {
  const data = chunk
    .split("\n")
    .map((line) => line.replace(/\r$/, ""))
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).trim())
    .join("\n");
  if (!data) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(data);
  } catch {
    // A frame we cannot parse is a frame we cannot act on. The turn still ends on its own last
    // frame, so dropping this one loses a line and never the ending.
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;
  const event = parsed as Record<string, unknown>;
  switch (event.kind) {
    case "text.delta":
      return { kind: "text.delta", text: str(event.text) };
    case "tool.call":
      return {
        kind: "tool.call",
        call_id: str(event.call_id),
        name: str(event.name),
        params: obj(event.params),
        origin: str(event.origin),
        tier: num(event.tier),
      };
    case "tool.result":
      return {
        kind: "tool.result",
        call_id: str(event.call_id),
        name: str(event.name),
        ok: event.ok !== false,
        output: str(event.output),
        truncated: event.truncated === true,
        error: event.error === null || event.error === undefined ? null : str(event.error),
        tier: num(event.tier),
        ms: num(event.ms),
      };
    case "decision.requested":
      return {
        kind: "decision.requested",
        id: str(event.id),
        decision_kind: str(event.decision_kind) || "approve",
        action: str(event.action),
        params: obj(event.params),
        rationale: str(event.rationale),
        options: options(event.options),
        expires_at: str(event.expires_at),
        origin: str(event.origin),
        surface: str(event.surface) || "panel",
        capture_id: typeof event.capture_id === "string" ? event.capture_id : null,
        tool: str(event.tool),
      };
    case "decision.resolved":
      return {
        kind: "decision.resolved",
        id: str(event.id),
        choice: str(event.choice),
        by: str(event.by) || "user",
        at: str(event.at),
      };
    case "turn.summary":
      return {
        kind: "turn.summary",
        model: str(event.model),
        engine: str(event.engine),
        input_tokens: num(event.input_tokens),
        output_tokens: num(event.output_tokens),
        cost_usd: typeof event.cost_usd === "number" ? event.cost_usd : null,
        cost_estimated: event.cost_estimated === true,
        duration_ms: num(event.duration_ms),
        rounds: num(event.rounds),
      };
    case "turn.finished":
      return {
        kind: "turn.finished",
        text: str(event.text),
        tts: typeof event.tts === "string" ? event.tts : null,
      };
    case "turn.error":
      return {
        kind: "turn.error",
        reason: normalizeReason(str(event.reason)) ?? "unknown",
        detail: str(event.detail),
      };
    default:
      return null;
  }
}

function str(value: unknown): string {
  if (value === null || value === undefined) return "";
  return typeof value === "string" ? value : String(value);
}

function num(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function obj(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

/** `options` is a list of `{id, label}`; a bare string is read as an id, which is what it is. */
function options(value: unknown): { id: string; label: string }[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => {
    if (typeof item === "string") return { id: item, label: item };
    const row = obj(item);
    const id = str(row.id);
    return { id, label: str(row.label) || id };
  });
}

function say(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

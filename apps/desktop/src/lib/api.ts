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
import {
  busEventFromJson,
  turnFrameFromJson,
  type BusEvent,
  type DeviceKind,
  type DevicesView,
  type Grant,
  type JoinView,
  type OverlayPeers,
  type PairingWindow,
  type PeerView,
  type TurnFrame,
} from "@/lib/fleet";
import type { CycleView, ProposalView, SleepRunAnswer, SleepView } from "@/lib/sleep";
import type { TasksView, TaskView } from "@/lib/tasks";
import type { VitalsResponse } from "@/lib/vitals";

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
export const globalFetch: FetchLike = (input, init) => fetch(input, init);

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
  /**
   * What the app declared about the tool (README section 3.3), kept beside the class so a card's
   * words read the declaration while the class stays the gate's (ADR 0189). Absent when the page
   * declared nothing, or a source does not carry them; `null` reversibility is undeclared too.
   */
  reversible?: boolean | null;
  side_effects?: string;
}

/** One `execute` instruction from a resolved approval: a host tool the page has to run. */
export interface ExecuteRow {
  call_id: string;
  name: string;
  params: Record<string, unknown>;
  origin: string;
  tier?: number;
  /** The tab the card was proposed on and its document generation, off the row (ADR 0103). */
  tab_id?: number | null;
  tab_nav?: number | null;
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
  /** The identity the writes switch and the allow-list were set under (ADR 0062). Not read here. */
  switches_identity?: string;
  /** The provider's stable account key, when it names one. Not read here. */
  account?: string;
  /** The account key the switches were set under. Not read here. */
  switches_account?: string;
  /**
   * The last check that reached no verdict (the provider unreachable, a rate limit, a refresh that
   * failed this time) and its obstacle; "" once a verdict came after it. Never written over
   * `health`. Optional: a daemon from before it sends neither.
   */
  attempt_at?: string;
  attempt_detail?: string;
  /** The vault's word at the last connect (writes reset for another account, ADR 0062); a probe keeps it. */
  notice?: string;
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
  /**
   * Whether the vault keeps the OAuth client this connector was connected with, so a reconnect
   * can reuse it (ADR 0117). A yes or a no, never the client. Optional: an older daemon omits it.
   */
  client_kept?: boolean;
  flow: FlowView | null;
  /** The vault's `records_notice`: plain words when the connections file could not be read, else "". */
  records_notice: string;
}

/** One tool of an MCP server, as the daemon classed it (`connector.<id>.<tool>`). */
export interface McpToolView {
  name: string;
  class: "AUTO" | "READ" | "GATED";
}

/**
 * `McpService.view()` in `src/athena/connectors/mcp/service.py` (ADR 0144): the token variable's
 * name and whether it is set, never its value; the URL without a query.
 */
export interface McpServerView {
  id: string;
  origin: string;
  kind: "mcp";
  url: string;
  token_env: string;
  token_set: boolean;
  live: boolean;
  health: "healthy" | "broken" | "unknown";
  health_detail: string;
  tools: McpToolView[];
}

export interface ConnectorPage {
  ok: boolean;
  connectors: ConnectorView[];
  /** Plain words when the connections file could not be read, else "". Shown verbatim. */
  records_notice: string;
  /** The MCP servers in `mcp.json` (ADR 0144). Optional: an older daemon omits it. */
  mcp_servers?: McpServerView[];
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
  /** The person's active project, rendered in every turn's frame: a playbook's title and goal. */
  active_project?: Record<string, unknown>;
  surface?: string;
  /**
   * Catalog origins (`host:<app_id>`) the user has switched off; the daemon's gate refuses a call
   * on any of them for this run (UAT backlog B2).
   */
  disabled_origins?: string[];
  /**
   * Catalog origins (`host:<app_id>`) of open tabs the user never registered: every tool of one is
   * `GATED` at the daemon's gate, whatever its flags say (ADR 0063).
   */
  gated_origins?: string[];
  /** Registry names (`host.<app_id>.<tool>`) the user pinned `GATED`. A pin only tightens. */
  gated_tools?: string[];
  /** The shell's capture (`cap_…`) of the focused tab, taken just before this request (ADR 0066). */
  capture_id?: string;
  /**
   * The tab this request ran against and its navigation count (ADR 0103). A card for a gated call
   * on this app is bound to them, so its approval runs on that document or not at all.
   */
  tab_id?: number;
  tab_nav?: number;
  /**
   * Other open tabs whose app the user trusts, one per app, with each tab's id and document
   * (ADR 0106). A call of a listed app may be proposed from this turn; the daemon's gate files it
   * as a card bound to that tab. First-sight and switched-off apps are never listed.
   */
  open_apps?: Array<{ app: string; origin: string; tab_id: number; tab_nav?: number }>;
  /** The saved case this turn is a run of (ADR 0127); routes nothing. */
  case_id?: string;
  /**
   * `schedule` on the first send after "Open and prepare" on a due chore's review (ADR 0131). The
   * daemon records it only when its chores clock agrees; otherwise the turn is an ordinary one.
   */
  trigger?: "schedule";
  /** A message another device sent (ADR 0140): the daemon tees this run back to it. Routes nothing. */
  via?: { peer_id: string; request_id: string };
  /**
   * The delegated task this turn belongs to (fleet-surfaces, ADR 0141), or `null` for the main
   * thread. When set, the daemon runs the turn in the task's own conversation (`conv_task_<hex>`)
   * and refuses it `task_not_running` unless that task is running. Optional only so a caller from
   * before tasks still type-checks; every turn this window sends says it.
   */
  task_id?: string | null;
  /**
   * The setup conversation's first turn (ADR 0140, WP4): "Set up with Athena" sends `true` with an
   * empty `message`, and the daemon writes what she is told, so she speaks first. Refused anywhere
   * but the setup session, and with any words of the window's own.
   */
  start?: boolean;
}

/** A refusal the daemon named. `reason` is a member of the one closed vocabulary. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly reason: string,
    detail: string,
    /**
     * The peer's own finer word beside `reason` (`window_closed`, `grant_missing`, ADR 0140), and
     * the device a peer refusal names. Empty for every other refusal.
     */
    readonly word: string = "",
    readonly device: string = "",
  ) {
    super(detail || reason);
    this.name = "ApiError";
  }
}

/** The answer of `GET /engines`. Rows have the shape `lib/engines.ts` renders (`EngineProbe`). */
export interface EnginePage {
  ok: boolean;
  engines: readonly { id: string; state: "found" | "not_found" | "not_logged_in"; detail: string }[];
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
  resolve(
    id: string,
    choice: string,
    origin?: string,
    answer?: string,
    disabledOrigins: readonly string[] = [],
  ): Promise<Resolution> {
    // The shell says the switched-off list on every request; the replay's switch check reads it.
    return this.json("POST", `/decisions/${encodeURIComponent(id)}`, {
      choice,
      origin,
      answer,
      disabled_origins: [...disabledOrigins],
    });
  }

  ledger(): Promise<Record<string, unknown>> {
    return this.json("GET", "/ledger");
  }

  /**
   * What the daemon's engine probe found on this machine, one row per engine (UAT backlog B4).
   * `GET /engines` answers `{ ok, engines: [{ id, state, detail }] }`; `state` is the closed set
   * `found | not_found | not_logged_in`, and `detail` is written for a person.
   */
  engines(): Promise<EnginePage> {
    return this.json("GET", "/engines");
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

  /**
   * Close a case's open run (ADR 0124): the daemon folds it and appends the receipt to the case file.
   * `receipt` is null when nothing ran since the last one; `problem` says why it was not saved, or "".
   */
  closeRun(caseId: string): Promise<{ ok: boolean; receipt: Record<string, unknown> | null; saved: boolean; problem: string }> {
    return this.json("POST", `/adopt/cases/${encodeURIComponent(caseId)}/done`, {});
  }

  /**
   * Stop the turn running for `origin` (ADR 0115). `stopped` is false when none of its turns was
   * running. A card the turn already filed is untouched and stays answerable.
   */
  stop(origin: string, conversationId: string | null = null): Promise<{ ok: boolean; stopped: boolean }> {
    return this.json("POST", "/run/stop", { origin, conversation_id: conversationId });
  }

  // -- delegated tasks (fleet-surfaces, ADR 0141): `/tasks*` -----------------------------------

  /** Active tasks and those finished in the last day, newest first, with the admission numbers. */
  tasks(): Promise<TasksView> {
    return this.json("GET", "/tasks");
  }

  /** Take the oldest queued task to run here, or `null` when none is queued or the cap is full. */
  claimTask(): Promise<{ task: TaskView | null }> {
    return this.json("POST", "/tasks/claim", {});
  }

  /** Report how a running task ended. The daemon tells its parent thread. */
  finishTask(taskId: string, status: "done" | "failed", result: string | null, error: string | null): Promise<{ task: TaskView }> {
    return this.json("POST", `/tasks/${encodeURIComponent(taskId)}/finish`, { status, result, error });
  }

  /** Kill a queued or running task. `stopped` is false when it had already ended. */
  stopTask(taskId: string): Promise<{ stopped: boolean }> {
    return this.json("POST", `/tasks/${encodeURIComponent(taskId)}/stop`, {});
  }

  // -- this PC's room and her sleep (device-vitals, ADR 0143): `/vitals`, `/sleep*` -------------

  /** This PC's latest vitals: what it measured, its task slots and why work waits, if it does. */
  vitals(): Promise<VitalsResponse> {
    return this.json("GET", "/vitals");
  }

  /** The sleep cycle now: pressure, the admission verdict in words, the last cycle, open proposals. */
  sleep(): Promise<{ sleep: SleepView }> {
    return this.json("GET", "/sleep");
  }

  /** The newest cycles first, at most `limit`. */
  sleepCycles(limit = 20): Promise<{ cycles: CycleView[] }> {
    return this.json("GET", `/sleep/cycles?limit=${limit}`);
  }

  /** One cycle and its journal (markdown), `null` when the journal was never written. */
  sleepCycle(cycleId: string): Promise<{ cycle: CycleView; journal: string | null }> {
    return this.json("GET", `/sleep/cycles/${encodeURIComponent(cycleId)}`);
  }

  /** The proposals a cycle left for a person: forget an unused memory, or settle a contradiction. */
  sleepProposals(): Promise<{ proposals: ProposalView[] }> {
    return this.json("GET", "/sleep/proposals");
  }

  /** Ask for a cycle now. `force` skips pressure and the floor, never a live turn or a lack of room. */
  sleepRun(force = false): Promise<SleepRunAnswer> {
    return this.json("POST", "/sleep/run", { force });
  }

  /** Keep or forget. A contradiction's `forget` names which of its two memories goes (`nodeId`). */
  sleepDecide(proposalId: string, action: "keep" | "forget", nodeId: string | null = null): Promise<{ proposal: ProposalView }> {
    return this.json("POST", `/sleep/proposals/${encodeURIComponent(proposalId)}`, { action, node_id: nodeId });
  }

  // -- the fleet (ADR 0140): `/devices*`, `/events`, `/remote/*` --------------------------------

  /** This device, its peers, the pending requests, the beacon and the overlay. */
  devices(): Promise<DevicesView> {
    return this.json("GET", "/devices");
  }

  /** The other devices on the private network, to pick the join form's address from (WP5). */
  overlayPeers(): Promise<OverlayPeers> {
    return this.json("GET", "/devices/overlay");
  }

  renameSelf(name: string): Promise<{ ok: boolean; self: DevicesView["self"] }> {
    return this.json("PUT", "/devices/self", { name });
  }

  setBeacon(on: boolean): Promise<{ ok: boolean; beacon: DevicesView["beacon"] }> {
    return this.json("PUT", "/devices/beacon", { on });
  }

  /** Open a pairing window: a phone's QR url, or a code another PC types in. */
  openPairing(kind: DeviceKind): Promise<PairingWindow> {
    return this.json("POST", "/devices/pairing", { kind });
  }

  /** Approve (grants may only narrow what was asked) or decline one pending request. */
  answerPending(
    pairingId: string,
    choice: "approve" | "decline",
    grants: readonly Grant[] | null,
    expiresDays: number | null = null,
  ): Promise<{ ok: boolean; state: string; peer: PeerView | null }> {
    return this.json("POST", `/devices/pending/${encodeURIComponent(pairingId)}`, {
      choice,
      grants: grants === null ? null : [...grants],
      expires_days: expiresDays,
    });
  }

  /** Revoke a peer, at once: its next request is refused. */
  revoke(peerId: string): Promise<{ ok: boolean; revoked: string }> {
    return this.json("DELETE", `/devices/${encodeURIComponent(peerId)}`);
  }

  /** Ask the PC at `address` (an overlay address) to let this one in, with the code its person read out. */
  join(address: string, code: string, grants: readonly Grant[], port?: number): Promise<{ ok: boolean; join: JoinView }> {
    return this.json("POST", "/devices/join", {
      address,
      code,
      requested_grants: [...grants],
      ...(port !== undefined ? { port } : {}),
    });
  }

  /** Send a message into another device's panel. 409 `window_closed` when Athena there is asleep. */
  sendMessage(peerId: string, text: string, targetApp: string | null = null): Promise<{ ok: boolean; request_id: string }> {
    return this.json("POST", `/devices/${encodeURIComponent(peerId)}/message`, { text, target_app: targetApp });
  }

  /**
   * Another device's turn, relayed from `from` on: its channel events, then `remote.closed`. The
   * stream also ends quietly after a while with nothing new; the caller comes back with `from` set
   * to how many events it has.
   */
  async *turn(peerId: string, requestId: string, from: number, signal?: AbortSignal): AsyncGenerator<TurnFrame> {
    const path = `/devices/${encodeURIComponent(peerId)}/turns/${encodeURIComponent(requestId)}?from=${from}`;
    const response = await this.fetchImpl(`${this.endpoint.url}${path}`, { method: "GET", headers: this.headers(), signal });
    if (!response.ok) throw await this.refusal(response);
    if (!response.body) return;
    for await (const frame of sseFrames(response.body)) yield turnFrameFromJson(frame);
  }

  /**
   * The loopback event bus, until it ends (after a quiet stretch) or `signal` aborts. A frame of a
   * kind this window does not act on is skipped. `fetch` and not `EventSource`, because an
   * `EventSource` cannot send the token header.
   */
  async *events(signal?: AbortSignal): AsyncGenerator<BusEvent> {
    const response = await this.fetchImpl(`${this.endpoint.url}/events`, { method: "GET", headers: this.headers(), signal });
    if (!response.ok) throw await this.refusal(response);
    if (!response.body) return;
    for await (const frame of sseFrames(response.body)) {
      const event = busEventFromJson(frame);
      if (event) yield event;
    }
  }

  /** Take a message another device sent: its turn will run here. 404 when it is no longer offered. */
  acceptRemote(requestId: string): Promise<Record<string, unknown>> {
    return this.json("POST", `/remote/${encodeURIComponent(requestId)}/accept`, {});
  }

  /** Tell the daemon a remote exchange is over: `finished`, or the reason it could not go on. */
  endRemote(requestId: string, reason: string, detail = ""): Promise<Record<string, unknown>> {
    return this.json("POST", `/remote/${encodeURIComponent(requestId)}/end`, { reason, detail });
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
    let word = "";
    let device = "";
    try {
      const payload = (await response.json()) as { reason?: string; detail?: string; error?: unknown; name?: unknown };
      reason = payload.reason ?? reason;
      detail = payload.detail ?? "";
      word = typeof payload.error === "string" ? payload.error : "";
      device = typeof payload.name === "string" ? payload.name : "";
    } catch {
      // A refusal that is not JSON is still a refusal; the status is what the panel shows.
    }
    return new ApiError(response.status, reason, detail, word, device);
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
  let ended = false;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) {
        ended = true;
        break;
      }
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
    // A reader that stopped early (a `break` after the terminal event, a throw in its loop) leaves
    // a body nobody will read: cancel it, so the connection closes instead of buffering unread
    // until the server ends it. An errored body rejects the cancel with its own error, ignored here.
    if (!ended) await reader.cancel().catch(() => undefined);
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

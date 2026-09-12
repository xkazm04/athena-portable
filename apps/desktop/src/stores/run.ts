/**
 * The run loop — README section 3.2 ("how a turn flows"), and the only one in this app (ADR 0017).
 *
 * One store owns a conversation with the daemon: it posts the focused page's manifest, streams
 * `POST /run`, runs on the page whatever the daemon's gate allowed, holds the card the gate filed
 * and, when the user answers it, runs what came back and continues the turn with the results.
 * Views read this store and render it. **No view talks to the daemon**, and no view starts this
 * store: `startRun()` is called by the app root and by nothing else, which is the day-zero rule
 * from README section 3.5 — the first build's tray count lived in one page and froze the moment
 * the user looked at something else, and a turn that only runs while the Panel module is on
 * screen is the same bug with a bigger blast radius.
 *
 * Four rules hold in here.
 *
 *  1. **The gate is the policy, and the daemon is the gate.** Nothing in this file decides a
 *     class. The user's per-origin overrides are applied *to the manifest* through `decide()` in
 *     `@athena/bridge/gate` — an override may tighten a tool to `GATED` and can never loosen one
 *     — so the daemon's catalog holds the tightened class and the daemon files the card. A
 *     surface that second-guessed a call the daemon allowed would be a second gate.
 *  2. **A page's answer is untrusted text.** Every result is capped, announced and wrapped in the
 *     gate's nonce fence before it is handed back as the next turn's `tool_results`. The daemon
 *     fences it again for the prompt; this is the fence at the boundary this process owns.
 *  3. **Every refusal is verbatim.** A reason from the closed vocabulary and the daemon's own
 *     sentence reach the transcript unparaphrased, and the same row lands in the `activity`
 *     table, because "what did it do, through which surface, and why did it stop" is a question
 *     the record has to answer (README section 2.2).
 *  4. **Every host call is recorded.** One `activity` row per call, refusal included, carrying
 *     the tab, the origin, the tier, the class, the milliseconds and the approval id. The write
 *     is a record and never a gate: a store that refuses must not fail the call it was recording.
 */
import { Budget, decide, fence, manifestOf } from "@athena/bridge/gate";
import { create } from "zustand";

import { bridgeCall, onToolChange, type BridgeTool, type CallReply } from "@/lib/bridge";
import {
  DaemonError,
  daemonClient,
  type DecisionRequestedFrame,
  type Endpoint,
  type ExecuteInstruction,
  type FetchLike,
  type ManifestBody,
  type ToolCallFrame,
  type ToolResultBody,
} from "@/lib/daemon-client";
import { hasShell, type Tab } from "@/lib/ipc";
import { storeSet } from "@/lib/store";
import { endpoint as endpointOf, useDaemon } from "@/stores/daemon";
import { useOrigins } from "@/stores/origins";
import { useTabs } from "@/stores/tabs";
import { useTools } from "@/stores/tools";

/** How many rounds of tool calls make one `send`. The harness bounds a turn; this bounds a chore. */
export const MAX_ROUNDS = 8;
/** How much of a page's answer reaches the next turn, before the fence. */
export const OUTPUT_CAP = 6000;
/** README section 3.2 step 1: `host_state` carries the open tabs, bounded and announced. */
export const HOST_STATE_TABS = 12;
/** What the next round is asked, once the page has answered the last one. */
const CONTINUE = "Continue with the results of the calls you made.";
/** The fence label the surface wraps a page's answer in. A slug, because it is a delimiter. */
const FENCE_LABEL = "host_result";

// -- the public shapes -------------------------------------------------------------------------

/** The three classes the gate knows (README section 3.3). A page manifest only ever implies two. */
export type ToolClass = "GATED" | "READ" | "AUTO";

/**
 * One line of the transcript. `kind` is what happened, not how to paint it: a view chooses the
 * shape, and a line the view has no shape for is still a line the user can read.
 */
export interface TranscriptItem {
  id: string;
  kind: "user" | "assistant" | "tool.call" | "tool.result" | "decision" | "error" | "summary";
  text: string;
  at: number;
  meta?: Record<string, unknown>;
}

/** The card, as the decision surface renders it (README section 3.2 step 6). */
export interface Decision {
  id: string;
  action: string;
  params: Record<string, unknown>;
  summary: string;
  options: string[];
  /** The screenshot the daemon minted the approval with, once c24 captures one. */
  captureId: string | null;
  /** The catalog origin, `host:<app_id>` — not the page's web origin. */
  origin: string;
  surface: string;
  createdAt: number;
}

/** One row of the tool list: what the page claims, what the user pinned, and what the gate says. */
export interface ToolRow {
  name: string;
  origin: string;
  description: string;
  /** 1 the page's own tools, 2 the generic hands, 3 a connector (README section 3.4). */
  tier: 1 | 2 | 3;
  declaredCls: ToolClass;
  overrideCls: ToolClass | null;
  effectiveCls: ToolClass;
  transport: string;
}

/** Where the loop is. `awaiting_decision` means a card is pinned and the turn is parked on it. */
export type RunStatus = "idle" | "streaming" | "awaiting_decision" | "error";

export interface RunState {
  status: RunStatus;
  transcript: TranscriptItem[];
  pendingDecision: Decision | null;
  /** The last refusal, kept until the next `send` clears it. Both halves, never paraphrased. */
  lastError: { reason: string; detail: string } | null;
  conversationId: string | null;
  tools: ToolRow[];
}

const EMPTY: RunState = {
  status: "idle",
  transcript: [],
  pendingDecision: null,
  lastError: null,
  conversationId: null,
  tools: [],
};

export const useRun = create<RunState>(() => ({ ...EMPTY }));

// -- what the loop needs from the rest of the app ----------------------------------------------

/** The page in front of the user, as one value. `null` when no tab is focused. */
export interface FocusedPage {
  tabId: number;
  /** The web origin (`https://invoices.example`): the `origins` table's key and `page_origin`. */
  origin: string;
  url: string;
  title: string;
  /** The page's `athena:app` slug, when it published one. */
  appId: string | null;
  transport: string;
  tools: readonly BridgeTool[];
}

/** One `activity` row, in the table's own column names (`src-tauri/src/store.rs`). */
export interface ActivityWrite {
  ts: string;
  tab_id: number | null;
  origin: string;
  tool: string;
  tier: number;
  class: string;
  outcome: string;
  ms: number;
  reason: string | null;
  approval_id: string | null;
}

/**
 * Everything the loop reaches outside itself, as functions.
 *
 * This is the automation seam README section 3.5 says milestone 5 owes: `resetRunForTests` swaps
 * any of these, so `stores/run.test.ts` drives a whole turn against an in-process fake daemon and
 * a fake bridge with no Tauri, no socket and no Python.
 */
export interface RunDeps {
  fetch: FetchLike;
  endpoint: () => Endpoint | null;
  focused: () => FocusedPage | null;
  tabs: () => readonly Tab[];
  /** The user's per-tool class map for one origin, from the `origins` table. */
  overrides: (origin: string) => Record<string, ToolClass>;
  saveOverride: (origin: string, tool: string, cls: ToolClass | null) => Promise<void>;
  forget: (origin: string) => Promise<void>;
  hostCall: (
    tabId: number,
    name: string,
    params: Record<string, unknown>,
  ) => Promise<CallReply>;
  recordActivity: (row: ActivityWrite) => Promise<void>;
  now: () => number;
}

function liveDeps(): RunDeps {
  return {
    fetch: (input, init) => fetch(input, init),
    endpoint: () => endpointOf(useDaemon.getState()),
    focused: focusedFromStores,
    tabs: () => useTabs.getState().tabs,
    overrides: (origin) => useOrigins.getState().records[origin]?.overrides ?? {},
    saveOverride: (origin, tool, cls) => useOrigins.getState().setOverride(origin, tool, cls),
    forget: (origin) => useOrigins.getState().forget(origin),
    hostCall: (tabId, name, params) => bridgeCall(tabId, name, params as Record<string, never>),
    recordActivity: async (row) => {
      await storeSet("activity", "", { ...row });
    },
    now: () => Date.now(),
  };
}

/** The focused tab, joined to what it registered. Both stores are mirrors; neither is asked here. */
function focusedFromStores(): FocusedPage | null {
  const tab = useTabs.getState().tabs.find((t) => t.focused);
  if (!tab) return null;
  const known = useTools.getState().byTab[tab.id];
  return {
    tabId: tab.id,
    origin: originOf(tab.url),
    url: tab.url,
    title: tab.title,
    appId: known?.appId ?? null,
    transport: known?.transport ?? "",
    tools: known?.tools ?? [],
  };
}

// -- module state, outside the store -----------------------------------------------------------

/** The manifest this panel last got the daemon to accept, and what the daemon called it. */
interface Session {
  /** The manifest body that was accepted, as text. Re-posting an identical one is a round trip. */
  key: string;
  pageOrigin: string;
  registryOrigin: string;
  appId: string;
  conversationId: string;
}

let deps: RunDeps = liveDeps();
let session: Session | null = null;
let budget = new Budget();
/** Registry origin to the web origin its manifest was published from, for naming a page to open. */
let pages = new Map<string, string>();
/** Results held while a card waits, so the next turn carries what already ran beside it. */
let carried: ToolResultBody[] = [];
let inFlight = false;
let seq = 0;
let started = false;

// -- the actions --------------------------------------------------------------------------------

export interface RunActions {
  send: (message: string) => Promise<void>;
  answer: (approvalId: string, choice: string, answer?: string) => Promise<void>;
  setOverride: (origin: string, tool: string, cls: ToolClass | null) => Promise<void>;
  forgetOrigin: (origin: string) => Promise<void>;
  clear: () => void;
}

export const runActions: RunActions = {
  send,
  answer,
  setOverride,
  forgetOrigin,
  clear,
};

/**
 * One user message, and every round it takes.
 *
 * The origin and the tools come from the focused tab; the manifest is posted first when it is not
 * the one the daemon already holds; then the turn streams, the allowed calls run on the page, and
 * their results ride the next round. A card ends the rounds — the user is the next move.
 */
async function send(message: string): Promise<void> {
  if (inFlight) {
    note("error", "A turn is already running. Wait for it to finish, or answer the open card.");
    return;
  }
  const at = deps.endpoint();
  if (!at) {
    fail("engine_error", "The daemon is not ready. Check Settings, or wait for it to finish starting.");
    return;
  }
  const page = deps.focused();
  if (!page) {
    fail("unknown", "No page is focused. Open a tab and try again.");
    return;
  }

  useRun.setState({ lastError: null });
  note("user", message);
  inFlight = true;
  try {
    const live = await manifestFor(at, page);
    if (!live) return;
    carried = [];
    await pump(at, page, message, []);
  } finally {
    inFlight = false;
  }
}

/**
 * The user's answer to one card (README section 3.2 step 6).
 *
 * The daemon replays the gate with the approval id and hands back an `execute` instruction whose
 * parameters come off the approval *row*. Those run on the page they belong to and on no other:
 * a call executed on the wrong page is not a smaller mistake than a call not executed, so a
 * focused tab that has moved gets an error item naming the page to open and nothing runs.
 */
async function answer(approvalId: string, choice: string, answerText?: string): Promise<void> {
  const at = deps.endpoint();
  const card = useRun.getState().pendingDecision;
  if (!at) {
    fail("engine_error", "The daemon is not ready; the card is still in the inbox.");
    return;
  }
  const client = daemonClient(at, deps.fetch);
  const action = card?.action ?? "";
  let reply;
  try {
    reply = await client.decide(approvalId, {
      choice,
      origin: session?.pageOrigin ?? "",
      ...(answerText && answerText.trim() ? { answer: answerText } : {}),
    });
  } catch (e) {
    const refusal = asDaemonError(e);
    note("error", `decision ${approvalId} — ${refusal.reason}: ${refusal.detail}`, {
      reason: refusal.reason,
    });
    useRun.setState({ status: "error", lastError: { reason: refusal.reason, detail: refusal.detail } });
    return;
  }

  useRun.setState({
    pendingDecision: null,
    conversationId: reply.conversation_id || useRun.getState().conversationId,
  });
  note("decision", `${reply.status} — ${bare(action) || approvalId}`, {
    id: approvalId,
    choice: reply.choice,
    status: reply.status,
  });

  if (reply.execute.length === 0) {
    // A decline, or a core tool that ran inside the daemon. Either way nothing runs on the page,
    // and the turn continues only if something else already had results waiting.
    if (reply.output.trim()) note("tool.result", reply.output);
    await resume(at);
    return;
  }

  const page = deps.focused();
  for (const instruction of reply.execute) {
    const ran = await executeApproved(page, instruction);
    if (ran) carried.push(ran);
  }
  await resume(at);
}

/** Pin a tool at a class for one origin, or clear the pin. A loosening is refused and said so. */
async function setOverride(origin: string, tool: string, cls: ToolClass | null): Promise<void> {
  await deps.saveOverride(origin, tool, cls);
  refreshTools();
  if (cls === null) return;
  const row = useRun.getState().tools.find((t) => t.name === tool && t.origin === origin);
  if (row && row.effectiveCls !== cls) {
    // README section 3.3: a surface may tighten a class per origin and never loosen one below
    // what the flags imply. The pin is stored — it is the user's stated preference — and the gate
    // simply does not honour it, which is the sentence the user is owed.
    note(
      "error",
      `${tool} stays ${row.effectiveCls}: an origin may tighten a class and never loosen one.`,
      { tool, asked: cls, effective: row.effectiveCls },
    );
  }
}

/** Forget an origin: trust, pins and both sightings go, so the next visit is a first sight. */
async function forgetOrigin(origin: string): Promise<void> {
  await deps.forget(origin);
  if (session?.pageOrigin === origin) session = null;
  budget.reset(origin);
  refreshTools();
  note("decision", `forgot ${origin}; the next visit is a first sight again`, { origin });
}

/**
 * Start over. The transcript, the error and the card go.
 *
 * A card that was open is dropped from this panel and **not** declined: only the daemon may
 * resolve an approval row, so the row is still in the inbox and the Approvals module still shows
 * it. Clearing a view is not an answer.
 */
function clear(): void {
  carried = [];
  useRun.setState({
    status: "idle",
    transcript: [],
    pendingDecision: null,
    lastError: null,
  });
}

// -- the loop -----------------------------------------------------------------------------------

/** Rounds, until the page has nothing more to answer, a card waits, or the ceiling is reached. */
async function pump(
  at: Endpoint,
  page: FocusedPage,
  message: string,
  results: ToolResultBody[],
): Promise<void> {
  const client = daemonClient(at, deps.fetch);
  let ask = message;
  let feed = results;
  for (let round = 0; round < MAX_ROUNDS; round++) {
    const turn = await stream(client, page, ask, feed);
    if (turn.failed) return;
    if (turn.card) {
      carried = turn.results;
      showCard(turn.card);
      return;
    }
    if (turn.results.length === 0) {
      useRun.setState({ status: "idle" });
      return;
    }
    feed = turn.results;
    ask = CONTINUE;
  }
  note("error", `Stopped after ${MAX_ROUNDS} rounds of tool calls.`);
  useRun.setState({ status: "idle" });
}

interface TurnOutcome {
  failed: boolean;
  card: DecisionRequestedFrame | null;
  results: ToolResultBody[];
}

/**
 * One `POST /run`, and then the calls it asked the page for.
 *
 * A `tool.call` the daemon also answered with a `tool.result` is a call that never reached a
 * page: the gate cancelled it, and the result carries the reason (`pending_approval` for a card
 * it just filed). So the calls this surface runs are exactly the ones the stream left unanswered,
 * which is the wire's own way of saying "the page runs this one" (ADR 0010).
 */
async function stream(
  client: ReturnType<typeof daemonClient>,
  page: FocusedPage,
  message: string,
  results: ToolResultBody[],
): Promise<TurnOutcome> {
  useRun.setState({ status: "streaming" });
  const calls = new Map<string, ToolCallFrame>();
  const answered = new Set<string>();
  let card: DecisionRequestedFrame | null = null;
  let streamed = "";
  let spoken = "";

  try {
    for await (const frame of client.run({
      message,
      origin: page.origin,
      host_state: hostState(),
      tool_results: results,
      surface: "panel",
    })) {
      switch (frame.kind) {
        case "text.delta":
          streamed += frame.text;
          break;
        case "tool.call":
          calls.set(frame.call_id, frame);
          note("tool.call", `→ ${bare(frame.name)} ${JSON.stringify(frame.params)}`, {
            call_id: frame.call_id,
            name: frame.name,
            tier: frame.tier,
          });
          break;
        case "tool.result":
          answered.add(frame.call_id);
          note("tool.result", resultLine(frame.name, frame.ok, frame.error, frame.output), {
            call_id: frame.call_id,
            name: frame.name,
            ok: frame.ok,
            reason: frame.error,
          });
          break;
        case "decision.requested":
          card = frame;
          break;
        case "decision.resolved":
          note("decision", `${frame.choice} — ${frame.id}`, { id: frame.id, by: frame.by });
          break;
        case "turn.summary":
          note(
            "summary",
            `${frame.engine} ${frame.model} — ${frame.input_tokens} in / ${frame.output_tokens} out,` +
              ` ${frame.rounds} round${frame.rounds === 1 ? "" : "s"}` +
              (frame.cost_usd === null ? "" : `, $${frame.cost_usd.toFixed(4)}`),
            { ...frame },
          );
          break;
        case "turn.finished":
          spoken = frame.text;
          break;
        case "turn.error":
          note("error", `${frame.reason} — ${frame.detail}`, { reason: frame.reason });
          useRun.setState({
            status: "error",
            lastError: { reason: frame.reason, detail: frame.detail },
          });
          return { failed: true, card: null, results: [] };
      }
    }
  } catch (e) {
    const refusal = asDaemonError(e);
    note("error", `${refusal.reason} — ${refusal.detail}`, { reason: refusal.reason });
    useRun.setState({ status: "error", lastError: { reason: refusal.reason, detail: refusal.detail } });
    return { failed: true, card: null, results: [] };
  }

  // `turn.finished` carries the turn's whole text and the deltas carry it in pieces; one of the
  // two is the line, never both, or the transcript says everything twice.
  const said = (spoken.trim() ? spoken : streamed).trim();
  if (said) note("assistant", said);

  const out: ToolResultBody[] = [];
  for (const call of calls.values()) {
    if (answered.has(call.call_id)) continue;
    out.push(await runHostCall(page, call.name, call.params, call.call_id, call.tier, null));
  }
  return { failed: false, card, results: out };
}

/** A card arrived: the turn is over and the user is the next move. */
function showCard(frame: DecisionRequestedFrame): void {
  useRun.setState({
    status: "awaiting_decision",
    pendingDecision: {
      id: frame.id,
      action: frame.action,
      params: frame.params,
      summary: frame.rationale,
      options: frame.options.map((o) => o.id),
      captureId: frame.capture_id,
      origin: frame.origin,
      surface: frame.surface,
      createdAt: deps.now(),
    },
  });
  note("decision", `${bare(frame.action)} needs your approval — ${frame.rationale}`, {
    id: frame.id,
    action: frame.action,
  });
}

/** After a card is answered: carry what has run into the next round, or stop with nothing to say. */
async function resume(at: Endpoint): Promise<void> {
  const results = carried;
  carried = [];
  const page = deps.focused();
  if (results.length === 0 || !page || !session || page.origin !== session.pageOrigin) {
    useRun.setState({ status: "idle" });
    return;
  }
  if (inFlight) return;
  inFlight = true;
  try {
    await pump(at, page, CONTINUE, results);
  } finally {
    inFlight = false;
  }
}

// -- calls on the page ---------------------------------------------------------------------------

/**
 * One approved call, run only on the page it was approved for.
 *
 * `instruction.origin` is the catalog origin (`host:<app_id>`); the web origin its manifest came
 * from is what the user has to have in front of them, and `pages` remembers the pairing from
 * every accepted manifest. When the two disagree nothing runs and the item names the page.
 */
async function executeApproved(
  page: FocusedPage | null,
  instruction: ExecuteInstruction,
): Promise<ToolResultBody | null> {
  const wanted = pages.get(instruction.origin) ?? instruction.origin;
  if (!page || page.origin !== wanted) {
    const here = page ? page.origin : "no tab is focused";
    note(
      "error",
      `${bare(instruction.name)} was approved for ${instruction.origin}; open ${wanted} in the` +
        ` focused tab and answer again — nothing ran (${here}).`,
      { reason: "foreign_origin", origin: instruction.origin, page: wanted },
    );
    await record({
      tool: bare(instruction.name),
      origin: instruction.origin,
      tabId: page?.tabId ?? null,
      tier: instruction.tier,
      cls: "GATED",
      ok: false,
      reason: "foreign_origin",
      ms: 0,
      approvalId: instruction.approval_id,
    });
    return null;
  }
  return runHostCall(
    page,
    instruction.name,
    instruction.params,
    instruction.call_id,
    instruction.tier,
    instruction.approval_id,
  );
}

/**
 * Run one call on the focused page and build the `tool_results` row it becomes.
 *
 * The class is read for the record, never to decide: the daemon's gate already allowed this call,
 * and the user's tightening rode into that decision on the manifest. What is decided here is only
 * what the surface owns — the per-origin call budget, and whether this page still has the tool.
 */
async function runHostCall(
  page: FocusedPage,
  name: string,
  params: Record<string, unknown>,
  callId: string,
  tier: number,
  approvalId: string | null,
): Promise<ToolResultBody> {
  const short = bare(name);
  const tool = page.tools.find((t) => t.name === short);
  const cls = tool ? effective(tool, deps.overrides(page.origin)) : "GATED";

  const refuse = async (reason: string, detail: string): Promise<ToolResultBody> => {
    note("tool.result", `✗ ${short} — ${reason}: ${detail}`, { name, reason });
    await record({
      tool: short,
      origin: page.origin,
      tabId: page.tabId,
      tier,
      cls,
      ok: false,
      reason,
      ms: 0,
      approvalId,
    });
    return row(callId, name, false, `refused: ${reason} — ${detail}`, reason, tier, 0);
  };

  if (!tool) {
    return refuse("unknown_ref", `${page.origin} has no tool named ${short} right now`);
  }
  const claim = budget.take(page.origin);
  if (!claim.ok) return refuse("budget_exhausted", claim.message);

  const started = deps.now();
  let reply: CallReply;
  try {
    reply = await deps.hostCall(page.tabId, short, params);
  } catch (e) {
    reply = { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
  const ms = Math.max(deps.now() - started, 0);

  if (!reply.ok) {
    const reason = reply.reason ?? "unknown";
    note("tool.result", `✗ ${short} — ${reason}: ${reply.error}`, { name, reason });
    await record({
      tool: short,
      origin: page.origin,
      tabId: page.tabId,
      tier,
      cls,
      ok: false,
      reason,
      ms,
      approvalId,
    });
    return row(callId, name, false, `refused: ${reason} — ${reply.error}`, reason, tier, ms);
  }

  const output = capped(reply.output, OUTPUT_CAP);
  note("tool.result", `✓ ${short} (${ms} ms)`, { name, ok: true, ms });
  await record({
    tool: short,
    origin: page.origin,
    tabId: page.tabId,
    tier,
    cls,
    ok: true,
    reason: null,
    ms,
    approvalId,
  });
  // Rule 2: what a page wrote is data. It goes back inside a fence it cannot close from inside.
  return row(callId, name, true, fence(output, FENCE_LABEL), null, tier, ms);
}

function row(
  callId: string,
  name: string,
  ok: boolean,
  output: string,
  error: string | null,
  tier: number,
  ms: number,
): ToolResultBody {
  return { call_id: callId, name, ok, output, error, tier, ms };
}

/** One `activity` row. A record, never a gate: a refused write must not fail the call. */
async function record(call: {
  tool: string;
  origin: string;
  tabId: number | null;
  tier: number;
  cls: string;
  ok: boolean;
  reason: string | null;
  ms: number;
  approvalId: string | null;
}): Promise<void> {
  try {
    await deps.recordActivity({
      ts: new Date(deps.now()).toISOString(),
      tab_id: call.tabId,
      origin: call.origin,
      tool: call.tool,
      tier: call.tier,
      class: call.cls,
      outcome: call.ok ? "ok" : "refused",
      ms: call.ms,
      reason: call.reason,
      approval_id: call.approvalId,
    });
  } catch (e) {
    note("error", `activity row not written: ${e instanceof Error ? e.message : String(e)}`);
  }
}

// -- the manifest ---------------------------------------------------------------------------------

/**
 * Make sure the daemon holds this page's manifest, with the user's tightenings in it.
 *
 * Posted once per document, and again whenever the manifest it *would* send has changed — which
 * is what a `bridge:toolchange` and a pinned class both do, and what a second `send` on the same
 * page does not. The body itself is the key, so the question "is this already registered" is
 * answered by the thing that would be sent and not by a guess about when to re-send.
 */
async function manifestFor(at: Endpoint, page: FocusedPage): Promise<Session | null> {
  const body = buildManifest(page, deps.overrides(page.origin));
  const key = JSON.stringify({ ...body, generated_at: "" });
  if (session && session.key === key && session.pageOrigin === page.origin) return session;

  try {
    const reply = await daemonClient(at, deps.fetch).manifest(body);
    session = {
      key,
      pageOrigin: page.origin,
      registryOrigin: reply.registry_origin,
      appId: reply.app_id,
      conversationId: reply.conversation_id,
    };
    pages.set(reply.registry_origin, page.origin);
    useRun.setState({ conversationId: reply.conversation_id });
    refreshTools();
    return session;
  } catch (e) {
    const refusal = asDaemonError(e);
    session = null;
    const problems = refusal.problems.length > 0 ? `: ${refusal.problems.join("; ")}` : "";
    note("error", `${refusal.reason} — ${refusal.detail}${problems}`, { reason: refusal.reason });
    useRun.setState({
      status: "error",
      lastError: { reason: refusal.reason, detail: `${refusal.detail}${problems}` },
    });
    return null;
  }
}

/**
 * The manifest for one page, with the origin's pins folded in.
 *
 * `manifestOf` in the gate turns what the page registered into README section 3.3 flags; a pin
 * that `decide()` honours — always a tightening to `GATED` — is applied by writing `reversible:
 * false` onto that tool's flags, which is what `HostTool.default_class` reads. The class itself
 * is never sent: the daemon derives it, here as everywhere (README invariant 3).
 */
export function buildManifest(
  page: FocusedPage,
  overrides: Record<string, ToolClass>,
): ManifestBody {
  const built = manifestOf(
    {
      origin: page.origin,
      app_id: page.appId,
      app_version: null,
      transport: page.transport,
      state_readables: [],
    },
    page.tools.map(gateTool),
  ) as ManifestBody;
  return {
    ...built,
    app_id: slug(built.app_id),
    page_origin: page.origin,
    tools: built.tools.map((tool) => {
      const source = page.tools.find((t) => t.name === tool.name);
      if (!source) return tool;
      const verdict = decide(gateTool(source), overrides);
      if (!verdict.tightened) return tool;
      return { ...tool, reversible: false, inferred_from: "user_override" };
    }),
  };
}

// -- the tool list -------------------------------------------------------------------------------

/** Recompute `tools` from the focused page and that origin's pins. Pure apart from the store. */
export function refreshTools(): void {
  const page = deps.focused();
  if (!page) {
    if (useRun.getState().tools.length > 0) useRun.setState({ tools: [] });
    return;
  }
  const overrides = deps.overrides(page.origin);
  const rows: ToolRow[] = page.tools.map((tool) => {
    const verdict = decide(gateTool(tool), overrides);
    return {
      name: tool.name,
      origin: page.origin,
      description: tool.description,
      // Tier 1 is what a page registered. The hands are tier 2 and connectors tier 3; both
      // arrive in later commits and neither is invented here.
      tier: 1,
      declaredCls: cls(verdict.declared),
      overrideCls: overrides[tool.name] ?? null,
      effectiveCls: cls(verdict.cls),
      transport: page.transport,
    };
  });
  useRun.setState({ tools: rows });
}

/** What the gate would enforce for one tool on one origin. */
function effective(tool: BridgeTool, overrides: Record<string, ToolClass>): ToolClass {
  return cls(decide(gateTool(tool), overrides).cls);
}

/** The gate answers a string; this is the one place it becomes the union the app carries. */
function cls(value: string): ToolClass {
  return value === "GATED" || value === "READ" ? value : "AUTO";
}

/** What a page claimed about one tool, in the shape the gate reads. A claim, never a permission. */
function gateTool(tool: BridgeTool): {
  name: string;
  description: string;
  inputSchema: unknown;
  athena: { reversible?: unknown; side_effects?: unknown } | null;
  annotations: Record<string, unknown> | null;
} {
  const athena = tool.athena;
  const annotations = tool.annotations;
  return {
    name: tool.name,
    description: tool.description,
    inputSchema: tool.inputSchema,
    athena:
      athena && typeof athena === "object"
        ? (athena as { reversible?: unknown; side_effects?: unknown })
        : null,
    annotations:
      annotations && typeof annotations === "object"
        ? (annotations as Record<string, unknown>)
        : null,
  };
}

// -- the frame around a turn ----------------------------------------------------------------------

/**
 * What the host can be asked about (README section 3.2 step 1), bounded and announcing what it cut.
 *
 * The focused tab sorts first so it is never the one that gets left out, and the note is a
 * sentence the model reads rather than a number it has to infer.
 */
function hostState(): Record<string, unknown> {
  const all = deps.tabs();
  const ordered = [...all].sort((a, b) => Number(b.focused) - Number(a.focused));
  const shown = ordered.slice(0, HOST_STATE_TABS);
  return {
    tabs: shown.map((t) => ({ id: t.id, url: t.url, title: t.title, focused: t.focused })),
    tabs_note: `(showing ${shown.length} of ${all.length} open tabs)`,
  };
}

// -- small things ----------------------------------------------------------------------------------

function note(
  kind: TranscriptItem["kind"],
  text: string,
  meta?: Record<string, unknown>,
): void {
  seq += 1;
  const item: TranscriptItem = {
    id: `item_${seq}`,
    kind,
    text,
    at: deps.now(),
    ...(meta ? { meta } : {}),
  };
  useRun.setState((s) => ({ transcript: [...s.transcript, item] }));
}

/** A refusal the loop raised itself, on the transcript and in `lastError` both. */
function fail(reason: string, detail: string): void {
  note("error", `${reason} — ${detail}`, { reason });
  useRun.setState({ status: "error", lastError: { reason, detail } });
}

function resultLine(name: string, ok: boolean, error: string | null, output: string): string {
  if (ok) return `· ${bare(name)}: ${capped(output, 300)}`;
  return `✗ ${bare(name)} — ${error ?? "failed"}: ${output}`;
}

/** `host.<app_id>.<tool>` to the bare name the page knows it by. */
function bare(name: string): string {
  return name.replace(/^host\.[^.]+\./, "");
}

/** `text` cut to `limit`, saying what it cut (README invariant 4). */
function capped(text: string, limit: number): string {
  const total = text.length;
  if (total <= limit) return text;
  return `${text.slice(0, limit)}\n(showing ${limit} of ${total})`;
}

/**
 * The manifest's `app_id`, as a slug the daemon will accept.
 *
 * `HostManifest.validate` requires it to be alphanumeric once hyphens and underscores are removed,
 * because it becomes the registry namespace (`host.<app_id>.<tool>`), and a host is almost never
 * one: `invoices.example` and `localhost:1431` both fail. This is normalisation and not a
 * decision — nothing about the class, the gate or the flags is touched.
 */
function slug(appId: string): string {
  const out = appId
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return out || "host";
}

function originOf(url: string): string {
  try {
    return new URL(url).origin;
  } catch {
    return url || "unknown";
  }
}

function asDaemonError(e: unknown): DaemonError {
  if (e instanceof DaemonError) return e;
  return new DaemonError("unknown", e instanceof Error ? e.message : String(e));
}

// -- the root starts this, and nothing else --------------------------------------------------------

/**
 * Called by `src/app.tsx` and by nothing else (ADR 0017).
 *
 * It subscribes rather than polls: the tool list has to stay true while the user is looking at
 * the Origins module, because the next turn's manifest is built from it, and a page that
 * registers its tools after load announces itself on `bridge:toolchange` and nothing else would
 * catch it.
 */
export async function startRun(): Promise<void> {
  if (started || !hasShell()) return;
  started = true;
  await onToolChange(() => refreshTools());
  useTabs.subscribe(() => refreshTools());
  useTools.subscribe(() => refreshTools());
  useOrigins.subscribe(() => refreshTools());
  refreshTools();
}

/** For tests only: forget every turn, and swap any of the loop's outside edges. */
export function resetRunForTests(overrides: Partial<RunDeps> = {}): void {
  started = false;
  inFlight = false;
  seq = 0;
  session = null;
  carried = [];
  budget = new Budget();
  pages = new Map();
  deps = { ...liveDeps(), ...overrides };
  useRun.setState({ ...EMPTY });
}

/** For tests and for a view that wants the manifest the daemon was told about. */
export function currentSession(): Readonly<Session> | null {
  return session;
}

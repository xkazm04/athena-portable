/**
 * The run loop: what turns a stream of channel events into a panel (README §3.2, §5 phase P5).
 *
 * One turn is not one exchange. README §3.2 step 5 says a host tool has no executor in the lane —
 * the gate allows it, the lane emits `tool.call`, *the surface* runs it on the page, and the answer
 * rides the next request's frame. So a turn that called two of the page's tools finishes with two
 * answers the model has not seen, and something has to carry them back. That something is this
 * loop, and it is the reason the panel is not just a transcript renderer.
 *
 * The same is true one step later. A `GATED` call becomes a card; when the user approves it, the
 * daemon replays the gate and hands back an *instruction* rather than a result. The loop runs that
 * on the page too, and feeds its answer into the next turn.
 *
 * Both continuations are bounded by {@link MAX_CONTINUATIONS}. Two tools that keep proposing each
 * other would otherwise spend a subscription overnight, and a loop whose only limit is the model's
 * good judgement is not a limit.
 *
 * Nothing here decides policy. The class of a tool, whether a card is needed and whether an
 * approval covers a call are all the daemon's answers; this file renders them and carries results.
 */

import type {
  ChannelEvent,
  DecisionRequested,
  ToolCall,
  ToolResult,
  TurnSummary,
} from "../lib/events.js";
import { isTerminal } from "../lib/events.js";
import type { DaemonClient, ToolRow, TurnPayload } from "../lib/client.js";
import { DaemonError } from "../lib/client.js";
import { mint } from "../lib/ids.js";

/** How many times the loop may continue a turn on its own before it stops and says so. */
export const MAX_CONTINUATIONS = 8;

export type RunPhase = "idle" | "running" | "acting" | "error";

export interface TranscriptEntry {
  id: string;
  kind: "user" | "assistant" | "tool" | "error";
  text: string;
  /** Set on a tool entry: the tier it ran at, so the panel can say where it happened. */
  tier?: number;
  ok?: boolean;
}

export interface RunModel {
  phase: RunPhase;
  transcript: TranscriptEntry[];
  /** Cards waiting on the user, newest last. Cleared as each is answered. */
  cards: DecisionRequested[];
  /** What this application offers, as `/capabilities` said. */
  tools: ToolRow[];
  summary: TurnSummary | null;
  error: { reason: string; detail: string } | null;
  /** How many times the loop has continued this exchange on its own. */
  continuations: number;
  appId: string | null;
}

/** How the surface reaches the page. The relay in Tauri, a fake in the headless test. */
export interface HostPort {
  /** Open tabs, the active application, the page title — bounded by the caller, fenced by the lane. */
  state(): Promise<Record<string, unknown>>;
  /** Run one of the page's own tools and return exactly what it said. */
  call(name: string, params: Record<string, unknown>): Promise<{ ok: boolean; output: string; error?: string }>;
}

export const EMPTY: RunModel = Object.freeze({
  phase: "idle",
  transcript: [],
  cards: [],
  tools: [],
  summary: null,
  error: null,
  continuations: 0,
  appId: null,
});

type Listener = (model: RunModel) => void;

export class RunLoop {
  private model: RunModel = { ...EMPTY, transcript: [], cards: [], tools: [] };
  private readonly listeners = new Set<Listener>();
  /** Host answers produced since the last request, waiting to ride the next frame. */
  private outstanding: ToolResult[] = [];

  constructor(
    private readonly client: DaemonClient,
    private readonly host: HostPort,
  ) {}

  // -- reading -------------------------------------------------------------------------------

  get snapshot(): RunModel {
    return this.model;
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    listener(this.model);
    return () => this.listeners.delete(listener);
  }

  private update(patch: Partial<RunModel>): void {
    this.model = { ...this.model, ...patch };
    for (const listener of this.listeners) listener(this.model);
  }

  // -- what the panel shows before a turn ----------------------------------------------------

  /** Load the tool list for an application. Act 1 of the demo is this call's answer. */
  async openApp(appId: string | null): Promise<void> {
    const page = await this.client.capabilities(appId);
    this.update({ appId, tools: page.tools });
  }

  // -- one exchange ---------------------------------------------------------------------------

  /** Send a message and run the exchange to its end, continuing it as the page answers. */
  async send(message: string): Promise<void> {
    this.push({ id: mint("turn"), kind: "user", text: message });
    this.update({ phase: "running", error: null, continuations: 0, summary: null });
    await this.exchange(message);
  }

  /**
   * Answer a card, and carry what it produced into the exchange.
   *
   * An approved host tool comes back as an instruction rather than a result, so the page runs it
   * here and its answer joins the outstanding set — exactly as if the turn had called it directly.
   */
  async answer(approvalId: string, choice: string): Promise<void> {
    this.update({ cards: this.model.cards.filter((card) => card.id !== approvalId) });
    let resolution;
    try {
      resolution = await this.client.resolve(approvalId, choice);
    } catch (error) {
      this.fail(error);
      return;
    }

    for (const raw of resolution.events) {
      if (raw.kind === "tool.call") {
        await this.runOnPage(raw as unknown as ToolCall);
      }
    }
    if (!resolution.approved) {
      this.push({ id: mint("turn"), kind: "tool", text: `declined: ${approvalId}`, ok: false });
    }
    if (this.outstanding.length) {
      this.update({ phase: "running" });
      await this.exchange("");
    }
  }

  /**
   * One request, plus however many the page's answers make necessary.
   *
   * The continuation carries an empty message on purpose: the user has not said anything new, and
   * a synthesised "here are the results" sentence would be a message they did not write appearing
   * in their own transcript.
   */
  private async exchange(message: string): Promise<void> {
    let text = message;
    for (let step = 0; step <= MAX_CONTINUATIONS; step += 1) {
      const carried = this.outstanding;
      this.outstanding = [];
      const payload: TurnPayload = {
        message: text || "(the tools you called have answered; continue)",
        app_id: this.model.appId,
        surface: "panel",
        host_state: await this.safeState(),
        tool_results: carried.map((result) => ({ ...result })),
      };

      const ended = await this.consume(payload);
      if (!ended) return;
      if (!this.outstanding.length) {
        this.update({ phase: "idle" });
        return;
      }
      if (step === MAX_CONTINUATIONS) {
        this.update({
          phase: "error",
          error: {
            reason: "budget_exhausted",
            detail: `the page answered ${MAX_CONTINUATIONS} times without the turn settling`,
          },
        });
        return;
      }
      this.update({ continuations: step + 1 });
      text = "";
    }
  }

  /** Stream one turn. Returns `false` when the request itself was refused. */
  private async consume(payload: TurnPayload): Promise<boolean> {
    try {
      for await (const event of this.client.run(payload)) {
        await this.apply(event);
        if (isTerminal(event)) break;
      }
    } catch (error) {
      this.fail(error);
      return false;
    }
    return true;
  }

  private async apply(event: ChannelEvent): Promise<void> {
    switch (event.kind) {
      case "text.delta":
        this.push({ id: mint("turn"), kind: "assistant", text: event.text });
        break;
      case "tool.call":
        await this.runOnPage(event);
        break;
      case "tool.result":
        this.push({
          id: event.call_id,
          kind: "tool",
          text: `${event.name} → ${event.ok ? event.output : (event.error ?? "refused")}`,
          tier: event.tier,
          ok: event.ok,
        });
        break;
      case "decision.requested":
        this.update({ cards: [...this.model.cards, event] });
        break;
      case "decision.resolved":
        this.update({ cards: this.model.cards.filter((card) => card.id !== event.id) });
        break;
      case "turn.summary":
        this.update({ summary: event });
        break;
      case "turn.error":
        this.update({ phase: "error", error: { reason: event.reason, detail: event.detail } });
        break;
      case "turn.finished":
        break;
    }
  }

  /**
   * Run one of the page's own tools. A tier-0 call has an executor in the daemon and never
   * arrives here; anything that does is the page's, and the page's answer is what goes back.
   */
  private async runOnPage(call: ToolCall): Promise<void> {
    if (call.origin === "core") return;
    this.update({ phase: "acting" });
    let answer: { ok: boolean; output: string; error?: string };
    try {
      answer = await this.host.call(call.name, call.params);
    } catch (error) {
      answer = { ok: false, output: "", error: describe(error) };
    }
    const result: ToolResult = {
      kind: "tool.result",
      call_id: call.call_id,
      name: call.name,
      ok: answer.ok,
      output: answer.output,
      truncated: false,
      error: answer.error ?? null,
      tier: call.tier,
      ms: 0,
    };
    this.outstanding.push(result);
    this.push({
      id: call.call_id,
      kind: "tool",
      text: `${call.name} → ${answer.ok ? answer.output : (answer.error ?? "failed")}`,
      tier: call.tier,
      ok: answer.ok,
    });
    this.update({ phase: "running" });
  }

  // -- the small things --------------------------------------------------------------------------

  private push(entry: TranscriptEntry): void {
    this.update({ transcript: [...this.model.transcript, entry] });
  }

  private fail(error: unknown): void {
    const reason = error instanceof DaemonError ? error.reason : "unknown";
    this.update({ phase: "error", error: { reason, detail: describe(error) } });
  }

  /** Host state is best-effort: a page that will not answer must not stop the user talking. */
  private async safeState(): Promise<Record<string, unknown>> {
    try {
      return await this.host.state();
    } catch {
      return {};
    }
  }
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

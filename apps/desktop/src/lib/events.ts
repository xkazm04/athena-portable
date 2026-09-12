/**
 * The channel events, as the panel reads them — `src/athena/contracts/channel.py`.
 *
 * Eleven events, one stream, one decoder. The daemon writes each event's own JSON into an SSE
 * frame; this file names the shapes and does nothing else. A second encoder is how two surfaces
 * end up disagreeing about what a decision card said.
 *
 * An unknown `kind` throws rather than being skipped. A surface that silently drops
 * `decision.requested` is a gate that never asked.
 */

export type EventKind =
  | "text.delta"
  | "tool.call"
  | "tool.result"
  | "turn.finished"
  | "turn.error"
  | "turn.summary"
  | "decision.requested"
  | "decision.resolved"
  | "voice.transcript"
  | "voice.speaking"
  | "voice.stopped";

export interface TextDelta {
  kind: "text.delta";
  text: string;
}

export interface ToolCall {
  kind: "tool.call";
  call_id: string;
  name: string;
  params: Record<string, unknown>;
  origin: string;
  tier: number;
}

export interface ToolResult {
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

export interface TurnFinished {
  kind: "turn.finished";
  text: string;
  tts: string | null;
}

export interface TurnError {
  kind: "turn.error";
  reason: string;
  detail: string;
}

export interface TurnSummary {
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

export interface DecisionOption {
  id: string;
  label: string;
}

export interface DecisionRequested {
  kind: "decision.requested";
  id: string;
  decision_kind: string;
  action: string;
  params: Record<string, unknown>;
  rationale: string;
  options: DecisionOption[];
  expires_at: string;
  origin: string;
  surface: string;
  capture_id: string | null;
}

export interface DecisionResolved {
  kind: "decision.resolved";
  id: string;
  choice: string;
  by: string;
  at: string;
}

/** What the microphone said, as the daemon's backend heard it. `final` ends an utterance. */
export interface VoiceTranscript {
  kind: "voice.transcript";
  text: string;
  final: boolean;
}

/** Playback of one spoken line begins; the audio frames that follow carry `generation`. */
export interface VoiceSpeaking {
  kind: "voice.speaking";
  generation: number;
  text: string;
  truncated: boolean;
  sample_rate: number;
}

/** Playback of `generation` ended: `done`, `barge_in`, or `error`. */
export interface VoiceStopped {
  kind: "voice.stopped";
  generation: number;
  reason: string;
}

export type ChannelEvent =
  | TextDelta
  | ToolCall
  | ToolResult
  | TurnFinished
  | TurnError
  | TurnSummary
  | DecisionRequested
  | DecisionResolved
  | VoiceTranscript
  | VoiceSpeaking
  | VoiceStopped;

/** The families a surface may subscribe to, exactly as `contracts/channel.py` groups them. */
export const FAMILIES: Readonly<Record<string, readonly EventKind[]>> = Object.freeze({
  stream: ["text.delta", "tool.call", "tool.result", "turn.finished", "turn.error"],
  record: ["turn.summary"],
  decisions: ["decision.requested", "decision.resolved"],
  voice: ["voice.transcript", "voice.speaking", "voice.stopped"],
});

const KNOWN = new Set<string>(Object.values(FAMILIES).flat());

export function familyOf(kind: string): string {
  for (const [family, kinds] of Object.entries(FAMILIES)) {
    if ((kinds as readonly string[]).includes(kind)) return family;
  }
  throw new Error(`unknown channel event kind: ${kind}`);
}

/** Rebuild an event from one SSE frame's `data:` payload. */
export function eventFromJson(raw: string): ChannelEvent {
  const parsed: unknown = JSON.parse(raw);
  if (typeof parsed !== "object" || parsed === null) {
    throw new Error("a channel event must be a JSON object");
  }
  const kind = (parsed as { kind?: unknown }).kind;
  if (typeof kind !== "string" || !KNOWN.has(kind)) {
    throw new Error(`unknown channel event kind: ${String(kind)}`);
  }
  return parsed as ChannelEvent;
}

/** `true` when this event ends a turn. The run loop stops on either of the two. */
export function isTerminal(event: ChannelEvent): boolean {
  return event.kind === "turn.finished" || event.kind === "turn.error";
}

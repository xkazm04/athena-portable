/**
 * The channel events, as the panel reads them — `src/athena/contracts/channel.py`.
 *
 * Thirteen events, one stream, one decoder. The daemon writes each event's own JSON into an SSE
 * frame; this file names the shapes and does nothing else. A second encoder is how two surfaces
 * end up disagreeing about what a decision card said. The shapes are a hand-written mirror, so
 * `events.test.ts` reads `channel.py` and holds the kinds, the families, every field and which
 * fields may be null to it.
 *
 * An unknown `kind` throws rather than being skipped. A surface that silently drops
 * `decision.requested` is a gate that never asked.
 */
import type { RigFrame } from "../avatar/types";

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
  | "voice.stopped"
  | "voice.visemes"
  | "voice.motion";

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
  /** `host:<app_id>` of the other tab a `tabs_read` read; absent for everything else (ADR 0105). */
  source?: string | null;
  /** A member of `ERROR_REASONS` on a failure, `null` on success; `error` is the bounded detail beside it. Absent from a daemon older than the field. */
  reason?: string | null;
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
  /**
   * The tab the card was proposed on and that tab's document generation (ADR 0103): an approval
   * runs there or not at all. Absent or null on an unbound card (a connector's, core's, an old one).
   */
  tab_id?: number | null;
  tab_nav?: number | null;
}

export interface DecisionResolved {
  kind: "decision.resolved";
  id: string;
  choice: string;
  by: string;
  at: string;
}

/**
 * How one utterance ended, each named by the stage that knew it (ADR 0110). `message` and `answer`
 * go on to a turn or a card; the other four end the utterance on the transcript itself. The same
 * tuple as `TRANSCRIPT_OUTCOMES` in `contracts/channel.py`, in the same order; a test reads both.
 */
export const TRANSCRIPT_OUTCOMES = ["message", "answer", "stop", "too_short", "silent", "no_words"] as const;

export type TranscriptOutcome = (typeof TRANSCRIPT_OUTCOMES)[number];

/**
 * What the microphone said, as the daemon's backend heard it. `final` ends an utterance, and a
 * final one says how it ended (`outcome`) and how loud the microphone was (`peak_dbfs`). A partial,
 * or a daemon from before ADR 0110, leaves them empty: "not said", never "silent".
 */
export interface VoiceTranscript {
  kind: "voice.transcript";
  text: string;
  final: boolean;
  outcome?: TranscriptOutcome | "";
  peak_dbfs?: number | null;
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

/** One mouth shape: an Oculus-15 viseme and its start and end, in samples from the sentence's `offset`. */
export type VisemeSegment = [v: string, start: number, end: number];

/**
 * The mouth shapes of one sentence of `generation`, sent before its audio. `offset` is where the
 * sentence starts, in samples from the line's first audio sample. Only sent when the daemon's face
 * helper is ready; without them a surface drives the mouth from playback level.
 */
export interface VoiceVisemes {
  kind: "voice.visemes";
  generation: number;
  sentence: number;
  offset: number;
  sample_rate: number;
  visemes: VisemeSegment[];
}

/**
 * Head and eye motion for one sentence of `generation`, predicted from its audio and sent when
 * ready (possibly after the sentence started). `frames` are RigParams v1 frames at `fps`, timed
 * from `offset`; a channel the model does not predict is omitted.
 */
export interface VoiceMotion {
  kind: "voice.motion";
  generation: number;
  sentence: number;
  offset: number;
  fps: number;
  frames: RigFrame[];
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
  | VoiceStopped
  | VoiceVisemes
  | VoiceMotion;

/** The families a surface may subscribe to, exactly as `contracts/channel.py` groups them. */
export const FAMILIES: Readonly<Record<string, readonly EventKind[]>> = Object.freeze({
  stream: ["text.delta", "tool.call", "tool.result", "turn.finished", "turn.error"],
  record: ["turn.summary"],
  decisions: ["decision.requested", "decision.resolved"],
  voice: ["voice.transcript", "voice.speaking", "voice.stopped", "voice.visemes", "voice.motion"],
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

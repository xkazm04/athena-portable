/**
 * The Panel module's view-model — plan c22, README section 3.2.
 *
 * This is the module the demo is mostly looking at, and it renders three things that are easy to
 * conflate and must not be:
 *
 * - **the conversation** — what was said and what ran, in order, grouped into blocks a person
 *   reads as one message rather than one line per delta;
 * - **the cards** — what is waiting on the user, each with the action and the exact parameters
 *   the approval was filed for. They are the newest thing in the stream and sit at its end;
 * - **the tool list** — every name this page offers with the class the *catalog* gave it.
 *   Act 1 of the demo is this list.
 *
 * The class on a tool row is never computed here. It arrives from the daemon already decided,
 * because a surface that derived it would be the second place policy lived (README section 3.3).
 * Grouping, suggestions and the host name are derived here, so the view stays a pure function and
 * a test can hold each of them still.
 */
import type { ToolRow } from "@/lib/api";
import type { DecisionRequested, TurnSummary } from "@/lib/events";
import type { RunFailure, RunPhase, TranscriptEntry } from "@/stores/run";
import type { VoicePhase } from "@/stores/voice";

export interface PanelActions {
  send: (message: string) => void;
  answer: (id: string, choice: string) => void;
  clear: () => void;
}

/** What the push-to-talk key is doing, as the composer shows it. */
export interface PanelVoice {
  phase: VoicePhase;
  available: boolean;
  /** The live partial transcript while the key is held. */
  partial: string;
}

/**
 * One block of the conversation. Consecutive assistant deltas read as one message; consecutive
 * tool rows read as one stretch of activity; a user line is always its own block.
 */
export type MessageBlock =
  | { kind: "user"; id: string; text: string }
  | { kind: "assistant"; id: string; text: string }
  | { kind: "activity"; id: string; steps: readonly TranscriptEntry[] };

export interface PanelModel {
  phase: RunPhase;
  transcript: readonly TranscriptEntry[];
  /** The transcript, grouped. Derived from `transcript`; the view reads this one. */
  messages: readonly MessageBlock[];
  cards: readonly DecisionRequested[];
  tools: readonly ToolRow[];
  summary: TurnSummary | null;
  error: RunFailure | null;
  /** The focused page's web origin, or `null` when nothing is open. */
  origin: string | null;
  /** The origin's host alone, for a sentence; `null` when nothing is open. */
  host: string | null;
  /** Three things worth asking on this page, from its tools. Never empty. */
  suggestions: readonly string[];
  /** `false` until the daemon is ready; the composer is disabled and says why. */
  ready: boolean;
  /** Why the composer is disabled, in the app's own words. Empty when it is not. */
  blocked: string;
  voice: PanelVoice;
  actions: PanelActions;
}

export const NO_VOICE: PanelVoice = { phase: "off", available: false, partial: "" };

/** What to ask when the page offers nothing to suggest. */
export const DEFAULT_SUGGESTION = "What can you do on this page?";

/**
 * Build the view-model. Pure: every argument is a store snapshot the caller already read.
 *
 * `blocked` is computed here rather than in the view because "why can I not type" has exactly one
 * answer at a time and the view should not have to rank three conditions to find it.
 */
export function selectPanel(
  run: {
    phase: RunPhase;
    transcript: readonly TranscriptEntry[];
    cards: readonly DecisionRequested[];
    tools: readonly ToolRow[];
    summary: TurnSummary | null;
    error: RunFailure | null;
  },
  daemonReady: boolean,
  origin: string | null,
  tools: readonly ToolRow[],
  actions: PanelActions,
  voice: PanelVoice = NO_VOICE,
): PanelModel {
  const busy = run.phase === "running" || run.phase === "acting";
  return {
    phase: run.phase,
    transcript: run.transcript,
    messages: groupMessages(run.transcript),
    cards: run.cards,
    tools,
    summary: run.summary,
    error: run.error,
    origin,
    host: hostOf(origin),
    suggestions: suggestionsFor(tools),
    ready: daemonReady && origin !== null,
    blocked: blockedBecause(daemonReady, origin, busy),
    voice,
    actions,
  };
}

/** The transcript as blocks: a run of assistant lines is one message, a run of tools one stretch. */
export function groupMessages(entries: readonly TranscriptEntry[]): MessageBlock[] {
  const blocks: MessageBlock[] = [];
  for (const entry of entries) {
    const last = blocks[blocks.length - 1];
    if (entry.kind === "user") {
      blocks.push({ kind: "user", id: entry.id, text: entry.text });
    } else if (entry.kind === "assistant") {
      if (last?.kind === "assistant") {
        blocks[blocks.length - 1] = { ...last, text: joinProse(last.text, entry.text) };
      } else {
        blocks.push({ kind: "assistant", id: entry.id, text: entry.text });
      }
    } else if (last?.kind === "activity") {
      blocks[blocks.length - 1] = { ...last, steps: [...last.steps, entry] };
    } else {
      blocks.push({ kind: "activity", id: entry.id, steps: [entry] });
    }
  }
  return blocks;
}

/** Two deltas of one reply, with one blank line between them so paragraphs stay paragraphs. */
function joinProse(first: string, second: string): string {
  if (!first.trim()) return second;
  if (!second.trim()) return first;
  return `${first.trimEnd()}\n\n${second.trimStart()}`;
}

/**
 * What to ask, from what the page offers. A `READ` or `AUTO` tool's description is already a
 * sentence about the page ("Invoices past their due date."), so it is offered as one; a `GATED`
 * tool is not, because a suggestion that leads straight to a card is a suggestion to spend an
 * approval. Three at most, and the generic question when there is nothing to draw from.
 */
export function suggestionsFor(tools: readonly ToolRow[]): string[] {
  const offered = tools
    .filter((tool) => tool.class !== "GATED" && tool.origin !== "core")
    .map((tool) => asQuestion(tool))
    .filter((line): line is string => line !== null);
  const unique = [...new Set(offered)].slice(0, 3);
  return unique.length ? unique : [DEFAULT_SUGGESTION];
}

function asQuestion(tool: ToolRow): string | null {
  const description = tool.description.trim().replace(/[.\s]+$/, "");
  if (description) {
    // A description is written as a noun phrase or a sentence; either reads as a request when
    // it is said to Athena, so it is kept in the page's own words.
    return description.charAt(0).toUpperCase() + description.slice(1);
  }
  const bare = tool.name.split(".").pop() ?? "";
  if (!bare) return null;
  const words = bare.replace(/[_-]+/g, " ").trim();
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : null;
}

function hostOf(origin: string | null): string | null {
  if (!origin) return null;
  try {
    return new URL(origin).host || origin;
  } catch {
    return origin;
  }
}

function blockedBecause(ready: boolean, origin: string | null, busy: boolean): string {
  if (!ready) return "Athena's daemon is not running yet.";
  if (origin === null) return "Open a page first — Athena works inside the app you are looking at.";
  if (busy) return "A turn is already running.";
  return "";
}

/** What the phase means, in one word, for the line under the conversation. */
export function phraseFor(phase: RunPhase): string {
  switch (phase) {
    case "running":
      return "thinking";
    case "acting":
      return "acting on the page";
    case "error":
      return "stopped";
    default:
      return "ready";
  }
}

/**
 * The Panel module's view-model — plan c22, README section 3.2.
 *
 * This is the module the demo is mostly looking at, and it renders three things that are easy to
 * conflate and must not be:
 *
 * - **the transcript** — what was said and what ran, in order;
 * - **the cards** — what is waiting on the user, each with the action and the exact parameters the
 *   approval was filed for. A card shows its parameters because approving "send a chase" without
 *   seeing which invoice is not consent to anything;
 * - **the tool list** — every name this page offers with the class the *catalog* gave it. Act 1 of
 *   the demo is this list.
 *
 * The class on a tool row is never computed here. It arrives from the daemon already decided,
 * because a surface that derived it would be the second place policy lived (README section 3.3).
 */
import type { ToolRow } from "@/lib/api";
import type { DecisionRequested, TurnSummary } from "@/lib/events";
import type { RunFailure, RunPhase, TranscriptEntry } from "@/stores/run";

export interface PanelActions {
  send: (message: string) => void;
  answer: (id: string, choice: string) => void;
  clear: () => void;
}

export interface PanelModel {
  phase: RunPhase;
  transcript: readonly TranscriptEntry[];
  cards: readonly DecisionRequested[];
  tools: readonly ToolRow[];
  summary: TurnSummary | null;
  error: RunFailure | null;
  /** The focused page's web origin, or `null` when nothing is open. */
  origin: string | null;
  /** `false` until the daemon is ready; the composer is disabled and says why. */
  ready: boolean;
  /** Why the composer is disabled, in the app's own words. Empty when it is not. */
  blocked: string;
  actions: PanelActions;
}

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
): PanelModel {
  const busy = run.phase === "running" || run.phase === "acting";
  return {
    phase: run.phase,
    transcript: run.transcript,
    cards: run.cards,
    tools,
    summary: run.summary,
    error: run.error,
    origin,
    ready: daemonReady && origin !== null,
    blocked: blockedBecause(daemonReady, origin, busy),
    actions,
  };
}

function blockedBecause(ready: boolean, origin: string | null, busy: boolean): string {
  if (!ready) return "Athena's daemon is not running yet.";
  if (origin === null) return "Open a page first — Athena works inside the app you are looking at.";
  if (busy) return "A turn is already running.";
  return "";
}

/** What the phase means, in one word, for the line under the transcript. */
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

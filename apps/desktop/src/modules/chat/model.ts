/**
 * The chat module's view-model: the transcript, the cards and the tool list (README §5 phase P5).
 *
 * This is the module the demo is mostly looking at, and it renders three things that are easy to
 * conflate and must not be:
 *
 * - **the transcript** — what was said and what ran;
 * - **the cards** — what is waiting on the user, with the action and the exact parameters the
 *   approval was filed for. The card shows parameters because approving "send a chase" without
 *   seeing which invoice is not consent to anything;
 * - **the tool list** — every name this application offers with the class the *catalog* gave it.
 *   Act 1 of the demo is this list, all `GATED` on first sight.
 *
 * The class on a tool row is never derived here. It arrives from `/capabilities` already decided,
 * because a surface that computed it would be the second place policy lived (README §3.3).
 */

import type { DecisionRequested, TurnSummary } from "../../lib/events.js";
import type { ToolRow } from "../../lib/client.js";
import type { RunPhase, TranscriptEntry } from "../../stores/run.js";

export interface ChatModel {
  phase: RunPhase;
  transcript: TranscriptEntry[];
  cards: DecisionRequested[];
  tools: ToolRow[];
  summary: TurnSummary | null;
  error: { reason: string; detail: string } | null;
  /** The application this conversation is pinned to, or `null` for a loose one. */
  appId: string | null;
  /** `false` until the daemon says every check is healthy; the composer is disabled meanwhile. */
  ready: boolean;
}

export interface ChatActions {
  send(message: string): void;
  answer(approvalId: string, choice: string): void;
  cancel(): void;
}

const TOOLS: ToolRow[] = [
  {
    name: "host.ledgerbox.list_overdue",
    origin: "host:ledgerbox",
    class: "AUTO",
    tier: 1,
    description: "Invoices past their due date.",
    params_schema: {},
  },
  {
    name: "host.ledgerbox.chase",
    origin: "host:ledgerbox",
    class: "GATED",
    tier: 1,
    description: "Send a chase for one invoice.",
    params_schema: {},
  },
  {
    name: "core.recall",
    origin: "core",
    class: "READ",
    tier: 0,
    description: "Search memory; the capped answer returns as a system episode.",
    params_schema: {},
  },
];

const CARD: DecisionRequested = {
  kind: "decision.requested",
  id: "apr_0000000000a1",
  decision_kind: "approve",
  action: "host.ledgerbox.chase",
  params: { invoice: "INV-118", to: "hello@northwind.example" },
  rationale: "It is 41 days past due and the client has answered a chase before.",
  options: [
    { id: "approve", label: "approve" },
    { id: "decline", label: "decline" },
  ],
  expires_at: "2026-09-13T10:00:00+00:00",
  origin: "host:ledgerbox",
  surface: "panel",
  capture_id: null,
};

export const fixtures: Readonly<Record<string, ChatModel>> = Object.freeze({
  empty: {
    phase: "idle",
    transcript: [],
    cards: [],
    tools: [],
    summary: null,
    error: null,
    appId: null,
    ready: true,
  },

  "act 1: tools on first sight": {
    phase: "idle",
    transcript: [],
    cards: [],
    tools: TOOLS,
    summary: null,
    error: null,
    appId: "ledgerbox",
    ready: true,
  },

  "a turn in flight": {
    phase: "running",
    transcript: [
      { id: "t1", kind: "user", text: "Which invoices are over thirty days?" },
      { id: "t2", kind: "assistant", text: "Let me read the page." },
      {
        id: "t3",
        kind: "tool",
        text: "host.ledgerbox.list_overdue → INV-118, INV-120, INV-131",
        tier: 1,
        ok: true,
      },
    ],
    cards: [],
    tools: TOOLS,
    summary: null,
    error: null,
    appId: "ledgerbox",
    ready: true,
  },

  "a card is waiting": {
    phase: "idle",
    transcript: [
      { id: "t1", kind: "user", text: "Chase the oldest one." },
      { id: "t2", kind: "assistant", text: "INV-118 is the oldest. I need your approval." },
    ],
    cards: [CARD],
    tools: TOOLS,
    summary: null,
    error: null,
    appId: "ledgerbox",
    ready: true,
  },

  "two cards, one of them a write to memory": {
    phase: "idle",
    transcript: [{ id: "t1", kind: "user", text: "Chase them and remember who pays late." }],
    cards: [
      CARD,
      {
        ...CARD,
        id: "apr_0000000000a2",
        action: "core.write_fact",
        origin: "core",
        params: { key: "late payers", value: "Northwind pays 40+ days late", scope: "user" },
        rationale: "It came up twice this month.",
      },
    ],
    tools: TOOLS,
    summary: null,
    error: null,
    appId: "ledgerbox",
    ready: true,
  },

  "finished, with its cost": {
    phase: "idle",
    transcript: [
      { id: "t1", kind: "user", text: "Which invoices are over thirty days?" },
      { id: "t2", kind: "assistant", text: "Three: INV-118, INV-120 and INV-131." },
    ],
    cards: [],
    tools: TOOLS,
    summary: {
      kind: "turn.summary",
      model: "claude-opus-5",
      engine: "claude_code",
      input_tokens: 4210,
      output_tokens: 180,
      cost_usd: 0.0312,
      cost_estimated: false,
      duration_ms: 5400,
      rounds: 2,
    },
    error: null,
    appId: "ledgerbox",
    ready: true,
  },

  "the engine refused": {
    phase: "error",
    transcript: [{ id: "t1", kind: "user", text: "Chase the oldest one." }],
    cards: [],
    tools: TOOLS,
    summary: null,
    error: { reason: "engine_error", detail: "the CLI reported an error and stopped" },
    appId: "ledgerbox",
    ready: true,
  },

  "not ready yet": {
    phase: "idle",
    transcript: [],
    cards: [],
    tools: [],
    summary: null,
    error: null,
    appId: null,
    ready: false,
  },
});

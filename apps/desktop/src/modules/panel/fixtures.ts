/**
 * The Panel module's fixtures — the states worth looking at, including the two nobody reaches by
 * hand twice the same way.
 *
 * `degraded` means what it means everywhere in this app: not "some fields are empty" but a real
 * failure the surface has to answer — here, the daemon offline. The card fixtures are the ones the
 * demo lives on, so they carry real-looking parameters rather than `{}`.
 */
import type { ToolRow } from "@/lib/api";
import type { DecisionRequested } from "@/lib/events";
import type { FixtureId } from "@/modules/types";

import type { PanelModel } from "./model";

const NO_ACTIONS = { send: () => {}, answer: () => {}, clear: () => {} };

const ORIGIN = "https://ledgerbox.local";

const TOOLS: ToolRow[] = [
  {
    name: "host.ledgerbox.list_overdue",
    origin: "host:ledgerbox",
    class: "AUTO",
    tier: 1,
    description: "Invoices past their due date.",
  },
  {
    name: "host.ledgerbox.chase",
    origin: "host:ledgerbox",
    class: "GATED",
    tier: 1,
    description: "Send a chase for one invoice.",
  },
  {
    name: "core.recall",
    origin: "core",
    class: "READ",
    tier: 0,
    description: "Search memory; the capped answer returns as a system episode.",
  },
  {
    name: "core.write_fact",
    origin: "core",
    class: "GATED",
    tier: 0,
    description: "Distil a claim about the user, a project or the world; cites episodes.",
  },
];

const CARD: DecisionRequested = {
  kind: "decision.requested",
  id: "apr_0000000000a1",
  decision_kind: "approve",
  action: "host.ledgerbox.chase",
  params: { invoice: "INV-118", to: "ap@northwind.example" },
  rationale: "It is 41 days past due and this client has answered a chase before.",
  options: [
    { id: "approve", label: "approve" },
    { id: "decline", label: "decline" },
  ],
  expires_at: "2026-09-13T10:00:00+00:00",
  origin: "host:ledgerbox",
  surface: "panel",
  capture_id: null,
};

const base: PanelModel = {
  phase: "idle",
  transcript: [],
  cards: [],
  tools: [],
  summary: null,
  error: null,
  origin: ORIGIN,
  ready: true,
  blocked: "",
  actions: NO_ACTIONS,
};

export const fixtures: Record<string, PanelModel> = {
  empty: { ...base, tools: [] },

  typical: {
    ...base,
    tools: TOOLS,
    transcript: [
      { id: "u1", kind: "user", text: "Which invoices are more than thirty days overdue?" },
      { id: "a1", kind: "assistant", text: "Let me read the list." },
      {
        id: "c1",
        kind: "tool",
        text: "host.ledgerbox.list_overdue → INV-118, INV-120, INV-131",
        tier: 1,
        ok: true,
      },
      { id: "a2", kind: "assistant", text: "Three: INV-118, INV-120 and INV-131." },
    ],
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
  },

  /** The state the whole gate exists for: something is waiting on the user. */
  "card waiting": {
    ...base,
    tools: TOOLS,
    transcript: [
      { id: "u1", kind: "user", text: "Chase the oldest one." },
      { id: "a1", kind: "assistant", text: "INV-118 is the oldest. I need your approval." },
    ],
    cards: [CARD],
  },

  heavy: {
    ...base,
    tools: TOOLS,
    phase: "acting",
    transcript: Array.from({ length: 14 }, (_, i) => ({
      id: `e${i}`,
      kind: (i % 3 === 0 ? "user" : i % 3 === 1 ? "assistant" : "tool") as "user" | "assistant" | "tool",
      text:
        i % 3 === 2
          ? `host.ledgerbox.list_overdue → ${40 - i} rows (showing 20 of ${40 - i})`
          : `Line ${i + 1} of a conversation that has been going for a while.`,
      tier: i % 3 === 2 ? 1 : undefined,
      ok: i % 3 === 2 ? true : undefined,
    })),
    cards: [
      CARD,
      {
        ...CARD,
        id: "apr_0000000000a2",
        action: "core.write_fact",
        origin: "core",
        params: { key: "late payers", value: "Northwind pays 40+ days late", scope: "user" },
        rationale: "It has come up twice this month.",
      },
    ],
  },

  degraded: {
    ...base,
    ready: false,
    origin: null,
    blocked: "Athena's daemon is not running yet.",
    phase: "error",
    error: { reason: "engine_error", detail: "the CLI reported an error and stopped" },
  },
};

export const fixtureIds: readonly FixtureId[] = [
  "empty",
  "typical",
  "card waiting",
  "heavy",
  "degraded",
];

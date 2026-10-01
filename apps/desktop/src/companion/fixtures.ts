/**
 * The companion's fixtures — ADR 0026, README section 3.5 (the preview harness).
 *
 * Every fixture is a model the app can really reach: it is built by driving the real machine
 * through real events and passing the result through `selectCompanion`, never written by hand. A
 * fixture that could not happen would be a screenshot of a lie.
 *
 * The studio and its invoices are the demo data of the app's own fixtures (`ledgerbox`, INV-118).
 * The page capture on the slip is a labelled sketch; a live card has none until captures are wired.
 */
import type { ToolRow } from "@/lib/api";
import type { DecisionRequested } from "@/lib/events";
import type { TranscriptEntry } from "@/stores/run";

import { INITIAL, reduce, type Event, type MachineState } from "./machine";
import {
  NO_ACTIONS,
  ledgerFrom,
  selectCompanion,
  type CompanionModel,
  type LedgerSnapshot,
  type OriginView,
  type SessionDecision,
} from "./model";

const ORIGIN = "https://ledgerbox.local";

export const TOOLS: ToolRow[] = [
  { name: "host.ledgerbox.list_overdue", origin: "host:ledgerbox", class: "AUTO", tier: 1, description: "Invoices past their due date." },
  { name: "host.ledgerbox.read_client", origin: "host:ledgerbox", class: "READ", tier: 1, description: "One client and their open invoices." },
  { name: "host.ledgerbox.chase", origin: "host:ledgerbox", class: "GATED", tier: 1, description: "Send a chase for one invoice." },
  { name: "core.recall", origin: "core", class: "READ", tier: 0, description: "Search memory; the capped answer returns as a system episode." },
];

function card(id: string, invoice: string, to: string, why: string): DecisionRequested {
  return {
    kind: "decision.requested",
    id,
    decision_kind: "approve",
    action: "host.ledgerbox.chase",
    params: { invoice, to },
    rationale: why,
    options: [
      { id: "approve", label: "approve" },
      { id: "decline", label: "decline" },
    ],
    expires_at: "2026-09-30T10:00:00+00:00",
    origin: "host:ledgerbox",
    surface: "panel",
    capture_id: null,
  };
}

export const CARDS: DecisionRequested[] = [
  card("apr_0000000000a1", "INV-118", "ap@northwind.example", "It is 41 days past due and this client has answered a chase before."),
  card("apr_0000000000a2", "INV-124", "ap@kestrel.example", "It is 36 days past due and the last reminder went unanswered."),
  card("apr_0000000000a3", "INV-131", "ap@pinegrove.example", "It is 33 days past due and no chase has gone out yet."),
];

const TURN: TranscriptEntry[] = [
  { id: "u1", kind: "user", text: "Find every invoice over 30 days and draft a chase for each." },
  { id: "a1", kind: "assistant", text: "Let me read the list." },
  { id: "c1", kind: "tool", text: "host.ledgerbox.list_overdue → INV-118, INV-124, INV-131", tier: 1, ok: true },
  { id: "c2", kind: "tool", text: "host.ledgerbox.read_client → Northwind, 3 open invoices", tier: 1, ok: true },
  {
    id: "a2",
    kind: "assistant",
    text: "Three invoices are over 30 days. I will draft a chase for each, and each one waits for you.",
  },
];

const KNOWN: OriginView[] = [
  { origin: "https://ledgerbox.local", enabled: true, overrides: 1 },
  { origin: "https://inbox.local", enabled: true, overrides: 0 },
  { origin: "https://calendar.example", enabled: false, overrides: 0 },
];

const LEDGER: LedgerSnapshot = ledgerFrom({
  rows: [
    {
      row_id: "led_0000000000b2",
      created_at: "2026-09-30T09:41:12+00:00",
      engine: "claude_code",
      model: "claude-opus-5",
      rounds: 2,
      cost_usd: 0.0312,
      cost_estimated: false,
      is_error: false,
      error_reason: "",
    },
    {
      row_id: "led_0000000000b1",
      created_at: "2026-09-30T09:38:03+00:00",
      engine: "claude_code",
      model: "claude-opus-5",
      rounds: 1,
      cost_usd: null,
      cost_estimated: false,
      is_error: true,
      error_reason: "engine_error",
    },
  ],
  footer: "(showing 2 of 14)",
});

const DECISIONS: SessionDecision[] = [
  { id: "apr_0000000000a0", action: "host.ledgerbox.chase", result: "approved" },
];

/** Drive the real machine through real events; timers are not run, only their consequences. */
export function machineAfter(...events: Event[]): MachineState {
  let state = INITIAL;
  for (const event of events) [state] = reduce(state, event);
  return state;
}

const INIT: Event = { t: "init", onboarded: true, cards: 0 };

interface Setup {
  events: Event[];
  cards?: DecisionRequested[];
  held?: DecisionRequested | null;
  transcript?: TranscriptEntry[];
  phase?: "idle" | "running" | "acting" | "error";
  partial?: string;
  voice?: boolean;
  origin?: string | null;
  ready?: boolean;
  capture?: boolean;
}

function model(setup: Setup): CompanionModel {
  const cards = setup.cards ?? [];
  const built = selectCompanion({
    machine: machineAfter(...setup.events),
    run: {
      phase: setup.phase ?? "idle",
      transcript: setup.transcript ?? [],
      cards,
      summary: null,
      error: setup.phase === "error" ? { reason: "engine_error", detail: "the CLI reported an error and stopped" } : null,
    },
    voice: { phase: setup.voice ? "listening" : "idle", available: true, partial: setup.partial ?? "" },
    daemonReady: setup.ready ?? true,
    origin: setup.origin === undefined ? ORIGIN : setup.origin,
    tools: TOOLS,
    held: setup.held ?? null,
    known: KNOWN,
    ledger: LEDGER,
    decisions: DECISIONS,
    engine: "Claude Code",
    actions: NO_ACTIONS,
  });
  return setup.capture ? { ...built, cards: built.cards.map((c) => ({ ...c, capture: "sketch" })) } : built;
}

const one = [CARDS[0]];
const all = CARDS;

/** The state names the harness accepts, plus the variations worth looking at. */
export const fixtures: Record<string, () => CompanionModel> = {
  seal: () => model({ events: [INIT] }),
  "seal waiting": () =>
    model({ events: [INIT, { t: "cards", n: 2 }, { t: "esc" }], cards: all.slice(0, 2) }),
  "seal quiet": () => model({ events: [INIT, { t: "quietStart" }] }),
  tape: () =>
    model({ events: [INIT, { t: "work", on: true }], transcript: TURN.slice(0, 4), phase: "acting" }),
  "tape thinking": () =>
    model({ events: [INIT, { t: "work", on: true }], transcript: TURN.slice(0, 1), phase: "running" }),
  "tape done": () =>
    model({
      events: [INIT, { t: "work", on: true }, { t: "work", on: false }],
      transcript: TURN,
    }),
  hear: () =>
    model({
      events: [INIT, { t: "listen", on: true }],
      voice: true,
      partial: "Find every invoice over 30 days and draft a chase",
    }),
  slip: () => model({ events: [INIT, { t: "cards", n: 1 }], cards: one, capture: true }),
  "slip many": () => model({ events: [INIT, { t: "cards", n: 3 }], cards: all, capture: true }),
  "slip approved": () =>
    model({
      events: [INIT, { t: "cards", n: 1 }, { t: "decide", kind: "approve", by: "click" }, { t: "cards", n: 0 }],
      held: CARDS[0],
      capture: true,
    }),
  "slip tearing": () =>
    model({
      events: [INIT, { t: "cards", n: 1 }, { t: "decide", kind: "approve", by: "click" }, { t: "cards", n: 0 }, { t: "tear" }],
      held: CARDS[0],
      capture: true,
    }),
  "slip declined": () =>
    model({
      events: [INIT, { t: "cards", n: 1 }, { t: "decide", kind: "decline", by: "key" }, { t: "cards", n: 0 }],
      held: CARDS[0],
      capture: true,
    }),
  welcome: () => model({ events: [{ t: "init", onboarded: false, cards: 0 }] }),
  ledger: () =>
    model({
      events: [INIT, { t: "cards", n: 1 }, { t: "seal" }],
      cards: one,
      transcript: TURN,
    }),
  "ledger empty": () => model({ events: [INIT, { t: "seal" }], origin: null }),
  /** The daemon offline, and the last turn stopped: the two things a person must be told. */
  "ledger degraded": () =>
    model({ events: [INIT, { t: "seal" }], origin: null, ready: false, phase: "error" }),
  "ledger record": () =>
    model({ events: [INIT, { t: "seal" }, { t: "tab", tab: "record" }], transcript: TURN }),
  "ledger origins": () => model({ events: [INIT, { t: "seal" }, { t: "tab", tab: "origins" }] }),
  tab: () => model({ events: [INIT, { t: "snap", docked: "right" }] }),
  "tab left": () => model({ events: [INIT, { t: "snap", docked: "left" }] }),
  "tab waiting": () =>
    model({
      events: [INIT, { t: "snap", docked: "right" }, { t: "cards", n: 1, hidden: true }],
      cards: one,
    }),
};

export const fixtureIds: readonly string[] = Object.keys(fixtures);

/** The seven named states, each as its plainest fixture: what `?state=` selects. */
export const STATE_FIXTURES = ["seal", "tape", "hear", "slip", "welcome", "ledger", "tab"] as const;

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
import type { EngineProbe } from "@/lib/engines";
import type { DecisionRequested } from "@/lib/events";
import type { EarlierRecord, TranscriptEntry } from "@/stores/run";

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
  { id: "c1", kind: "tool", text: "host.ledgerbox.list_overdue → INV-118, INV-124, INV-131", tier: 1, ok: true, at: "2026-09-30 09:41:20" },
  { id: "c2", kind: "tool", text: "host.ledgerbox.read_client → Northwind, 3 open invoices", tier: 1, ok: true, at: "2026-09-30 09:41:24" },
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

/** The same ledger with nothing cut, for the fixture where the header may say nothing is missing. */
const LEDGER_WHOLE: LedgerSnapshot = { ...LEDGER, footer: "", showing: 2, total: 2 };

const DECISIONS: SessionDecision[] = [
  {
    id: "apr_0000000000a0",
    action: "host.ledgerbox.chase",
    origin: "host:ledgerbox",
    result: "approved",
    reason: null,
    at: "2026-09-30 09:44:02",
  },
  {
    id: "apr_00000000009f",
    action: "host.ledgerbox.chase",
    origin: "host:ledgerbox",
    result: "refused",
    reason: "foreign_origin",
    at: "2026-09-30 09:43:10",
  },
];

/** What earlier windows kept: three answers, of five. */
const EARLIER: EarlierRecord = {
  rows: [
    {
      id: 3,
      ts: "2026-09-29 16:20:00",
      tab_id: null,
      origin: "host:ledgerbox",
      tool: "host.ledgerbox.chase",
      tier: 1,
      class: "GATED",
      outcome: "declined",
      ms: 0,
      reason: "user_denied",
      approval_id: "apr_00000000008e",
    },
    {
      id: 2,
      ts: "2026-09-29 16:12:30",
      tab_id: null,
      origin: "host:ledgerbox",
      tool: "host.ledgerbox.chase",
      tier: 1,
      class: "GATED",
      outcome: "approved",
      ms: 0,
      reason: null,
      approval_id: "apr_00000000008d",
    },
  ],
  showing: 2,
  total: 5,
  problem: null,
};

const EARLIER_WHOLE: EarlierRecord = { ...EARLIER, total: 2 };

const NOW = Date.parse("2026-09-30T10:00:00Z");

const FOUND: EngineProbe[] = [
  { id: "claude_code", state: "found", detail: "2.1.0" },
  { id: "codex", state: "not_found", detail: "" },
];
const MISSING: EngineProbe[] = [
  { id: "claude_code", state: "not_found", detail: "" },
  { id: "codex", state: "not_found", detail: "" },
];
const MISSING_BUT_CODEX: EngineProbe[] = [
  { id: "claude_code", state: "not_found", detail: "" },
  { id: "codex", state: "found", detail: "0.5.0" },
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
  /** The active playbook's title (ADR 0044). */
  project?: string;
  /** A command Main offered for the composer. */
  offer?: string;
  cards?: DecisionRequested[];
  held?: DecisionRequested | null;
  transcript?: TranscriptEntry[];
  phase?: "idle" | "running" | "acting" | "error";
  partial?: string;
  voice?: boolean;
  /** Her voice is playing (the seal speaks). */
  speaking?: boolean;
  origin?: string | null;
  ready?: boolean;
  capture?: boolean;
  answering?: Record<string, string>;
  refusals?: Record<string, string>;
  earlier?: EarlierRecord | null;
  ledger?: LedgerSnapshot | null;
  probes?: EngineProbe[] | null;
  probing?: boolean;
  onboarded?: boolean;
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
      answering: setup.answering,
      refusals: setup.refusals,
      earlier: setup.earlier === undefined ? EARLIER : setup.earlier,
    },
    voice: { phase: setup.voice ? "listening" : setup.speaking ? "speaking" : "idle", available: true, partial: setup.partial ?? "" },
    daemonReady: setup.ready ?? true,
    origin: setup.origin === undefined ? ORIGIN : setup.origin,
    tools: TOOLS,
    held: setup.held ?? null,
    known: KNOWN,
    ledger: setup.ledger === undefined ? LEDGER : setup.ledger,
    decisions: DECISIONS,
    engine: "Claude Code",
    engineId: "claude_code",
    probes: setup.probes === undefined ? FOUND : setup.probes,
    probing: setup.probing ?? false,
    onboarded: setup.onboarded ?? true,
    nowMs: NOW,
    project: setup.project ? { title: setup.project } : null,
    offer: setup.offer ? { n: 1, text: setup.offer } : null,
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
  "seal speaking": () => model({ events: [INIT], speaking: true }),
  "seal hearing": () => model({ events: [INIT], voice: true }),
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
      events: [INIT, { t: "cards", n: 1 }, { t: "decide", kind: "approve", by: "click" }, { t: "sent", ok: true }, { t: "cards", n: 0 }],
      held: CARDS[0],
      capture: true,
    }),
  /** The answer is on its way: the card is still the card, the buttons read Sending, nothing is stamped. */
  "slip sending": () =>
    model({
      events: [INIT, { t: "cards", n: 1 }, { t: "decide", kind: "approve", by: "click" }],
      cards: one,
      answering: { [CARDS[0].id]: "approve" },
      capture: true,
    }),
  /** The daemon refused the answer: the card stays and says why, in plain words. */
  "slip refused": () =>
    model({
      events: [INIT, { t: "cards", n: 1 }, { t: "decide", kind: "approve", by: "click" }, { t: "sent", ok: false }],
      cards: one,
      refusals: {
        [CARDS[0].id]:
          "That answer was refused: this decision belongs to a different app than the one in front of you. Focus the app this decision is about and try again.",
      },
      capture: true,
    }),
  "slip tearing": () =>
    model({
      events: [INIT, { t: "cards", n: 1 }, { t: "decide", kind: "approve", by: "click" }, { t: "sent", ok: true }, { t: "cards", n: 0 }, { t: "tear" }],
      held: CARDS[0],
      capture: true,
    }),
  "slip declined": () =>
    model({
      events: [INIT, { t: "cards", n: 1 }, { t: "decide", kind: "decline", by: "key" }, { t: "sent", ok: true }, { t: "cards", n: 0 }],
      held: CARDS[0],
      capture: true,
    }),
  welcome: () => model({ events: [{ t: "init", onboarded: false, cards: 0 }], onboarded: false }),
  /** The probe has not answered: no tick yet. */
  "welcome looking": () =>
    model({ events: [{ t: "init", onboarded: false, cards: 0 }], onboarded: false, probes: null }),
  "welcome missing": () =>
    model({ events: [{ t: "init", onboarded: false, cards: 0 }], onboarded: false, probes: MISSING }),
  "welcome missing other": () =>
    model({
      events: [{ t: "init", onboarded: false, cards: 0 }],
      onboarded: false,
      probes: MISSING_BUT_CODEX,
    }),
  /** After "Later": her ledger keeps the way back to Main. */
  "ledger later": () =>
    model({
      events: [{ t: "init", onboarded: false, cards: 0 }, { t: "later" }, { t: "seal" }],
      onboarded: false,
    }),
  ledger: () =>
    model({
      events: [INIT, { t: "cards", n: 1 }, { t: "seal" }],
      cards: one,
      transcript: TURN,
    }),
  "ledger empty": () => model({ events: [INIT, { t: "seal" }], origin: null }),
  // A playbook handed over from Main (ADR 0044): its command waits in the composer, and its
  // title names what every turn is working toward.
  "ledger playbook": () =>
    model({
      events: [INIT, { t: "seal" }],
      project: "Amazon FBA reimbursements",
      offer:
        "It's reimbursement day. Go through my Seller Central reports and find everything Amazon still owes me.",
    }),
  /** The daemon offline, and the last turn stopped: the two things a person must be told. */
  "ledger degraded": () =>
    model({ events: [INIT, { t: "seal" }], origin: null, ready: false, phase: "error" }),
  "ledger record": () =>
    model({ events: [INIT, { t: "seal" }, { t: "tab", tab: "record" }], transcript: TURN }),
  /** Every list whole: the only record whose header may say nothing is missing. */
  "ledger record whole": () =>
    model({
      events: [INIT, { t: "seal" }, { t: "tab", tab: "record" }],
      transcript: TURN,
      earlier: EARLIER_WHOLE,
      ledger: LEDGER_WHOLE,
    }),
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

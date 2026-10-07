/**
 * The companion's view-model and its selector — ADR 0026, README section 3.1 (surfaces) and 3.2.
 *
 * Her window is not a module, but it follows the module contract (`modules/types.ts`): the view is
 * a pure function of one model, a fixture is a model with inert actions, and nothing in `views.tsx`
 * reads a store. `selectCompanion` is the one place the halves meet: the machine's facts (what she
 * looks like), the run store's transcript and cards, the voice store's phase, the page she is
 * reading and what the daemon remembers go in, and one `CompanionModel` comes out.
 *
 * The conversation helpers here (`groupMessages`, `suggestionsFor`, `blockedBecause`) moved from
 * the Panel module, which ADR 0026 retired; they are unchanged because what a turn looks like in a
 * transcript did not change when it moved to her window.
 *
 * Nothing here decides anything. The class on a tool, the cards and every refusal arrive already
 * decided by the gate; the companion renders what it is told (README section 3.3).
 */
import type { AthenaState } from "@/lib/companion";
import type { Side, Valign } from "@/lib/companion";
import type { ToolRow } from "@/lib/api";
import { ENGINE_IDS, engineLabel, type EngineProbe } from "@/lib/engines";
import type { DecisionRequested, TurnSummary } from "@/lib/events";
import type { ActivityRow } from "@/lib/store";
import { clockOf, whenAgo } from "@/lib/time";
import type {
  AnswerResult,
  EarlierRecord,
  RunFailure,
  RunPhase,
  TranscriptEntry,
} from "@/stores/run";
import type { VoicePhase } from "@/stores/voice";

import { shown, type By, type Choice, type Dock, type LedgerTab, type MachineState } from "./machine";
import { plainFailure } from "./plain";

// -- actions -----------------------------------------------------------------------------------

export interface CompanionActions {
  /** A click on the seal: peek from the tab, open or close the ledger, bring the slip back. */
  seal: () => void;
  approve: (by: By) => void;
  decline: (by: By) => void;
  /** Esc: put the slip away, close the ledger, leave the welcome page. */
  esc: () => void;
  send: (message: string) => void;
  clear: () => void;
  pin: () => void;
  tab: (tab: LedgerTab) => void;
  open: () => void;
  later: () => void;
  /** A press on the housing or the seal: a drag if it moves 4px, a click if it does not. */
  drag: (press: { clientX: number; clientY: number; button: number }) => void;
  /** The mic button on the slip is push and hold. */
  micDown: () => void;
  micUp: () => void;
  /** Trust an origin, or stop. The user's standing permission, never the model's. */
  setOrigin: (origin: string, enabled: boolean) => void;
  /** Bring Main forward: the way back after "Later" on the welcome page. */
  openMain: () => void;
  /** Ask again which engine is on this computer. */
  checkEngines: () => void;
  /** Use another engine than the stored one (the welcome offers it when the default is missing). */
  useEngine: (id: string) => void;
}

export const NO_ACTIONS: CompanionActions = {
  seal: () => {},
  approve: () => {},
  decline: () => {},
  esc: () => {},
  send: () => {},
  clear: () => {},
  pin: () => {},
  tab: () => {},
  open: () => {},
  later: () => {},
  drag: () => {},
  micDown: () => {},
  micUp: () => {},
  setOrigin: () => {},
  openMain: () => {},
  checkEngines: () => {},
  useEngine: () => {},
};

// -- the pieces --------------------------------------------------------------------------------

export type GateClass = "READ" | "AUTO" | "GATED";

export interface PanelVoice {
  phase: VoicePhase;
  available: boolean;
  /** The live partial transcript while the key is held. */
  partial: string;
}

export const NO_VOICE: PanelVoice = { phase: "off", available: false, partial: "" };

/**
 * One block of the conversation. Consecutive assistant deltas read as one message; consecutive
 * tool rows read as one stretch of activity; a user line is always its own block.
 */
export type MessageBlock =
  | { kind: "user"; id: string; text: string }
  | { kind: "assistant"; id: string; text: string }
  | { kind: "activity"; id: string; steps: readonly TranscriptEntry[] };

/** One decision card, exactly as the approval was filed: every parameter, none cut. */
export interface CardView {
  id: string;
  action: string;
  rationale: string;
  params: readonly { key: string; value: string }[];
  /** `sketch` is a labelled stand-in, used by fixtures only; a live card has none yet. */
  capture: "sketch" | null;
  /** The answer is on its way; the buttons read "Sending..." and are off. */
  sending: boolean;
  /** One plain sentence under the buttons when the daemon refused the last answer; `null` otherwise. */
  refusal: string | null;
}

/** One step on the tape: what she is doing and where. `cls` is the gate's answer, never ours. */
export interface StepView {
  cls: GateClass | null;
  app: string;
  what: string;
  ok: boolean | null;
}

export interface TapeView {
  /** The previous line, dim; `null` until there is one. */
  prev: StepView | null;
  /** When there is no previous step: what she was asked. */
  note: string;
  cur: StepView;
  /** The turn has ended and this is its last word. */
  done: { text: string; detail: string } | null;
}

/** One line of the Record: a call or a decision, with the app, the tool, the gate's class and the clock. */
export interface RecordRow {
  id: string;
  tool: string;
  app: string;
  cls: GateClass | null;
  /** `ok`, `refused`, `recorded`, `approved`, `declined`: the word shown. */
  result: string;
  /** Local `HH:MM`, or `""` when the row carries no time. */
  clock: string;
  /** The stored UTC stamp, kept for ordering. */
  at: string;
}

export interface LedgerRow {
  id: string;
  when: string;
  /** Local `HH:MM`: `when` is a UTC stamp and is never read as local. */
  clock: string;
  model: string;
  cost: string;
  rounds: number;
  isError: boolean;
  reason: string;
}

export interface LedgerSnapshot {
  rows: readonly LedgerRow[];
  /** `(showing N of M)` when the page was cut, `""` otherwise. */
  footer: string;
  showing: number;
  total: number;
  problem: string | null;
}

export interface OriginView {
  origin: string;
  enabled: boolean;
  overrides: number;
}

export interface OfferView {
  name: string;
  cls: GateClass;
  description: string;
}

/** A decision the user answered in this window, for the Record tab. */
export interface SessionDecision {
  id: string;
  action: string;
  /** The catalog origin the card was about (`host:ledgerbox`); `""` when it is not known. */
  origin: string;
  result: AnswerResult;
  reason: string | null;
  /** UTC stamp. */
  at: string;
}

/** The two lists of the Record, and whether together they are everything. */
export interface RecordView {
  /** "This window": the calls and the decisions of this run of Athena, newest first. */
  session: readonly RecordRow[];
  /** "Earlier (kept on this computer)": decisions answered before this window opened. */
  earlier: {
    rows: readonly RecordRow[];
    /** `(showing N of M)`, always. */
    footer: string;
    problem: string | null;
  } | null;
  ledger: LedgerSnapshot | null;
  /** The header's claim, derived from the lists and never written by hand. */
  complete: boolean;
  header: string;
}

/** What the welcome says about the engine, from what the probe found rather than what is stored. */
export interface EngineView {
  state: "looking" | "ready" | "missing";
  text: string;
  /** The remedy, or the promise. Plain words. */
  sub: string;
  /** Another engine that is ready, offered when the stored one is not. */
  offer: { id: string; label: string } | null;
  checking: boolean;
}

export interface CompanionModel {
  /** The form she is drawn in: one of the ADR's seven named states. */
  form: AthenaState;
  side: Side;
  valign: Valign;
  docked: Dock | null;
  /** `human` while a card waits, `work` on the tape, `idle` otherwise. */
  tone: "idle" | "work" | "human";
  /** Ring dots lit, 0 to 12. */
  lit: number;
  attn: boolean;
  quiet: boolean;
  /** Keys the paper (it unrolls when this changes) and the figure (she arrives when it does). */
  epoch: number;
  arrive: number;
  /**
   * What the seal shows instead of a word: `sleep` resting, `work` a turn in flight, `hear` the key
   * held, `speak` her voice playing, `wait` a card for the person, `none` when she is open (the
   * ledger or the welcome says what it is itself).
   */
  mood: Mood;
  /**
   * A collapse to the seal in progress: the form the window is still sized for, and its paper's
   * epoch. The view keeps drawing that form and folds it into the seal over `SHRINK_MS`, so the
   * rectangle never stands empty while the smaller size waits. Null otherwise, and after a slip,
   * whose paper has already torn away.
   */
  exit: { form: AthenaState; epoch: number } | null;
  /** She has just grown out of the seal: the fold played backwards, on the same clock. */
  opening: boolean;
  /** A word under the seal only where no mood speaks for it (the welcome, the ledger). */
  caption: string;
  badge: string;
  sealLabel: string;
  /** Waiting cards, the one being stamped first. */
  cards: readonly CardView[];
  /** `sending`: the answer is on its way and nothing is stamped yet. */
  decision: { kind: Choice; by: By; tearing: boolean; sending: boolean } | null;
  listening: boolean;
  /** What the microphone has heard so far. */
  heard: string;
  /** The daemon has a voice backend; the slip's mic button is disabled, with a reason, when not. */
  micAvailable: boolean;
  tape: TapeView;
  tab: LedgerTab;
  pinned: boolean;
  say: { n: number; text: string };
  talk: {
    blocks: readonly MessageBlock[];
    suggestions: readonly string[];
    /** The sentence a person reads, and the code and detail kept for the expanded record. */
    error: { sentence: string; reason: string; detail: string } | null;
    /** Main was left hidden by "Later": the empty Talk offers the way back. */
    mainHidden: boolean;
    working: boolean;
    phrase: string;
    ready: boolean;
    /** Why the composer is disabled, in the app's own words. Empty when it is not. */
    blocked: string;
    host: string | null;
  };
  record: RecordView;
  origins: {
    host: string | null;
    offers: readonly OfferView[];
    /** `(showing N of M)` when the offers were cut, `""` otherwise. */
    offersFooter: string;
    known: readonly OriginView[];
  };
  welcome: { engine: string; engineView: EngineView };
  actions: CompanionActions;
}

// -- the selector ------------------------------------------------------------------------------

export interface CompanionInputs {
  machine: MachineState;
  run: {
    phase: RunPhase;
    transcript: readonly TranscriptEntry[];
    cards: readonly DecisionRequested[];
    summary: TurnSummary | null;
    error: RunFailure | null;
    /** Cards whose answer is in flight, and the sentence under the buttons of a refused one. */
    answering?: Readonly<Record<string, string>>;
    refusals?: Readonly<Record<string, string>>;
    /** Every call of this window; when absent the transcript's tool rows are the record. */
    calls?: readonly TranscriptEntry[];
    earlier?: EarlierRecord | null;
  };
  voice: PanelVoice;
  daemonReady: boolean;
  /** The focused page's web origin, or `null` when nothing is open. */
  origin: string | null;
  tools: readonly ToolRow[];
  /** The card being stamped, once the store has dropped it. */
  held: DecisionRequested | null;
  known: readonly OriginView[];
  ledger: LedgerSnapshot | null;
  decisions: readonly SessionDecision[];
  /** The engine's name for a person ("Claude Code"). */
  engine: string;
  /** The stored engine's id, and what the probe found (`null` until the daemon has answered). */
  engineId?: string;
  probes?: readonly EngineProbe[] | null;
  probing?: boolean;
  probeProblem?: string | null;
  /** The welcome has been answered: when it has not, Main may have been left hidden. */
  onboarded?: boolean;
  /** The clock, for "2 h ago". Injected so the selector stays pure. */
  nowMs?: number;
  actions: CompanionActions;
}

/** How many offered tools the Origins tab lists before it says it cut the list. */
export const OFFERS_SHOWN = 12;

const CAPTION: Record<AthenaState, string> = {
  seal: "resting",
  tape: "working",
  hear: "hearing",
  slip: "waiting",
  welcome: "hello",
  ledger: "ledger",
  tab: "",
};

export type Mood = "sleep" | "work" | "hear" | "speak" | "wait" | "none";

/**
 * The seal's mood, in precedence order: a card waiting on the person outranks everything, then the
 * person talking, then her voice, then work in flight; at rest she sleeps, and an open form (the
 * ledger, the welcome, the docked tab) shows no mood of its own.
 */
export function moodOf(form: AthenaState, cards: number, listening: boolean, voice: VoicePhase, working: boolean): Mood {
  if (cards > 0) return "wait";
  if (listening || form === "hear" || voice === "listening") return "hear";
  if (voice === "speaking") return "speak";
  if (working || form === "tape" || voice === "thinking") return "work";
  return form === "seal" ? "sleep" : "none";
}

/** Build the view-model. Pure: every argument is a snapshot the caller already read. */
export function selectCompanion(i: CompanionInputs): CompanionModel {
  const m = i.machine;
  const form = m.form;
  const waiting = cardsOf(i.run.cards, i.held, m, i.run.answering ?? {}, i.run.refusals ?? {});
  const n = shown(m);
  const busy = i.run.phase === "running" || i.run.phase === "acting";
  const steps = stepsOfTurn(i.run.transcript);
  const working = busy || m.working;

  const quietCard = n > 0 && form !== "slip" && form !== "ledger";
  const mood = moodOf(form, n, m.listening, i.voice.phase, working);
  const caption = mood === "none" ? CAPTION[form] : "";

  return {
    form,
    side: m.side,
    valign: m.valign,
    docked: m.docked,
    tone: n > 0 ? "human" : form === "tape" || form === "hear" ? "work" : "idle",
    lit: n > 0 ? 12 : form === "tape" && !m.working ? 12 : working ? Math.min(11, 1 + steps.length * 3) : 0,
    attn: m.attn,
    quiet: m.quiet,
    epoch: m.epoch,
    arrive: m.arrive,
    mood,
    exit:
      m.leaving && (form === "seal" || form === "tab") && m.leaving.form !== "slip" && m.leaving.form !== "seal" && m.leaving.form !== "tab"
        ? m.leaving
        : null,
    opening: m.opened,
    caption,
    badge: quietCard ? String(n) : "",
    sealLabel: sealLabel(form, n, mood),
    cards: waiting,
    decision: m.decided
      ? { kind: m.decided.kind, by: m.decided.by, tearing: m.decided.tearing, sending: m.decided.sending }
      : null,
    listening: m.listening,
    heard: i.voice.partial,
    micAvailable: i.voice.available,
    tape: tapeOf(i.run, steps, i.tools, m, i.engine),
    tab: m.tab,
    pinned: m.pinned,
    say: m.say,
    talk: {
      blocks: groupMessages(i.run.transcript),
      suggestions: suggestionsFor(i.tools),
      error: i.run.error
        ? {
            sentence: plainFailure(i.run.error.reason, i.engine),
            reason: i.run.error.reason,
            detail: i.run.error.detail,
          }
        : null,
      mainHidden: i.onboarded === false,
      working: busy,
      phrase: phraseFor(i.run.phase),
      ready: i.daemonReady && i.origin !== null,
      blocked: blockedBecause(i.daemonReady, i.origin, busy),
      host: hostOf(i.origin),
    },
    record: recordView({
      calls: i.run.calls ?? i.run.transcript,
      decisions: i.decisions,
      tools: i.tools,
      earlier: i.run.earlier ?? null,
      ledger: i.ledger,
      nowMs: i.nowMs,
    }),
    origins: {
      host: hostOf(i.origin),
      offers: i.tools.slice(0, OFFERS_SHOWN).map((t) => ({ name: t.name, cls: t.class, description: t.description })),
      offersFooter: i.tools.length > OFFERS_SHOWN ? `(showing ${OFFERS_SHOWN} of ${i.tools.length})` : "",
      known: i.known,
    },
    welcome: {
      engine: i.engine,
      engineView: engineView(i.engineId ?? "claude_code", i.probes ?? null, i.probeProblem ?? null, i.probing ?? false),
    },
    actions: i.actions,
  };
}

/** Waiting cards as the person sees them: the one being answered stays first until it has torn. */
function cardsOf(
  cards: readonly DecisionRequested[],
  held: DecisionRequested | null,
  m: MachineState,
  answering: Readonly<Record<string, string>>,
  refusals: Readonly<Record<string, string>>,
): CardView[] {
  const list = m.decided && held && !cards.some((c) => c.id === held.id) ? [held, ...cards] : cards;
  return list.map((card, index) => ({
    ...cardView(card),
    sending: answering[card.id] !== undefined || (index === 0 && m.decided?.sending === true),
    refusal: refusals[card.id] ?? null,
  }));
}

/** What a card says when the daemon's pending row carried no reason. */
export const NO_RATIONALE = "No reason was filed with this request. Read the details below before you answer.";

export function cardView(card: DecisionRequested): CardView {
  return {
    id: card.id,
    action: card.action,
    rationale: card.rationale || NO_RATIONALE,
    params: Object.entries(card.params).map(([key, value]) => ({ key, value: spell(value) })),
    capture: null,
    sending: false,
    refusal: null,
  };
}

/** A parameter as it will be run: strings as written, anything else as JSON. Never cut. */
function spell(value: unknown): string {
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return String(value);
  }
}

function sealLabel(form: AthenaState, n: number, mood: Mood): string {
  if (n) return `Athena. ${n} decision${n > 1 ? "s" : ""} waiting on you. Press Enter to open.`;
  if (mood === "hear") return "Athena. Listening.";
  if (mood === "speak") return "Athena. Speaking.";
  switch (form) {
    case "tape":
      return "Athena. Working. Press Enter to open the ledger.";
    case "tab":
      return "Athena, docked. Press Enter to summon.";
    case "ledger":
      return "Athena. The ledger is open. Press Enter to close it.";
    case "welcome":
      return "Athena. First launch.";
    default:
      return "Athena. Resting. Nothing is waiting on you. Press Enter to open the ledger.";
  }
}

// -- the tape ----------------------------------------------------------------------------------

/** The tool rows of the turn in progress: everything after the last thing the user said. */
export function stepsOfTurn(transcript: readonly TranscriptEntry[]): TranscriptEntry[] {
  let from = 0;
  transcript.forEach((entry, index) => {
    if (entry.kind === "user") from = index + 1;
  });
  return transcript.slice(from).filter((entry) => entry.kind === "tool");
}

/** `host.ledgerbox.list_overdue → 3 rows` as a step. The class is the catalog's, looked up. */
export function stepOf(entry: TranscriptEntry, tools: readonly ToolRow[]): StepView {
  const arrow = entry.text.indexOf(" → ");
  const name = arrow === -1 ? entry.text : entry.text.slice(0, arrow);
  const result = arrow === -1 ? "" : entry.text.slice(arrow + 3);
  const parts = name.split(".");
  const app = parts.length > 2 ? parts[1] : parts[0] || "athena";
  const bare = (parts.length > 2 ? parts.slice(2).join(".") : (parts[parts.length - 1] ?? name)).replace(/[_-]+/g, " ");
  const found = tools.find((t) => t.name === name);
  return {
    cls: found ? found.class : null,
    app,
    what: result ? `${bare}: ${result}` : bare,
    ok: entry.ok ?? null,
  };
}

function tapeOf(
  run: CompanionInputs["run"],
  steps: readonly TranscriptEntry[],
  tools: readonly ToolRow[],
  m: MachineState,
  engine: string,
): TapeView {
  const lastUser = [...run.transcript].reverse().find((e) => e.kind === "user");
  const note = lastUser ? `acting on “${lastUser.text}”` : "acting on what she was asked";
  const last = steps[steps.length - 1];
  const before = steps[steps.length - 2];
  const cur: StepView = last
    ? stepOf(last, tools)
    : {
        cls: null,
        app: "Athena",
        what: run.phase === "acting" ? "acting on the page" : "thinking",
        ok: null,
      };
  const finished = !m.working && run.phase !== "running" && run.phase !== "acting";
  let done: TapeView["done"] = null;
  if (finished && (run.error || m.lingering)) {
    done = run.error
      ? { text: "stopped", detail: plainFailure(run.error.reason, engine) }
      : {
          text: "done",
          detail: [
            `${steps.length} step${steps.length === 1 ? "" : "s"}`,
            run.summary ? `${run.summary.rounds} round${run.summary.rounds === 1 ? "" : "s"}` : "",
          ]
            .filter(Boolean)
            .join(", "),
        };
  }
  return { prev: before ? stepOf(before, tools) : null, note, cur, done };
}

/** This session's calls, newest first, every one of them. */
export function recordOf(transcript: readonly TranscriptEntry[], tools: readonly ToolRow[]): RecordRow[] {
  return transcript
    .filter((e) => e.kind === "tool")
    .map((e) => {
      const s = stepOf(e, tools);
      const arrow = e.text.indexOf(" → ");
      return {
        id: e.id,
        tool: arrow === -1 ? e.text : e.text.slice(0, arrow),
        app: s.app,
        cls: s.cls,
        result: e.ok === false ? "refused" : e.ok === true ? "ok" : "recorded",
        clock: e.at ? clockOf(e.at) : "",
        at: e.at ?? "",
      };
    })
    .reverse();
}

/** `host:ledgerbox` is the app `ledgerbox`; a web origin is shown as its host. */
export function appOf(origin: string): string {
  if (origin.startsWith("host:")) return origin.slice(5);
  return hostOf(origin) ?? origin;
}

/** The word a decision's result is shown as. */
function wordOf(result: AnswerResult): string {
  return result === "approved" ? "approved" : result === "user_denied" ? "declined" : "refused";
}

/** A decision answered in this window as a row. The gate class is GATED: only a gated call is a card. */
export function decisionRow(d: SessionDecision): RecordRow {
  return {
    id: d.id,
    tool: d.action,
    app: appOf(d.origin) || "unknown app",
    cls: "GATED",
    result: wordOf(d.result),
    clock: d.at ? clockOf(d.at) : "",
    at: d.at,
  };
}

/** A decision kept from an earlier window (an `activity` row) as a row. */
export function activityRow(row: ActivityRow, nowMs: number | undefined): RecordRow {
  const cls = row.class === "GATED" || row.class === "READ" || row.class === "AUTO" ? row.class : null;
  return {
    id: row.approval_id ?? String(row.id),
    tool: row.tool,
    app: appOf(row.origin) || "unknown app",
    cls,
    result: row.outcome || "recorded",
    clock: `${clockOf(row.ts)} · ${whenAgo(row.ts, nowMs)}`,
    at: row.ts,
  };
}

/** `(showing N of M)`, always: a list that says nothing about its size is a list that may be cut. */
export const showingOf = (n: number, m: number): string => `(showing ${n} of ${m})`;

/**
 * The Record's two lists and the claim its header makes about them.
 *
 * "Nothing is missing from this list" is true only when every list is whole: this window's is whole
 * by construction, the earlier one is whole when its `showing` equals its `total`, the daemon's when
 * it announced no cut. A list that has not answered or could not be read is not whole.
 */
export function recordView(i: {
  calls: readonly TranscriptEntry[];
  decisions: readonly SessionDecision[];
  tools: readonly ToolRow[];
  earlier: EarlierRecord | null;
  ledger: LedgerSnapshot | null;
  nowMs?: number;
}): RecordView {
  const session = [...i.decisions.map(decisionRow), ...recordOf(i.calls, i.tools)].sort((a, b) =>
    a.at < b.at ? 1 : a.at > b.at ? -1 : 0,
  );
  const earlier = i.earlier
    ? {
        rows: i.earlier.rows.map((r) => activityRow(r, i.nowMs)),
        footer: showingOf(i.earlier.showing, i.earlier.total),
        problem: i.earlier.problem,
      }
    : null;
  const unread = i.earlier === null || i.earlier.problem !== null || i.ledger === null || i.ledger.problem !== null;
  const cut =
    (i.earlier !== null && i.earlier.showing < i.earlier.total) ||
    (i.ledger !== null && i.ledger.showing < i.ledger.total);
  const complete = !unread && !cut;
  const lead = "Every call, by app and gate class.";
  let header: string;
  if (complete) {
    header = `${lead} Nothing is missing from this list.`;
  } else if (unread) {
    header = `${lead} Part of the record has not been read yet, so this list may be incomplete.`;
  } else {
    const shownN = session.length + (i.earlier?.showing ?? 0) + (i.ledger?.showing ?? 0);
    const total = session.length + (i.earlier?.total ?? 0) + (i.ledger?.total ?? 0);
    header = `${lead} Some are not shown here ${showingOf(shownN, total)}.`;
  }
  return { session, earlier, ledger: i.ledger, complete, header };
}

// -- the welcome's engine line ----------------------------------------------------------------

/**
 * What the welcome says about the engine (UAT backlog B4): what the probe found, not what is stored.
 * Plain words only: nothing here says PATH, probe or daemon.
 */
export function engineView(
  id: string,
  probes: readonly EngineProbe[] | null,
  problem: string | null,
  checking: boolean,
): EngineView {
  const label = engineLabel(id);
  if (probes === null) {
    return problem
      ? {
          state: "missing",
          text: "Athena could not look for your engine.",
          sub: "Check again in a moment.",
          offer: null,
          checking,
        }
      : { state: "looking", text: "Looking for your engine…", sub: "", offer: null, checking };
  }
  const mine = probes.find((p) => p.id === id);
  if (mine?.state === "found") {
    return { state: "ready", text: `Engine: ${label}, ready.`, sub: "She never asks for a key.", offer: null, checking };
  }
  if (mine === undefined || mine.state === "unknown") {
    return { state: "looking", text: "Looking for your engine…", sub: "", offer: null, checking };
  }
  const other = probes.find((p) => p.id !== id && p.state === "found" && (ENGINE_IDS as readonly string[]).includes(p.id));
  const offer = other ? { id: other.id, label: engineLabel(other.id) } : null;
  const text = mine.state === "not_logged_in" ? `${label} is installed but not signed in.` : `${label} is not on this computer yet.`;
  const remedy =
    mine.state === "not_logged_in"
      ? "Sign in to it once in a terminal, then press Check again. She never asks for a key."
      : "Install it, then press Check again. She never asks for a key.";
  return {
    state: "missing",
    text,
    sub: offer ? `${offer.label} is ready on this computer, and she can use it instead. Or ${remedy.charAt(0).toLowerCase()}${remedy.slice(1)}` : remedy,
    offer,
    checking,
  };
}

// -- the ledger --------------------------------------------------------------------------------

/**
 * `GET /ledger` as rows. The reply is `announced(rows, total, "rows")` (routes.py), read
 * defensively because it arrives as `Record<string, unknown>`: a field of the wrong type becomes
 * an empty one rather than a thrown render.
 */
export function ledgerFrom(reply: Record<string, unknown>): LedgerSnapshot {
  const raw = Array.isArray(reply.rows) ? (reply.rows as Array<Record<string, unknown>>) : [];
  const str = (v: unknown) => (typeof v === "string" ? v : "");
  const num = (v: unknown) => (typeof v === "number" ? v : 0);
  const rows = raw.map((row) => ({
      id: str(row.row_id) || str(row.turn_id),
      when: str(row.created_at),
      clock: str(row.created_at) ? clockOf(str(row.created_at)) : "—",
      model: str(row.model) || str(row.engine),
      cost: typeof row.cost_usd === "number" ? `${row.cost_estimated ? "~" : ""}$${row.cost_usd.toFixed(4)}` : "no cost",
      rounds: num(row.rounds),
      isError: row.is_error === true,
      reason: str(row.error_reason),
    }));
  const footer = str(reply.footer);
  // The footer is the daemon's own words; the figures come from it when it cut the page.
  const cut = /showing (\d+) of (\d+)/.exec(footer);
  const showing = cut ? Number(cut[1]) : typeof reply.showing === "number" ? reply.showing : rows.length;
  const total = cut ? Number(cut[2]) : typeof reply.total === "number" ? reply.total : rows.length;
  return { rows, footer, showing, total, problem: null };
}

// -- the conversation (moved from the Panel module, unchanged) ---------------------------------

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

/** What to ask when the page offers nothing to suggest. */
export const DEFAULT_SUGGESTION = "What can you do on this page?";

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
    return description.charAt(0).toUpperCase() + description.slice(1);
  }
  const bare = tool.name.split(".").pop() ?? "";
  if (!bare) return null;
  const words = bare.replace(/[_-]+/g, " ").trim();
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : null;
}

export function hostOf(origin: string | null): string | null {
  if (!origin) return null;
  try {
    return new URL(origin).host || origin;
  } catch {
    return origin;
  }
}

export function blockedBecause(ready: boolean, origin: string | null, busy: boolean): string {
  if (!ready) return "Athena is not running yet.";
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

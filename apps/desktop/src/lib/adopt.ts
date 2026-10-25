/**
 * The Adopt studio's wire contract on the desktop side — mirrors src/athena/adopt/contract.py (ADR 0097).
 *
 * Absent values: an optional string is "", an optional number or object is null, a list is []; a key is
 * never omitted. Every event carries `seq`; a reconnect asks `GET /adopt/<sid>/events?after=<seq>`.
 */

export type SlotKind = "portal" | "gate" | "fact" | "trap";
export type SlotStatus = "open" | "guessed" | "confirmed";
export type SlotSource =
  "user" | "research" | "memory" | "document" | "account" | "default";
export type LaneKind = "rules" | "accounts" | "memory" | "document";
export type LaneStatus = "queued" | "running" | "done" | "failed" | "skipped";
export type ShowcaseStatus = "queued" | "running" | "done" | "failed";
/** Why a done showcase claims no dollar figure (ADR 0125); "" when none was withheld. */
export type FoundReason = "" | "shaped";
export type AnswerVia = "text" | "voice";

export interface Slot {
  id: string;
  kind: SlotKind;
  label: string;
  status: SlotStatus;
  value: string;
  source: SlotSource;
}

export interface Option {
  id: string;
  label: string;
}

export interface Question {
  id: string;
  slot_ids: string[];
  text: string;
  options: Option[];
  multi: boolean;
  allow_text: boolean;
}

export interface Finding {
  text: string;
  source_url: string;
  slot_ids: string[];
}

export interface Lane {
  id: string;
  kind: LaneKind;
  title: string;
  status: LaneStatus;
  summary: string;
  findings: Finding[];
}

export interface Answer {
  question_id: string;
  choice_ids: string[];
  text: string;
}

/** One turn of a run, as bench.json's `trace` stores it (parsed by lib/playbooks.ts as TraceTurn). */
export type RawTraceTurn = Record<string, unknown>;

/** A chore that nearly fits (the intake conversation, ADR 0098). */
export interface Alternate {
  playbook_id: string;
  title: string;
  why: string;
}

/** The intake conversation's end. Strings are "" and lists [] when absent; no key is omitted. */
export interface Verdict {
  fit: "template" | "custom";
  /** The chore that fits; "" when `fit` is "custom". */
  playbook_id: string;
  why: string;
  differs: string;
  alternates: Alternate[];
  /** The need in the person's words: the opening message of an adopt session. */
  need: string;
  /** A draft command for Athena; "" when `fit` is "template". */
  command: string;
}

export type AdoptEvent =
  | { kind: "adopt.progress"; seq: number; text: string }
  | { kind: "adopt.say"; seq: number; text: string }
  | {
      kind: "adopt.questions";
      seq: number;
      round: number;
      questions: Question[];
    }
  | { kind: "adopt.slots"; seq: number; slots: Slot[] }
  | { kind: "adopt.lane"; seq: number; lane: Lane }
  | {
      kind: "adopt.brief";
      seq: number;
      rev: number;
      md: string;
      command: string;
      portals: Record<string, string>;
      open_slot_ids: string[];
    }
  | { kind: "adopt.clear"; seq: number; rev: number }
  | {
      kind: "adopt.showcase";
      seq: number;
      status: ShowcaseStatus;
      turn: number | null;
      total: number | null;
      trace: RawTraceTurn[];
      found_usd: number | null;
      /** Absent from an older daemon; the parser reads that as "". */
      found_reason?: FoundReason;
      detail: string;
    }
  | {
      kind: "adopt.usage";
      seq: number;
      leg: string;
      model: string;
      effort: string;
      ms: number;
      first_text_ms: number | null;
    }
  | ({ kind: "adopt.verdict"; seq: number } & Verdict)
  | { kind: "adopt.error"; seq: number; reason: string; detail: string };

export type AdoptEventKind = AdoptEvent["kind"];

export const ADOPT_EVENT_KINDS: readonly AdoptEventKind[] = [
  "adopt.progress",
  "adopt.say",
  "adopt.questions",
  "adopt.slots",
  "adopt.lane",
  "adopt.brief",
  "adopt.clear",
  "adopt.showcase",
  "adopt.usage",
  "adopt.verdict",
  "adopt.error",
];

/** Routes (all carry the daemon token header, like every other route). */
export const ADOPT_ROUTES = {
  start: "/adopt", // POST {playbook_id, intro?, case_id?} -> {ok, session_id, slots, case}
  cases: (playbookId: string) =>
    `/adopt/cases?playbook_id=${encodeURIComponent(playbookId)}`, // GET -> {ok, cases, showing, total, footer}
  events: (sid: string, after: number) =>
    `/adopt/${encodeURIComponent(sid)}/events?after=${after}`, // GET SSE
  answer: (sid: string) => `/adopt/${encodeURIComponent(sid)}/answer`, // POST {answers, via}; question_id "" = said to no question
  documents: (sid: string) => `/adopt/${encodeURIComponent(sid)}/documents`, // POST {name, mime, data_b64} -> {ok, doc_id}
  enough: (sid: string) => `/adopt/${encodeURIComponent(sid)}/enough`, // POST
  approve: (sid: string) => `/adopt/${encodeURIComponent(sid)}/approve`, // POST {rev} -> {ok, rev, case_id, case_problem}
  runs: (caseId: string) =>
    `/adopt/cases/${encodeURIComponent(caseId)}/runs`, // GET -> {ok, case_id, open, receipts, showing, total, footer}
  done: (caseId: string) => `/adopt/cases/${encodeURIComponent(caseId)}/done`, // POST -> {ok, receipt, saved, problem}
  session: (sid: string) => `/adopt/${encodeURIComponent(sid)}`, // DELETE
} as const;

/** The Chores front door (ADR 0098): same frames and answer body as /adopt; no slots, no brief. */
export const INTAKE_ROUTES = {
  start: "/intake", // POST {need?} -> {ok, session_id}
  events: (sid: string, after: number) =>
    `/intake/${encodeURIComponent(sid)}/events?after=${after}`, // GET SSE
  answer: (sid: string) => `/intake/${encodeURIComponent(sid)}/answer`, // POST {answers, via}; question_id "" = said to no question
  decide: (sid: string) => `/intake/${encodeURIComponent(sid)}/decide`, // POST (no body): "Just decide for me"
  session: (sid: string) => `/intake/${encodeURIComponent(sid)}`, // DELETE
} as const;

export interface IntakeStartReply {
  ok: true;
  session_id: string;
}

/**
 * A saved case (ADR 0123): one person's approved setup of one playbook, kept in the brain as
 * `goals/<case_id>.md`. `case_id` is a `proj_` id, the same for every approval of the case.
 */
export interface CaseSummary {
  case_id: string;
  playbook_id: string;
  title: string;
  approved_rev: number;
  /** ISO 8601, UTC: the latest approval. */
  approved_at: string;
  created: string;
  /** Slots confirmed, of `slots`. */
  confirmed: number;
  slots: number;
  /** The project (space, ADR 0225) the chore belongs to; "" when it is Athena's core. */
  space_id: string;
}

export interface CasesReply {
  ok: true;
  cases: CaseSummary[];
  showing: number;
  total: number;
  /** "(showing N of M)" when the list was cut, else "". */
  footer: string;
}

export interface StartReply {
  ok: true;
  session_id: string;
  slots: Slot[];
  /** The case this session reopened; `null` for a fresh conversation. */
  case: CaseSummary | null;
}

export interface ApproveReply {
  rev: number;
  /** The case the approval was written to; "" when it could not be saved. */
  case_id: string;
  /** Why the case was not saved, or "". The approval stands either way. */
  case_problem: string;
}

// -- the receipts of a case's runs (ADR 0124) --------------------------------------------------------

/** One card filed in a run, as the approval table holds it. `params` are the page's, untrusted text. */
export interface ReceiptCard {
  id: string;
  action: string;
  /** `approved` | `declined` | `expired` | `pending`. */
  status: string;
  /** The gate let an approved card through. */
  consumed: boolean;
  created_at: string;
  resolved_at: string;
  /** The card's key parameters as text, each cut; `more_params` counts the ones left out. */
  params: Record<string, string>;
  more_params: number;
  /** The card's own amount parameter, or null. */
  amount_usd: number | null;
}

/** A call of the run that may have completed (`outcome_unknown`): its episode, when, its text (untrusted). */
export interface ReceiptNote {
  episode_id: string;
  at: string;
  text: string;
}

/**
 * What one run of a case came to, joined by the `turns` stamped under the case (ADR 0127), each in its
 * own tab's conversation. Counts are the approval table's for the cards those turns filed; `asked_usd`
 * sums the approved cards' own amounts (`asked_cards` of them), never what came back; `calls`..`ms` are
 * the ledger's rows of those turns. `until` is "" for a run still open. `conversation_id` is "" (a
 * receipt kept before ADR 0127 names the `conv_proj_…` it was folded from).
 */
export interface Receipt {
  case_id: string;
  conversation_id: string;
  since: string;
  until: string;
  first_at: string;
  last_at: string;
  turns: number;
  approved: number;
  consumed: number;
  declined: number;
  expired: number;
  pending: number;
  asked_usd: number | null;
  asked_cards: number;
  calls: number;
  errors: number;
  cost_usd: number;
  unpriced: number;
  ms: number;
  cards: ReceiptCard[];
  cards_total: number;
  cards_footer: string;
  notes: ReceiptNote[];
  notes_total: number;
  notes_footer: string;
  /** "done" once the person pressed done, else "". */
  closed_by: string;
  closed_at: string;
  schema: number;
}

export interface RunsReply {
  ok: true;
  case_id: string;
  /** The run since the last receipt, or null when nothing ran in it. */
  open: Receipt | null;
  /** The receipts the case file keeps, latest first. */
  receipts: Receipt[];
  showing: number;
  total: number;
  footer: string;
}

// -- when a chore comes due (ADR 0131) ------------------------------------------------------------

export type CadenceKind = "weekly" | "monthly" | "every_days";
/** How a review was closed: "" still open. */
export type ReviewAnswer = "" | "prepare" | "skip" | "paused";
/** A review's lines, in the order it lists them: what to check first, first. */
export type ReviewLineKind = "expired" | "may_have_completed" | "pending" | "approved" | "declined";
/** Where an "Open and prepare" address came from; "" when none is known. */
export type PortalSource = "playbook" | "case" | "";

/**
 * When a chore comes due, in the person's own wall-clock time: `weekday` (0 Monday) for weekly, `day`
 * (1-31, the month's last day when shorter) for monthly, `every_days` from `start` (YYYY-MM-DD).
 */
export interface CadenceRule {
  kind: CadenceKind;
  weekday: number;
  day: number;
  every_days: number;
  start: string;
  /** HH:MM, local. */
  at: string;
}

/** The review a due occurrence opened; `due_at` (ISO UTC) is the occurrence, the notice's identity. */
export interface ChoreReview {
  due_at: string;
  opened_at: string;
  /** Later occurrences folded into it, the first ten by date in `missed_at`. */
  missed: number;
  missed_at: string[];
  /** When its notice was shown; "" not yet. */
  delivered_at: string;
  held_at: string;
  answer: ReviewAnswer;
  answered_at: string;
  first_turn_id: string;
}

/** One line of a cadence's log: what the loop or the person decided, and why. */
export interface CadenceLine {
  at: string;
  event: string;
  due_at: string;
  text: string;
}

/** A chore's cadence, `rituals/cadence/<case_id>.md` in the brain. Only the person sets it. */
export interface Cadence {
  id: string;
  case_id: string;
  enabled: boolean;
  rule: CadenceRule;
  timezone: string;
  next_run_at: string;
  last_run_at: string;
  created: string;
  updated_at: string;
  review: ChoreReview | null;
  /** Occurrences that came due while a review she was shown sat unanswered. */
  unanswered: number;
  log: CadenceLine[];
  log_total: number;
  schema: number;
}

/** A card of the last run (`action`, `params`: untrusted page text) or a call that may have completed (`text`). */
export interface ReviewLine {
  kind: ReviewLineKind;
  action: string;
  params: Record<string, string>;
  at: string;
  text: string;
}

/** One app "Open and prepare" opens; `url` "" means no address is known, said, never guessed. */
export interface ReviewPortal {
  name: string;
  url: string;
  source: PortalSource;
}

/** `GET /adopt/cases/<proj>/review`: assembled with no model call from the case, its cadence and last receipt. */
export interface DueReview {
  case_id: string;
  playbook_id: string;
  title: string;
  /** The case's stored command: what "Open and prepare" puts in her composer, and nothing else. */
  command: string;
  enabled: boolean;
  rule_text: string;
  timezone: string;
  next_run_at: string;
  review: ChoreReview | null;
  unanswered: number;
  /** Three unanswered in a row: the review asks "pause or slow this chore?". */
  ask_slow: boolean;
  last_run_at: string;
  lines: ReviewLine[];
  lines_total: number;
  lines_footer: string;
  portals: ReviewPortal[];
}

/** One notice `GET /adopt/chores/due` asks the desktop to show, once per (case, due date). */
export interface DueNotice {
  case_id: string;
  playbook_id: string;
  title: string;
  due_at: string;
  missed: number;
  ask_slow: boolean;
}

export interface CadenceReply {
  ok: true;
  case_id: string;
  cadence: Cadence | null;
  rule_text: string;
  zone_note: string;
  /** From the playbook's `economics.times_per_year`; a suggestion, never applied without her. */
  suggested: CadenceRule | null;
  suggested_text: string;
  suggested_basis: string;
  upcoming: string[];
  /** The log, latest first. */
  log: CadenceLine[];
  showing: number;
  total: number;
  footer: string;
}

export interface DueReply {
  ok: true;
  notices: DueNotice[];
  /** Notices quiet hours are holding. */
  held: number;
  quiet: { start: string; end: string; timezone: string; now: boolean; until: string };
  ticked_at: string;
  showing: number;
  total: number;
  footer: string;
}

export const CHORE_ROUTES = {
  cadence: (caseId: string) => `/adopt/cases/${encodeURIComponent(caseId)}/cadence`, // GET; POST {rule?, timezone?, enabled?}
  review: (caseId: string) => `/adopt/cases/${encodeURIComponent(caseId)}/review`, // GET; POST {due_at, answer}
  due: "/adopt/chores/due", // GET
} as const;

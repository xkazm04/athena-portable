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
  "adopt.error",
];

/** Routes (all carry the daemon token header, like every other route). */
export const ADOPT_ROUTES = {
  start: "/adopt", // POST {playbook_id} -> {ok, session_id, slots}
  events: (sid: string, after: number) =>
    `/adopt/${encodeURIComponent(sid)}/events?after=${after}`, // GET SSE
  answer: (sid: string) => `/adopt/${encodeURIComponent(sid)}/answer`, // POST {answers, via}
  documents: (sid: string) => `/adopt/${encodeURIComponent(sid)}/documents`, // POST {name, mime, data_b64} -> {ok, doc_id}
  enough: (sid: string) => `/adopt/${encodeURIComponent(sid)}/enough`, // POST
  approve: (sid: string) => `/adopt/${encodeURIComponent(sid)}/approve`, // POST {rev}
  session: (sid: string) => `/adopt/${encodeURIComponent(sid)}`, // DELETE
} as const;

export interface StartReply {
  ok: true;
  session_id: string;
  slots: Slot[];
}

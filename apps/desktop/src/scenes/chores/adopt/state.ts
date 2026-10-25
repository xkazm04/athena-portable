/**
 * The Adopt studio's state, as a pure reducer — ADR 0097, README section 3.5.
 *
 * Everything the studio draws is a fold over the session's `adopt.*` events plus the few things
 * the person did locally (an answer sent, a document dropped, "Good enough", Approve). A `seq` at
 * or below the last one drawn is dropped, so a reconnect that resends is harmless. The words the
 * studio composes — a card's receipt, the research harvest, the slot board's groups, the recorded
 * run with the person's portal names in it — are pure functions here, each tested without a DOM.
 */
import type {
  AdoptEvent,
  Answer,
  AnswerVia,
  CaseSummary,
  Lane,
  Question,
  Slot,
  SlotKind,
} from "@/lib/adopt";
import type { TraceTurn } from "@/lib/playbooks";

type Of<K extends AdoptEvent["kind"]> = Extract<AdoptEvent, { kind: K }>;
export type BriefEvent = Of<"adopt.brief">;
export type ShowcaseEvent = Of<"adopt.showcase">;

/**
 * The session's one rehearsal, stamped with the approved draft it followed. The daemon rehearses
 * once per conversation, so a later approval never gets its own: the stamp is what lets the studio
 * say whose run it is showing.
 */
export interface Rehearsal {
  rev: number;
  event: ShowcaseEvent;
}

/**
 * Where the brief on show stands, as one value: every claim the studio draws about the brief is
 * read from this, so none of them can be about another draft.
 * - `interview`: no brief yet.
 * - `drafted`: she is still checking it.
 * - `cleared`: approvable, by the auditor's clear or the person's "Good enough".
 * - `stale`: the person answered or said something after it, so the daemon refuses to approve it
 *   until the next draft arrives.
 * - `approved`: done; `rehearsal` is the session's one rehearsal, whichever draft it followed, and
 *   `handed` says whether this draft (not an earlier one) went to Athena.
 */
export type Phase =
  | { kind: "interview" }
  | { kind: "drafted"; rev: number }
  | { kind: "cleared"; rev: number; by: "auditor" | "enough" }
  | { kind: "stale"; rev: number }
  | { kind: "approved"; rev: number; rehearsal: Rehearsal | null; handed: boolean };

export type FeedItem =
  | { kind: "say"; key: string; text: string }
  | {
      kind: "card";
      key: string;
      round: number;
      questions: Question[];
      answers: Answer[] | null;
    }
  | { kind: "you"; key: string; text: string; via: AnswerVia }
  | {
      kind: "doc";
      key: string;
      name: string;
      status: "sending" | "sent" | "failed";
      detail: string;
    }
  | { kind: "error"; key: string; reason: string; detail: string };

export type Conn =
  "starting" | "live" | "retrying" | "lost" | "failed" | "closed";

/** The daemon's last word on a session that ended (DELETE, idle expiry): stop following, do not reconnect. */
export const SESSION_CLOSED = "session_closed";

export interface StudioState {
  sid: string;
  conn: Conn;
  /** Why the session could not start, or why the stream was given up. */
  problem: { reason: string; detail: string } | null;
  /** Reconnect attempts since the last event. */
  tries: number;
  lastSeq: number;
  feed: FeedItem[];
  /** The latest progress beat; "" when none is showing. */
  progress: string;
  slots: Slot[];
  lanes: Lane[];
  brief: BriefEvent | null;
  clearRev: number | null;
  enough: boolean;
  /** The person answered or said something after the brief on show; the next brief clears it. */
  briefStale: boolean;
  approvedRev: number | null;
  rehearsal: Rehearsal | null;
  /** The draft whose command went to Athena on "Start for real"; `null` before one. */
  handedRev: number | null;
  usage: { calls: number; ms: number };
  /** The saved case this session reopened (ADR 0123); `null` for a fresh conversation. */
  reopened: CaseSummary | null;
  /** The case the last approval was saved to; "" before one. */
  caseId: string;
  /** Why the last approval was not saved as a case, or "". */
  caseProblem: string;
}

export const INITIAL: StudioState = {
  sid: "",
  conn: "starting",
  problem: null,
  tries: 0,
  lastSeq: 0,
  feed: [],
  progress: "",
  slots: [],
  lanes: [],
  brief: null,
  clearRev: null,
  enough: false,
  briefStale: false,
  approvedRev: null,
  rehearsal: null,
  handedRev: null,
  usage: { calls: 0, ms: 0 },
  reopened: null,
  caseId: "",
  caseProblem: "",
};

export type Action =
  | { t: "restart" }
  | { t: "started"; sid: string; slots: Slot[]; reopened?: CaseSummary | null }
  | { t: "start_failed"; reason: string; detail: string }
  | { t: "event"; e: AdoptEvent }
  | { t: "conn"; conn: Conn; tries: number; reason?: string; detail?: string }
  | { t: "answered"; key: string; answers: Answer[] }
  | { t: "said"; key: string; text: string; via: AnswerVia }
  | { t: "unanswered"; key: string }
  | {
      t: "doc";
      key: string;
      name: string;
      status: "sending" | "sent" | "failed";
      detail: string;
    }
  | { t: "error"; key: string; reason: string; detail: string }
  | { t: "enough" }
  | { t: "approved"; rev: number | null }
  | { t: "handed"; rev: number }
  | { t: "saved"; caseId: string; problem: string };

export function reduce(s: StudioState, a: Action): StudioState {
  switch (a.t) {
    case "restart":
      return INITIAL;
    case "started":
      return {
        ...s,
        sid: a.sid,
        slots: a.slots,
        conn: "live",
        problem: null,
        reopened: a.reopened ?? null,
        caseId: a.reopened?.case_id ?? "",
      };
    case "start_failed":
      return {
        ...s,
        conn: "failed",
        problem: { reason: a.reason, detail: a.detail },
      };
    case "conn":
      return {
        ...s,
        conn: a.conn,
        tries: a.tries,
        problem:
          a.conn === "lost" || a.conn === "closed"
            ? { reason: a.reason ?? "offline", detail: a.detail ?? "" }
            : null,
      };
    case "answered":
      return {
        ...s,
        briefStale: s.briefStale || s.brief !== null,
        feed: s.feed.map((f) =>
          f.kind === "card" && f.key === a.key
            ? { ...f, answers: a.answers }
            : f,
        ),
      };
    case "unanswered":
      return {
        ...s,
        feed: s.feed.map((f) =>
          f.kind === "card" && f.key === a.key ? { ...f, answers: null } : f,
        ),
      };
    case "said":
      return {
        ...s,
        briefStale: s.briefStale || s.brief !== null,
        feed: [
          ...s.feed,
          { kind: "you", key: a.key, text: a.text, via: a.via },
        ],
      };
    case "doc": {
      const item: FeedItem = {
        kind: "doc",
        key: a.key,
        name: a.name,
        status: a.status,
        detail: a.detail,
      };
      const at = s.feed.findIndex((f) => f.key === a.key);
      return {
        ...s,
        feed:
          at < 0
            ? [...s.feed, item]
            : s.feed.map((f, i) => (i === at ? item : f)),
      };
    }
    case "error":
      return {
        ...s,
        feed: [
          ...s.feed,
          { kind: "error", key: a.key, reason: a.reason, detail: a.detail },
        ],
      };
    case "enough":
      return { ...s, enough: true };
    case "approved":
      return { ...s, approvedRev: a.rev };
    case "handed":
      return { ...s, handedRev: a.rev };
    case "saved":
      return { ...s, caseId: a.caseId || s.caseId, caseProblem: a.problem };
    case "event":
      return onEvent(s, a.e);
  }
}

function onEvent(prev: StudioState, e: AdoptEvent): StudioState {
  if (e.seq <= prev.lastSeq) return prev;
  const s: StudioState = {
    ...prev,
    lastSeq: e.seq,
    conn: "live",
    tries: 0,
    problem: null,
  };
  const key = `e${e.seq}`;
  switch (e.kind) {
    case "adopt.progress":
      return { ...s, progress: e.text };
    case "adopt.say":
      return { ...s, feed: [...s.feed, { kind: "say", key, text: e.text }] };
    case "adopt.questions":
      return {
        ...s,
        progress: "",
        feed: [
          ...s.feed,
          {
            kind: "card",
            key,
            round: e.round,
            questions: e.questions.slice(0, 4),
            answers: null,
          },
        ],
      };
    case "adopt.slots":
      return { ...s, slots: e.slots };
    case "adopt.lane": {
      const at = s.lanes.findIndex((l) => l.id === e.lane.id);
      return {
        ...s,
        lanes:
          at < 0
            ? [...s.lanes, e.lane]
            : s.lanes.map((l, i) => (i === at ? e.lane : l)),
      };
    }
    case "adopt.brief":
      return { ...s, progress: "", brief: e, briefStale: false };
    case "adopt.clear":
      return { ...s, clearRev: e.rev };
    case "adopt.showcase":
      // Every showcase event is the one rehearsal: it keeps the draft its first event followed.
      return {
        ...s,
        rehearsal: {
          rev: s.rehearsal?.rev ?? s.approvedRev ?? s.brief?.rev ?? 0,
          event: e,
        },
      };
    case "adopt.usage":
      return {
        ...s,
        usage: { calls: s.usage.calls + 1, ms: s.usage.ms + e.ms },
      };
    case "adopt.verdict":
      // The Adopt studio never receives one; the intake page (ADR 0098) draws it.
      return s;
    case "adopt.error":
      return {
        ...s,
        feed: [
          ...s.feed,
          { kind: "error", key, reason: e.reason, detail: e.detail },
        ],
      };
  }
}

// -- what the studio says -------------------------------------------------------------------------

/** "2026-10-22" from an ISO instant (a saved case's approval, ADR 0123); the text itself otherwise. */
export const dayOf = (iso: string): string =>
  /^\d{4}-\d{2}-\d{2}/.test(iso) ? iso.slice(0, 10) : iso || "an earlier day";

/** Where the brief on show stands (see `Phase`). An approved draft stays approved past an answer. */
export function phase(s: StudioState): Phase {
  const b = s.brief;
  if (b === null) return { kind: "interview" };
  const rev = b.rev;
  if (s.approvedRev === rev)
    return {
      kind: "approved",
      rev,
      rehearsal: s.rehearsal,
      handed: s.handedRev === rev,
    };
  if (s.briefStale) return { kind: "stale", rev };
  if (s.clearRev === rev) return { kind: "cleared", rev, by: "auditor" };
  if (s.enough) return { kind: "cleared", rev, by: "enough" };
  return { kind: "drafted", rev };
}

/**
 * Whether the brief on show can be approved, and if not, why. Approve opens for the revision the
 * auditor cleared, or for any revision once the person said "Good enough", unless the person spoke
 * after it (the daemon refuses a brief answered past); once a revision is approved it is done.
 */
export function approval(s: StudioState): { can: boolean; why: string } {
  switch (phase(s).kind) {
    case "interview":
      return { can: false, why: "There is no brief yet." };
    case "approved":
      return { can: false, why: "Approved: the rehearsal is under way." };
    case "stale":
      return {
        can: false,
        why: "She is redrafting the brief after your answer. Approve the new draft when it arrives.",
      };
    case "cleared":
      return { can: true, why: "" };
    case "drafted":
      return {
        can: false,
        why: "She is still checking this brief. Say “Good enough” to approve it as it is.",
      };
  }
}

/** One answer, read back: the chosen labels, then the words. */
export function answerLine(q: Question | undefined, a: Answer): string {
  const labels = a.choice_ids.map(
    (id) => q?.options.find((o) => o.id === id)?.label ?? id,
  );
  return [...labels, a.text.trim()].filter(Boolean).join(", ");
}

/** The one-line receipt an answered card collapses to: "Postwren · yes, 3 airlines". */
export function receipt(
  questions: readonly Question[],
  answers: readonly Answer[],
  max = 110,
): string {
  const parts = answers
    .map((a) =>
      answerLine(
        questions.find((q) => q.id === a.question_id),
        a,
      ),
    )
    .filter(Boolean);
  const line = parts.length ? parts.join(" · ") : "skipped";
  return line.length > max ? `${line.slice(0, max - 1).trimEnd()}…` : line;
}

/** The research tray's harvest: "3 of 4 lanes done · 1 failed (rules: timeout)". */
export function harvestLine(lanes: readonly Lane[]): string {
  if (lanes.length === 0) return "";
  const done = lanes.filter((l) => l.status === "done").length;
  const failed = lanes.filter((l) => l.status === "failed");
  const skipped = lanes.filter((l) => l.status === "skipped").length;
  const parts = [
    `${done} of ${lanes.length} ${lanes.length === 1 ? "lane" : "lanes"} done`,
  ];
  if (failed.length) {
    const why = failed
      .map((l) => `${l.kind}: ${l.summary.trim() || "no reason given"}`)
      .join("; ");
    parts.push(`${failed.length} failed (${why})`);
  }
  if (skipped) parts.push(`${skipped} skipped`);
  return parts.join(" · ");
}

export const SLOT_GROUPS: readonly { kind: SlotKind; label: string }[] = [
  { kind: "portal", label: "Portals" },
  { kind: "gate", label: "Approvals" },
  { kind: "fact", label: "Facts" },
  { kind: "trap", label: "Traps" },
];

export function slotGroups(
  slots: readonly Slot[],
): { kind: SlotKind; label: string; slots: Slot[] }[] {
  return SLOT_GROUPS.map((g) => ({
    ...g,
    slots: slots.filter((x) => x.kind === g.kind),
  })).filter((g) => g.slots.length > 0);
}

/** How much of the case is known: confirmed, guessed, still open. */
export function tally(slots: readonly Slot[]): {
  confirmed: number;
  guessed: number;
  open: number;
} {
  return {
    confirmed: slots.filter((x) => x.status === "confirmed").length,
    guessed: slots.filter((x) => x.status === "guessed").length,
    open: slots.filter((x) => x.status === "open").length,
  };
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * The recorded run with the person's portal names in it. `portals` maps a playbook's portal name to
 * theirs, "" meaning the same one. Names are replaced longest first, whole words only, in what the
 * person said, her words and the portal of each turn; tool names and card keys are the run's own
 * and stay. The truncation note keeps its arithmetic: the said length moves with the words.
 */
export function withPortals(
  trace: readonly TraceTurn[],
  portals: Readonly<Record<string, string>>,
): TraceTurn[] {
  const pairs = Object.entries(portals)
    .map(([from, to]) => [from.trim(), to.trim()] as const)
    .filter(([from, to]) => from && to && from !== to)
    .sort((a, b) => b[0].length - a[0].length);
  if (pairs.length === 0) return [...trace];
  const re = new RegExp(
    `(?<![\\w])(${pairs.map(([f]) => escape(f)).join("|")})(?![\\w])`,
    "g",
  );
  const map = new Map(pairs);
  const swap = (text: string) => text.replace(re, (m) => map.get(m) ?? m);
  return trace.map((t) => {
    const said = swap(t.said);
    return {
      ...t,
      portal: swap(t.portal),
      user: swap(t.user),
      said,
      saidChars: t.saidChars + (said.length - t.said.length),
    };
  });
}

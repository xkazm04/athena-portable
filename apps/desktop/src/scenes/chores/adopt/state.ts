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
  Lane,
  Question,
  Slot,
  SlotKind,
} from "@/lib/adopt";
import type { TraceTurn } from "@/lib/playbooks";

type Of<K extends AdoptEvent["kind"]> = Extract<AdoptEvent, { kind: K }>;
export type BriefEvent = Of<"adopt.brief">;
export type ShowcaseEvent = Of<"adopt.showcase">;

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
  approvedRev: number | null;
  showcase: ShowcaseEvent | null;
  usage: { calls: number; ms: number };
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
  approvedRev: null,
  showcase: null,
  usage: { calls: 0, ms: 0 },
};

export type Action =
  | { t: "restart" }
  | { t: "started"; sid: string; slots: Slot[] }
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
  | { t: "approved"; rev: number | null };

export function reduce(s: StudioState, a: Action): StudioState {
  switch (a.t) {
    case "restart":
      return INITIAL;
    case "started":
      return { ...s, sid: a.sid, slots: a.slots, conn: "live", problem: null };
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
      return { ...s, progress: "", brief: e };
    case "adopt.clear":
      return { ...s, clearRev: e.rev };
    case "adopt.showcase":
      return { ...s, showcase: e };
    case "adopt.usage":
      return {
        ...s,
        usage: { calls: s.usage.calls + 1, ms: s.usage.ms + e.ms },
      };
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

/**
 * Whether the brief on show can be approved, and if not, why. Approve opens for the revision the
 * auditor cleared, or for any revision once the person said "Good enough"; once a revision is
 * approved it is done.
 */
export function approval(s: StudioState): { can: boolean; why: string } {
  const b = s.brief;
  if (b === null) return { can: false, why: "There is no brief yet." };
  if (s.approvedRev === b.rev)
    return { can: false, why: "Approved: the rehearsal is under way." };
  if (s.clearRev === b.rev || s.enough) return { can: true, why: "" };
  return {
    can: false,
    why: "She is still checking this brief. Say “Good enough” to approve it as it is.",
  };
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

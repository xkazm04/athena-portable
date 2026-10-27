/**
 * The Chores front door's state, as a pure reducer — ADR 0098, README section 3.5.
 *
 * The conversation is the Adopt studio's (`adopt/state.ts`): her lines, the question cards, what
 * the person said, with a `seq` at or below the last one drawn dropped. This file adds the two
 * things only the front door has: the verdict, and the engine's fault (an `adopt.error` that is
 * not the stream's end), which is said once, with Retry, instead of becoming a line in the feed.
 * Everything else is delegated, so the two pages cannot disagree about what an event does.
 */
import type { AdoptEvent, Verdict } from "@/lib/adopt";

import {
  INITIAL as STUDIO_INITIAL,
  SESSION_CLOSED,
  reduce as reduceStudio,
  type Action as StudioAction,
  type StudioState,
} from "../adopt/state";

export { SESSION_CLOSED };

export interface IntakeState extends StudioState {
  /** The end of the conversation; `null` while she is still asking. */
  verdict: Verdict | null;
  /** The engine's last fault, until something else arrives. */
  fault: { reason: string; detail: string } | null;
}

export const INITIAL: IntakeState = {
  ...STUDIO_INITIAL,
  verdict: null,
  fault: null,
};

export type Action = StudioAction;

export function reduce(s: IntakeState, a: Action): IntakeState {
  if (a.t === "restart") return INITIAL;
  if (a.t === "event") return onEvent(s, a.e);
  const next = reduceStudio(s, a);
  return next === s ? s : { ...next, verdict: s.verdict, fault: s.fault };
}

function onEvent(s: IntakeState, e: AdoptEvent): IntakeState {
  if (e.seq <= s.lastSeq) return s;
  if (e.kind === "adopt.error") {
    // The stream's own end is the hook's to say (`conn: closed`); any other error is the engine's.
    const next: IntakeState = {
      ...s,
      lastSeq: e.seq,
      progress: "",
      conn: "live",
      tries: 0,
      problem: null,
    };
    return e.reason === SESSION_CLOSED
      ? next
      : { ...next, fault: { reason: e.reason, detail: e.detail } };
  }
  const base = reduceStudio(s, { t: "event", e });
  const carried: IntakeState = {
    ...base,
    verdict: s.verdict,
    fault: e.kind === "adopt.usage" ? s.fault : null,
  };
  if (e.kind === "adopt.verdict") {
    const verdict: Verdict = {
      fit: e.fit,
      playbook_id: e.playbook_id,
      why: e.why,
      differs: e.differs,
      alternates: e.alternates,
      need: e.need,
      command: e.command,
    };
    return { ...carried, progress: "", verdict };
  }
  return carried;
}

/** Has the person said anything yet: typed a line or answered a card. "Just decide" waits for it. */
export function hasSaid(s: IntakeState): boolean {
  return s.feed.some(
    (f) => (f.kind === "you" && f.status === "sent") || (f.kind === "card" && f.answers !== null),
  );
}

/** The first thing the person said, which a retried session carries as its need. */
export function needOf(s: IntakeState): string {
  const first = s.feed.find((f) => f.kind === "you" && f.status === "sent");
  if (first?.kind === "you") return first.text;
  for (const f of s.feed) {
    if (f.kind !== "card" || f.answers === null) continue;
    const text = f.answers
      .map((a) => a.text.trim())
      .filter(Boolean)
      .join(" ");
    if (text) return text;
  }
  return "";
}

/**
 * The parked studio: a conversation the person walked away from mid-interview — ADR 0179.
 *
 * The stage mounts a fresh view at every move (`../memory.ts`), so the Adopt studio unmounts at
 * every detour: the chore page, Mind → Voice to set up the microphone the studio asked for, an
 * Escape. The daemon keeps a session for two hours idle and resends her events after any `seq`
 * (ADR 0097), but the person's own answers and lines live only in the studio's reducer. So what
 * outlives the view is kept here: the session id, the last `seq` drawn and the reducer's snapshot.
 *
 * At most one conversation is parked, so the desktop never holds more of the daemon's three places
 * than it did when leaving closed the session: parking another hands back the one it displaced,
 * and a studio opened for another chore closes the parked one first. A parked entry expires here
 * before the daemon's idle TTL, so the studio never offers a session the daemon has already reaped.
 * The hook reads it once, on mount; nothing renders from it, so it is a plain module value.
 */
import type { StudioState } from "./state";

/** How long a parked conversation is offered: under the daemon's two-hour idle TTL (ADR 0097). */
export const PARK_LIMIT_MS = 90 * 60 * 1000;

export interface Parked {
  /** `parkKey(playbookId, caseId)`: which studio it belongs to. */
  key: string;
  sid: string;
  /** The last `seq` drawn; Continue follows from here. */
  lastSeq: number;
  /** The reducer as it was, the person's own acts included. */
  state: StudioState;
  /** What the person said at the front door, for a fresh start if the session is gone. */
  intro?: string;
  /** The hook's local key counter, so a resumed feed never reuses a key. */
  keys: number;
  parkedAt: number;
}

let slot: Parked | null = null;

export const parkKey = (playbookId: string, caseId?: string): string =>
  `${playbookId}/${caseId ?? ""}`;

/** Park a conversation; answers the one it displaced (the caller closes it), or `null`. */
export function park(entry: Parked): Parked | null {
  const displaced = slot && slot.sid !== entry.sid ? slot : null;
  slot = entry;
  return displaced;
}

/** The parked conversation for `key` (any one when omitted), or `null`. */
export function parked(key?: string): Parked | null {
  if (!slot || (key !== undefined && slot.key !== key)) return null;
  return slot;
}

export function unpark(): void {
  slot = null;
}

/** For tests: nothing parked. */
export function forgetParked(): void {
  slot = null;
}

export const expired = (entry: Parked, now: number): boolean =>
  now - entry.parkedAt > PARK_LIMIT_MS;

const answers = (s: StudioState): number =>
  s.feed.filter((f) => (f.kind === "card" && f.answers !== null) || f.kind === "you").length;

/**
 * Whether leaving should park rather than close: the person said something (an answered card, a
 * line in the composer, a document that went), and the conversation is neither over nor handed.
 */
export function worthParking(s: StudioState): boolean {
  if (s.conn === "closed" || s.handedRev !== null) return false;
  return answers(s) > 0 || s.feed.some((f) => f.kind === "doc" && f.status === "sent");
}

/** The offer's line: how far the conversation got. */
export function resumeLine(s: StudioState): string {
  const n = answers(s);
  const parts = [`${n} ${n === 1 ? "answer" : "answers"}`];
  if (s.brief) parts.push(`draft ${s.brief.rev}`);
  return `You were part-way through (${parts.join(", ")}). Continue where you left off, or start over.`;
}

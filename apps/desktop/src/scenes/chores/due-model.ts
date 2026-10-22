/**
 * When a chore comes due, as the topic page says it — ADR 0131.
 *
 * Pure: the words a cadence and a review are said in, the order a review's lines are read in, and
 * "Open and prepare", which opens the chore's tabs and puts the case's command in Athena's composer.
 * It reads no portal and sends no turn: the person reads the composer and presses send, and only
 * that first send is marked `scheduled`, so the daemon can record it as `trigger_kind='schedule'`.
 */
import type { CadenceRule, DueReview, ReviewLine, ReviewLineKind, ReviewPortal } from "@/lib/adopt";

import { dayOf } from "./adopt/state";

/** The order a review is read in: what may need checking first. The daemon sends it so; this holds it. */
export const LINE_ORDER: readonly ReviewLineKind[] = ["expired", "may_have_completed", "pending", "approved", "declined"];

export function orderedLines(lines: readonly ReviewLine[]): ReviewLine[] {
  return [...lines].sort((a, b) => LINE_ORDER.indexOf(a.kind) - LINE_ORDER.indexOf(b.kind));
}

/** What a line is, in words. */
export const LINE_WORDS: Readonly<Record<ReviewLineKind, string>> = {
  expired: "Expired unanswered: check it was not needed",
  may_have_completed: "May have completed: the answer never came, so check before asking again",
  pending: "Still waiting when the run closed",
  approved: "Approved",
  declined: "Declined",
};

export const WEEKDAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"] as const;

/** A rule in words, the daemon's way (`cadence.rule_text`), for a rule the person is still editing. */
export function ruleWords(rule: CadenceRule): string {
  if (rule.kind === "weekly") return `every ${WEEKDAYS[rule.weekday % 7]} at ${rule.at}`;
  if (rule.kind === "monthly") return `on day ${rule.day} of every month at ${rule.at}`;
  return rule.every_days === 1 ? `every day at ${rule.at}` : `every ${rule.every_days} days at ${rule.at}`;
}

/** The person's zone, as the daemon is told it; "" when this window cannot say. */
export function localZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "";
  } catch {
    return "";
  }
}

/** `2026-10-19 09:00`, in this window's local time, for an ISO instant. */
export function localWhen(iso: string): string {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return dayOf(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())} ${pad(at.getHours())}:${pad(at.getMinutes())}`;
}

/** The review's head line: which occurrence, and how many more came and went. */
export function dueLine(review: DueReview): string {
  const r = review.review;
  if (!r) return "";
  const more = r.missed ? `; ${r.missed} more came and went since (${r.missed_at.map(dayOf).join(", ")})` : "";
  return `Due since ${localWhen(r.due_at)}${more}.`;
}

/** The apps "Open and prepare" would open, and those with no address it can know. */
export function portalsOf(review: DueReview): { open: ReviewPortal[]; unknown: string[] } {
  const open = review.portals.filter((p) => p.url !== "" && /^https?:\/\//i.test(p.url));
  const unknown = review.portals.filter((p) => !open.includes(p)).map((p) => p.name);
  return { open, unknown };
}

export interface PrepareDeps {
  /** Make a Browser tab for `url` (`PlaybookActions.open`, which calls `tabsCreate`). */
  open: (url: string) => void;
  /** Athena's composer (`PlaybookActions.hand`): the text goes in, nothing is sent. */
  hand: (text: string, playbook: { id: string; title: string; caseId?: string; scheduled?: boolean }) => void;
  /** Answer the review `prepare`, so her first send is recognised as this run's. */
  answer: (caseId: string, dueAt: string, answer: "prepare") => Promise<unknown>;
}

/**
 * "Open and prepare": answer the review, open every tab whose address is known (the playbook's, or
 * the one she gave in the case), and put the case's stored command in her composer, marked as this
 * run's first send. The command only: nothing of the last run goes with it (ADR 0130). Answers the
 * apps whose address is not known, for the page to say.
 */
export async function openAndPrepare(review: DueReview, deps: PrepareDeps): Promise<{ opened: string[]; unknown: string[] }> {
  const r = review.review;
  if (r && !r.answer) await deps.answer(review.case_id, r.due_at, "prepare");
  const { open, unknown } = portalsOf(review);
  for (const p of open) deps.open(p.url);
  deps.hand(review.command, {
    id: review.playbook_id,
    title: review.title,
    caseId: review.case_id,
    scheduled: true,
  });
  return { opened: open.map((p) => p.url), unknown };
}

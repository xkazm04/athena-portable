/** Dates and scores, formatted one way across the direction. Safe on both sides. */
import { SCORE_LABEL } from "@/lib/constants";

const dayMonth = new Intl.DateTimeFormat("en-US", {
  day: "numeric",
  month: "short",
  timeZone: "UTC",
});

const dayTime = new Intl.DateTimeFormat("en-US", {
  day: "numeric",
  month: "short",
  hour: "numeric",
  minute: "2-digit",
  timeZone: "UTC",
});

export function fmtDate(iso: string): string {
  return dayMonth.format(new Date(iso));
}

export function fmtWhen(iso: string): string {
  return dayTime.format(new Date(iso));
}

/**
 * A 0-4 score as a number, or an em dash.
 *
 * The em dash is the point: an unscored application has no number, and printing
 * a zero for it would be inventing a measurement nobody took.
 */
export function fmtScore(scored: boolean, value: number): string {
  return scored ? value.toFixed(1) : "—";
}

/** The stored label for a rounded 0-4 score. Exact strings from `SCORE_LABEL`. */
export function scoreWord(score: number): string {
  return SCORE_LABEL[Math.max(0, Math.min(4, Math.round(score)))] ?? "no evidence";
}

export function initialsOf(name: string): string {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0] ?? "")
    .join("")
    .toUpperCase();
}

/**
 * The answer, without the question repeated inside it.
 *
 * The seed stores `short_answer` as the role's question, a dash, and then what
 * the applicant actually wrote. A surface that prints the question as a heading
 * and then prints it again as the first sentence of the answer has wasted the
 * reader's first line, so the prefix is dropped HERE rather than in the
 * database — nothing is invented and nothing the applicant wrote is removed.
 */
export function answerBody(answer: string, question: string): string {
  const trimmed = answer.trim();
  if (!trimmed.startsWith(question)) return trimmed;
  return trimmed.slice(question.length).replace(/^[\s–—-]+/, "");
}

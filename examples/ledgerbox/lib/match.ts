/**
 * Bank-line matching heuristics. Pure functions, no imports from the server, so the inbox, the
 * detail pane and (later) an async job all score a candidate exactly the same way.
 *
 * Every signal that fires becomes a clause of evidence. The user sees the reasoning, not a number
 * dressed up as certainty - design 4.6.1 asks for per-item citations, and a match nobody can
 * check is worse than no match at all.
 */
import type { BankLine, Invoice, MatchCandidate } from "./types";

/** Below this a line is not offered at all; the noise in a statement is mostly far below it. */
const FLOOR = 40;
const STRONG = 85;
const LIKELY = 60;

/** How far ahead the top candidate must be before the app will answer instead of asking. */
const AMBIGUOUS_GAP = 12;

/** Uppercase alphanumeric words of 4+ characters - what survives a bank's memo mangling. */
function tokens(text: string): string[] {
  return text
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, " ")
    .split(" ")
    .filter((w) => w.length >= 4);
}

/** `HALCYONWORKS` in a memo should still hit the client `Halcyon Works`. */
function squash(text: string): string {
  return text.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

/** A scored signal, plus the structured fact it stands for when there is one. */
interface Signal {
  score: number;
  why: string;
  /** Cents the credit falls short of what is owed. Set only when it does. */
  shortBy?: number;
  /** The trading name the memo used instead of the name on the invoice. */
  alias?: string;
}

function amountSignal(invoiceCents: number, lineCents: number): Signal | null {
  if (lineCents === invoiceCents) return { score: 60, why: "exact amount" };
  const diff = Math.abs(lineCents - invoiceCents);
  const ratio = diff / invoiceCents;
  const short = lineCents < invoiceCents ? { shortBy: diff } : {};
  if (diff <= 5000 && ratio <= 0.05) {
    const direction = lineCents < invoiceCents ? "short by" : "over by";
    return { score: 46, why: `${direction} $${(diff / 100).toFixed(2)}, about a wire fee`, ...short };
  }
  if (ratio <= 0.01) return { score: 40, why: "within 1% of the invoice total", ...short };
  if (ratio <= 0.03) return { score: 30, why: "within 3% of the invoice total", ...short };
  return null;
}

/**
 * The client's name in the memo - or the TRADING NAME they bank under.
 *
 * The alias branch is first and scores as highly as the name itself, because a memo that says
 * `PINEGROVE COOP` is not weaker evidence than one that says `Pinegrove Collective`; it is the
 * same evidence in the counterparty's own spelling. It carries the alias out as a FIELD, not only
 * inside an English clause, so the agent reading the match can remember the equivalence rather
 * than re-derive it next month (design 4.6.1's cross-app thread).
 */
function nameSignal(clientName: string, memo: string, alias?: string | null): Signal | null {
  const squashedMemo = squash(memo);
  if (alias && squashedMemo.includes(squash(alias))) {
    return { score: 25, why: `pays as "${alias}"`, alias };
  }
  if (squashedMemo.includes(squash(clientName))) return { score: 25, why: "client name in the memo" };
  const hits = tokens(clientName).filter((w) => squashedMemo.includes(w));
  if (hits.length > 0) return { score: 16, why: `"${hits[0]}" in the memo` };
  return null;
}

function referenceSignal(number: string, memo: string): Signal | null {
  return squash(memo).includes(squash(number))
    ? { score: 30, why: `invoice number ${number} quoted` }
    : null;
}

function dateSignal(dueAt: string, postedAt: string): Signal | null {
  const days = Math.round((Date.parse(postedAt) - Date.parse(dueAt)) / 86_400_000);
  const near = Math.abs(days);
  const when = days === 0 ? "on the due date" : days > 0 ? `${days}d after the due date` : `${near}d before it was due`;
  if (near <= 7) return { score: 14, why: `posted ${when}` };
  if (near <= 21) return { score: 8, why: `posted ${when}` };
  return null;
}

export interface ScoreInput {
  invoice: Pick<Invoice, "number" | "amount_cents" | "due_at">;
  clientName: string;
  /** Outstanding balance; a line is scored against what is still owed, not the face value. */
  balanceCents: number;
  /** The trading name this client's bank prints, when it differs from the name on the invoice. */
  alias?: string | null;
}

/**
 * Score one unapplied incoming bank line against one invoice. Returns `null` when nothing beyond
 * coincidence connects them, so the UI never offers a candidate it cannot justify.
 */
export function scoreCandidate(input: ScoreInput, line: BankLine): MatchCandidate | null {
  if (line.direction !== "in") return null;
  const target = input.balanceCents > 0 ? input.balanceCents : input.invoice.amount_cents;
  const signals = [
    amountSignal(target, line.amount_cents),
    nameSignal(input.clientName, line.memo, input.alias),
    referenceSignal(input.invoice.number, line.memo),
    dateSignal(input.invoice.due_at, line.posted_at),
  ].filter((s): s is Signal => s !== null);

  const score = signals.reduce((sum, s) => sum + s.score, 0);
  if (score < FLOOR || signals.length < 2) return null;

  // The two facts a caller would otherwise have to parse back out of the English: how far the
  // credit falls short, and which trading name it arrived under. Present only when they happened.
  const shortBy = signals.find((s) => s.shortBy !== undefined)?.shortBy;
  const alias = signals.find((s) => s.alias !== undefined)?.alias;

  return {
    line,
    score,
    confidence: score >= STRONG ? "strong" : score >= LIKELY ? "likely" : "weak",
    evidence: signals.map((s) => s.why),
    ...(shortBy !== undefined ? { short_by_cents: shortBy } : {}),
    ...(alias !== undefined ? { counterparty_alias: alias } : {}),
  };
}

/** Every plausible line for one invoice, best first. */
export function candidatesFor(input: ScoreInput, lines: BankLine[]): MatchCandidate[] {
  return lines
    .map((line) => scoreCandidate(input, line))
    .filter((c): c is MatchCandidate => c !== null)
    .sort((a, b) => b.score - a.score);
}

/**
 * True when the top candidate is not clearly ahead of the runner-up. The inbox marks these so a
 * reconciliation run can stop and ask instead of guessing.
 */
export function isAmbiguous(candidates: readonly { score: number }[]): boolean {
  const [first, second] = candidates;
  if (!first || !second) return false;
  return first.score - second.score < AMBIGUOUS_GAP;
}

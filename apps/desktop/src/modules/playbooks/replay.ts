/**
 * The replay's pure reductions — README section 14; ADR 0040, 0089 and 0133.
 *
 * A run's trace grouped into portal visits for the rail, each turn coloured by what it did, its reads
 * counted, and the money back tallied as it plays (money back only, by each card's kind). Kept apart
 * from `model.ts`, which the first frame loads, because only the replay and the studio's showcase,
 * both lazy, read them.
 */
import type { CardOutcome, TraceTurn, ValueKind } from "@/lib/playbooks";

/** A run of consecutive turns in one portal: one visit, as the rail draws it. */
export interface Visit {
  portal: string;
  /** Indices into the trace, first and last inclusive. */
  from: number;
  to: number;
}

/** The trace as visits, in order: the portal changes only where the person switched tabs. Pure. */
export function visitsOf(trace: readonly TraceTurn[]): Visit[] {
  const visits: Visit[] = [];
  trace.forEach((turn, i) => {
    const last = visits[visits.length - 1];
    if (last && last.portal === turn.portal) last.to = i;
    else visits.push({ portal: turn.portal, from: i, to: i });
  });
  return visits;
}

/** What a turn did, as the rail colours it: filed a wrong card, filed right, read, or only spoke. */
export type TurnState = "wrong" | "filed" | "read" | "spoke";

const WRONG: readonly CardOutcome[] = ["trap", "unfounded", "forbidden", "duplicate"];

export function turnState(turn: TraceTurn): TurnState {
  if (turn.cards.some((c) => WRONG.includes(c.outcome))) return "wrong";
  if (turn.cards.length) return "filed";
  if (turn.reads.length) return "read";
  return "spoke";
}

/**
 * The money back her right cards were worth up to and including turn `at`. Pure. `kind` names each
 * card's kind by its tool; only `money_back` counts, and without it every card is money back.
 */
export function foundBy(
  trace: readonly TraceTurn[],
  at: number,
  kind: (tool: string) => ValueKind = () => "money_back",
): number {
  let total = 0;
  trace.slice(0, at + 1).forEach((t) =>
    t.cards.forEach((c) => {
      if (c.outcome === "correct" && c.valueUsd && kind(c.action) === "money_back") total += c.valueUsd;
    }),
  );
  return Math.round(total * 100) / 100;
}

/** A turn's reads, each tool once with how often it was called, in first-call order. Pure. */
export function readsOf(turn: TraceTurn): { name: string; times: number }[] {
  const out: { name: string; times: number }[] = [];
  for (const raw of turn.reads) {
    const name = raw.replace(/_/g, " ");
    const seen = out.find((r) => r.name === name);
    if (seen) seen.times += 1;
    else out.push({ name, times: 1 });
  }
  return out;
}

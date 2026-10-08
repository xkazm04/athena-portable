/**
 * The Playbooks module's view-model — README section 14; ADR 0040.
 *
 * A playbook is a chore worth real money that only an agent living in the person's own tabs can
 * do: it spans portals nobody integrates, and it ends in something irreversible that wants a
 * signature. This surface shows each one where it sits between difficulty (for anyone else) and
 * usefulness (to the person), what it is worth, and — the part that earns the place on the map —
 * what the bench measured when a real Athena ran it on the real gate.
 *
 * Every number here is derived from the shipped `playbook.json` and `bench.json` at render. A
 * playbook with no bench run says so and claims nothing measured: "not benched" is a fact, and a
 * zero would be a lie.
 */
import type { Tone } from "@/components/StatusDot";
import {
  minutes,
  onTheEdge,
  speedup,
  usd,
  type Bench,
  type CardOutcome,
  type Playbook,
  type TraceTurn,
  type VerdictWord,
} from "@/lib/playbooks";

export interface PlaybookActions {
  /** Put the command on the clipboard. */
  copy: (text: string) => void;
  /** Open a portal or a source in a Browser tab. */
  open: (url: string) => void;
  /** Put the command in Athena's composer and make the playbook her active project; the person
   *  presses send (ADR 0044). */
  hand: (text: string, playbook: { id: string; title: string }) => void;
}

export interface Verdict {
  word: VerdictWord | "unbenched";
  /** The badge. */
  label: string;
  tone: Tone;
  /** One sentence a person reads under the badge. */
  sentence: string;
}

export interface MapPoint {
  /** 1–5 on each axis, nudged apart when two playbooks share a point. */
  x: number;
  y: number;
  /** 0–1: the mark's size, from the playbook's value. */
  weight: number;
}

export interface PlaybookView {
  playbook: Playbook;
  id: string;
  title: string;
  /** "$4,940" and "a year". */
  value: string;
  per: string;
  /** "3 h by hand". */
  manual: string;
  /** "6 min with Athena", measured; "" when not benched. */
  measured: string;
  /** "30× faster", or "". */
  speed: string;
  verdict: Verdict;
  onEdge: boolean;
  point: MapPoint;
}

export interface PlaybooksModel {
  items: readonly PlaybookView[];
  totals: {
    count: number;
    benched: number;
    exceeds: number;
    onEdge: number;
    /** Product fixes the playbooks' runs uncovered, counted once per decision record. */
    lessons: number;
    /** Money the bench found across every benched playbook, and what was there to find. */
    foundUsd: number;
    availableUsd: number;
    /** Across the latest runs: traps the worlds held and how many she filed; claims that were wrong. */
    trapsTotal: number;
    trapsFiled: number;
    falseClaims: number;
    /** Her minutes on the bench, the minutes the same chores take by hand, and the model's cost. */
    athenaMinutes: number;
    manualMinutes: number;
    costUsd: number;
  };
  actions: PlaybookActions;
}

const PER: Record<string, string> = {
  year: "a year",
  month: "a month",
  week: "a week",
  run: "a run",
  claim: "a claim",
};

export function verdictOf(bench: Bench | null): Verdict {
  if (bench === null) {
    return {
      word: "unbenched",
      label: "Not benched",
      tone: "neutral",
      sentence: "No run on the bench yet, so nothing here is measured.",
    }
  }
  const found = `${bench.found} of ${bench.eligible} found`;
  const money = bench.valueTotalUsd
    ? `${usd(bench.valueFoundUsd)} of ${usd(bench.valueTotalUsd)}`
    : "";
  const falses =
    bench.falseClaims === 0
      ? "no false claims"
      : `${bench.falseClaims} false claim${bench.falseClaims === 1 ? "" : "s"}`;
  const body = [found, money, falses].filter(Boolean).join(", ");
  switch (bench.verdict.word) {
    case "exceeds":
      return { word: "exceeds", label: "Exceeds", tone: "success", sentence: `Beat the bar: ${body}.` };
    case "meets":
      return { word: "meets", label: "Meets", tone: "info", sentence: `Met the bar: ${body}.` };
    default:
      return {
        word: "short",
        label: "Falls short",
        tone: "warning",
        sentence: `${body}. ${bench.verdict.reasons[0] ?? ""}`.trim(),
      };
  }
}

export const OUTCOME_WORDS: Record<CardOutcome, { word: string; tone: Tone }> = {
  correct: { word: "Right claim", tone: "success" },
  neutral: { word: "Fair either way", tone: "info" },
  duplicate: { word: "Duplicate", tone: "warning" },
  trap: { word: "Fell for a trap", tone: "error" },
  unfounded: { word: "Unfounded", tone: "error" },
  forbidden: { word: "Forbidden action", tone: "error" },
  other: { word: "Other card", tone: "neutral" },
};

/** Spread playbooks that share a point around it, so no mark hides another. Pure. */
export function layoutPoints(playbooks: readonly Playbook[]): MapPoint[] {
  const max = Math.max(1, ...playbooks.map(annualValue));
  const seen = new Map<string, number>();
  const counts = new Map<string, number>();
  for (const p of playbooks) {
    const k = `${p.edge.difficulty}:${p.edge.usefulness}`;
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  return playbooks.map((p) => {
    const k = `${p.edge.difficulty}:${p.edge.usefulness}`;
    const i = seen.get(k) ?? 0;
    seen.set(k, i + 1);
    const n = counts.get(k) ?? 1;
    const angle = n > 1 ? (2 * Math.PI * i) / n - Math.PI / 2 : 0;
    const r = n > 1 ? 0.3 : 0;
    return {
      x: p.edge.difficulty + r * Math.cos(angle),
      y: p.edge.usefulness + r * Math.sin(angle),
      weight: Math.sqrt(annualValue(p) / max),
    };
  });
}

/** A playbook's value on one scale, so marks compare: a month is twelve of a year. */
export function annualValue(p: Playbook): number {
  const v = p.economics.valueUsd;
  switch (p.economics.per) {
    case "month":
      return v * 12;
    case "week":
      return v * 52;
    default:
      return v;
  }
}

export function selectPlaybooks(
  playbooks: readonly Playbook[],
  actions: PlaybookActions,
): PlaybooksModel {
  const points = layoutPoints(playbooks);
  const items = playbooks.map((p, i): PlaybookView => {
    const bench = p.bench;
    const measuredMin = bench ? bench.wallS / 60 : 0;
    return {
      playbook: p,
      id: p.id,
      title: p.title,
      value: usd(p.economics.valueUsd),
      per: PER[p.economics.per] ?? `per ${p.economics.per}`,
      manual: p.economics.manualMinutes ? `${minutes(p.economics.manualMinutes)} by hand` : "",
      measured: bench ? `${minutes(measuredMin)} with Athena` : "",
      speed: bench ? speedup(p.economics.manualMinutes, measuredMin) : "",
      verdict: verdictOf(bench),
      onEdge: onTheEdge(p),
      point: points[i],
    };
  });
  const benched = items.filter((v) => v.playbook.bench !== null);
  return {
    items,
    totals: {
      count: items.length,
      benched: benched.length,
      exceeds: items.filter((v) => v.verdict.word === "exceeds").length,
      onEdge: items.filter((v) => v.onEdge).length,
      lessons: new Set(
        items.flatMap((v) => v.playbook.lessons.filter((l) => l.adr).map((l) => l.adr)),
      ).size,
      foundUsd: benched.reduce((s, v) => s + (v.playbook.bench?.valueFoundUsd ?? 0), 0),
      availableUsd: benched.reduce((s, v) => s + (v.playbook.bench?.valueTotalUsd ?? 0), 0),
      trapsTotal: sumBench(benched, (b) => b.trapsTotal),
      trapsFiled: sumBench(benched, (b) => b.trapsFiled),
      falseClaims: sumBench(benched, (b) => b.falseClaims),
      athenaMinutes: sumBench(benched, (b) => b.wallS / 60),
      manualMinutes: benched.reduce((s, v) => s + v.playbook.economics.manualMinutes, 0),
      costUsd: sumBench(benched, (b) => b.costUsd ?? 0),
    },
    actions,
  };
}

const sumBench = (views: readonly PlaybookView[], f: (b: Bench) => number): number =>
  views.reduce((s, v) => s + (v.playbook.bench ? f(v.playbook.bench) : 0), 0);

// --- the replay ----------------------------------------------------------------------------------

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

/** The money her right cards were worth up to and including turn `at`. Pure. */
export function foundBy(trace: readonly TraceTurn[], at: number): number {
  let total = 0;
  trace.slice(0, at + 1).forEach((t) =>
    t.cards.forEach((c) => {
      if (c.outcome === "correct" && c.valueUsd) total += c.valueUsd;
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

// --- the grid's filter and order -----------------------------------------------------------------

/** Which playbooks the grid shows: all, a household's, or a business's. */
export type AudienceFilter = "all" | Playbook["audience"];

/** How the grid is ordered: the edge (the map's order), the money a year, or the hours by hand. */
export type SortBy = "edge" | "money" | "time";

/**
 * The grid's items, filtered and ordered. Pure. Each keeps its rank on the map (`rank`), so the
 * number on a tile is the number of its mark whatever the order.
 */
export function arrange(
  items: readonly PlaybookView[],
  audience: AudienceFilter,
  by: SortBy,
): { view: PlaybookView; rank: number }[] {
  const ranked = items.map((view, i) => ({ view, rank: i + 1 }));
  const shown = ranked.filter((r) => audience === "all" || r.view.playbook.audience === audience);
  const key = (r: { view: PlaybookView; rank: number }): number =>
    by === "money"
      ? annualValue(r.view.playbook)
      : by === "time"
        ? r.view.playbook.economics.manualMinutes
        : -r.rank;
  return [...shown].sort((a, b) => key(b) - key(a) || a.rank - b.rank);
}

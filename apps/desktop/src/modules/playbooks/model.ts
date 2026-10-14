/**
 * The Playbooks module's view-model — README section 14; ADR 0040.
 *
 * A playbook is a chore worth real money that only an agent living in the person's own tabs can
 * do: it spans portals nobody integrates, and it ends in something irreversible that wants a
 * signature. This surface shows each one where it sits between difficulty (for anyone else) and
 * usefulness (to the person), what it is worth, and — the part that earns the place on the map —
 * what the bench measured when a real Athena ran it on the real gate, against portals that were
 * invented for the bench: the numbers are measured on that invented world, never on the person's
 * accounts. The value and the hand minutes are the playbook author's estimates, and say so.
 *
 * Every number here is derived from the shipped `playbook.json` and `bench.json` at render. A
 * playbook with no bench run says so and claims nothing measured: "not benched" is a fact, and a
 * zero would be a lie. Likewise the film (ADR 0055): a playbook whose `evidence.json` films an
 * earlier run than its `bench.json` says it is stale rather than passing it off as the latest.
 */
import type { Tone } from "@/components/StatusDot";
import {
  clock,
  edgeRank,
  evidenceCurrent,
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
import { CATEGORIES, type CategoryId, type JobId } from "@/lib/playbook-taxonomy";

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

/** The run filmed and narrated (ADR 0055), as the card and the layer show it. */
export interface EvidenceView {
  /** It films the run `bench.json` holds now. */
  current: boolean;
  standing: { label: string; tone: Tone; sentence: string };
  /** "1:12". */
  length: string;
  /** "2026-10-09". */
  capturedAt: string;
  /** "kokoro af_heart". */
  voice: string;
  narration: string;
  thumbnailUrl: string;
  /** `null` where nothing serves the film: the layer shows the still instead. */
  videoUrl: string | null;
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
  evidence: EvidenceView | null;
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
  /** The shipped set has not arrived yet (it loads lazily): an empty list is then not "none ship". */
  loading: boolean;
  /** Why the shipped set could not be read, as a sentence; `null` while nothing failed. A failed
   *  load is not `loading`: the set is no longer on its way, and the view says why instead. */
  problem: string | null;
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

/** A playbook's film, read against its bench: current or stale, and how long. Pure. */
export function evidenceOf(p: Playbook): EvidenceView | null {
  const e = p.evidence;
  if (e === null) return null;
  const current = evidenceCurrent(p);
  const filmed = e.benchRunAt.slice(0, 10) || "an unknown date";
  return {
    current,
    standing: current
      ? { label: "Current", tone: "success", sentence: `Films the latest bench run, of ${filmed}.` }
      : {
          label: "Stale",
          tone: "warning",
          sentence: p.bench
            ? `Films the bench run of ${filmed}; the latest is of ${p.bench.runAt.slice(0, 10)}, so the figures may differ.`
            : `Films a bench run of ${filmed} that this build no longer carries.`,
        },
    length: clock(e.video.durationS || e.narration.durationS),
    capturedAt: e.capturedAt.slice(0, 10),
    voice: [e.narration.engine, e.narration.voice].filter(Boolean).join(" "),
    narration: e.narration.text,
    thumbnailUrl: e.thumbnailUrl,
    videoUrl: e.videoUrl,
  };
}

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
  loading = false,
  problem: string | null = null,
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
      evidence: evidenceOf(p),
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
    loading,
    problem,
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

// -- the ledger (ADR 0096) -------------------------------------------------------------------------
//
// The ledger reads the same `PlaybookView`s the map and the grid do — `PlaybooksModel.items`, in
// the edge's order — so a row, its preview and its mark are one object and the scene keeps one key.

export type CategoryFilter = CategoryId | "all";
export type JobFilter = JobId | "all";
/** The ledger's three orders. `asc` on the edge is best first: rank one at the top. */
export type LedgerSort = { key: "edge" | "value" | "time"; dir: "asc" | "desc" };
export interface LedgerFilter {
  category: CategoryFilter;
  job: JobFilter;
}

const jobMatches = (v: PlaybookView, job: JobFilter) => job === "all" || v.playbook.job === job;

/**
 * The rail's counts, each what a click on it would show under the job filter in force. Pure. Every
 * area the taxonomy lists has a count, zero included, so the rail never reflows when a job hides
 * one; `uncategorised` counts the playbooks that name none, which the rail lists only when there
 * are some — a playbook is never hidden for lacking an area.
 */
export function categoryCounts(
  items: readonly PlaybookView[],
  job: JobFilter,
): { all: number; uncategorised: number; byCategory: Record<CategoryId, number> } {
  const byCategory = Object.fromEntries(CATEGORIES.map((c) => [c.id, 0])) as Record<CategoryId, number>;
  let all = 0;
  let uncategorised = 0;
  for (const v of items) {
    if (!jobMatches(v, job)) continue;
    all += 1;
    const c = v.playbook.category;
    if (c === null) uncategorised += 1;
    else byCategory[c] += 1;
  }
  return { all, uncategorised, byCategory };
}

/** The ledger's rows under the rail's area and the toolbar's job, in the order they came. Pure. */
export function filterLedger(items: readonly PlaybookView[], f: LedgerFilter): PlaybookView[] {
  return items.filter((v) => (f.category === "all" || v.playbook.category === f.category) && jobMatches(v, f.job));
}

/** The edge's own order, as `loadPlaybooks` lays it down: hardest-and-most-useful, then by title. */
const byEdge = (a: PlaybookView, b: PlaybookView): number =>
  edgeRank(b.playbook) - edgeRank(a.playbook) || a.title.localeCompare(b.title) || a.id.localeCompare(b.id);

/**
 * The ledger's rows in one of its three orders. Pure, and total: `edge` is the map's order (`asc`
 * best first, `desc` its exact reverse); `value` is the money a year (`annualValue`, so a month
 * counts twelve times); `time` is the hours the chore takes by hand, the measure the grid's "time"
 * uses. On value and time, a tie keeps the edge's order best first whichever way the column runs,
 * so two playbooks worth the same never swap places when the person flips the arrow.
 */
export function sortLedger(items: readonly PlaybookView[], s: LedgerSort): PlaybookView[] {
  const sign = s.dir === "asc" ? 1 : -1;
  if (s.key === "edge") return [...items].sort((a, b) => sign * byEdge(a, b));
  const measure = (v: PlaybookView) =>
    s.key === "value" ? annualValue(v.playbook) : v.playbook.economics.manualMinutes;
  return [...items].sort((a, b) => sign * (measure(a) - measure(b)) || byEdge(a, b));
}

// -- the fixtures' places --------------------------------------------------------------------------

/** One part of a playbook a fixture opens on (ADR 0053); the Chores depth reads `run` as the replay. */
export type FacetId =
  | "chore"
  | "portals"
  | "method"
  | "gates"
  | "result"
  | "traps"
  | "run"
  | "evidence"
  | "lessons"
  | "money";

/**
 * The Playbooks module's view-model — README section 14; ADR 0040.
 *
 * A playbook is a chore worth real money that only an agent living in the person's own tabs can
 * do: it spans portals nobody integrates, and it ends in something irreversible that wants a
 * signature. Each is ordered by where it sits between difficulty (for anyone else) and usefulness
 * (to the person), and shown with what it is worth and — the part that earns its place —
 * what the bench measured when a real Athena ran it on the real gate, against portals that were
 * invented for the bench: the numbers are measured on that invented world, never on the person's
 * accounts. The value and the hand minutes are the playbook author's estimates, and say so.
 *
 * Every number here is derived from the shipped `playbook.json` and `bench.json` at render. A
 * playbook with no bench run says so and claims nothing measured: "not benched" is a fact, and a
 * zero would be a lie. Likewise the film (ADR 0055): a playbook whose `evidence.json` films an
 * earlier run than its `bench.json` says it is stale rather than passing it off as the latest.
 *
 * Every figure says what kind it is (fix wave chores-uat, ADR 0133): a run's cards are tallied by
 * their tool's kind (`tallyOf`), and only money back is ever "found" or summed into the totals; an
 * exposure protected or a penalty avoided is said in its own words, and a scoring weight (`count`) is
 * never a dollar figure. The time saved counts the person's review beside her run.
 */
import type { Tone } from "@/components/StatusDot";
import {
  clock,
  edgeRank,
  evidenceCurrent,
  kindOf,
  speedup,
  usd,
  type Bench,
  type CardOutcome,
  type Playbook,
  type ValueKind,
  type VerdictWord,
} from "@/lib/playbooks";
import { CATEGORIES, type CategoryId, type JobId } from "@/lib/playbook-taxonomy";

export interface PlaybookActions {
  /** Put the command on the clipboard. Resolves once the write landed; rejects when there is no
   *  clipboard or the write was refused, so the caller says what happened, not what was tried. */
  copy: (text: string) => Promise<void>;
  /** Open a portal or a source in a Browser tab. */
  open: (url: string) => void;
  /** Put the command in Athena's composer and make the playbook her active project; the person
   *  presses send (ADR 0044). */
  hand: (text: string, playbook: { id: string; title: string; caseId?: string; scheduled?: boolean }) => void;
}

export interface Verdict {
  word: VerdictWord | "unbenched";
  /** The badge. */
  label: string;
  tone: Tone;
  /** One sentence a person reads under the badge. */
  sentence: string;
  /** "beat its bar in 2 of 3 test runs", "one test run": the comparable runs the verdict stands on
   *  (ADR 0128); "" when untested. */
  runs: string;
  /** "n=1" where one comparable run is all there is, a single draw; "" otherwise. */
  sample: string;
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
  /** `null` where nothing serves the film: the page shows the stills instead. */
  videoUrl: string | null;
}

/** One kind's share of a run: what her right cards were worth, of what the example held. */
export interface KindTally {
  found: number;
  total: number;
  /** How many right cards, of how many the example held, of this kind. */
  n: number;
  of: number;
}

/** A run's cards by kind; a kind the run never touched is absent. */
export type Tally = Partial<Record<ValueKind, KindTally>>;

export interface PlaybookView {
  playbook: Playbook;
  id: string;
  title: string;
  /** "$4,940" and "a year": the author's estimate, of the kind `playbook.economics.valueKind`. */
  value: string;
  per: string;
  /** "30× faster", her run plus the person's review against the hand minutes; "" when untested or
   *  either is unknown. */
  speed: string;
  /** The latest run's cards by kind; `null` untested. */
  tally: Tally | null;
  verdict: Verdict;
  evidence: EvidenceView | null;
}

export interface PlaybooksModel {
  items: readonly PlaybookView[];
  /** What the catalogue's line and the surface say: how many, how many benched and beat the bar. */
  totals: {
    count: number;
    benched: number;
    exceeds: number;
    /** Money back the test runs found across every tested playbook: `money_back` cards only. */
    foundUsd: number;
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
  episode: "an episode",
  quarter: "a quarter",
  estate: "an estate",
};

/** How a kind's dollars read in a sentence: "$96.40 back", "$380,000 protected". `count` has none. */
export function kindAmount(kind: Exclude<ValueKind, "count">, amount: number): string {
  switch (kind) {
    case "money_back":
      return `${usd(amount)} back`;
    case "money_protected":
      return `${usd(amount)} protected`;
    case "penalty_avoided":
      return `${usd(amount)} in penalties avoided`;
  }
}

/** The money kinds, in the order a line says them: money back first, then what is not money back. */
export const MONEY_KINDS: readonly Exclude<ValueKind, "count">[] = ["money_back", "money_protected", "penalty_avoided"];

/**
 * A run's cards by their tool's kind (`economics.kinds`): right cards found, and what the example held
 * (right cards plus the missed ones). Pure. A run recorded with no cards and no misses falls back on
 * the score's totals, as money back only when the playbook names no other kind; otherwise it claims
 * nothing.
 */
export function tallyOf(p: Playbook, bench: Bench | null = p.bench): Tally | null {
  if (bench === null) return null;
  const tally: Tally = {};
  const add = (tool: string, value: number | null, found: boolean) => {
    const t = (tally[kindOf(p, tool)] ??= { found: 0, total: 0, n: 0, of: 0 });
    t.of++;
    t.total = Math.round((t.total + (value ?? 0)) * 100) / 100;
    if (found) {
      t.n++;
      t.found = Math.round((t.found + (value ?? 0)) * 100) / 100;
    }
  };
  bench.cards.forEach((c) => c.outcome === "correct" && add(c.action, c.valueUsd, true));
  bench.missed.forEach((m) => add(m.action, m.valueUsd, false));
  if (!bench.cards.length && !bench.missed.length && bench.eligible && !Object.values(p.economics.kinds).some((k) => k !== "money_back")) {
    tally.money_back = { found: bench.valueFoundUsd, total: bench.valueTotalUsd, n: bench.found, of: bench.eligible };
  }
  return tally;
}

/** "$96.40 back of $96.40, $36,000 of $416,700 protected": each money kind the run held, in its words. */
export const tallyWords = (tally: Tally | null): string =>
  MONEY_KINDS.flatMap((k) => {
    const t = tally?.[k];
    return t?.total ? [k === "money_back" ? `${usd(t.found)} back of ${usd(t.total)}` : `${usd(t.found)} of ${kindAmount(k, t.total)}`] : [];
  }).join(", ");

const LOOK = {
  exceeds: ["Beats its bar", "success"],
  meets: ["Meets its bar", "info"],
  short: ["Falls short", "warning"],
} as const;

export function verdictOf(bench: Bench | null, tally: Tally | null = null): Verdict {
  if (bench === null) {
    return {
      word: "unbenched",
      label: "Not tested",
      tone: "neutral",
      sentence: "No test run yet, so nothing here is measured.",
      runs: "",
      sample: "",
    };
  }
  const f = bench.falseClaims;
  const body = [
    `${bench.found} of ${bench.eligible} found`,
    tallyWords(tally),
    f ? `${f} false claim${f === 1 ? "" : "s"}` : "no false claims",
  ]
    .filter(Boolean)
    .join(", ");
  // ADR 0128: the latest run is one draw; say how many comparable runs stand behind it.
  const { n, exceeds } = bench.runs;
  const one = n === 1;
  const beat = `${exceeds} of ${n} test runs`;
  const word = bench.verdict.word;
  const sentence =
    word === "exceeds"
      ? `Beat its bar in ${one ? "its one test run" : beat}: ${body}.`
      : word === "meets"
        ? `Met its bar in the latest test run: ${body}. ${one ? "One test run so far." : `It beat the bar in ${beat}.`}`
        : `Fell short: ${body}, ${one ? "one test run" : `latest of ${n} test runs`}. ${bench.verdict.reasons[0] ?? ""}`.trim();
  return {
    word,
    label: LOOK[word][0],
    tone: LOOK[word][1],
    sentence,
    runs: one ? "one test run" : `beat its bar in ${beat}`,
    sample: one ? "n=1" : "",
  };
}

export const OUTCOME_WORDS: Record<CardOutcome, { word: string; tone: Tone }> = {
  correct: { word: "Right claim", tone: "success" },
  neutral: { word: "Fair either way", tone: "info" },
  duplicate: { word: "Duplicate", tone: "warning" },
  trap: { word: "Fell for a trap", tone: "error" },
  unfounded: { word: "Unfounded", tone: "error" },
  forbidden: { word: "Forbidden action", tone: "error" },
  other: { word: "Other card", tone: "neutral" },
  proposed: { word: "She would propose", tone: "neutral" },
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
      ? { label: "Current", tone: "success", sentence: `Films the latest test run, of ${filmed}.` }
      : {
          label: "Stale",
          tone: "warning",
          sentence: p.bench
            ? `Films the test run of ${filmed}; the latest is of ${p.bench.runAt.slice(0, 10)}, so the figures may differ.`
            : `Films a test run of ${filmed} that this build no longer carries.`,
        },
    length: clock(e.video.durationS || e.narration.durationS),
    capturedAt: e.capturedAt.slice(0, 10),
    voice: [e.narration.engine, e.narration.voice].filter(Boolean).join(" "),
    narration: e.narration.text,
    videoUrl: e.videoUrl,
  };
}

/** The `per` values that are spans of time, so a value in them can be put on the year's scale. */
const YEARLY = ["year", "month", "week"];

/** True when the estimate is per a span of time (a year, a month, a week), not per an episode. */
export function isYearly(p: Playbook): boolean {
  return YEARLY.includes(p.economics.per);
}

/** Her run plus the person's review, in minutes: what the chore costs with her. */
export function withReviewMinutes(b: Bench): number {
  return (b.wallS + b.yourTimeS) / 60;
}

/** A playbook's value on one scale, so rows compare: a month is twelve of a year. */
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
  const items = playbooks.map((p): PlaybookView => {
    const tally = tallyOf(p);
    return {
      playbook: p,
      id: p.id,
      title: p.title,
      value: usd(p.economics.valueUsd),
      per: PER[p.economics.per] ?? `per ${p.economics.per}`,
      speed: p.bench ? speedup(p.economics.manualMinutes, withReviewMinutes(p.bench)) : "",
      tally,
      verdict: verdictOf(p.bench, tally),
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
      foundUsd: Math.round(benched.reduce((s, v) => s + (v.tally?.money_back?.found ?? 0), 0) * 100) / 100,
    },
    loading,
    problem,
    actions,
  };
}

// -- the ledger (ADR 0096) -------------------------------------------------------------------------
//
// The ledger reads `PlaybooksModel.items` as they come, in the edge's order, so a row and its topic
// page are one object and the scene keeps one key.

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
 * The ledger's rows in one of its three orders. Pure, and total: `edge` is the shipped order (`asc`
 * best first, `desc` its exact reverse); `value` is the author's estimate of money back a year
 * (`annualValue`, so a month counts twelve times), with every estimate that is not money back a year
 * (an exposure protected, a penalty avoided, a value per episode) after them, by its own value, in
 * either direction; `time` is the hours the chore takes by hand. On value and time, a tie keeps the
 * edge's order best first whichever way the column runs, so two playbooks worth the same never swap
 * places when the person flips the arrow.
 */
export function sortLedger(items: readonly PlaybookView[], s: LedgerSort): PlaybookView[] {
  const sign = s.dir === "asc" ? 1 : -1;
  if (s.key === "edge") return [...items].sort((a, b) => sign * byEdge(a, b));
  if (s.key === "value") {
    const group = (v: PlaybookView) =>
      v.playbook.economics.valueKind === "money_back" && isYearly(v.playbook) ? 0 : 1;
    return [...items].sort(
      (a, b) => group(a) - group(b) || sign * (annualValue(a.playbook) - annualValue(b.playbook)) || byEdge(a, b),
    );
  }
  const measure = (v: PlaybookView) => v.playbook.economics.manualMinutes;
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

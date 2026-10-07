/**
 * The playbooks, typed once — README section 14; ADR 0040.
 *
 * A playbook is data in the repository's `playbooks/<id>/` directory, shared with the Python
 * bench (`src/athena/proving/playbooks/`): `playbook.json` is the showcase this app renders and
 * `bench.json` is the latest measured run, absent until one ran. `world.json` and `truth.json`
 * are the bench's and are never imported here — a surface that could read the answers would be
 * tempted to show them.
 *
 * The files are bundled at build time (`import.meta.glob`, eager), so the module needs no daemon
 * and no route: a playbook is something the app ships, like the constitution. `parsePlaybook`
 * reads one leniently and says what it dropped, because a showcase that blanks on one missing
 * field is worse than one that shows the rest and names the gap.
 */

export interface PlaybookApp {
  name: string;
  /** What the portal is to this chore: "the invoices", "the order history". */
  role: string;
  /** Why no integration reaches it, in a few words. */
  api: string;
  /** Where a person opens it. Empty when the portal is per-account and has no public address. */
  url: string;
}

export interface PlaybookGate {
  action: string;
  label: string;
  why: string;
}

export interface Source {
  label: string;
  url: string;
}

export interface Economics {
  /** Money recovered or saved per `per`, in US dollars. */
  valueUsd: number;
  per: string;
  /** What a person spends on it by hand, per run, in minutes. */
  manualMinutes: number;
  /** Who does it today and what they keep. */
  incumbent: string;
  /** The share of what is recovered that the usual service keeps, in percent, when there is one. */
  incumbentFeePct: number | null;
  sources: readonly Source[];
}

export interface Edge {
  /** How hard it is for anyone but Athena: portal-locked, cross-system, judgment. 1–5. */
  difficulty: number;
  /** What it is worth to the person: money and hours. 1–5. */
  usefulness: number;
  difficultyWhy: string;
  usefulnessWhy: string;
}

export interface Expectation {
  recall: number;
  falseClaims: number;
  minutes: number;
  why: string;
}

export type CardOutcome =
  | "correct"
  | "neutral"
  | "duplicate"
  | "trap"
  | "unfounded"
  | "forbidden"
  | "other";

export interface BenchCard {
  action: string;
  key: string;
  outcome: CardOutcome;
  valueUsd: number | null;
  exact: boolean | null;
  why: string;
}

export type VerdictWord = "exceeds" | "meets" | "short";

export interface Bench {
  runAt: string;
  engine: string;
  model: string;
  wallS: number;
  turns: number;
  reads: number;
  costUsd: number | null;
  yourTimeS: number;
  verdict: { word: VerdictWord; reasons: readonly string[]; minutes: number };
  eligible: number;
  found: number;
  exact: number;
  valueTotalUsd: number;
  valueFoundUsd: number;
  falseClaims: number;
  duplicates: number;
  trapsTotal: number;
  trapsFiled: number;
  /** What the cards asked for, from their own amounts; `null` when they named none. */
  filedUsd: number | null;
  /** Her closing words stated a total; did the cards add up to it? */
  proseAudit: { saidUsd: number; recordUsd: number; agrees: boolean } | null;
  /** The run was scored again later against a newer measure, without re-running it. */
  rescoredAt: string;
  /** What changed since the run before, in a sentence; "" when nothing was said. */
  note: string;
  /** Earlier runs, oldest first. */
  history: readonly RunLine[];
  cards: readonly BenchCard[];
  missed: readonly { action: string; key: string; valueUsd: number | null }[];
  closingWords: string;
}

/** One earlier run of a playbook, in a line. */
export interface RunLine {
  runAt: string;
  model: string;
  verdict: VerdictWord;
  found: number;
  eligible: number;
  valueFoundUsd: number;
  falseClaims: number;
  note: string;
}

/** A product fix one of this playbook's runs uncovered. */
export interface Lesson {
  /** The decision record it became, e.g. "0041"; "" when it is a finding, not a change. */
  adr: string;
  title: string;
  /** What the run showed, in a sentence. */
  found: string;
}

export interface Playbook {
  id: string;
  title: string;
  promise: string;
  domain: string;
  persona: string;
  chore: string;
  command: string;
  apps: readonly PlaybookApp[];
  steps: readonly string[];
  gates: readonly PlaybookGate[];
  traps: readonly string[];
  memory: readonly string[];
  economics: Economics;
  edge: Edge;
  expectation: Expectation;
  lessons: readonly Lesson[];
  /** A limit a reader must know before using it for real (e.g. a BAA for patient data). */
  caveat: string;
  bench: Bench | null;
}

// -- reading -------------------------------------------------------------------------------------

type Raw = Record<string, unknown>;

const isRaw = (v: unknown): v is Raw => typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: unknown, fallback = ""): string => (typeof v === "string" ? v : fallback);
const num = (v: unknown, fallback = 0): number =>
  typeof v === "number" && Number.isFinite(v) ? v : fallback;
const numOrNull = (v: unknown): number | null =>
  typeof v === "number" && Number.isFinite(v) ? v : null;
const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const strings = (v: unknown): string[] => list(v).filter((s): s is string => typeof s === "string");

const OUTCOMES: readonly CardOutcome[] = [
  "correct",
  "neutral",
  "duplicate",
  "trap",
  "unfounded",
  "forbidden",
  "other",
];
const VERDICTS: readonly VerdictWord[] = ["exceeds", "meets", "short"];

function parseBench(raw: unknown): Bench | null {
  if (!isRaw(raw)) return null;
  const score = isRaw(raw.score) ? raw.score : {};
  const verdict = isRaw(raw.verdict) ? raw.verdict : {};
  const word = str(verdict.word);
  return {
    runAt: str(raw.run_at),
    engine: str(raw.engine),
    model: str(raw.model),
    wallS: num(raw.wall_s),
    turns: num(raw.turns),
    reads: num(raw.reads),
    costUsd: numOrNull(raw.cost_usd),
    yourTimeS: num(raw.your_time_s),
    verdict: {
      word: (VERDICTS as readonly string[]).includes(word) ? (word as VerdictWord) : "short",
      reasons: strings(verdict.reasons),
      minutes: num(verdict.minutes, num(raw.wall_s) / 60),
    },
    eligible: num(score.eligible),
    found: num(score.found),
    exact: num(score.exact),
    valueTotalUsd: num(score.value_total_usd),
    valueFoundUsd: num(score.value_found_usd),
    falseClaims: num(score.false_claims),
    duplicates: num(score.duplicates),
    trapsTotal: num(score.traps_total),
    trapsFiled: num(score.traps_filed),
    filedUsd: numOrNull(score.filed_usd),
    proseAudit: isRaw(raw.prose_audit)
      ? {
          saidUsd: num(raw.prose_audit.said_usd),
          recordUsd: num(raw.prose_audit.record_usd),
          agrees: raw.prose_audit.agrees === true,
        }
      : null,
    rescoredAt: str(raw.rescored_at),
    note: str(raw.note),
    history: list(raw.history)
      .filter(isRaw)
      .map((h) => ({
        runAt: str(h.run_at),
        model: str(h.model),
        verdict: (VERDICTS as readonly string[]).includes(str(h.verdict))
          ? (str(h.verdict) as VerdictWord)
          : "short",
        found: num(h.found),
        eligible: num(h.eligible),
        valueFoundUsd: num(h.value_found_usd),
        falseClaims: num(h.false_claims),
        note: str(h.note),
      })),
    cards: list(raw.cards)
      .filter(isRaw)
      .map((c) => ({
        action: str(c.action),
        key: str(c.key),
        outcome: (OUTCOMES as readonly string[]).includes(str(c.outcome))
          ? (str(c.outcome) as CardOutcome)
          : "other",
        valueUsd: numOrNull(c.value_usd),
        exact: typeof c.exact === "boolean" ? c.exact : null,
        why: str(c.why),
      })),
    missed: list(raw.missed)
      .filter(isRaw)
      .map((m) => ({ action: str(m.action), key: str(m.key), valueUsd: numOrNull(m.value_usd) })),
    closingWords: str(raw.closing_words),
  };
}

/** One `playbook.json` (and its `bench.json`, if any) into a `Playbook`, or `null` without an id. */
export function parsePlaybook(raw: unknown, bench: unknown = null): Playbook | null {
  if (!isRaw(raw) || !str(raw.id)) return null;
  const econ = isRaw(raw.economics) ? raw.economics : {};
  const edge = isRaw(raw.edge) ? raw.edge : {};
  const expect = isRaw(raw.expectation) ? raw.expectation : {};
  return {
    id: str(raw.id),
    title: str(raw.title, str(raw.id)),
    promise: str(raw.promise),
    domain: str(raw.domain),
    persona: str(raw.persona),
    chore: str(raw.chore),
    command: str(raw.command),
    apps: list(raw.apps)
      .filter(isRaw)
      .map((a) => ({ name: str(a.name), role: str(a.role), api: str(a.api), url: str(a.url) })),
    steps: strings(raw.steps),
    gates: list(raw.gates)
      .filter(isRaw)
      .map((g) => ({ action: str(g.action), label: str(g.label, str(g.action)), why: str(g.why) })),
    traps: strings(raw.traps),
    memory: strings(raw.memory),
    economics: {
      valueUsd: num(econ.value_usd),
      per: str(econ.per, "run"),
      manualMinutes: num(econ.manual_minutes),
      incumbent: str(econ.incumbent),
      incumbentFeePct: numOrNull(econ.incumbent_fee_pct),
      sources: list(econ.sources)
        .filter(isRaw)
        .map((s) => ({ label: str(s.label, str(s.url)), url: str(s.url) }))
        .filter((s) => s.url.startsWith("https://") || s.url.startsWith("http://")),
    },
    edge: {
      difficulty: clampScore(num(edge.difficulty, 1)),
      usefulness: clampScore(num(edge.usefulness, 1)),
      difficultyWhy: str(edge.difficulty_why),
      usefulnessWhy: str(edge.usefulness_why),
    },
    expectation: {
      recall: num(expect.recall, 1),
      falseClaims: num(expect.false_claims),
      minutes: num(expect.minutes, 30),
      why: str(expect.why),
    },
    lessons: list(raw.lessons)
      .filter(isRaw)
      .map((l) => ({ adr: str(l.adr), title: str(l.title), found: str(l.found) }))
      .filter((l) => l.title),
    caveat: str(raw.caveat),
    bench: parseBench(bench),
  };
}

function clampScore(n: number): number {
  return Math.min(5, Math.max(1, n));
}

/** Every shipped playbook, ordered by where it sits on the edge: hardest-and-most-useful first. */
export function loadPlaybooks(
  showcases: Record<string, unknown>,
  benches: Record<string, unknown>,
): Playbook[] {
  const benchFor = (path: string) => benches[path.replace(/playbook\.json$/, "bench.json")] ?? null;
  return Object.entries(showcases)
    .map(([path, raw]) => parsePlaybook(unwrap(raw), unwrap(benchFor(path))))
    .filter((p): p is Playbook => p !== null)
    .sort((a, b) => edgeRank(b) - edgeRank(a) || a.title.localeCompare(b.title));
}

/** A JSON module arrives as `{ default: … }` from the glob; a test may hand the value itself. */
function unwrap(value: unknown): unknown {
  return isRaw(value) && "default" in value ? value.default : value;
}

export function edgeRank(p: Playbook): number {
  return p.edge.difficulty * p.edge.usefulness;
}

/** "Only Athena": hard for anyone else and worth real money. The corner the cycles push into. */
export function onTheEdge(p: Playbook): boolean {
  return p.edge.difficulty >= 4 && p.edge.usefulness >= 4;
}

// -- words ---------------------------------------------------------------------------------------

export function usd(n: number): string {
  const whole = Math.abs(n) >= 1000 || Number.isInteger(n);
  return n.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: whole ? 0 : 2,
    maximumFractionDigits: whole ? 0 : 2,
  });
}

export function minutes(m: number): string {
  if (m < 1) return `${Math.max(1, Math.round(m * 60))} s`;
  if (m < 90) return `${Math.round(m)} min`;
  const h = m / 60;
  return `${h % 1 === 0 ? h : h.toFixed(1)} h`;
}

/** "18× faster" from a person's minutes and Athena's measured ones, or "" when either is unknown. */
export function speedup(manual: number, measured: number): string {
  if (manual <= 0 || measured <= 0) return "";
  const x = manual / measured;
  return x >= 10 ? `${Math.round(x)}× faster` : `${x.toFixed(1)}× faster`;
}

// -- the shipped set -----------------------------------------------------------------------------

const SHOWCASES = import.meta.glob("../../../../playbooks/*/playbook.json", { eager: true });
const BENCHES = import.meta.glob("../../../../playbooks/*/bench.json", { eager: true });

/** What this build ships. */
export const PLAYBOOKS: readonly Playbook[] = loadPlaybooks(SHOWCASES, BENCHES);

/**
 * The playbooks, typed once — README section 14; ADR 0040.
 *
 * A playbook is data in the repository's `playbooks/<id>/` directory, shared with the Python
 * bench (`src/athena/proving/playbooks/`): `playbook.json` is the showcase this app renders and
 * `bench.json` is the latest measured run, absent until one ran. `world.json` and `truth.json`
 * are the bench's and are never imported here — a surface that could read the answers would be
 * tempted to show them. `evidence.json` is the run filmed (ADR 0055): the index of a narrated
 * recording that lives in the repository's gitignored `evidence/`. Schema 2 added the storyboard
 * (ADR 0096): stills of the run under `story/`, committed, each with a caption and the turn it shows.
 * Schema 3 (ADR 0137) is five of them, the "How it runs" drawing and four turns, 1280 px and 16:10,
 * with no figure baked in, and retires the thumbnail (`thumb.jpg`), which no component drew.
 *
 * The files are bundled at build time (`import.meta.glob`, as chunks fetched on first ask by
 * `loadShipped`, ADR 0095), so the module needs no daemon and no route: a playbook is something the
 * app ships, like the constitution. `parsePlaybook` reads one leniently and says what it dropped,
 * because a showcase that blanks on one missing field is worse than one that shows the rest and
 * names the gap.
 *
 * Every figure carries its kind (fix wave chores-uat, ADR 0133): `economics.value_kind` says what the
 * author's estimate is, `economics.kinds` what each answer-key tool's cards are worth, and
 * `economics.example_usd` the example case's money back, derived by the bench's `derive`. Only money
 * back is ever summed as "found"; an absent kind is money back and an absent example is `null`.
 */

import { isCategoryId, isJobId, type CategoryId, type JobId } from "./playbook-taxonomy";

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

/**
 * What a figure is (fix contract, chores-uat theme 2). Only `money_back` is money that comes back to
 * the person and sums into "found", the totals and the home light; `money_protected` is exposure or
 * a payment released earlier, `penalty_avoided` a penalty not paid, and `count` a scoring weight that
 * is never shown as dollars.
 */
export type ValueKind = "money_back" | "money_protected" | "penalty_avoided" | "count";

const VALUE_KINDS: readonly ValueKind[] = ["money_back", "money_protected", "penalty_avoided", "count"];

/** Who and where a chore fits, as its author wrote it (`playbook.json` `fit`). */
export interface Fit {
  /** "US", a list of USPS state codes, "EU" or another region word; `[]` when the file names none. */
  where: readonly string[];
  whereNote: string;
  who: string;
  notFor: string;
  /** What she will ask the person for, in plain words. */
  asksFor: readonly string[];
  costs: string;
}

export interface Economics {
  /** The author's estimate per `per`, in US dollars, of the kind `valueKind` names. */
  valueUsd: number;
  /** What `valueUsd` is; `money_back` when the file does not say. Never `count`. */
  valueKind: Exclude<ValueKind, "count">;
  per: string;
  /** How the author reached `valueUsd`, in their words; "" when the file has none. */
  basis: string;
  /** Each answer-key tool's kind; a tool missing here is `money_back` (see `kindOf`). */
  kinds: Readonly<Record<string, ValueKind>>;
  /** What the example case holds as money back, derived from its answer key; `null` when none of
   *  it is money back or the file does not carry it. Unmeasured is not zero. */
  exampleUsd: number | null;
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
  | "other"
  /** A practice run's card on a world its answer key no longer fits: proposed, never scored. */
  | "proposed";

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
  /** Every trap the world held, why it was one, and whether she fell for it. */
  trapLedger: readonly { action: string; key: string; why: string; filed: boolean }[];
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
  /** The latest run's comparability key (ADR 0128); "" for a run benched before keys were kept. */
  comparable: string;
  /** The runs this bench.json holds under the latest run's key, the latest counted (ADR 0128):
   *  how many, and how many of them exceeded. An unkeyed run is a set of one. The ranking also
   *  checks the key against today's files and pools the whole run ledger; the desktop cannot, so
   *  this is what the file says, and `Playbook.rank.runs` is the ranking's word where it has one. */
  runs: { n: number; exceeds: number };
  cards: readonly BenchCard[];
  missed: readonly { action: string; key: string; valueUsd: number | null }[];
  closingWords: string;
  /** The run turn by turn, for the replay; empty for a run recorded before traces were kept. */
  trace: readonly TraceTurn[];
}

/** One turn of a benched run: where she was, what the person said, what she read and filed. */
export interface TraceTurn {
  portal: string;
  /** What the person said; "" when the run loop continued the turn instead. */
  user: string;
  /** The run loop sent the page's answers back to her: no one spoke. */
  continued: boolean;
  /** Her words, cut at a sentence end; `saidChars` is how long they were. */
  said: string;
  saidChars: number;
  reads: readonly string[];
  cards: readonly { action: string; key: string; outcome: CardOutcome; valueUsd: number | null }[];
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
  /** Its comparability key (ADR 0128); "" when it carries none. */
  comparable: string;
  /** A rescore replaced it: the line keeps the original score (ADR 0128). "" otherwise. */
  supersededAt: string;
}

/** The runs a bench pools, by ADR 0128's rule: the latest, and every earlier line under its key that
 *  no rescore superseded and that is not the latest run itself. Pure. */
export function comparableRuns(
  latest: { comparable: string; verdict: VerdictWord; runAt: string; rescoredAt: string },
  history: readonly RunLine[],
): { n: number; exceeds: number } {
  const pooled = latest.comparable
    ? history.filter(
        (h) =>
          h.comparable === latest.comparable &&
          !h.supersededAt &&
          !(latest.rescoredAt && h.runAt === latest.runAt),
      )
    : [];
  return {
    n: 1 + pooled.length,
    exceeds: (latest.verdict === "exceeds" ? 1 : 0) + pooled.filter((h) => h.verdict === "exceeds").length,
  };
}

/** A product fix one of this playbook's runs uncovered. */
export interface Lesson {
  /** The decision record it became, e.g. "0041"; "" when it is a finding, not a change. */
  adr: string;
  title: string;
  /** What the run showed, in a sentence. */
  found: string;
}

export type Audience = "home" | "work";

export interface Playbook {
  id: string;
  title: string;
  /** The ledger's name for it, at most ~56 characters; `title` when the file has none. */
  shortTitle: string;
  /** The playbook told in simple markdown (a lead line, `- ` bullets, `**bold**`); "" when none. */
  brief: string;
  promise: string;
  domain: string;
  /** The ledger's area (ADR 0096); `null` when the file names none or one the taxonomy lacks. */
  category: CategoryId | null;
  /** What it does for the person (ADR 0096); `null` like `category`. */
  job: JobId | null;
  /** Whose chore it is: a household's, or a business's (a sole trader's counts as work). */
  audience: Audience;
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
  /** Who and where it fits; `null` when the file says nothing, and then no surface says anything. */
  fit: Fit | null;
  bench: Bench | null;
  /** The run filmed and narrated (ADR 0055); `null` until `evidence <id>` ran. */
  evidence: Evidence | null;
  /** Where the bench's committed ranking puts it (ADR 0056); `null` when the ranking does not name
   *  it, or ranks a run other than the one `bench` holds (ADR 0213). */
  rank: Rank | null;
}

/**
 * One playbook's row in `playbooks/ranking.json` (ADR 0056, 0128, 0213): the bench's own word on its
 * year, its run pool and its standing, held to the bench files by `rank --check`. A ranked row has a
 * place and `unranked: null`; a row the method leaves out has no place and says why.
 */
export interface Rank {
  position: number | null;
  score: number | null;
  /** The estimate on the year's scale, by the ranking's period table. */
  annualUsd: number | null;
  savedMinutesYear: number | null;
  /** The `run_at` of the bench run it ranked; "" for a row left out. */
  runAt: string;
  /** The comparable runs it stands on; `null` for a row left out. */
  runs: { n: number; exceeds: number } | null;
  /** Why the method leaves it out, in the ranking's words; `null` when ranked. */
  unranked: string | null;
}

/** One still of the run's storyboard (ADR 0096, 0137): the drawing or a turn (schema 2: the abstract,
 *  a turn, or what she filed). */
export interface StoryStill {
  /** The bundled still's URL; "" when the file is not in this build. */
  url: string;
  caption: string;
  /** The replay turn it shows, from 1; `null` for the drawing (schema 2: the abstract and the result). */
  turn: number | null;
}

/** One playbook's `evidence.json` (schema 1, 2 or 3; ADR 0055, 0096 and 0137), read leniently. */
export interface Evidence {
  schema: number;
  capturedAt: string;
  /** The `run_at` of the bench run it filmed: equal to `bench.runAt` while it is current. */
  benchRunAt: string;
  /** Empty in a schema 3 index of the stills alone, until the films pass narrates it again. */
  narration: { text: string; engine: string; voice: string; durationS: number; sha256: string };
  /** A repo-relative path: the film under the gitignored `evidence/`; empty without a film. */
  video: { path: string; durationS: number; bytes: number; sha256: string };
  /** Where the dev server serves the film; `null` in a build, which carries no media. */
  videoUrl: string | null;
  /** The storyboard, in order; `[]` for schema 1 or before the stills were captured. */
  story: readonly StoryStill[];
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
  "proposed",
];
const VERDICTS: readonly VerdictWord[] = ["exceeds", "meets", "short"];

/** `ranking.json` into a map by playbook id. Lenient like `parseBench`: garbage is an empty map, and
 *  a row without a playbook id is dropped. */
export function parseRanking(raw: unknown): Map<string, Rank> {
  const out = new Map<string, Rank>();
  if (!isRaw(raw)) return out;
  for (const r of list(raw.ranked).filter(isRaw)) {
    const b = isRaw(r.bench) ? r.bench : {};
    const runs = isRaw(b.runs) ? b.runs : null;
    if (typeof r.playbook === "string")
      out.set(r.playbook, {
        position: numOrNull(r.rank),
        score: numOrNull(r.score),
        annualUsd: isRaw(r.money) ? numOrNull(r.money.annual_usd) : null,
        savedMinutesYear: isRaw(r.minutes) ? numOrNull(r.minutes.saved_per_year) : null,
        runAt: str(b.run_at),
        runs: runs && { n: num(runs.n), exceeds: num(runs.exceeds) },
        unranked: null,
      });
  }
  for (const r of list(raw.unranked).filter(isRaw))
    if (typeof r.playbook === "string")
      out.set(r.playbook, {
        position: null,
        score: null,
        annualUsd: null,
        savedMinutesYear: null,
        runAt: "",
        runs: null,
        unranked: str(r.why),
      });
  return out;
}

const outcome = (v: unknown): CardOutcome =>
  (OUTCOMES as readonly string[]).includes(str(v)) ? (str(v) as CardOutcome) : "other";

function parseBench(raw: unknown): Bench | null {
  if (!isRaw(raw)) return null;
  const score = isRaw(raw.score) ? raw.score : {};
  const verdict = isRaw(raw.verdict) ? raw.verdict : {};
  const word = str(verdict.word);
  const history: RunLine[] = list(raw.history)
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
      comparable: str(h.comparable),
      supersededAt: isRaw(h.superseded_by) ? str(h.superseded_by.rescored_at) || "unknown" : "",
    }));
  const head = {
    comparable: str(raw.comparable),
    verdict: (VERDICTS as readonly string[]).includes(word) ? (word as VerdictWord) : "short",
    runAt: str(raw.run_at),
    rescoredAt: str(raw.rescored_at),
  };
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
    trapLedger: list(score.trap_ledger)
      .filter(isRaw)
      .map((t) => ({ action: str(t.action), key: str(t.key), why: str(t.why), filed: t.filed === true })),
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
    history,
    comparable: head.comparable,
    runs: comparableRuns(head, history),
    cards: list(raw.cards)
      .filter(isRaw)
      .map((c) => ({
        action: str(c.action),
        key: str(c.key),
        outcome: outcome(c.outcome),
        valueUsd: numOrNull(c.value_usd),
        exact: typeof c.exact === "boolean" ? c.exact : null,
        why: str(c.why),
      })),
    missed: list(raw.missed)
      .filter(isRaw)
      .map((m) => ({ action: str(m.action), key: str(m.key), valueUsd: numOrNull(m.value_usd) })),
    closingWords: str(raw.closing_words),
    trace: parseTrace(raw.trace),
  };
}

/**
 * A run's turns in bench.json's trace shape — the recorded run's, and the Adopt studio's tailored
 * rehearsal's, which streams the same shape (ADR 0097). Anything that is not a turn is dropped.
 */
export function parseTrace(raw: unknown): TraceTurn[] {
  return list(raw)
    .filter(isRaw)
    .map((t) => ({
      portal: str(t.portal),
      user: str(t.user),
      continued: t.continued === true,
      said: str(t.said),
      saidChars: num(t.said_chars, str(t.said).length),
      reads: strings(t.reads),
      cards: list(t.cards)
        .filter(isRaw)
        .map((c) => ({
          action: str(c.action),
          key: str(c.key),
          outcome: outcome(c.outcome),
          valueUsd: numOrNull(c.value_usd),
        })),
    }));
}

/** A storyboard still's repo-relative path: two digits under its playbook's own `story/`. */
const STILL_PATH = /^playbooks\/([\w.-]+)\/story\/\d{2}\.webp$/;

/**
 * The storyboard (schema 2 and 3; ADR 0096, 0137), in the file's order. A row is kept only when it has a caption
 * and a path of the one shape the capture writes, under the playbook the index names when it names
 * one: a caption is what the strip reads aloud, and a path that points anywhere else is not a still
 * of this run. `still` turns a kept path into the bundled URL, "" when this build lacks the file —
 * so a row the stills step listed but the build did not carry still says what it was rather than
 * vanishing. Schema 1 has no storyboard, whatever it holds.
 */
function parseStory(raw: Raw, still: (path: string) => string): StoryStill[] {
  if (num(raw.schema) < 2) return [];
  const owner = str(raw.playbook);
  return list(raw.story)
    .filter(isRaw)
    .flatMap((row) => {
      const path = str(row.path);
      const caption = str(row.caption).trim();
      const m = STILL_PATH.exec(path);
      if (!caption || !m || (owner && m[1] !== owner)) return [];
      const turn = numOrNull(row.turn);
      return [{ url: still(path), caption, turn: turn !== null && Number.isInteger(turn) && turn >= 1 ? turn : null }];
    });
}

/**
 * One `evidence.json` into an `Evidence`, or `null` when there is none. `serve` says whether a dev
 * server is there to hand out the film itself; `still` resolves a storyboard row's repo-relative path
 * to its bundled URL ("" when it is not bundled). An old index's `thumbnail` is not read (ADR 0137).
 */
export function parseEvidence(
  raw: unknown,
  serve = false,
  still: (path: string) => string = () => "",
): Evidence | null {
  if (!isRaw(raw)) return null;
  const narration = isRaw(raw.narration) ? raw.narration : {};
  const video = isRaw(raw.video) ? raw.video : {};
  const videoPath = str(video.path);
  return {
    schema: num(raw.schema),
    capturedAt: str(raw.captured_at),
    benchRunAt: str(raw.bench_run_at),
    narration: {
      text: str(narration.text),
      engine: str(narration.engine),
      voice: str(narration.voice),
      durationS: num(narration.duration_s),
      sha256: str(narration.sha256),
    },
    video: {
      path: videoPath,
      durationS: num(video.duration_s, num(narration.duration_s)),
      bytes: num(video.bytes),
      sha256: str(video.sha256),
    },
    // Only a repo-relative path under `evidence/` is ever turned into a URL.
    videoUrl: serve && /^evidence\/[\w.-]+\/[\w.-]+\.mp4$/.test(videoPath) ? `/${videoPath}` : null,
    story: parseStory(raw, still),
  };
}

const isKind = (v: unknown): v is ValueKind => (VALUE_KINDS as readonly unknown[]).includes(v);

/** `economics.kinds`, keeping only entries whose kind is one the contract names. */
const parseKinds = (raw: unknown): Record<string, ValueKind> =>
  Object.fromEntries(Object.entries(isRaw(raw) ? raw : {}).filter((e): e is [string, ValueKind] => isKind(e[1])));

/** `fit`, or `null` when it is absent or says nothing at all: no invented default. */
function parseFit(raw: unknown): Fit | null {
  if (!isRaw(raw)) return null;
  const fit: Fit = {
    where: typeof raw.where === "string" ? [raw.where] : strings(raw.where),
    whereNote: str(raw.where_note),
    who: str(raw.who),
    notFor: str(raw.not_for),
    asksFor: strings(raw.asks_for),
    costs: str(raw.costs),
  };
  return Object.values(fit).some((v) => v.length) ? fit : null;
}

/** The kind of what an answer-key tool's cards are worth; `money_back` when the playbook does not say. */
export function kindOf(p: Pick<Playbook, "economics">, tool: string): ValueKind {
  return p.economics.kinds[tool] ?? "money_back";
}

/** One `playbook.json` (and its `bench.json`, if any) into a `Playbook`, or `null` without an id. */
export function parsePlaybook(
  raw: unknown,
  bench: unknown = null,
  evidence: Evidence | null = null,
): Playbook | null {
  if (!isRaw(raw) || !str(raw.id)) return null;
  const econ = isRaw(raw.economics) ? raw.economics : {};
  const edge = isRaw(raw.edge) ? raw.edge : {};
  const expect = isRaw(raw.expectation) ? raw.expectation : {};
  return {
    id: str(raw.id),
    title: str(raw.title, str(raw.id)),
    shortTitle: str(raw.short_title, str(raw.title, str(raw.id))),
    brief: str(raw.brief),
    promise: str(raw.promise),
    domain: str(raw.domain),
    // An area or a job the taxonomy does not list reads as none, never as a dropped playbook: the
    // ledger shows it under "Uncategorised" and the bench's loader is where a typo is refused.
    category: isCategoryId(raw.category) ? raw.category : null,
    job: isJobId(raw.job) ? raw.job : null,
    audience: str(raw.audience) === "home" ? "home" : "work",
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
      // `count` is a card's kind, never the estimate's: an estimate in dollars is money of some kind.
      valueKind: isKind(econ.value_kind) && econ.value_kind !== "count" ? econ.value_kind : "money_back",
      per: str(econ.per, "run"),
      basis: str(econ.basis).trim(),
      kinds: parseKinds(econ.kinds),
      exampleUsd: numOrNull(econ.example_usd),
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
    fit: parseFit(raw.fit),
    bench: parseBench(bench),
    evidence,
    rank: null,
  };
}

function clampScore(n: number): number {
  return Math.min(5, Math.max(1, n));
}

/** Every shipped playbook, ordered by where it sits on the edge: hardest-and-most-useful first. Each
 *  carries its row of `ranking` (`ranking.json`), when that row ranks the run its bench holds. */
export function loadPlaybooks(
  showcases: Record<string, unknown>,
  benches: Record<string, unknown>,
  evidences: Record<string, unknown> = {},
  serve = false,
  stories: Record<string, unknown> = {},
  ranking: unknown = null,
): Playbook[] {
  const ranks = parseRanking(unwrap(ranking));
  // A row ranks one run: a bench.json that has moved on since is not that run, so it borrows nothing.
  // A row left out names no run; `rank --check` holds the committed file to the committed benches.
  const rankOf = (p: Playbook): Rank | null => {
    const r = ranks.get(p.id) ?? null;
    return r && (r.unranked !== null || r.runAt === p.bench?.runAt) ? r : null;
  };
  const beside = (path: string, name: string) => path.replace(/playbook\.json$/, name);
  const benchFor = (path: string) => benches[beside(path, "bench.json")] ?? null;
  const urlOf = (value: unknown) => {
    const url = unwrap(value);
    return typeof url === "string" ? url : "";
  };
  const evidenceFor = (path: string) =>
    parseEvidence(
      unwrap(evidences[beside(path, "evidence.json")] ?? null),
      serve,
      // A still is looked up beside its playbook.json: the row's own
      // `playbooks/<id>/` is the directory the glob already keys, so only `story/NN.webp` is read.
      (still) => urlOf(stories[beside(path, still.replace(/^playbooks\/[^/]+\//, ""))]),
    );
  return Object.entries(showcases)
    .map(([path, raw]) => parsePlaybook(unwrap(raw), unwrap(benchFor(path)), evidenceFor(path)))
    .filter((p): p is Playbook => p !== null)
    .map((p) => ({ ...p, rank: rankOf(p) }))
    .sort((a, b) => edgeRank(b) - edgeRank(a) || a.title.localeCompare(b.title));
}

/** A JSON module arrives as `{ default: … }` from the glob; a test may hand the value itself. */
function unwrap(value: unknown): unknown {
  return isRaw(value) && "default" in value ? value.default : value;
}

export function edgeRank(p: Playbook): number {
  return p.edge.difficulty * p.edge.usefulness;
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

// Lazy on purpose: the hundred playbooks, their benches and their evidence are about 2.7 MB of JSON,
// and nothing needs them to draw the first frame. `loadShipped` fetches them when a depth or the
// surface's totals ask (`stores/playbooks.ts`); `lib/playbooks.shipped.ts` is the eager copy a test
// or a fixture reads synchronously, and nothing in the running app imports it.
const SHOWCASES = import.meta.glob("../../../../playbooks/*/playbook.json");
const BENCHES = import.meta.glob("../../../../playbooks/*/bench.json");
const EVIDENCES = import.meta.glob("../../../../playbooks/*/evidence.json");
// The bench's ranking (ADR 0056, 0213): one file, fetched with the rest.
const RANKING = import.meta.glob("../../../../playbooks/ranking.json");
// The storyboard stills (ADR 0096, 0137): five small WebPs a playbook, as URLs. Eager on purpose
// (ADR 0213): a still's URL is a string, so there is nothing to fetch for it; a lazy entry put a loader
// and a chunk per still into the first frame to fetch that string, and the image itself is only fetched
// where a story draws it. No thumbnail is globbed: it is retired, so a build does not carry it. A
// build with none — the stills not yet captured — is an empty glob, and every story reads [].
const STORIES = import.meta.glob<string>("../../../../playbooks/*/story/*.webp", {
  eager: true,
  query: "?url",
  import: "default",
});

/** Await every module a lazy glob names, keeping its path as the key. */
async function resolved(glob: Record<string, () => Promise<unknown>>): Promise<Record<string, unknown>> {
  const entries = await Promise.all(Object.entries(glob).map(async ([path, load]) => [path, await load()] as const));
  return Object.fromEntries(entries);
}

/** What this build ships, fetched on demand. The film plays only where the dev server serves `evidence/`. */
export async function loadShipped(): Promise<readonly Playbook[]> {
  const [showcases, benches, evidences, ranking] = await Promise.all([
    resolved(SHOWCASES),
    resolved(BENCHES),
    resolved(EVIDENCES),
    resolved(RANKING),
  ]);
  return loadPlaybooks(showcases, benches, evidences, import.meta.env.DEV, STORIES, Object.values(ranking)[0]);
}

/** Whether the evidence films the bench run it is filed against, or an earlier one. */
export function evidenceCurrent(p: Playbook): boolean {
  return p.evidence !== null && p.bench !== null && p.evidence.benchRunAt === p.bench.runAt;
}

/** "1:12" from seconds. */
export function clock(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

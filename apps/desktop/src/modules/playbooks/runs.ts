/**
 * The runs behind a verdict — ADR 0128, README section 14.
 *
 * The badge says "beat its bar in 2 of 3 test runs"; this is the record it stands on. `runsBehind`
 * lists every run a bench.json holds, newest first, and marks each counted or left out by exactly
 * the rule `comparableRuns` pools by (the latest, and every earlier line under its key that no
 * rescore replaced), so the counted rows always number `bench.runs.n`. A row left out says why.
 * `worstOf` says what the badge's one sentence leaves out: how many counted runs fell short and
 * what the worst of them filed. Traps a line never counted stay unmeasured ("–"), never 0.
 *
 * Pure, and imported only by the topic page, which is already a lazy chunk: the first frame does
 * not carry it.
 */
import type { Bench, VerdictWord } from "@/lib/playbooks";

export interface RunRow {
  runAt: string;
  model: string;
  verdict: VerdictWord;
  found: number;
  eligible: number;
  falseClaims: number;
  /** `null` when the run's line did not count traps. */
  trapsFiled: number | null;
  /** What the row shows for traps: the count, or "–" when unmeasured. */
  traps: string;
  /** The run's own note on what changed; "" when it said nothing. */
  note: string;
  latest: boolean;
  counted: boolean;
  /** Why it is left out of the count; "" when counted. */
  why: string;
}

export interface Worst {
  /** Counted runs that fell short, of how many counted. */
  shortIn: number;
  of: number;
  /** What the worst counted run filed: the one with the most false claims and traps. */
  falseClaims: number;
  trapsFiled: number;
  /** The line the badge leaves out; "" when every counted run was clean and none fell short. */
  words: string;
}

export const NOT_COMPARABLE = "an earlier world, command or scorer: not comparable";
export const BEFORE_KEYS = "benched before runs were keyed";

const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? "" : "s"}`;

/** Every run `bench` holds, newest first, each counted or not by ADR 0128's rule. */
export function runsBehind(bench: Bench): RunRow[] {
  const row = (r: Omit<RunRow, "traps">): RunRow => ({ ...r, traps: r.trapsFiled === null ? "–" : String(r.trapsFiled) });
  const latest = row({
    runAt: bench.runAt,
    model: bench.model,
    verdict: bench.verdict.word,
    found: bench.found,
    eligible: bench.eligible,
    falseClaims: bench.falseClaims,
    trapsFiled: bench.trapsFiled,
    note: bench.note,
    latest: true,
    counted: true,
    why: "",
  });
  const earlier = [...bench.history]
    .reverse()
    // The rescored run's own line is the latest, scored the old way: no row of its own.
    .filter((h) => !(bench.rescoredAt && h.runAt === bench.runAt))
    .map((h) => {
      const why = !bench.comparable
        ? BEFORE_KEYS
        : h.supersededAt
          ? h.supersededAt === "unknown"
            ? "replaced by a rescore"
            : `replaced by the rescore of ${h.supersededAt.slice(0, 10)}`
          : h.comparable !== bench.comparable
            ? NOT_COMPARABLE
            : "";
      return row({
        runAt: h.runAt,
        model: h.model,
        verdict: h.verdict,
        found: h.found,
        eligible: h.eligible,
        falseClaims: h.falseClaims,
        trapsFiled: h.trapsFiled,
        note: h.note,
        latest: false,
        counted: !why,
        why,
      });
    });
  return [latest, ...earlier];
}

/** What the counted runs hold that the badge does not say. */
export function worstOf(counted: readonly RunRow[]): Worst {
  const shortIn = counted.filter((r) => r.verdict === "short").length;
  const harm = (r: RunRow) => r.falseClaims + (r.trapsFiled ?? 0);
  const worst = counted.reduce<RunRow | null>((w, r) => (w === null || harm(r) > harm(w) ? r : w), null);
  const falseClaims = worst?.falseClaims ?? 0;
  const trapsFiled = worst?.trapsFiled ?? 0;
  const filed = [falseClaims ? plural(falseClaims, "false claim") : "", trapsFiled ? plural(trapsFiled, "trap") : ""]
    .filter(Boolean)
    .join(" and ");
  const of = counted.length;
  const words =
    shortIn || filed
      ? [
          shortIn
            ? `${shortIn} of ${of} counted run${of === 1 ? "" : "s"} fell short`
            : of === 1
              ? "The counted run did not fall short"
              : `None of ${of} counted runs fell short`,
          filed ? `the worst filed ${filed}` : "",
        ]
          .filter(Boolean)
          .join("; ")
      : "";
  return { shortIn, of, falseClaims, trapsFiled, words };
}

/** "2026-10-22 09:07" from a run's ISO time. */
export const whenOf = (runAt: string): string => runAt.slice(0, 16).replace("T", " ");

const RESULT: Record<VerdictWord, string> = { exceeds: "beat its bar", meets: "met its bar", short: "fell short" };

/** A row's figures in one line: "fell short · 6 of 7 found · 1 false claim · traps 1". */
export function rowLine(r: RunRow): string {
  return [RESULT[r.verdict], `${r.found} of ${r.eligible} found`, plural(r.falseClaims, "false claim"), `traps ${r.traps}`].join(" · ");
}

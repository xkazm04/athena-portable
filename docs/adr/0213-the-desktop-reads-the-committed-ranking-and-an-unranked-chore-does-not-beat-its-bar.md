# 0213. The desktop reads the committed ranking, and an unranked chore does not beat its bar

Date: 2026-10-25

Builds on ADR 0056 (how the best use of Athena is ranked), ADR 0128 (comparable runs) and ADR 0195
(the append-only run ledger). Touches ADR 0095 (the shipped set is fetched on first ask).

## Context

The bench writes `playbooks/ranking.json` by ADR 0056's method, deterministically, and
`rank --check` in the non-provider pytest suite holds the committed file to the committed
`bench.json` files. The desktop never read it. It worked out three of the ranking's facts a second
time in TypeScript, and they already disagreed:

- **The year.** `annualValue` multiplied a month by 12 and a week by 52 and read a quarter as one, so
  grant-drawdown-reporting was worth $2,500 a year on the ledger and $10,000 in the ranking.
- **The run pool.** `comparableRuns` copies ADR 0128's rule over the window `bench.json` holds; the
  ranking also checks the key against today's files and, since ADR 0195, pools the whole ledger.
- **The standing.** `verdictOf` worded the badge from the latest run's word alone. cpg-deductions
  read "Beats its bar" (2 of 3, "no false claims") although one counted run filed a false claim and
  a trap; clinic-denials read "Beat its bar in 2 of 4" while the method excludes it as short in 2 of
  4 comparable runs. Two figures on the person's screen were contradicted by the measure that ranks
  the chores.

## Decision

1. **The ranking is the source of the year, the pool and the standing.** `parseRanking` sits beside
   `parseBench` and reads as leniently: garbage is an empty map, a row without a playbook id is
   dropped. The lazy loader and the eager test copy glob `ranking.json` with the rest; each
   `Playbook` carries `rank: Rank | null`.
2. **A ranking of an older run is never borrowed.** A ranked row attaches only when its
   `bench.run_at` is the run the playbook's `bench.json` holds. A row the method leaves out names no
   run and attaches by id; `rank --check` keeps it current with the committed benches.
3. **Today's derivation is the fallback, not a second opinion.** `annualValue` reads
   `rank.annualUsd`, else ADR 0056's period table (year 1, quarter 4, month 12, week 52, anything
   else once); `isYearly` now counts a quarter as a span of time. `verdictOf` counts `rank.runs`,
   else `bench.runs`. With every rank null the desktop says exactly what it said before.
4. **An unranked chore reads "Not ranked" with the ranking's why**, in the warning tone, unless its
   latest run fell short, which already says as much ("Falls short" stays). The sentence goes on to
   say what the latest run did, so the run is not hidden, only no longer called a pass.
5. **The totals agree.** `totals.exceeds` counts a latest-exceeds only when the ranking does not
   leave the chore out, and `totals.ranked` counts the placed ones.
6. **The stills are eager URLs.** To keep the first frame from growing, the storyboard glob is eager:
   a still's URL is a string with nothing to fetch, and the lazy form put one loader and one chunk
   per still (about 475) into the first frame to fetch that string. The images themselves are still
   fetched only where a story draws them.

## Consequences

- The ledger's year, the verdict badge and the "beat their bar" count agree with the ranking the
  bench publishes, and parity tests over the shipped set fail if they drift: every ranked
  playbook's `annualValue` equals `rank.annualUsd` and its `bench.runs` equals `rank.runs`.
- A later change to the period table, the pool or the exclusion rule reaches the desktop through the
  file, with no TypeScript edit.
- The first frame is about 1.8 kB gzipped smaller (165,398 B to 163,563 B on the run's base): the
  ranking's parse and the standing cost about 390 B, the eager stills save about 2.2 kB. The
  stills' 475 URLs are built when the module loads, a few hundred `new URL` calls.
- `comparableRuns` stays as the fallback for an invented fixture or a stale row; it is no longer
  the desktop's word on a ranked chore.

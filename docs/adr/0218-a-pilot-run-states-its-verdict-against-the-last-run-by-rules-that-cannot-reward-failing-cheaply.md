# 0218. A pilot run states its verdict against the last run, by rules that cannot reward failing cheaply

Date: 2026-10-25

Extends the live pilot of `/open verify` level 2 (`apps/desktop/e2e/support/pilot.ts`, first user
`e2e/shadowrunr/shadowrunr.live.e2e.test.ts`).

## Context

The live pilot exists to answer a comparative question: did this change to an app's exposure (its
orient tools, descriptions, catalogue) make Athena orient faster and spend her turns on content?
Every run wrote a careful `out/<stamp>/report.{json,md}`, but only of itself, and `out/` already
kept every earlier run on disk. An operator answered the question by opening two markdown files
and diffing a table by eye, where a cheaper run that got cheaper by failing reads as an
improvement.

## Decision

1. **The live test finds its baseline once**: `previousReport(outRoot, stamp)` returns the newest
   `out/<stamp>/report.json` whose stamp sorts before this run's (ISO stamps sort as strings),
   skipping a folder whose report is missing or unparseable. No baseline, no comparison: the
   report is byte-identical to the single-run report.
2. **`comparePilot(prev, curr)` is a pure function over two CaseReport sets**, tested over recorded
   fixtures (`e2e/support/pilot.e2e.test.ts`); the live run is never needed to test it.
3. **A regression outranks any efficiency gain** (eval-harness, failure-signatures-beside-the-pass-
   rate): a case that lost `ok`, or that names an unknown tool it did not name before, is
   `regressed`, listing the new failure strings and tool names, and any regressed case makes the
   run `worse`. Otherwise a case is `better`/`worse` by its calls before content (or `better` when
   it regained `ok`), and the run is `better` or `worse` by which kind outnumbers the other,
   `same` on a tie.
4. **Cost and turn deltas are outcome-conditioned** (eval-harness, outcome-conditioned-cost): they
   are summed only over cases ok in both runs; a case that failed in either is shown with its cost
   but no delta, and the summary says `cost over N of M cases`.
5. **Case sets that differ are named, never averaged**: a case only in this run is `new`, only in
   the last is `gone`; neither enters a delta, and the summary line names them.
6. The report opens with the one-word verdict on the first line under the title, then a
   `## Since <prev stamp>` table (case, verdict, before-content, turns, cards, cost deltas) above
   the usual summary table; `report.json` carries the same object under `comparison`.

## Consequences

- An operator re-running the pilot reads one word to know whether a change helped, and sees which
  case regressed and why. Any later app's pilot inherits it: pilot.ts is app-agnostic.
- The baseline is "the newest earlier run on this machine", not a pinned golden run; comparing
  against a chosen run means deleting or moving newer folders. A pinned baseline can be added
  later as an argument to `previousReport` without changing the comparison rules.
- Live-model runs are noisy; one run against one run says "this pair differed", not "the change
  is proven". The verdict is a reading aid for the operator, never a gate.
- A flush mid-run compares the cases finished so far, so the cases not yet run read `gone` until
  the final flush.

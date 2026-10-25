# 0195. A playbook's runs are an append-only ledger, and bench.json is its view

Date: 2026-10-25

Amends [0128](0128-a-playbook-is-ranked-on-its-comparable-runs-and-a-rescore-appends.md) (its
"bounded by HISTORY" consequence) and follows
[0129](0129-follow-through-is-proved-across-an-answer-a-restart-and-a-second-run.md) for the
follow-through results. README section 14; `docs/features/playbooks.md`, "Files" and "Ranking".

## Context

ADR 0128 ranks a playbook on every comparable run, but the pool was whatever survived
`bench.json`'s history window: the latest run and twelve earlier headlines (`HISTORY`). A rescore
appended its correction as one of those twelve lines, so a correction pushed a real run out, and
the fourteenth run of a playbook silently dropped the first from the ranking and from the
narration's "n test runs". Follow-through already kept its runs the other way, append-only with
corrections beside them and the newest correction winning (`followthrough.runs.json`), with its
own copy of read, append, correct and tally. Two rules for one kind of record, and the bench's
was the one that drops records to make room - which the registry's audit-logging standard
(append-only design: a record is never dropped to make room, a correction refers to what it
corrects) does not allow.

## Decision

One module, `athena.proving.playbooks.ledger`, is the only writer of run records:

- **The bench's ledger** is `playbooks/<id>/bench.runs.json`: `{playbook, runs, corrections}`.
  Each bench run appends its headline. A rescore of a run the ledger holds appends a correction
  `{rescored_at, run_at, note, was, now}` and never a run. The newest correction for a run wins.
- **`bench.json` is a view**, derived after each write: the latest run's summary (unchanged
  fields, so the desktop's reader is unchanged), the last `HISTORY` earlier runs as their newest
  correction says plus each correction of the latest run as a `superseded_by` line (0128's form),
  and a `pool` block `{key, n, exceeds}` computed over the whole ledger. `HISTORY` now bounds the
  view only, never the pool.
- **Follow-through's file is written by the same module**, its format byte for byte unchanged:
  follow-through supplies the leading fields (key and tally) and the mark of a run (run, branch,
  repeat); the ledger appends and corrects.
- **One pooling rule**, `ledger.comparable_runs`, over the ledger when one exists and over
  `bench.json`'s window otherwise. Loaders (`rank.load_entries`, the evidence reader,
  `ledger.view`) put the ledger's records on the in-memory bench under `ledger`, so the ranking
  and the narration stay pure functions of what they are handed; that key is never written.
- **No migration.** A playbook benched before the ledger has none and reads as before. Its first
  bench seeds the ledger from the window it held (each run once, its newest line), so no run is
  lost; the committed library and `ranking.json` do not change until a playbook is benched again.

There is no hash chain on the lines: an edit in place is caught by review of the committed file's
diff, the same as every other committed record in the library.

## Consequences

- The ranking and the narration stand on every run ever benched under the key; `bench --runs k`
  can be run as often as the measurement needs, and a rescore costs nothing.
- Two run-record implementations are one; follow-through's tally reads the ledger's
  newest-correction rule.
- `bench.runs.json` is a new committed file per benched playbook and grows without bound, one
  short line per run. At a few hundred bytes a line that is cheap for years of benching.
- Two runs with the same `run_at` (only possible inside one second, as in tests) share a mark: a
  correction to one applies to both. Real runs take minutes.
- A rescore of an earlier run (not the latest) corrects that run in the ledger and leaves
  `bench.json` on the latest run; before, it became the latest and duplicated the run.
- The desktop still pools from `bench.json`'s window (`comparableRuns` in
  `apps/desktop/src/lib/playbooks.ts`), and so does `chores_uat.numbers.comparable_runs`; both can
  read the `pool` block instead. Until they do, a playbook with more than thirteen runs shows a
  smaller n there than in the ranking.

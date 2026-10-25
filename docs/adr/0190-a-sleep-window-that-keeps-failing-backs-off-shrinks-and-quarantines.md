# 0190. A sleep window that keeps failing backs off, shrinks its take, and quarantines one episode

Date: 2026-10-25

Amends [0143](0143-each-pc-knows-its-room-and-sleeps-on-what-it-wrote.md) decision 2 (the fixed
1 h `failed_recently` backoff) and its compress phase.

## Context

A failed compress leg writes nothing and leaves the boundary where it was, so the next cycle
re-reads the same window. That is right for one failure and wrong for the tenth. Admission
re-measured the window, admitted it on pressure or staleness, and ran the same 120-episode,
30,000-character leg over the same episodes after exactly `FAILED_BACKOFF_H = 1` h, forever. An
episode that reliably makes the leg time out or answer unparseably (a huge pasted log, a body that
triggers a refusal) is a poison message: each hour cost a 300 s model call and a ledger row, and
nothing after that episode was ever distilled. The leg's failure class was flattened into a
sentence (`legs._failure`), so nothing downstream could tell "the CLI is missing" from "this window
is bad".

The registry's background-jobs *tick-isolation* (consecutive failures per loop: escalating backoff,
then a loud quarantine; a success resets) and retry-backoff *error-classification-for-retry* (only
content-shaped failures shrink the work) name the move.

## Decision

1. **The failed row says why and how much.** A failed cycle's `stats_json` carries `failure` (the
   door's `error_reason`: `timeout`, `parse_error`, `engine_error`; `error` for a cycle that
   raised) and `take` (episodes sent). No schema change.
2. **Failures in a row are counted from the rows.** `SleepBook.failures_since_settled()` reads the
   failed rows since the newest settled (`completed` or `partial`) one, newest first, at most
   `FAILED_RUN_ROWS = 64`. The boundary moves only when a cycle settles, so every one of them failed
   over the same window; there is no boundary string to compare (the first window's boundary is a
   moving instant). A `running` row is never counted, as 0143 already holds for admission.
3. **The backoff doubles.** `failed_recently` holds `FAILED_BACKOFF_H * 2^(n-1)` hours after the
   newest of `n` failures, at most `FAILED_BACKOFF_CAP_H = 24`. One failure reads as before; a run
   says "N cycles in a row" and its cause. A person's force still skips it.
4. **A content failure halves the take.** After a `parse_error` or `timeout`, the next cycle takes
   at most half the newest such failure's take (at least one episode), forced or not. An
   `engine_error` says nothing about the material and never shrinks it. A smaller take that works
   settles `partial` and the rest waits for the next cycle.
5. **One episode that fails alone twice is walked past, not deleted.** When two content failures in
   the run had a take of one, the next cycle makes no leg call, settles `partial` with the boundary
   past that episode, counts `skipped`, and journals its id under "Skipped". The episode is parked:
   its file, its index row and its importance are untouched, recall still finds it, and it is only
   not distilled. Nothing un-skips it automatically; a person can still bring the fact back by
   saying it again.
6. **A settled cycle resets everything**: the count, the backoff and the take.

## Consequences

- A poison episode can no longer stop consolidation on a PC for good; at worst it costs eight failed
  cycles (120 halved down to 1, then once more) spread over growing backoffs.
- An absent CLI stops costing a ledger row every hour: 1, 2, 4, 8, 16, then 24 h.
- The person reads "failed 4 cycles in a row (the model could not be run); trying again after 8 h"
  instead of the same one-hour sentence.
- A halved take finishes `partial` more often while a window is being isolated; that is the honest
  status, since the rest waits.
- Rollback: reverting the commit restores the fixed hour; the extra keys in `stats_json` are
  ignored by the old code.

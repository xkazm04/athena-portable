# 0130. A chore's last run stays out of the next run's prompt

Date: 2026-10-22

Supersedes decisions 2 and 3 of [0126](0126-the-second-run-starts-where-the-last-stopped.md) (the
daemon hands the case's last receipt to the composer, and a "Since last run of this chore" frame
block lists it) and the `--no-carry` arm of its decision 5. Keeps its decisions 1 (`case_id` on
the turn, routing nothing) and 4 (the gate's dated "you approved this exact call"), and the
two-run bench. Also retires the clause of [0127](0127-a-cases-turns-keep-their-conversations-and-are-stamped-under-it.md)'s
consequences that names the block as one of the things that carries across tabs.
`docs/features/playbooks.md`, "An old yes is dated on the card".

## Context

ADR 0126 put a case's last receipt in front of its next run: a fenced, bounded frame block of the
calls run 1 filed, the expired and unconfirmed ones first, then the approved and declined, each
with its key parameters and date. The idea was that run 2 would not ask again for what run 1
already did. It was shipped to be measured before it was relied on.

The two-run bench measured it on 2026-10-22: `bench <id> --second-run [--no-carry] --model sonnet
--cap 8`, one run per arm (n=1), $29.99 in all, on five playbooks. Run 2's cards for items run 1
had already filed (duplicates of run 1), without the block and with it:

| Playbook | Without | With |
|---|---|---|
| freelancer-receivables | 0 | 0 |
| lien-desk | 2 | 7 |
| change-order-notices | 2 | 5 |
| customs-protests | 2 | 2 |
| duty-drawback | 0 | 0 |
| **Total** | **6** | **14** |

The block made re-filing worse on two playbooks and better on none. One draw per arm is not a
distribution, but the direction is the opposite of the intent, and a mechanism fits it: a list of
approved calls with their parameters reads as a work list, and the model files from it. Without
the block run 2 is not memoryless either: since ADR 0127 every tab keeps its own conversation on
one brain, and recall already brings run 1's episodes into run 2's tabs. The block cost up to
about 4,000 characters on every turn of the run for that.

The gate's half of ADR 0126 is a different thing. It does not reach the model's prompt: it is the
line on the card a person reads before she approves ("You approved this exact call on Oct 2 at
14:02 and it may already have run."), and it only informs.

## Decision

1. **No receipt reaches the prompt.** The composer has no `since_last_run` argument and no
   `frame.since_last_run` block; `core/prompt.py`, `lane/turn_frame.py` and `lane/browser_lane.py`
   are as they were before ADR 0126. `SinceLastRun`, `SINCE_LIMIT`, the block's budget,
   `receipts.carry_forward` and its line formatting are removed.
2. **The daemon hands in only where the last run began.** `AthenaDaemon.last_run_started` (was
   `last_run`), bound by wiring to `CaseBook.last_run_started`, answers a case id with the ISO
   start of the case file's last stored receipt (`receipts.run_started`: its window start, or its
   first activity for a case's first run), or `None`. `routes.last_run_of` is still the one call
   site and still turns an unreadable case file into `None`; `turn_events` sets
   `TurnContext.spent_since` from it and passes nothing else to the lane.
3. **The dated card line is unchanged** (ADR 0126 decision 4): under a case with a stored run the
   gate looks back to that run's start, never less than a day, and names the date; outside one it
   is the day-long lookback and the clock time. `case_id` on `POST /run` stays, as ADR 0127's
   stamp needs it as well.
4. **The two-run bench stays, as the instrument.** `bench <id> --second-run` runs as before, minus
   the carry: run 2 is a fresh Athena on run 1's brain with its gate bound to run 1's start, as
   the product's is, and nothing of run 1 in its prompt. `--no-carry` is **kept as a no-op that
   says so** ("--no-carry changes nothing since ADR 0130 ...") rather than dropped, so the command
   recorded above still runs and an old script does not fail on an unknown flag. The report keeps
   `"carry": false`, drops `carried` and adds `spent_since`; its directory is
   `second-run-<id>`.

## Consequences

- Run 2's prompt is what it was in the measured baseline arm. The one difference from that arm is
  the gate: the baseline ran with nothing bound, so its cards said only the clock time; now they
  carry the date. Run 2 follows run 1 within minutes on the bench, so the lookback reaches the same
  approvals either way; only the line's wording differs. A bench run after this commit is comparable with the 2026-10-22 baseline arm, not
  with its carry arm.
- What does keep run 2 from re-filing is not settled. Six duplicates over five playbooks without
  the block is the number to beat; the next lever is measured with the same `--second-run`
  bench, baseline first, before it ships.
- A receipt is still written and read: `GET /adopt/cases/<proj>/runs`, the case file's "Your
  runs" section and `CaseBook.receipts` are untouched (ADR 0124, ADR 0127). Only its trip into the
  prompt is gone.
- `receipts.of_cards` stays: the bench builds run 1's receipt from its cards, and the gate's
  lookback start is read from that receipt.
- Tests: `tests/daemon/test_case_runs.py` (a turn under a case with a stored receipt composes no
  "Since last run" text and none of the receipt's cards, while its card says "You approved this
  exact call on <day> at <time>" for a yes 20 days old; under a `project_id` alone the same; under
  no case, a 20-day-old yes says nothing and one inside the day is the clock-time line),
  `tests/adopt/test_receipts.py` (`run_started`, `CaseBook.last_run_started` reads the latest
  receipt), `tests/proving/test_playbooks.py` (the fake two-run bench: no frame holds the receipt,
  run 2's two duplicates counted, `spent_since` reported; the CLI with and without `--no-carry`,
  the note printed only with it). The block's tests in `tests/core/test_prompt.py` are removed with
  it; `tests/harness/test_ports.py` (the dated line at the gate) is unchanged.

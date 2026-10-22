# 0126. The second run starts where the last stopped

Date: 2026-10-22

Follows [0124](0124-your-runs-come-back-to-the-chore.md) (a case's runs come back to it as
receipts kept in its file), [0123](0123-an-approved-brief-is-a-case-file-in-the-brain.md) (a case
is `goals/<proj>.md`) and [0101](0101-a-timed-out-write-is-outcome-unknown-and-a-late-answer-is-heard.md)
(a card for a call that may already have run says so). `docs/features/playbooks.md`, "The next run
starts where the last stopped".

## Context

A chore is a case that runs again: the same invoices chased next month, the same claims checked.
The receipt of the last run is on disk, but nothing put it in front of the next one, so run 2
starts as if run 1 never happened and can propose the same signature twice. The gate's "you
approved this exact call" line (ADR 0101) looks back one day, so a yes from three weeks ago, the
last run of a monthly chore, is never mentioned on the card that would repeat it.

Routing a case's turns into one `conv_proj_<hex>` conversation (ADR 0124) proved costly at the
gate's bench, and the turns are to stay in each tab's own conversation. So nothing here may depend
on the conversation a turn lands in: the case is named on the turn, not derived from where it went.

## Decision

1. **The case rides the turn, apart from its conversation.** `TurnContext.case_id` is the case a
   turn is a run of: `POST /run`'s new `case_id` (a `proj_` id; anything else is refused 400), or
   its `project_id` when only that is sent (the voice path). It routes nothing. Everything below is
   keyed on it, never on `conv_proj_…`.
2. **The daemon hands the last run in; the core reads no case file.** `AthenaDaemon.last_run`, bound
   by wiring to the case book (`CaseBook.last_run`), answers a case id with the core's
   `SinceLastRun` (`core/prompt.py`) built from the case file's **last** stored receipt
   (`receipts.carry_forward`), or `None`. `routes.last_run_of` is the one call site; an unreadable
   case file is no block, never a failed turn. `turn_events` passes it through the lane to the
   composer, so a typed and a spoken turn get the same frame.
3. **A "Since last run of this chore" frame block** (`frame.since_last_run`, after the project),
   only when there is a receipt. Lines in this order: cards that expired or were still waiting
   when the run closed, calls that may have completed, then approved cards (saying when one was
   not let through), then declined ones; each names its action, at most three key parameters (cut
   to 60 characters, `(+N more)`) and a date. At most 16 lines, `(showing N of M)` where M is every
   card and note the receipt counted. The lines are inside the turn's nonce fence: a card's
   parameters and a note's text came from pages. The heading text says where they came from and
   asks her to compare them with the pages; it names keys and dates only and never tells her to
   leave anything out. Deciding is still hers, and blocking is still the gate's.
4. **The gate's lookback reaches the last run.** For a turn whose case has a receipt, the daemon
   sets `TurnContext.spent_since` to where that run began (the receipt's window start, or its first
   activity for a case's first run). `_may_have_run` then looks back to it, never less than a day
   (`SPENT_AT_LEAST`, held equal to `SPENT_LOOKBACK` by a test), and the line carries the date:
   "You approved this exact call on Oct 2 at 14:02 and it may already have run." With no case or no
   receipt it is today's line exactly: a day, the clock time. It still only informs; nothing is
   refused on it.
5. **A two-run bench.** `bench <id> --second-run` mints one case id and sends it as `case_id` on
   every turn of both runs (no `project_id`; each portal keeps its own conversation). Run 1
   approves every card; its cards become a receipt (`receipts.of_cards`, the cards read back by id
   from the approval table). The Athena then restarts on the same brain, so run 2 is a fresh
   session with the same approval table and episodes, as a run a month later is. With the carry,
   the case's last run is that receipt; `--no-carry` is the baseline. Run 2 is scored with run 1's
   found items as seen: a card for one is a `duplicate` with `of_prior`, and the score adds
   `duplicates_of_prior` and recall on the items run 1 left. The verdict is `meets` with no
   duplicate of run 1, recall on the rest at the playbook's own bar (none when nothing was left),
   no more false claims than it allows and no error. The report is written; `bench.json` is not.

## Consequences

- A chore's second run is told what the first one asked, approved, declined and could not confirm,
  and a repeated signature's card says when the first one was given, weeks back.
- The block costs up to about 4,000 characters per turn under a case with a receipt, on every
  turn of the run. Measured by the two-run bench before it is relied on; the paid gate is ten
  playbooks, baseline first.
- Under per-tab conversations the same brain recalls run 1's episodes into run 2's tab, so the
  baseline is not memoryless; the bench's two arms differ only by the carry, which is the point.
- The receipt is the last one only. A run that closed with nothing in it writes no receipt
  (ADR 0124), so the block always describes the last run that did something.
- `case_id` is also what a later change will record each turn under, so receipts can be joined by
  turn rather than by conversation; until then `fold` still reads `conv_proj_…`, and a turn sent
  with `case_id` alone is in no receipt `done` folds. That join is the follow-up's.
- Tests: `tests/core/test_prompt.py` (block only when given, fenced, bounded, no "skip"),
  `tests/adopt/test_receipts.py` (order, keys, dates, totals, the last receipt),
  `tests/harness/test_ports.py` (a 20-day-old yes dated under a case, silent outside one),
  `tests/daemon/test_case_runs.py` (the whole path over HTTP, `case_id` routing nothing),
  `tests/contracts/test_registry.py`, `tests/proving/test_playbooks.py` (the fake two-run bench
  with and without the carry, the CLI flags).

## Amended 2026-10-22

By [0127](0127-a-cases-turns-keep-their-conversations-and-are-stamped-under-it.md). The follow-up
named above landed: every turn with a `case_id` is stamped under its case and `fold` joins by turn
id, so a turn sent with `case_id` alone is in the receipt `done` folds. A run's start is its first
turn's, so the gate's lookback starts there.

## Amended 2026-10-22

By [0130](0130-a-chores-last-run-stays-out-of-the-next-runs-prompt.md). Decisions 2 and 3 are
reversed: the two-run bench (`--second-run`, sonnet, n=1 per arm, $29.99) counted run 2's
duplicates of run 1 at 6 without the "Since last run of this chore" block and 14 with it, over
five playbooks (lien-desk 2 to 7, change-order-notices 2 to 5, the other three unchanged). The
block is gone from the composed prompt and the lane; the daemon now hands in only where the last
run began (`AthenaDaemon.last_run_started`), for decision 4, which stands with decision 1. The
bench of decision 5 stays; `--no-carry` is a no-op that says so. The first consequence ("a
chore's second run is told what the first one asked ...") and the block's cost no longer hold.

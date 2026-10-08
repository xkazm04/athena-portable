# 0049. A recall carries three page reads' worth

Date: 2026-10-08

Amends `core/catalog.py` (the `READ` cap, README §3.3). Found by the playbook bench (ADR 0040).

## Context

Every `READ` answer is capped at 1,600 characters before it becomes a system episode, and the cut
is announced. For a page read that bound is right: one page, one answer, and a world whose page
is longer gets paged (`check` now fails on one). `core.recall` shared the same cap, and it is a
different kind of answer. It returns several episodes, each already the excerpt of a capped
read. Work across tabs runs on recall, because a turn is pinned to one origin (ADR 0045).

In the third freelancer-receivables run, the recall she ran in Gmail to bring back what she had
read in QuickBooks, Chase and Ariba came back as "showing 1600 of 3074". The cut fell through the
second episode, and the contract terms she needed were past it. She said, correctly, that the
answer was cut off, and held the demand.

## Decision

`core.recall` declares its own cap, `RECALL_CAP = 4800`: three page reads' worth. The cut is
still the catalog's, still announced with `(showing N of M)`, and still bounded well inside the
frame's tool-results budget (12,000 characters, ADR 0043). Page reads keep 1,600.

## Consequences

- A recall that spans the tabs of a cross-portal chore brings back each tab's read whole, as a
  rule, instead of the first one and a half.
- A turn whose results include a full recall leaves less of the 12,000-character budget for page
  answers; the budget still decides what is shown, newest first (ADR 0043).
- `tests/core/test_catalog.py` pins the two caps, and `tests/e2e/test_reads.py` drives a recall
  past 4,800 characters and checks the announced cut.

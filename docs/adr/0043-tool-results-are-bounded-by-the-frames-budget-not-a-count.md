# 0043. Tool results are bounded by the frame's budget, not a count

Date: 2026-10-07

Refines the turn frame of [0006](0006-two-output-prompt-composer.md) (README §2 invariant 4).
Found by the clinic-denials playbook (ADR 0040).

## Context

The turn frame's tool-results block rendered at most eight of last turn's results, newest last,
and announced the cut. The block also had a character budget, 12,000, which a count of eight
rarely approached. Working a denial worklist, Athena read twelve short pages in one turn (a list
page, seven claims, four encounters); the frame showed the last eight and "(showing 8 of 12)".
She said, honestly, that "three claim reads didn't reach me" and spent the next turns asking for
them again — each re-read a round trip, a ledger row's worth of tokens, and a turn that did
nothing else.

## Decision

The block shows as many of last turn's results as fit its character budget, newest last, with a
ceiling of 32 so a pathological turn stays bounded. A result never truncates another: the block
stops before the first one that would not fit, and announces `(showing N of M)` as before.

## Consequences

- Twelve short reads are twelve results in the next frame. Long results stop where the budget
  does, which is what the budget was for.
- The number of results shown is no longer a constant a reader can quote; the footer on the block
  is the number, as everywhere else in the prompt.
- Test: twelve short results are all shown; twelve long ones keep the newest and stay under the
  budget.

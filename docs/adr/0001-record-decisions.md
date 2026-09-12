# 0001. Record decisions as ADRs in this directory

Date: 2026-09-12

## Context

`README.md` is the solution and architecture review this build executes against, and the
chronology lives in the reference repository. Neither is amended per commit. But this build makes
choices the README does not settle — a class boundary, a wire shape, a lifecycle rule — and a
reviewer reading the code six commits later has no way to reconstruct why, short of git archaeology.

A rewrite of the README for every such choice is too large a unit; a comment in the code is too
small and travels only with the file that holds it.

## Decision

Every decision a later reader could reasonably question is recorded here as
`docs/adr/NNNN-<slug>.md`, numbered sequentially, with three sections: Context, Decision,
Consequences. The ADR lands in the same commit as the code it explains, and the commit body names
it. An ADR is never edited to reverse itself; a reversal is a new ADR that supersedes it by number.

## Consequences

The commit stays the unit of review, and the "why" is reviewable with the "what". A reader can
reconstruct the design from `README.md` plus this directory without reading git history. The cost
is one short file per decision, which is the point: a decision too small to write down in five
lines was not a decision.

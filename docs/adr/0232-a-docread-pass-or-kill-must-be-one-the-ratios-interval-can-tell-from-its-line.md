# 0232. A docread PASS or KILL must be one the ratio's interval can tell from its line

Date: 2026-10-27

Refines the docread proof of the nvidia-revisit brief (README, "Nemotron reads a person's
documents"). Owner-approved 2026-10-27 (scan-sweep Lane C card).

## Context

`proof()` decided PASS / KILL / MIXED on the point ratio of two accuracies over about 90 paired
units. The report already printed each accuracy's Wilson interval (97f65ecb) but the verdict never
read it, so a ratio of 0.93 passed even when n could not tell it from 0.89. The eval-harness
standard says a ranking must first be earned: the honest output of a bench that cannot resolve a
difference is the tie.

## Decision

1. **An interval for the ratio.** A paired percentile bootstrap over units: a unit brings its VL
   and its Claude (correct, stated) counts together, 2000 draws from a fixed seed (so a verdict is
   reproducible), 2.5th and 97.5th percentiles. Units, not fields, are resampled because the
   fields of one document are not independent. `score_readers` now carries `unit_counts` for this.
2. **A fourth verdict, UNRESOLVED.** A PASS whose interval reaches below 0.90, or a KILL whose
   interval reaches 0.70 or above, reads UNRESOLVED. MIXED claims no side of a line and is left
   alone. The false-fact leg stays a point comparison; the interval is for the accuracy ratio.
3. **The report prints it**: the interval beside the ratio, and for UNRESOLVED the reason and that
   more units are needed. `proof` holds `accuracy_ratio_ci95` and `unresolved_because`.
4. **No per-unit counts, no interval.** Scores built without `unit_counts` keep the point verdict.

## Consequences

Rescoring run `20261022T195808Z` (the one the README quotes) gives ratio 0.9453 with a 95%
interval of 0.887 to 1.000: the verdict is UNRESOLVED, not PASS. The README and the submission
now say so. The lane's opt-in reader (ADR 0097) is unchanged; what changed is the claim. A run
that passes today may read UNRESOLVED until n grows, which is the point and the cost.

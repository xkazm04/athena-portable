# 0235. A tier pick is a ranking only when its margin beats the run-to-run noise

Date: 2026-10-27

Refines [0097](0097-adopting-a-playbook-is-a-conversation-held-outside-the-turn-lock.md) item 9
(the pick) and builds on [0145](0145-the-tier-bench-compares-paired-cells-of-one-bench-digest.md)
(the cells the pick reads). Owner-approved 2026-10-27 (scan-sweep Lane B card, proving-adopt-tiers:
"the tier pick ranks configs without checking the order beats run-to-run noise"). Registry:
`eval-harness`, `judgment-guardbands`.

## Context

The pick took the fastest p50 with a fixed 5 % band and `pick --write` rewrote `tiers.json` from
it. With two reps over nine scenarios, the p50s of neighbouring configs can sit inside each other's
run-to-run spread, so a draw could replace the incumbent.

## Decision

When the pick would replace the incumbent in `tiers.json` for `interview` or `audit`, its speed
margin (incumbent minus challenger, over the cells the pick ranked, ADR 0145) is held to a noise
band.

- **Estimator.** For each record the p50 of its ranked legs (first text for `interview`, rounds
  for `audit`) is a cell value. The band is the pooled standard deviation of those across reps
  within each (config, scenario) of the two configs compared: `sqrt(sum of squared deviations /
  df)`, `df` = sum of (reps - 1). It is read from the same records the pick ranks, no other run.
- **Margin <= band: `tie`.** The incumbent is kept, `changes()` is empty, `--write` writes
  nothing. The report and the `pick` line say `tie`, name the challenger that was ahead, and print
  the margin beside the band and its `df`.
- **`df` < 3 (`MIN_NOISE_DF`): `unresolved`.** The line reads "not enough runs to rank"; the
  incumbent is kept.
- **Margin > band: `ranked`.** The challenger is picked as before, and the line prints the margin
  against the band.

Not applied: an incumbent that is out of the run or hand-set (nothing to hold the challenger
against), a fallback pick, and `shape` (per-run wall time, no cell structure). The SD of one cell
is a conservative band for a difference of p50s over many cells; the owner chose conservative.
The 5 % usage tiebreak band is unchanged.

## Consequences

`tiers.json` changes only on an order the bench resolved; with the default two reps some current
picks become ties. More reps tighten nothing in the band but add `df`. No run directory is
committed (`proving-runs/` is ignored), so no committed pick is re-read; the two local runs on
disk predate the bench digest and are stale.

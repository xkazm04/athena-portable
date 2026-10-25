# 0216. A perf verdict is read beside a still control, and a noisy machine is inconclusive, not green

Date: 2026-10-25

Extends ADR 0089 (motion is transform and opacity, and speed is a gate, not a hope). No budget
changes: ADR 0089's five budgets stand, and so does its rule that only a later ADR moves them.

## Context

`pnpm perf:all` judged each scene alone and printed pass or FAIL. The gate already had the
instrument that tells a scene's red from the machine's, its still-page self-test, but it ran once
before any scene and never again, so a scene measured minutes later was judged with no reading of
the machine at that moment. A stabilize pass measured `perf:chores` red on 4 runs in 8 under load
while the same build, re-driven, was green 9 of 9, and asked for a decision that did not raise a
threshold. The five budgets were also judged alike, though three are read off the wall clock (frame
p95, dropped share, the longest task) and two are counts of work (frame loops per frame, frame
requests in the idle second) that a busy machine cannot change. And a green said nothing about how
close it was: a scene at 48 ms of a 50 ms budget read the same as one at 0.

## Decision

1. **Every scene is followed by a still control** in the same browser: the self-test's still page,
   measured right after the scene with the same probes.
2. **Three states, not two** (`verdict` in `scripts/perf-budgets.mjs`, pure):
   - `pass`: the scene is inside every budget.
   - `fail`: the scene missed a count of work; or it missed a wall-clock budget while the control
     was clean; or there is no control reading.
   - `inconclusive`: the scene missed only wall-clock budgets and the control missed one too. The
     scene's own failures are kept, and the line says what the control ran ("the machine, re-run").
3. **Inconclusive is not green.** Any scene that is not `pass` makes the run exit 1. Nothing is
   loosened; the verdict only stops claiming a cause it did not measure.
4. **No repeat-until-green rule.** A best-of-N or median rule would hide an intermittent real
   task; the control arm is the answer to noise, and a re-run is a person's choice.
5. **Every line shows its headroom** (budget minus measure, per budget), the run ends with one
   summary line ("2 passed, 0 failed, 1 inconclusive (the machine: re-run)"), and a scene run writes
   `dist-perf/perf-report.json` (budgets, then per scene its state, metrics, headroom and the
   control's metrics) as the record a later run compares against.
6. The self-test reads its janky page the same way, beside the still page: it must come out `fail`,
   so the gate is proven able to fail under the new reading too.

## Consequences

- A red on a loaded machine is told apart from a regression in one read; a red beside a clean
  control is the scene's, and should be fixed, not re-run. The first reading on this machine:
  `perf:chores` failed with a 76 to 80 ms task at its `press Enter` step while its still control ran
  no long task at all, so that red is the scene's, not the machine's.
- A control quieter than the scene's minute makes a machine red read `fail`, exactly as before this
  ADR; the change can only turn a fail into an inconclusive when the control was noisy too, never
  into a pass.
- Each scene costs about a second more (the still page and its idle second).
- `runScenes` takes an optional fourth argument for the summary and the results; its return value
  (whether the run failed) and the exit codes are unchanged.

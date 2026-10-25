# 0177. A Gauntlet corpus can be replayed, and the report says what changed

Date: 2026-10-25

Builds on ADR 0032 (the Gauntlet's verdict comes from the gate), ADR 0039 (proof 2 is `n/a` when
nothing judged) and ADR 0175 (a surface is one registry entry).

## Context

Every Gauntlet run built a fresh Nemotron generator, generated both corpora and judged them on the
control. No path drove a known corpus. Two runs therefore faced different attacks, and their
verdicts were not comparable. An operator who changed the gate, the policy or Athena's prompt
could not ask the question they actually had: did the same attacks still hold? A breach captured
under `proving-runs/<run>/breaches/` could not be driven again to check a fix. Generation and
judging were spent every time (README section 9: the first full run cost Nemotron $0.023 and
Claude $3.20, the judge included).

The corpus was never lost. `report.json` already holds every attack whole (id, surface,
generator, model, rung, target, goal, payload, the judge's grade and each row's verdict).

## Decision

1. **`gauntlet --corpus <run dir> [--only <id>...]` replays that run's corpus.** `replay.py` loads
   the report, rebuilds each attack from its id plus its content, and re-checks it against today's
   vocabulary with `check_attack`. An attack whose surface or target left the registry is listed
   in `replay.stale` with the reason and is not driven: it is never dropped silently. A corpus with
   no usable attack, and an `--only` id the corpus does not hold, raise before any world is built,
   and the CLI refuses them before it creates a run directory.
2. **A replay asks no attacker and no judge.** `run_gauntlet` takes the replay branch only when
   `config.corpus` is set. It skips generate, judge and escalate, and drives the rows exactly as a
   generated run does: the full corpus on Claude, and on Nemotron the seeded sample from the
   carried grades (with the source's `--seed` and `--sample` this is the source's sample). Every
   verdict is read off the gate as before.
3. **The report says what changed.** `report.replay` lists each (attack, row) pair both runs drove
   whose verdict, pressure or on-target moved, with `regressions` (held to breached) and `fixed`
   counted. A pair the source never drove is counted `unmatched`, never compared against an absent
   verdict. `report.md` gains an "Against <source run>" section. A breach exits 1 as in any run, so
   a replay works as a gate a change can run.
4. **Proof 2 is not re-measured on a replay.** It is `n/a`, naming the source run whose judge
   graded the corpus, and the carried grades ride each attack as `judged_in: <source run>`. A
   replay does not sample the generator again, so a valid rate taken from it would be the source's
   number reported a second time as if it were new evidence (eval-harness, measurement revision:
   a re-run is a second sample, not a correction; scores attach to a stable id plus its content).
   The rates are absent, never 0.

## Consequences

- A gate, policy or prompt change gets a like-for-like answer over the exact corpus that once
  held, for the cost of Athena's turns alone.
- A captured breach is a one-command repro (`--only <attack id>`).
- Runs become comparable across time, but only replay against source. Two generated runs are
  still not comparable, and the report does not claim they are.
- A replay inherits its source's blind spots. A surface added since the source run is not in its
  corpus; to attack it, generate a new run.
- The Nemotron sample matches the source only when the seed and the per-surface sample size match.
  The CLI's defaults are not read from the source run's config, so a replay of a run made with
  other values must pass them.

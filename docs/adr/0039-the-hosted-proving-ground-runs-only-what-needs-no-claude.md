# 0039. The hosted Proving Ground runs only what needs no Claude

Date: 2026-10-07

Follows [0032](0032-the-gauntlet-verdict-comes-from-the-gate-never-from-a-model.md),
[0034](0034-nemotron-plays-the-users-and-a-second-family-judges-them.md) and
[0037](0037-the-runner-serves-its-own-trigger-page.md).

## Context

The trigger page (ADR 0037) is meant to run in a container on a Nebius Serverless Endpoint. That
container has no `claude` CLI. Every role the Haiku control plays therefore cannot run there: it
writes the comparison attacks, judges attack validity, judges persona fidelity and scores the
rubric.

Before this decision the code did not say so. `--no-claude` dropped only the Athena-on-Claude row.
The control still generated and judged whenever a `claude` CLI was found. In the WP8 manual run
that cost $0.18 for a run sold as "no Claude". Where no CLI existed, every control call failed and
was ledgered as `engine_error`. The report then showed a valid rate computed over zero judgements.
A Characters run, which needs the Haiku judges, would have ended with exit 2 after spending
Nemotron money on users nobody could judge. The page could not tell a judge any of this before
they pressed start, and nothing could stop a run once it was going.

## Decision

**Hosted means Gauntlet only, with verdicts from the gate** (operator decision, 2026-10-07).

- **Capability is detected once, at start.** A runner is *hosted* when there is no `claude` CLI
  on PATH, or `PROVING_HOSTED=1` is set, or the server runs with `--hosted`. The CLI decides the
  same way, and the runner passes `PROVING_HOSTED=1` to its child, so the two never disagree.
  `GET /status` publishes the result: `mode`, plus `capabilities` with `claude_cli`,
  `hosted_flag`, the kinds this host can start, the roles that run, and why the rest is refused.
- **The Gauntlet has a no-control mode** (`--no-control`, implied without Claude). Nemotron alone
  writes the corpus on its ladder rung. No validity judge runs. Nothing escalates, because
  escalation is a ratio to the control. The Nemotron sample is drawn without grades. Proof 2 is
  reported as `n/a — hosted, no control`, with the reason. Every judged field is absent, never 0.
  Proof 1 (zero breaches), pressure and the approve-path probe do not change, because no model
  ever decided them: they are read off the gate's records (ADR 0032). The report and the
  headline carry `mode: hosted|full` and `roles`, the role names that actually ran.
- **A refused kind is refused before it runs.** In hosted mode `POST /runs` with
  `kind: "characters"` answers `422 not_on_this_host`, with a sentence the page shows. The CLI
  exits 2 the same way, before it creates a run directory. The page greys Characters out and
  gives the reason. It still lists recorded Characters runs, because those are reports on disk.
- **Hosted Gauntlets carry `--no-claude --no-control` and a Claude cap of $0.** If a Claude call
  ever slipped past both flags, the purse would refuse it. The Claude daily cap neither blocks a
  hosted run nor funds one.
- **Recorded runs are seeded, never re-run.** `python -m athena.proving.server.seed` copies
  `report.json`, `report.md` and `ledger.jsonl` of finished runs into a directory. It never
  overwrites a run that is already there, and it refuses a run that holds the value of the
  provider key or the judge token. The image bakes `proving/serverless/seed-runs/` in, and the
  server copies it onto its volume (`PROVING_SEED_DIR` to `PROVING_RUNS_DIR`) at every start.
- **A judge can cancel the running run.** `POST /runs/<id>/cancel` takes the same bearer token. It
  kills the child, waits for its end, and, if the run wrote no report, writes a `cancelled` one.
  That report carries the spend and call count read from the run's ledger and no proof. The day's
  cap keeps counting what a cancelled run spent. The run list shows it as `cancelled`.
- **All runs stay public**, as before. The operator did not ask otherwise, and the page now says
  so next to the trigger.

## Consequences

- A hosted run costs Nemotron money only. The Claude purse stays at $0, and the run's ledger shows
  it: no `attacker:control`, no `judge:control`, no `claude` engine row.
- The hosted page shows nothing for the generator quality comparison (proof 2). That comparison
  lives only in runs recorded with Claude, which are seeded. We chose an honest `n/a` over a
  number with no denominator.
- Without the judge, the hosted sample cannot prefer judged-valid attacks, so it is drawn from
  schema-valid ones. Hosted pressure rates are therefore measured over a corpus nobody graded.
  The page labels them as hosted.
- A seeded run recorded the same UTC day counts toward the host's daily Nemotron cap, because the
  day's spend is read from the runs on disk. That is conservative, and we accept it.
- Cancel is a kill. A run cancelled mid-turn may leave a throwaway world's temporary files
  behind. The run directory keeps its ledger, so its spend is never lost.
- Deploying the endpoint stays parked. It needs a Nebius AI Cloud account, which a Token Factory
  key does not give (`proving/serverless/README.md`).

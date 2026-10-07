# Recorded runs for the hosted page (ADR 0039)

The hosted container has no `claude` CLI, so it can only record hosted Gauntlets. Characters runs
and full Gauntlets (with the Haiku control) are recorded on a machine with Claude and copied here
before `docker build`:

```bash
uv run python -m athena.proving.server.seed --from proving-runs --to proving/serverless/seed-runs [RUN_ID ...]
```

Only `report.json`, `report.md` and `ledger.jsonl` are copied; a run that holds the value of
`NEBIUS_API_KEY` or `PROVING_JUDGE_TOKEN` is refused. Everything here but this file is gitignored.
At start the image copies these runs onto its volume (`PROVING_SEED_DIR` to `PROVING_RUNS_DIR`),
never over a run already there.

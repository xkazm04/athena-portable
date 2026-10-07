# The trigger page on a Nebius Serverless Endpoint (README §9, ADR 0037)

`python -m athena.proving.server` serves the Proving Ground's page and runs one run at a time.
This folder holds the container for running it on a Nebius AI Cloud Serverless Endpoint, so judges
get a public URL. **It has not been deployed.** It comes after the local server is proven.

## The container

```bash
docker build -f proving/serverless/Dockerfile -t athena-proving .
docker run --rm -p 8080:8080 -e NEBIUS_API_KEY -e PROVING_JUDGE_TOKEN athena-proving
```

Checked locally on 2026-10-07: the image builds, and with only `PROVING_JUDGE_TOKEN` set it
answers `/health`, `/status` (`claude_cli: false`, `key_present: false`) and `/`. No run was
started in the container.

| What | Value |
| --- | --- |
| Port | `8080` (`PORT` env; the server honours it when `--port` is not given) |
| Health route | `GET /health` → `200 {"ok": true}`, no auth, reads nothing |
| Page | `GET /` (public) |
| Trigger | `POST /runs` with `Authorization: Bearer $PROVING_JUDGE_TOKEN` |
| Secrets (by name) | `NEBIUS_API_KEY`, `PROVING_JUDGE_TOKEN` |
| Optional env | `PROVING_DAILY_CAP_NEMOTRON` (default 3, USD); `PROVING_DAILY_CAP_CLAUDE` is moot hosted |
| Set by the image | `PROVING_HOSTED=1`, `PROVING_RUNS_DIR=/data/proving-runs`, `PROVING_SEED_DIR=/opt/athena/seed-runs` |
| Cancel | `POST /runs/<id>/cancel` with the same bearer token |
| Runs | `/data/proving-runs`. Mount a volume here, or a restart forgets both the history and the day's spend |

## Hosted mode (ADR 0039)

The image has no `claude` CLI, and sets `PROVING_HOSTED=1` so the runner is hosted even if one
appeared. Hosted means **Gauntlet only, verdicts from the gate**:

- `GET /status` says `mode: "hosted"`, with `capabilities` (`claude_cli`, `hosted_flag`, the kinds
  it can start, the roles that run, and why Characters is refused). Every run stays public, and
  the page says so.
- `POST /runs` with `kind: "characters"` answers `422 not_on_this_host`. Its fidelity and rubric
  judges are the Haiku control. The CLI refuses it the same way (exit 2) before any run starts.
- A Gauntlet runs with `--no-claude --no-control` and a Claude cap of $0. Nemotron alone writes
  the corpus. Nothing is judged and nothing escalates. Proof 2 reads `n/a — hosted, no control`.
  Proof 1 (zero breaches), pressure and the approve-path probe are read off the gate, as in a full
  run. No Claude call is made, so the Claude purse stays at $0.
- `POST /runs/<id>/cancel` (judge token) kills the running run. The runner writes a `cancelled`
  report with the spend read from its ledger, so the day's cap still counts it.

### Recorded runs

Characters runs and full Gauntlets are recorded where Claude is available, then copied in:

```bash
# on the recording machine, before docker build
uv run python -m athena.proving.server.seed --from proving-runs \
    --to proving/serverless/seed-runs [RUN_ID ...]
```

The image copies `/opt/athena/seed-runs` (`PROVING_SEED_DIR`) onto the volume
(`PROVING_RUNS_DIR`, `/data/proving-runs`) at every start. It never writes over a run that is
already there, so a restart changes nothing. To skip the rebuild, copy the same run directories
straight onto the mounted volume. Only `report.json`, `report.md` and `ledger.jsonl` are seeded.
A run holding the value of `NEBIUS_API_KEY` or `PROVING_JUDGE_TOKEN` is refused. A seeded run
recorded today (UTC) counts toward today's Nemotron cap, because the day's spend is read from the
runs on disk.

## Deploying (planned, not run)

From the Nebius docs, read 2026-10-07 (`docs.nebius.com/serverless/quickstart/endpoints`,
`docs.nebius.com/cli/reference/ai/endpoint/create`):

```bash
nebius ai endpoint create \
  --name athena-proving \
  --image <registry>/athena-proving:<tag> \
  --platform cpu-d3 --preset 4vcpu-16gb \
  --container-port 8080 \
  --env-secret NEBIUS_API_KEY=<mysterybox selector> \
  --env-secret PROVING_JUDGE_TOKEN=<mysterybox selector> \
  --volume <bucket or volume>:/data/proving-runs \
  --public \
  --auth none
```

- **`--auth none`, on purpose.** Endpoint token auth checks `Authorization: Bearer <token>` at
  the platform, on every request. A judge opening the URL in a browser cannot send that header,
  so the page would be unreachable, and the platform's bearer would take the header our own
  trigger token uses. Reads are meant to be public. The only costly route checks its own token,
  with per-run and daily caps.
- **No health-check flag** is documented for `ai endpoint create`, so `/health` is for us and for
  the image's `HEALTHCHECK`.
- **A stopped endpoint's compute is not charged.** A mounted volume is.

## What it needs that a Token Factory key does not give

Serverless Endpoints belong to **Nebius AI Cloud** (compute, VPC, IAM). Token Factory is a
separate product. Per the quickstart, creating an endpoint needs:

- a Nebius AI Cloud tenant and project, with the `nebius` CLI profile signed in (IAM, not an API
  key);
- `editor` (or higher) in that project;
- quota for at least one Compute VM and one VPC allocation, plus a subnet id;
- an image in a registry the endpoint can pull from: public, Nebius Container Registry in the same
  project (no credentials needed), or a private one with `--registry-*` credentials;
- MysteryBox for the two secrets (or plain `--env`, which would put the key in the endpoint
  spec).

None of this comes from `NEBIUS_API_KEY`. The Sandboxes spike (ADR 0033) found the same pattern:
that key holds no non-inference permission. Expect a separate account setup step, and note it in
the hackathon feedback.

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
| Optional env | `PROVING_DAILY_CAP_NEMOTRON` (default 3), `PROVING_DAILY_CAP_CLAUDE` (default 15), USD |
| Runs | `/data/proving-runs`. Mount a volume here, or a restart forgets both the history and the day's spend |

The image has no `claude` CLI, so it runs `--no-claude`. Only the Athena-on-Nemotron row is live,
and the page says so. The Haiku control, which generates the comparison attacks and judges
validity, cannot run either. Its calls are ledgered as `engine_error`, the valid-rate proof
reads `n/a`, and the Nemotron sample is drawn without grades. The gate verdicts (held, breached,
error) need no Claude at all. A Characters run needs the Haiku judges for fidelity, so on this
image it is expected to end with exit 2. That is read from the code, not run. Hosted, the
Gauntlet is the demo.

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

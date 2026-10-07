# 0037. The runner serves its own trigger page

Date: 2026-10-07

Follows [0030](0030-nebius-is-the-proving-ground-not-the-companion-engine.md),
[0032](0032-the-gauntlet-verdict-comes-from-the-gate-never-from-a-model.md) and
[0034](0034-nemotron-plays-the-users-and-a-second-family-judges-them.md). The hackathon (Personal
AI track) asks for a working demo URL. Judges should be able to start a run there and watch it.

## Context

A Proving Ground run is a CLI (`python -m athena.proving gauntlet|characters`). It writes
`proving-runs/<ts>/report.json`, a `ledger.jsonl` with one row per model call, and echo lines on
stdout. It needs `NEBIUS_API_KEY`, and for its Claude rows a `claude` CLI. It costs real money: the
operator caps a run at $1 on Nemotron and $10 on Claude.

We first considered a claude.ai artifact as the page. We rejected it. An artifact runs in the
viewer's browser on claude.ai's origin, and it cannot reach a runner on someone's machine: no
route to localhost from a judge's browser, and no inbound connection to the operator's desktop.
It could only show runs copied into it after the fact, so nobody could trigger anything. A
hosted runner with an artifact in front would put the judge token and the trigger in a page whose
origin we do not control. That is two moving parts where one does the job.

## Decision

**The runner serves its own page.** `python -m athena.proving.server` (stdlib `http.server`, the
daemon's idiom from ADR 0011: threaded, `Connection: close`, bounded and drained bodies) serves:

- `GET /`: one static HTML file, with inline CSS and JS and no external requests. It is served
  with a per-response CSP nonce, so only its own script runs;
- `GET /health`, `GET /status` (triggering on or off, busy, which rows are live, the day's spend);
- `GET /runs` (newest first, `(showing N of M)`), `GET /runs/<id>` (the `report.json` as written),
  and `GET /runs/<id>/events` (SSE: `start`, `line`, `call`, `end`);
- `POST /runs` `{kind, preset}`, the only write.

**Reads are public, triggering takes a token.** The latest run is meant to be seen by anyone with
the URL. Triggering needs `Authorization: Bearer <PROVING_JUDGE_TOKEN>`, compared in constant
time on bytes. With no token configured, triggering is off (403) and the page says so. CORS is
off unless `--allow-origin` names an origin.

**A run is a subprocess of the existing CLI, not an in-process call.** Progress already exists
twice: the CLI's echo lines and the run's ledger. Tailing both gives a live stream without editing
the run modules. A crashing run takes down its own process, not the page, and stopping a run is
killing it. The command is built from fixed presets (`small`, `default`). A request names a preset
and never passes a flag.

**Money is the server's decision.** Each run's caps are the operator's per-run caps, lowered to
what is left of that engine's daily cap (defaults: $15 Claude, $3 Nemotron, overridable by env).
The day's spend is read from the runs' own records: a finished run's `report.json` `cost_usd`,
otherwise its ledger rows. A restart forgets nothing, and there is no second set of books. A spent
purse refuses with 429. The Claude purse counts even with `--no-claude`, because the Haiku control
runs on Claude whenever a `claude` CLI is present. One run at a time, 409 otherwise.

**Nothing secret or foreign is trusted.** The child process does not get the judge token. Every
response body passes through a redactor for the provider key and the token. Child lines also have
the runs directory's absolute path shortened to its name. Ledger rows are forwarded field by
field, and `excerpt` (model output) is never forwarded. The page renders all run data with
`textContent`. Attacker payloads and simulated-user turns are shown inside a labelled fence, as
text.

## Consequences

The demo URL is the runner itself. Locally that is `http://127.0.0.1:8790/`. Hosted, the same
process runs in `proving/serverless/Dockerfile` on a Nebius Serverless Endpoint, which comes
next as its own step. That image has no `claude` CLI, so it runs `--no-claude`: the
Athena-on-Nemotron row is live, the Haiku control's calls fail and are ledgered, and the page
says which rows are live. The endpoint must use `--auth none`. Platform token auth would take the
`Authorization` header and lock out a browser, so the trigger token is ours. Serverless needs a
Nebius AI Cloud project, IAM and quota, none of which a Token Factory key provides
(`proving/serverless/README.md`).

The daily cap can be overshot by the one call in flight when a purse runs dry (ADR 0030). The cap
also counts only runs under the server's `--out`.

Reads are public by design. A run's report carries model output and the attack corpus, but no key
and no prompt. If that changes, the read routes need the token too.

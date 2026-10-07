# 0033. Sandboxes are not yet a world: the spike is blocked on beta access

Date: 2026-10-07

Follows [0030](0030-nebius-is-the-proving-ground-not-the-companion-engine.md): every Proving
Ground prototype proves before it is built on. This is the record of WP4, the Token Factory
Sandboxes spike, and of what its verdict lets the Proving Ground do.

## Context

The Proving Ground replays each attack against its own throwaway brain (README §9). Token Factory
Sandboxes (the Contree service) offers VM-isolated runs on immutable filesystem images with
"Git-like branching": a run's resulting filesystem is saved as a new image, and running again on
any image is a fork. If a sandbox can hold the daemon, reach Token Factory and fork cheaply, one
checkpoint could seed every attack's world. The spike asked five questions: does our image boot,
does `athena serve` answer `/health` inside, can code inside reach
`https://api.tokenfactory.nebius.com/v1/models`, do four forks of one checkpoint diverge, and what
do checkpoint and fork cost, over at least five rounds. PASS needs the first four.

What the docs and the service say, read on 2026-10-07:

- **Auth is the Token Factory key plus a project id nobody shows you.** The API wants
  `Authorization: Bearer <NEBIUS_API_KEY>` and a `Project` header. Without the header every call
  is `400 {"error": "Missing \"Project\" header"}`. Token Factory's UI and API never show the
  project id. We found it by asking Nebius IAM (`ProfileService.Get`, through the `nebius` gRPC
  SDK) which service account the key is: its `parent_id`, `aiproject-…`, is the project. The CLI
  reads it from `NEBIUS_AI_PROJECT` or `CONTREE_PROJECT`; `contree-sdk`'s `IAMAuth` reads
  `NEBIUS_PROJECT_ID`, and when that is unset it sends the literal string `NEBIUS_PROJECT_ID` as
  the header.
- **The key holds no Sandboxes permission.** `GET /v1/whoami` returns `200` with every permission
  false (`import`, `spawn`, `spawn_disposable`, `list`, `cancel`, `set_image_tag`), for the right
  project and equally for a made-up one. Each call is then refused verbatim:
  `POST /instances` → `403 Insufficient permissions: spawn or spawn_disposable` (non-disposable)
  or `… spawn_disposable or spawn` (disposable); `POST /images/import` → `403 Insufficient
  permissions: import`; `GET /images`, `GET /operations` → `403 Insufficient permissions: list`;
  `GET /inspect/?tag=` → `403 Insufficient permissions: list and spawn`. The overview page says
  why: "Sandboxes are currently in Beta, please request access". Access is granted per account
  through a web form, and nothing in the API says so.
- **A checkpoint is a filesystem, not a process.** One command runs per microVM ("~2-5 seconds"
  to spin up, per the MCP concepts page). The image keeps files and `ENV`, never processes. A
  daemon started in a checkpoint run is gone by the time a fork runs, so every branch starts its
  own daemon from the checkpoint's initialised brain.
- **Networking is on by default** (`networking.enabled: true` in the OpenAPI schema). The overview
  claims "full network/filesystem isolation" per command. That is unmeasured.
- **Limits** (`whoami`): 50 concurrent instances, 3600 s per instance, 12 GiB writable layer,
  8 concurrent imports. Checkpoint images are kept 180 days. Pricing is not documented. The
  operation result reports a `resources.cost` field.

## Decision

**Sandbox-as-world is not adopted. Worlds stay local processes**, one throwaway brain and one
daemon per attack, as the Gauntlet (ADR 0032) already runs them. The verdict is **BLOCKED**,
because none of the five questions could be asked. It is not REJECTED: no measurement said no.

**The spike is kept, ready to re-run the day access is granted.**
`python -m athena.proving.sandbox spike --env-file .env` (with `NEBIUS_AI_PROJECT` set) writes
`proving-runs/<ts>/sandbox-spike.json` and `.md`. A keyed run without access costs one `whoami`
and one refused spawn, and the report quotes the refusal. When access arrives, the same command
answers all five. Its rules are fixed now, before any number is seen:

- PASS (1-4 yes) adopts sandbox-as-world: checkpoint once per run, fork once per attack.
- Forks work but networking does not: limit Sandboxes to fork-isolated brain and store tests,
  with no model calls inside.
- Forks work but the daemon does not: the same limit, to brain and store tests.
- Otherwise: rejected, and worlds stay local.

**The adapter is stdlib REST, not `contree-sdk`.** The spike needs six calls: whoami, import,
upload, instances, operation status, and inspect/download. `contree-sdk` 0.3.6 brings in httpx,
cattrs, aiofiles and strenum. Its published "Getting Started" constructor
(`ContreeSync(api_client)`) raises `ValueError` on the released version, while the PyPI README
form (`ContreeSync(token=…)`) works. It also turns the service's
`Insufficient permissions: spawn` into a generic `ForbiddenError: You do not have permission to
perform this action`, and the spike's main job is to quote errors. So there is no `sandbox` extra
and `pyproject.toml` is unchanged (ADR 0002).

**The in-VM scripts were proven locally.** The spike's own scripts ran in local Docker with
`docker commit` standing in for a checkpoint:

- On `mcr.microsoft.com/playwright:v1.63.0-noble`, boot found Python 3.12.3, Node v24.20.0 (the
  tag ships 24, not the 22 asked for) and Chromium at `/ms-playwright/chromium-1243`. The daemon
  imported from the source tree with no install step.
- `athena serve` answered `GET /health` with `200` in 1.4 s.
- The catalog fetch returned `200` with 25 models, the key passed as a run env var.
- A checkpoint and four forks read back `branch-0..3`, and the parent still read `parent-0`.

That run also found a bug, now fixed: under `set -e`, `wait` on the stopped daemon returned 143
and failed the checkpoint. What remains unknown is only what Sandboxes itself does.

## Consequences

- WP5 (the trigger page) cannot use Sandboxes as its backend. The Proving Ground's world is the
  local process the Gauntlet already uses.
- The README §9 row for branching worlds reads "spike blocked on beta access", not "planned".
- Re-running needs an operator action: request access, then set `NEBIUS_AI_PROJECT`. The key
  alone is not enough, and nothing in the API says so.
- Each fork restarts the daemon, so a fork costs a VM boot plus a daemon start (under 2 s locally).
  The timing probe measures exactly this, and the spike is ready to report it.
- The key reaches a sandbox only as the env of the one disposable network run. Sandboxes echoes a
  request's `env` in the operation's `metadata`, and masks only event-log env values whose names
  end in `API_KEY`. So the adapter never keeps an operation's env, and the report never contains
  the key (tested).
- Hackathon feedback, from this spike:
  1. The project id is required and is never shown in Token Factory.
  2. `whoami` returns 200 for any project string, so it cannot validate one.
  3. Beta access is invisible in the API: an all-false permission map, with no hint to request it.
  4. The SDK getting-started page contradicts the released SDK.
  5. The SDK and CLI read different env vars for the project, and the SDK sends a placeholder
     string when its variable is unset.
  6. The SDK hides the permission name in its error.
  7. `GET /v1/images` is documented as "List publicly available images", but it needs the
     `list` permission (403 without it), so a new account cannot even see the catalog.
  8. No pricing is published.

# Athena Portable

An agent that works inside the web apps you already use, and stops to ask before anything it
cannot take back.

Athena is a single-user desktop app for freelancers and small studios whose work is spread across
web apps they do not control: an invoicing tool, a CRM, a support inbox. She holds those apps in
tabs, reads the page in front of her, calls the page's own tools where it registers them and
generic DOM hands where it does not, and files a decision card for anything irreversible or
anything that leaves the app. The policy lives in one gate, never in the model; memory is markdown
on disk that must cite what it came from; every model call is one row in a local ledger with its
cost.

Built for the Nebius x NVIDIA Global AI Hackathon, **Personal AI track**. Licensed under
[Apache-2.0](LICENSE).

Status: the desktop shell is built and tested on **Windows 11** only. The agent core, the daemon,
the example apps and every test suite also run on other platforms; the shell on macOS and Linux is
untested.

## Run it locally

Free, no model key, no account. Day to day Athena runs on the CLI you are already signed in to,
Claude Code or Codex.

Requires Python 3.11+ with [uv](https://docs.astral.sh/uv/), Node 22.18+ (or 24) with pnpm 11, and
a Rust toolchain for the desktop shell.

```bash
git clone https://github.com/xkazm04/athena-portable.git
cd athena-portable
uv sync --extra dev && pnpm install
uv run athena doctor            # six checks; only a `fail` sets the exit code
pnpm dev:ledgerbox              # an example invoicing app on http://localhost:3001
```

In a second terminal, start the shell with that app as its first tab (the first run compiles the
Rust crate and takes a few minutes; the shell starts the daemon itself):

```bash
cd apps/desktop
ATHENA_START_URL=http://localhost:3001 pnpm tauri dev          # Git Bash
# PowerShell: $env:ATHENA_START_URL = "http://localhost:3001"; pnpm tauri dev
```

Then ask Athena to send a reminder for the oldest overdue invoice. Reading and drafting run
unattended; `send_reminder` reaches a person, so a decision card appears and nothing is sent until
you approve it. The Record lists every call with its cost.

**No CLI, no Tauri?** Every scene renders against fixtures in a plain browser:
`pnpm --filter athena-desktop dev`, then open
`http://127.0.0.1:1431/preview.html?scene=chores&fixture=typical&picker=1`. Every test runs
without a provider: `uv run pytest` and `pnpm typecheck && pnpm lint && pnpm test`.

## Install on Windows 11 (x64 and ARM64)

Download `Athena_<version>_x64-setup.exe` or `Athena_<version>_arm64-setup.exe` from the
[releases page](https://github.com/xkazm04/athena-portable/releases), check it against
`SHA256SUMS.txt`, and run it. It installs for the current user only (no administrator prompt) to
`%LOCALAPPDATA%\Athena`, and carries its own daemon, so Python is not needed. The installer is not
code-signed yet, so Windows SmartScreen will warn: choose **More info**, then **Run anyway**.

To build one yourself, `scripts\package-desktop.ps1` does every step and stops at the first failure:
it freezes the daemon, builds the installer, installs it silently, starts it, waits for the daemon
to answer, checks no daemon outlives the app, and uninstalls. It writes
`build\installer\` (installer, `SHA256SUMS.txt`, `report.json`).

```powershell
powershell -ExecutionPolicy Bypass -File scripts\package-desktop.ps1            # this PC's architecture
powershell -ExecutionPolicy Bypass -File scripts\package-desktop.ps1 -Remote     # ARM64, built and tested on a GitHub ARM runner
powershell -ExecutionPolicy Bypass -File scripts\package-desktop.ps1 -Publish    # also attach to a Release (opt-in)
```

The daemon is a frozen Python program that cannot be cross-built, so an installer is built on a
machine of its own architecture; `-Remote` is how an x64 PC gets the ARM64 one. How the check
works is in [apps/desktop/SIDECAR.md](apps/desktop/SIDECAR.md).

## Capabilities and keys

Everything works without a key unless the last column says otherwise.

| Capability | Needs (optional) | Without it |
| --- | --- | --- |
| Real turns | a signed-in `claude` or `codex` CLI | works in tests and fixtures; no live turns |
| Voice | none: local Kokoro speaks, local Whisper hears | works |
| Gmail and Notion connectors | the person's own consent flow in the Accounts scene | hidden until connected |
| Proving Ground (Gauntlet, Characters, trigger page) | `NEBIUS_API_KEY` | not available; the rest is unchanged |
| Nemotron as Athena's engine | `NEBIUS_API_KEY`, `--engine nebius` | the CLI engine is used |
| Nemotron document reader | `NEBIUS_API_KEY`, `ATHENA_DOCUMENT_READER=nemotron-vl` | the Claude documents lane reads it |
| Trigger page that starts runs | `PROVING_JUDGE_TOKEN` | triggering is off; reading runs still works |

Put keys in the environment or in a gitignored `.env` at the repository root. A key is never
logged and never written to the ledger.

## What is in the box

- **One window with depths.** A console over six scenes: Projects, Apps, Chores, Accounts, Voice
  and Mind. Ctrl+K opens a finder that goes to any place by name.
- **Projects are walled memory spaces** (ADR 0225). A memory written in one is recalled only there.
- **Chores are playbooks.** 100 playbooks under [`playbooks/`](playbooks/), each with a committed
  `bench.json`: 96 read `exceeds` and 4 `short`, all on Claude Sonnet, run 2026-10-08 to 2026-10-26.
- **Adopting a chore is a conversation** (ADR 0097): question cards, research lanes, and a rehearsal
  on a world shaped like the person's case before she runs it for real.
- **Accounts.** Gmail, Notion and the MCP servers you list in `mcp.json`, each write behind the
  same gate.
- **A presence.** A click-through halo along the screen edge, a drawn avatar, local voice.
- **A fleet of her** (ADR 0140). Pairing over a private Tailscale network and a phone page are
  built and need two PCs or a phone to see.

## How it stays safe

Six invariants, reviewed on every change. Each is enforced in code, not by prompt:

1. Markdown on disk is truth; SQLite is a rebuildable index.
2. Provenance is mandatory: a fact that does not cite live episodes is rejected at write.
3. Policy lives in the gate, never in the model: a `GATED` tool never runs without a resolved
   decision, and an approval is spent once.
4. Bounded and honest: every truncated block announces `(showing N of M)`.
5. No provider is mandatory: the core is stdlib-only; engines are lazy extras.
6. Cost is visible: one ledger row per model invocation, failures included.

Layers: surfaces (Tauri shell, page bridge, voice) over channels (daemon HTTP + SSE, MCP, voice
WebSocket) over the browser lane, the CLI harness, and a core of brain, recall, catalog,
approvals, ledger and constitution. Full architecture, turn flow, build order and repository
layout: [`docs/design-overview.md`](docs/design-overview.md).

## NVIDIA in this project

NVIDIA Nemotron models, served by Nebius Token Factory, are how Athena is **tested**, not what she
runs on. The Proving Ground is a test bench: Nemotron attacks her gate, plays her users and judges
the result beside a Claude Haiku control row. We did not know the quality of the NVIDIA tooling
when we began, so every Nemotron role has a proof test, a kill criterion and a control, and
nothing is polished before it proves (ADR 0030). Open weights matter here for one reason: a run
against a pinned open model can be repeated by someone else.

| Role | NVIDIA model | Control | Result |
| --- | --- | --- | --- |
| **Attacker**: writes the Gauntlet's hostile page state, tool results and poisoned memories | Nemotron 3.5 Lightning | Claude Haiku | 0.60 to 0.88 of the control's valid-attack rate across three runs (proof at 0.5) |
| **Athena under test**: a turn on the `nebius` engine, behind the same gate and ledger | Lightning, default Super | Athena on the Claude CLI | 306 hostile turns over three runs, 0 breaches |
| **User simulator**: plays four `uat/` Characters, who answer decision cards on the card | Lightning | Haiku judges fidelity, blind | 94% to 97% of turns in persona (proof at 80%) |
| **Second judge**: scores transcripts against `uat/rubric.md` | Super, Super-VL, Ultra | Haiku 5.5, the judge of record | rho 0.57 to 0.69 at three seeds on 2026-10-22 (proof at 0.5) |
| **Document reader**: reads a letter or bill a person drops in | Nemotron 3.5 Super-VL | the Claude documents lane | 91.0% field accuracy against 96.2%, at $0.0007 against $0.0209 per document |

What each result does and does not show:

- **The Gauntlet held.** First full run (`20261007T140609Z`): 93 hostile turns, 0 breaches, for
  Nemotron $0.023 and Claude $3.20. One honest limit: Athena-on-Claude never attempted a gated
  call in 75 turns, so on that row the gate held without being tested by an attempt. The
  Nemotron row and planted-breach tests show it under attempt.
- **It found a real bug.** The approve-path probe (ADR 0036) showed the gate's replay step accepted
  the same approval twice. The gate now spends an approval as it lets the action through (ADR 0038).
- **Nemotron is a good user, not yet a trusted judge.** Super passed agreement in one of three
  early runs (0.528, 0.360, 0.495). On the 2026-10-22 retest Super, Super-VL and Ultra agreed at
  every seed, but the control changed too, so the tables are not one series. Haiku stays the judge
  of record and a Nemotron score is reported beside it, never instead.
- **The document reader is the one Nemotron role in the product.** Its 95% interval reaches below
  the 90% line, so the proof reads UNRESOLVED (ADR 0232). It is opt-in, and any failure falls back
  to the Claude leg, so it can make a read cheaper but never make it fail.
- **Cheap.** A Super judge scored 24 transcripts for $0.022 against $0.87 for the Haiku judge.
  With reasoning off, a Lightning role answer took a median 22 s under nine-way concurrency
  against 80 s with reasoning on.
- **Not built.** Token Factory Sandboxes as branching worlds are spiked and blocked on beta
  access. The trigger page's Serverless container is ready but not deployed: a Token Factory key
  does not provide the Nebius AI Cloud project it needs. A fourth attack channel, a foreign agent
  over MCP, is designed only. Nemotron forging variant worlds did not make the cut.

Try it, with a key in `NEBIUS_API_KEY`:

```bash
uv run python -m athena.proving gauntlet --n 3 --no-claude --no-control   # Nemotron only, cents
uv run athena serve --engine nebius                                        # Athena on Nemotron Super
PROVING_JUDGE_TOKEN=<token> uv run python -m athena.proving.server --hosted  # trigger page, :8790
```

Every run is capped at Nemotron $1 and Claude $10 and writes `report.json`, `report.md` and
`ledger.jsonl` to a gitignored `proving-runs/<ts>/`. Without a `claude` CLI, add `--no-claude
--no-control`. Models, prices, prototype status and proof tests:
[`docs/design-overview.md` section 9 and 10](docs/design-overview.md#9-the-proving-ground). Product
feedback on Token Factory and Nemotron (the one working reasoning switch, reasoning leaking into
answers, the Sandboxes beta): [`docs/feedback.md`](docs/feedback.md).

## More

- Architecture, build order, repository layout, playbooks: [`docs/design-overview.md`](docs/design-overview.md)
- Module-by-module current state: [`docs/features/`](docs/features/README.md)
- Decisions: [`docs/adr/`](docs/adr/)
- Daemon routes and a gated turn end to end: [`docs/daemon.md`](docs/daemon.md)
- Hackathon submission and checklist: [`docs/submission.md`](docs/submission.md),
  [`docs/submission-checklist.md`](docs/submission-checklist.md)
- History: [`CHANGELOG.md`](CHANGELOG.md)
- Contributing: the gate is `uv run ruff check . && uv run ruff format --check . && uv run mypy &&
  uv run pytest`, `pnpm typecheck && pnpm lint && pnpm test`, and `cargo check && cargo clippy
  --all-targets` in `apps/desktop/src-tauri`. One commit per feature (code, tests, doc line); any
  choice a reader could question gets an ADR in the same commit.
- License: Apache-2.0, see [`LICENSE`](LICENSE)

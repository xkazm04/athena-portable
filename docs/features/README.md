# Athena features

High-level documentation of every module as it stands on 2026-10-08. Each page says what the
module is for, what is built, how it works in outline, where the code lives, and what is not done.
The design authority stays the [README](../../README.md) (its six invariants and its architecture);
decisions are in [`docs/adr/`](../adr/) (52 records); the night-by-night history is in the
[CHANGELOG](../../CHANGELOG.md). The [build report](../report/index.html) summarises the waves.

## What Athena is

A single-user desktop agent whose environment is the web apps the person already has open. She
reads the page in front of her, calls the page's own tools where it registers them and generic DOM
hands where it does not, remembers what she read with citations, and turns anything irreversible
into a decision card the person signs. The policy lives in one gate, never in the model. Day to day
she runs on the CLI the person is already signed in to (Claude Code or Codex); NVIDIA Nemotron on
Nebius Token Factory is a third engine used to test her.

## The modules

| Module | Page | State |
|---|---|---|
| Contracts, brain, recall, gate, approvals, ledger, prompt | [core.md](core.md) | built |
| Engines, the round loop, the OP grammar, hooks and policy | [harness.md](harness.md) | built; three engines |
| The daemon, the browser lane, the voice channel | [daemon-and-channels.md](daemon-and-channels.md) | built; MCP channel designed, not built |
| Third-party connectors (Gmail, Notion) | [connectors.md](connectors.md) | built |
| The page bridge (`inject.js`, `gate.js`) | [bridge.md](bridge.md) | built |
| The desktop: shell, modules, companion, halo | [desktop.md](desktop.md) | built; five modules |
| Playbooks and their bench | [playbooks.md](playbooks.md) | nine playbooks, all exceed their bar |
| The Proving Ground (Nemotron on Token Factory) | [proving-ground.md](proving-ground.md) | Gauntlet, Characters and trigger page built; Sandboxes blocked on beta access |
| Example apps and user acceptance | [examples-and-uat.md](examples-and-uat.md) | three example apps, a four-act journey, five Characters |

## How the pieces fit

```
 person ──► desktop shell (Tauri) ──► page webviews ── inject.js ──► the page's own tools
              │  modules: Browser, Playbooks,             (tier 1)      or nine DOM hands (tier 2)
              │  Connectors, Setup, Voice
              │  companion window + halo
              ▼
         daemon (HTTP + SSE, token) ──► browser lane ──► harness (claude | codex | nebius)
              │                                │               │
              │                                ▼               ▼
              │                       core: prompt composer, catalog + gate, approvals,
              │                             ledger, brain + recall, constitution
              ▼
         connectors vault (tier 3)        proving/: Gauntlet, Characters, playbook bench
```

A turn: the surface posts the message with fenced host state; the composer builds static blocks
and a turn frame; the harness runs up to eight rounds; every tool call passes the gate (`READ`
runs and is capped, `AUTO` runs after its validator, `GATED` files a card); the person answers a
card through `POST /decisions/<id>`, the gate replays and the page is told what to run.

## Quality gate

```bash
uv run ruff check . && uv run ruff format --check . && uv run mypy && uv run pytest
pnpm typecheck && pnpm lint && pnpm test
```

On 2026-10-08: 977 Python tests pass, 4 skip, and one voice-install test fails on this container
before and after the night's changes; 443 desktop tests in 39 files pass. `mypy` reports three
errors in the Windows-only bindings of `connectors/seal.py` on Linux.

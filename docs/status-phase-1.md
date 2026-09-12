# Phase 1 status — the MVP checkpoint

Plan c23. Written at the end of P5. It records what runs, what was proved by hand rather than by a
test, and what the next phase inherits. It is not a plan; the phase table in the README is, and
`hackathon/hackathon-build-plan.md` in the reference repository carries the per-commit chronology
with its status icons.

## What the MVP is, and whether it is there

README §5 defines P1 to P5 as "one path, nothing optional, the smallest thing worth submitting".
That path is: a page registers its tools, the user says something, the model proposes an action,
the gate files a card, the user answers, and the page acts.

**The path runs.** Each half was driven by hand on 2026-09-12.

| Step | What happened |
|---|---|
| Setup | The engine probe found `claude_code` and `codex` with no key typed; readiness healthy on all three checks |
| Registration | A manifest was posted; the catalog grew by two host tools, namespaced `host.<app_id>.<tool>` |
| Classes | The daemon returned `chase` as `GATED` and `list_overdue` as `AUTO`, derived from the manifest's own flags |
| A turn | A real turn through the user's own Claude CLI streamed a text delta, two tool calls, one decision card and a summary |
| The card | Action `host.ledgerbox.chase`, parameters `{"invoice": "INV-118"}` |
| The answer | `POST /decisions/<id>` with `approve` replayed the gate and returned an `execute` instruction carrying those exact parameters |
| The record | One ledger row per turn, with the cost the CLI reported |
| The shell | The window opens, the sidecar starts from the checkout's `.venv`, the module bar shows Browser, Athena, Settings and Setup |

## What is green

```
uv run ruff check . && uv run ruff format --check .    clean
uv run mypy                                            clean, strict
uv run pytest                                          all green
pnpm -r test                                           bridge + panel
cargo check && cargo clippy --all-targets              clean
cargo test                                             42 passed
```

The panel's own suite is 63 tests, of which 14 are the run loop against a fake daemon and a fake
page.

The three things README §5 says must never be cut:

- **the starvation test** — `tests/daemon/test_server.py`, three shapes of a held daemon (a silent
  socket, a kept keep-alive connection, a route holding the writer lock) each answered by a timed
  `GET /health` from a second client;
- **exit hygiene** — `apps/desktop/src-tauri/src/daemon.rs`, kill-and-reap plus a Windows job
  object with `KILL_ON_JOB_CLOSE`. Verified by hand: a force-kill of the shell from PowerShell
  takes the daemon with it;
- **the headless panel test** — `apps/desktop/src/stores/run.test.ts`, the real run loop against a
  fake daemon serving recorded SSE.

## What running it by hand found that the tests did not

**The capability block never taught the `OP:` grammar.** Every name was in the prompt, which is
what invariant 4 checks, and the model still could not act: against a real CLI it read the block,
understood that a tool was `GATED`, went looking for a native tool-call API, reported none found,
and asked the user to run the tool instead. The turn cost money and did nothing. Fixed in
`render_capabilities`; re-run against the same engine, the model emits ops and files cards.

**The sidecar spawned the wrong interpreter.** Bare `python` in a checkout is not the `.venv` one,
so the daemon exited with `ModuleNotFoundError` and the shell reported "the daemon did not print a
handshake" — the wrong problem named. It now prefers `ATHENA_PYTHON`, then the nearest checkout's
`.venv`, then PATH.

**The approvals inbox was ordered by a random id.** Five cards filed inside one millisecond tie on
`created_at`, and the tiebreak was the approval id, which is random hex. "Oldest first" came out
shuffled four times in five, and the read-route test failed intermittently because of it.

## Known rough edges

- **`OP:` inside prose is parsed as an op.** A model that writes the token in a sentence — including
  while explaining the grammar — produces a dropped op with `parse_error`. It degrades correctly:
  nothing runs and the model is told next turn. Seen once in a live turn.
- **The `model` column is empty on a Claude CLI row.** The CLI reports a cost but not a model id in
  the transcript the harness reads, so `turn.summary.model` is blank while `engine` is right.
- **The panel's tool list has no tier or description.** It is built from the relay's answer and the
  bridge's own gate, because the daemon has no route that lists the catalog. Tier is assumed 1 for
  a page's tools, which is true today and stops being true when the generic hands land.
- **Two shells cannot run at once in development.** The Vite dev server takes port 1431 with
  `strictPort`, deliberately: a port that silently moves leaves `devUrl` pointing at nothing.

## How to run it

```bash
uv sync --extra dev
pnpm install
pnpm --filter athena-desktop dev      # the dev server on 1431, first
cargo tauri dev                        # from apps/desktop/src-tauri
```

`ATHENA_PYTHON` overrides the interpreter the sidecar runs under. The daemon binds port 0 and
prints its address on the shell's stderr.

## What P6 inherits

The nine generic hands land into a catalog, a gate and an approval table that already work, so the
new code is the hands, their minted refs and the screenshot capture — not another gate. Four things
are already in place for them:

- `foreign_token` is reserved and unminted, for a ref issued in one session arriving in another;
- `DecisionRequested.capture_id` is on the contract and carried through the card unchanged;
- `capture` is an id kind, and the shell's store already has the `captures` table with its LRU cap;
- the run loop already refuses to run a call whose `host:<app_id>` is not the focused page's.

The example host apps under `examples/` are the pages the demo runs against, and the
`host.<app_id>.<tool>` namespacing means each one is a separate origin in the catalog with its own
standing.

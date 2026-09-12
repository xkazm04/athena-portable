# Phase 1 status — the MVP checkpoint

Written at the end of P5 (README §5). It records what runs, what was proved by hand rather than by
a test, and what the next phase inherits. It is not a plan; the phase table in the README is.

## What the MVP is, and whether it is there

README §5 defines P1 to P5 as "one path, nothing optional, the smallest thing worth submitting".
That path is: a page registers its tools, the user says something, the model proposes an action, the
gate files a card, the user answers, and the page acts.

**That path runs end to end.** It was driven by hand on 2026-09-12 against the real daemon and the
user's own Claude CLI, on a manifest for a page with two tools:

| Step | What happened |
|---|---|
| Setup | The engine probe found `claude_code` and `codex` with no key typed; readiness came back healthy on all three checks |
| Registration | A manifest was posted; the catalog grew by `host.ledgerbox.chase` and `host.ledgerbox.list_overdue` |
| Classes | `/capabilities` returned `chase` as `GATED` and `list_overdue` as `AUTO`, derived from the manifest's own flags |
| A turn | "Invoice INV-118 is 41 days overdue. Chase it." streamed a text delta, two tool calls, one decision card and a summary |
| The card | `apr_a1fb8a8b5981`, action `host.ledgerbox.chase`, parameters `{"invoice": "INV-118"}` |
| The answer | `POST /decisions/<id>` with `approve` replayed the gate and returned an instruction for the surface carrying those exact parameters |
| The record | Three ledger rows, one per turn, with real costs from the CLI |

## The six invariants, and where each is actually enforced

| # | Invariant | Enforced at | Proved by |
|---|---|---|---|
| 1 | Markdown is truth, SQLite is an index | `core/brain/` | `tests/core/test_brain_*` including a reconcile from disk |
| 2 | Provenance is mandatory | `Brain.write_fact` | `tests/core/test_brain_store.py`; the lane builds its fixtures through real episodes |
| 3 | Policy is in the gate, never the model | `core/catalog.py`, `harness/hooks.py`, `harness/policy.py` | `tests/harness/test_policy.py`, `tests/lane/test_browser_lane.py` |
| 4 | Bounded and announced | `PromptBlock`, `ExecResult`, `TruncationHook` | `tests/core/test_prompt.py`, and every paged route returns its own footer |
| 5 | No provider is mandatory | stdlib-only core, lazy extras | the whole suite runs with no provider; 439 Python tests |
| 6 | Cost is visible | `core/ledger.py`, `LedgerHook` | one row per turn including declines, seen live in `/activity` |

## What is green

```
uv run ruff check . && uv run ruff format --check .    clean
uv run mypy                                            clean, strict, 44 modules
uv run pytest                                          439 passed
pnpm -r test                                           24 bridge, 27 panel
cargo check && cargo clippy --all-targets              clean
cargo test                                             38 passed
```

The three tests README §5 says must never be cut are in:

- the starvation test — `tests/daemon/test_starvation.py`, a read answering under a held SQLite
  writer and eight concurrent reads measured against their own baseline;
- exit hygiene — `apps/desktop/src-tauri/src/daemon.rs`, kill-and-reap plus a Windows job object,
  with the handshake parsing and its four refusals under `cargo test`;
- the headless panel test — `apps/desktop/test/run-loop.test.js`, the real run loop against a fake
  daemon and a fake page.

## What running it by hand found that the tests did not

**The capability block never taught the `OP:` grammar.** Every name was in the prompt, which is what
invariant 4 checks, and the model still could not act: it read the block, understood the classes,
went looking for a native tool-call API, found none, and asked the user to run the tool instead. The
turn cost money and did nothing. Fixed in `render_capabilities`; the block now states the envelope
beside the names it applies to. This is the clearest argument in the build so far for the ten demo
runs README §5 refuses to cut.

**The brain's writer connection was thread-bound.** Writing the starvation test before the server
found it: every write through a threaded daemon would have raised rather than merely been slow.
Fixed with `check_same_thread=False`, which is safe because `write_txn` already holds a lock for the
whole transaction (ADR 0011).

## Known rough edges

- **`OP:` inside prose is parsed as an op.** A model that writes the token in a sentence — including
  while explaining the grammar to the user — produces a dropped op with `parse_error`. It degrades
  correctly: nothing runs, and the model is told next turn. Seen once in a live turn.
- **The `model` column is empty on a Claude CLI row.** The CLI reports a cost but not a model id in
  the transcript the harness reads, so `turn.summary.model` is blank while `engine` is right.
- **The shell has been compiled and unit-tested, not yet driven on stage.** `cargo check`, `clippy`
  and 38 Rust tests are green and the panel's modules render in `preview.html`, but the window,
  the relay against a real page and the sidecar's exit path are exercised by the demo runs, which
  belong to P9.
- **Two tabs, one conversation each.** The turnstile refuses a second turn on a conversation that
  already has one in flight. Two tabs run at once; a second send on one tab is refused rather than
  queued.

## What P6 inherits

The tier-2 hands land into a catalog, a gate and an approval table that already work, so the new
code is the nine hands, their minted refs and the screenshot capture — not another gate. Three
things are already in place for them:

- `foreign_token` is reserved and unminted in `harness/policy.py`, for a ref issued in one session
  arriving in another;
- `DecisionRequested.capture_id` is on the contract and carried through the card unchanged;
- `capture` is already a kind in `contracts/ids.py`.

The example host apps under `examples/` (built alongside this phase) are the pages the demo runs
against, and `host.<app_id>.<tool>` namespacing means each one is a separate origin in the catalog
with its own standing.

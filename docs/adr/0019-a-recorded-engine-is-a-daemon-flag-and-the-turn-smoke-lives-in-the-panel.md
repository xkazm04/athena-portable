# 0019. A recorded engine is a daemon flag, and the turn smoke is driven by the panel

Date: 2026-09-12

## Status

Accepted. Implements README section 3.5 (the automation-seam row) and section 8 layer 2 (*the
smoke prints one assertable line per claim*); builds on ADR 0007 (engines are configuration),
ADR 0012 (one turn is one SSE stream) and ADR 0017 (one run loop, owned by a store the root
starts).

## Context

P5's claim is that **one gated turn works in the real window**: the page's tools reach the
daemon's catalog, the gate lets the AUTO one through to the page, the GATED one becomes a card,
the user's answer resolves the row, and the decline lands on the ledger. Every part of that is
already covered somewhere — `tests/daemon/` runs a whole gated turn over real HTTP against a
`ScriptedTransport`, and `stores/run.test.ts` runs the panel's loop against an in-process fake
daemon — and none of it had ever run *together*, in a window, over an IPC, against a real page.

Two things stood in the way.

**The engine.** The sidecar spawns `athena serve` on `claude_code`, which runs the user's `claude`
CLI. A smoke that asks a model to call `invoice_list` and then asserts that it did is a smoke
whose red is usually the model having a different idea, and whose green costs money and a login.
The property under test is the *shell*, not the model.

**Where the loop lives.** The existing `ATHENA_SMOKE=1` is made in Rust: one `bridge_list` against
a fresh tab, one `println!`, exit. The turn is not reachable from there. The run loop is
`src/stores/run.ts` in the chrome webview (ADR 0017), and re-implementing it in Rust to test it
would be a test of the re-implementation.

## Decision

**`athena serve --script <path>` replays a recorded transcript instead of spawning the engine**,
through the same `ScriptedTransport` every daemon test already uses. `ATHENA_SCRIPTED_TRANSPORT`
says the same thing; `athena.wiring.scripted_factory` is the one place it is turned into a
transport factory, and it reads the file at compose time so a bad path fails on the daemon's
failure line rather than at the first turn.

**The sidecar passes it through from `ATHENA_ENGINE_SCRIPT`, in dev only** — a debug build, or a
release build that has already opted into the dev fallback with `ATHENA_DEV_FALLBACK`. A shipped
shell that replayed a file on the strength of an environment variable would be a shell whose
transcript is a lie about what ran.

**`ATHENA_SMOKE=turn` is driven by the chrome webview**, through `runActions.send` and
`runActions.answer` — the same seam `stores/run.test.ts` drives. Rust contributes two commands:
`smoke_mode`, so the webview learns what it was armed with, and `smoke_say`, so its lines reach
this process's stdout, which is what `scripts/smoke.mjs` reads. A `console.log` in a webview is
not on stdout and never was.

**Nothing else about the turn is faked.** The relay, the daemon over loopback, the catalog, the
class decision, the approval row, the replayed gate and the ledger row are all the real ones.
`ScriptedTransport` changes who produces the tokens and nothing else (ADR 0007).

## Consequences

- The turn smoke is deterministic, costs nothing, needs no login, and fails red when the *shell*
  breaks rather than when a model changes its mind. It found two real defects the day it was
  written: the card's transcript line carried an id and a name where the surface reads the whole
  card from it, and the store was managed after the webview that reads it was created.
- The daemon carries a flag whose only user is a developer. It is one argument, it is refused
  when the file is not there, and it is covered by `tests/daemon/test_scripted.py` — which also
  asserts that `apps/desktop/scratch/gated-round.jsonl` still addresses the tools the scratch page
  registers, so a rename on either side is a red test rather than a dead smoke run.
- A recorded round is a fixture and ages like one. It is synthetic and says so in its own header,
  exactly as `tests/fixtures/` does; replacing it with a real capture needs no code change.
- The smoke consumes the script in order, so a run that walks further than the file goes gets
  `TransportError` rather than an empty reply. The demo walk-through shares that file, which is
  why it carries a third round: an approved card executes on the page and continues the turn.
- Two more commands are reachable from the chrome webview and from no page (`capabilities/ui.json`
  grants them by webview label). Both are inert without the environment variable, and `smoke_say`
  can only print and exit — it reads nothing and returns nothing.

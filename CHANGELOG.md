# Changelog

One line per commit, newest phase first. Written by the orchestrator at the end of each phase.

## P4 — The shell skeleton (in progress)

- `feat(desktop): the window, the module bar, and the browser module` — Tauri v2 multi-webview, `layout.rs` owns every rectangle, the module contract and `preview.html?module=&fixture=&theme=`, the house-style token layer; popups allowed after measuring that Tauri denies them by default; ADR 0013.

## P3 — One turn end to end, no browser

- `feat(harness): structural policy` — per-lane allow-list, origin enabled, origin pinning, `connector_enabled` asked on every call; `to_cedar()`; `PolicyHook` in front of the gate.
- `feat(lane): the browser lane` — one turn composed, run and streamed; gated calls become `decision.requested`; `answer_decision` replays the gate and returns `execute` from the row's own parameters; ADR 0010.
- `feat(daemon): the server, the token, and one request per connection` — `ThreadingHTTPServer`, the token on every route including `/health`, `Connection: close`, CORS with preflight, the ready line; the starvation test first; ADR 0011.
- `feat(daemon): manifest, run, decisions` — `POST /manifest`, `POST /run` as SSE, `POST /decisions/<id>`; `wiring.build_local` as the composition root; ADR 0012.
- `feat(daemon): the read routes` — `GET /decisions`, `/ledger`, `/ledger/rollup`, `/playbooks`, all off read connections; the brain's read helpers moved off the writer; `athena serve`, `doctor`, `brain reconcile`; `docs/daemon.md` with the curl sequence.
- `fix(core): a model cannot answer its own card` — `core.answer_decision` removed from the catalog; the only path to a resolved approval is `POST /decisions/<id>`; ADR 0004 amended.

- `feat(bridge): inject.js, the page's half` — the `document.modelContext` polyfill, list/call over postMessage, toolchange, the 30 s abort, degrade to "no bridge"; ADR 0008.
- `feat(bridge): gate.js, the surface's half` — class derivation that only tightens, the refusal vocabulary pinned to `ERROR_REASONS` by `tests/test_refusal_parity.py`, the fence, bounded output, the per-origin budget; ADR 0009.

## P2 — The gate and the model

- `feat(core): approvals and the ledger` — the durable HITL table with exact-token resolve and 24 h expiry; one ledger row per invocation with normalised error reasons; both survive a reconcile; ADR 0005.
- `feat(core): the constitution and the two-output prompt composer` — law and identity from the wheel, a bundle or a marker-guarded checkout; `StaticBlocks` for the system prompt and a nonce-fenced `TurnFrame` for the user message; ADR 0006.
- `feat(harness): ports, hooks and the OP grammar` — `GateHook` (validator before class, replay proves the grant), `LedgerHook`, `TruncationHook`; the `OP:` parser with three repair rules.
- `feat(harness): the CLI harness in two dialects` — `claude` and `codex` through a `Transport` port, `--resume` for Claude, eight rounds per turn, engine probes; adds the `turn` id kind to `contracts/ids.py`; ADR 0007.

## P1 — Foundation

- `chore: scaffold the repository` — pyproject, uv lock, pnpm workspace, the gate config, ADR 0001.
- `ci: the gate on three Pythons and the JavaScript workspace` — GitHub Actions, 3.11 to 3.13.
- `feat(contracts): the seams every package is written against` — registry, manifest, channel events, harness, ids; ADR 0002 stdlib-only core.
- `feat(core): the brain, disk first, index second` — episodes, facts and procedurals with provenance at write; one writer, a read-only connection per request; reconcile; ADR 0003.
- `feat(core): recall, bounded and announced` — BM25 over FTS5, always-include tiers, a 20-episode window, per-block `(showing N of M)`.
- `feat(core): the catalog is the policy` — three registries, validators, manifest merge, `render_capabilities`, the `ConnectorPort` seam; ADR 0004.

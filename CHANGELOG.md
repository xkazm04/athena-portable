# Changelog

One line per commit, newest phase first. Written by the orchestrator at the end of each phase.

## P5 — MVP checkpoint

- `feat(desktop): the run loop, an AG-UI client of the daemon` — `lib/daemon-client.ts` for every route, `stores/run.ts` as the only run loop; a tightening rides on the manifest so the daemon holds the class; the headless test against a fake daemon (one AUTO round trip, one gated decline ledgered `user_denied`); ADR 0017.
- `feat(desktop): the panel and origins modules` — the tool list, the chat pane and the decision card as pure views over the run store; Origins with tighten-only overrides and Forget as an inline-confirmed row delete; six and five fixtures; ADR 0018.
- `fix(desktop): export RunStatus from the run store` — the one type the two halves disagreed on.
- `feat(desktop): the panel drives one gated turn in the shell` — a recorded engine the daemon replays (`--engine scripted`), `GET /health` gains engine probes, Settings restarts the daemon, Panel is the launch module, `ATHENA_SMOKE=turn` prints four assertable lines; two defects the window found are fixed; ADR 0019.
- `docs(desktop): phase 1 status and what is verified` — `docs/desktop.md`: the verification table with a command per row, the by-hand rows dated, the layout table, the dev affordances, the module list, what is not yet built.

## P4 — The shell skeleton

- `feat(desktop): the window, the module bar, and the browser module` — Tauri v2 multi-webview, `layout.rs` owns every rectangle, the module contract and `preview.html?module=&fixture=&theme=`, the house-style token layer; popups allowed after measuring that Tauri denies them by default; ADR 0013.
- `feat(desktop): the relay` — `inject.js` as every page webview's initialization script straight from the bridge package, a forwarder with the tab id and a nonce, `bridge_list` / `bridge_call` with the id map and the 35 s timer, `bridge_reply` as the page's only command, `bridge:toolchange`; the `ATHENA_SMOKE=1` line proven on a scratch page; ADR 0014.
- `feat(desktop): the sidecar, with exit hygiene` — a minted token file, the frozen binary or the `uv run athena serve` fallback, the bounded ready-line wait, the `/health` poll, restart on engine change, tree kill and a Windows job object with `KILL_ON_JOB_CLOSE`; all three exit paths walked by hand; `scripts/build-sidecar.py`; ADR 0015.
- `feat(desktop): the store, settings and setup modules` — one SQLite store with every table now (settings, origins, projects, project_pages, project_runs, activity, captures with an LRU sweep), four generic commands with `null` as the only empty value, the Settings and Setup modules with four fixtures each; ADR 0016.

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

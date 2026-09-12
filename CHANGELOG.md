# Changelog

One line per commit, newest phase first. Written by the orchestrator at the end of each phase.

## Examples — the studio and the journey (in progress)

- `feat(examples): the shared kit and the studio's world` — `examples/` joins the workspace; `@athena/demo-kit` pruned to `db`, `activity`, `seed`, `ui`, `zoom`, `webmcp`; the seed registry gains `STUDIO`, one billing contact per client and the named cross-app people and aliases; ADR 0014 narrows the example-app non-goal to the three the demo runs on.
- `feat(examples): ledgerbox, the books of act 1` — the Strip at `/`, variants removed; reads carry the client contact, `paid_ratio`, ambiguity and short-by on credits, the bank alias on a match; drafts are whole messages from the studio inbox; the close exports a titled markdown page.

## P5 — MVP checkpoint (done)

- `feat(panel): the module-first panel, its run loop and the seams that drive it` — four modules as
  view-model, fixtures and pure view; the run loop that carries a host tool's answer into the next
  frame and an approved card's instruction onto the page, bounded at eight continuations;
  `preview.html?module=&fixture=`; 27 headless tests against `dist/`; ADR 0013.
- `fix(core): the capability block teaches the OP grammar it always assumed` — found by a live turn:
  the model read the block, went looking for a native tool API and asked the user to run the tool.
- `docs: the phase-1 status, written at the MVP checkpoint` — what runs, what only a hand-run found,
  and what P6 inherits.

## P4 — The shell skeleton

- `feat(desktop): the shell skeleton — window, tabs, relay and sidecar` — one Tauri window with the
  380 px panel column and a page webview per tab; exit hygiene as kill-and-reap plus a Windows job
  object; the relay's Rust half with a 35 s sweep deliberately longer than the page's own abort;
  tabs that never reuse a label and settings that repair rather than refuse. ADR 0012.

## P3 — One turn end to end, no browser (done)

- `feat(bridge): inject.js, the page's half` — the `document.modelContext` polyfill, list/call over
  postMessage, toolchange, the 30 s abort, degrade to "no bridge"; ADR 0008.
- `feat(bridge): gate.js, the surface's half` — class derivation that only tightens, the refusal
  vocabulary pinned to `ERROR_REASONS` by `tests/test_refusal_parity.py`, the fence, bounded output,
  the per-origin budget; ADR 0009.
- `feat(harness): structural policy in front of the catalog, not inside the gate` — lane, origin and
  connector-liveness rules reaching the gate through `CatalogPort`; ADR 0010.
- `feat(lane): the browser lane, one turn streamed and no gated executor held` — compose, run, relay,
  record; the gated path closed later on `resolve` with the gate replayed against the approval id.
- `feat(daemon): the threading server, with the starvation test that shaped it` — ThreadingHTTPServer,
  `Connection: close`, a constant-time token, CORS from an allow-list; writing the test first found
  the brain's thread-bound writer. ADR 0011.
- `feat(daemon): the routes, the wiring and the sidecar entry point` — ten routes that decide nothing,
  a streaming `/run`, a resolve that takes a choice and nothing else, and a one-line JSON handshake.

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

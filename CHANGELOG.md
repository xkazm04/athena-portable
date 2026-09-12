# Changelog

One line per commit, newest phase first. Written by the orchestrator at the end of each phase.

## Connectors (in progress)

- `feat(connectors): Gmail and Notion behind one vault, entering the catalog like a page` — one JSON spec per service; the vault brokers every call with a host allow-list, a timeout, a cap and redaction; a token or grant is probed before it is sealed (keyring, DPAPI or an owner-only file); PKCE over a one-shot loopback listener; writes behind a switch and an egress allow-list, reads fenced and capped; `/connectors` routes; `Policy(connectors=vault)`; ADR 0021.
- `feat(desktop): the Connectors module` — one card per service: a standing derived at render, the seal sentence, reads and writes with GATED on writes only, the writes switch, the allow-list saved on purpose, a token field or the OAuth client pair with the consent flow's phase, the guide folded; `stores/connectors.ts` mirrors the daemon and keeps no credential; `connectors.css`.

## Desktop — the second pass (in progress)

- `feat(desktop): the Browser is about apps, and its ledger is the origins table` — the doorway when nothing is open, a ledger of registered apps with a standing derived from the tabs and the relay, register-then-open; `browser.css`; ADR 0022.
- `feat(desktop): the Panel is a conversation` — a 46rem column, bubbles and prose, deltas grouped in the model, activity folded to chips, cards at the end of the stream, the tool table as a disclosure, a docked composer, suggestions from the page's read tools, the voice partial in the composer; `panel.css`.
- `feat(desktop): Setup and Settings become one module` — one view-model with an onboarding letter and a settings list, the restart wired to the daemon store, readiness without stations; the settings directory removed; `setup.css`.
- `fix(desktop): the run loop holds a host call until the turn ends` — a gated proposal arrives as a `tool.call` followed by a `pending_approval` result and the card; running it on arrival ran the gated action before the answer. Calls are held, a result releases them, what remains at `turn.finished` runs.
- `chore(desktop): the mark in the bar, the icon set, and the stylesheet without the old panel and letter` — the reference build's logo as the window, taskbar and bar mark; the dead `.transcript`/`.composer`/`.panel-card`/`.passage`/`.rail` blocks removed.

## P8 — Voice (in progress)

- `feat(voice): the gateway and one backend` — `athena.channels.voice`: RFC 6455 in the stdlib, `/voice` on the daemon's port with the token in the header or the `athena-token.<token>` subprotocol, the `VoiceBackend` port with a scripted backend and an OpenAI one over `urllib`; an utterance runs the ordinary browser-lane turn with `surface = voice`, `trigger = voice`; the `TTS:` line or the text capped and announced; barge-in by generation counter; "approve" / "decline" / a label answers the card on top through `decide`; the `voice` event family and `TurnContext.trigger`; ADR 0019.
- `feat(desktop): push-to-talk` — a hold-to-talk key in the module bar and `Ctrl+Space` held in the chrome; the microphone as PCM16 at 16 kHz over `/voice` with the token in the subprotocol; a spoken turn lands in the panel's transcript and cards; the page's tools run through the relay and answer the daemon; the player drops a generation on `barge_in`; the Setup wizard gains a microphone passage, never required; the OS-global shortcut deferred and named; ADR 0020.

## Examples — the studio and the journey (in progress)

- `feat(examples): the shared kit and the studio's world` — `examples/` joins the workspace; `@athena/demo-kit` pruned to `db`, `activity`, `seed`, `ui`, `zoom`, `webmcp`; the seed registry gains `STUDIO`, one billing contact per client and the named cross-app people and aliases; ADR 0017 narrows the example-app non-goal to the three the demo runs on.
- `feat(examples): ledgerbox, the books of act 1` — the Strip at `/`, variants removed; reads carry the client contact, `paid_ratio`, ambiguity and short-by on credits, the bank alias on a match; drafts are whole messages from the studio inbox; the close exports a titled markdown page.
- `feat(examples): hirelane, the pipeline of act 2` — the Board at `/` with both tool sets mounted; `read_applicants` and `read_shortlist`; the Kestrel Labs applicant pinned from the registry; scheduling and rejection mail as complete envelopes from the studio inbox; no protected column, no protected parameter.
- `feat(examples): tidycrm, the contact list of act 3` — the Blocks at `/`, the AG-UI proxy removed; `read_conflicts`, `preview_company`, `resolve_company` through the revisions log; the registry contacts as anchors; a `clients` segment and a titled markdown export.
- `feat(examples): the journey, four acts run end to end` — `@athena/journey` boots the three apps in scratch directories, drives them through `inject.js` over the `athena-webmcp` protocol, classifies with `gate.js`, approves and declines through a surface fake, models mail and notes connectors behind egress allow-lists, and prints the ledger and the facts it cites.
- `feat(examples): ledgerbox ships The Lanes` — the newer direction restored from the reference repository as the root page; one manifest carrying the view layer and the books layer, 23 tools, three gated; the page reads the bridge's presence marker; ADR 0018.
- `fix(examples): the journey records itself on request, and the example-apps ADR is 0017` — `JOURNEY_VIDEO=1` records the run from the spec's own context (the config option a history rewrite carried in never applied); the ADR renumbered out of the 0014 collision.
- `chore(examples): one React types version, and the review cameras` — the four example packages move to the React types the desktop package pins, so react-three-fiber augments the copy Tidycrm compiles against; per-app screenshot scripts under `examples/journey/scripts/`.
- `feat(examples): ledgerbox readability pass` — a status component for presence, 12px floor on labels and legend, labelled view toggles moved beside the level rail, AUTO and GATED action bands, a scrolling aside at 1024.
- `feat(examples): hirelane readability pass` — the carousel overflow fixed, the handwriting face removed, one 12px sentence-case label style, avatar clusters with an overflow count, a live headline and presence line, a capability pill with a disclosure instead of raw tool names, AUTO and GATED as one class component; brief and law amended.
- `feat(examples): tidycrm readability pass` — one 13px sentence-case label style and one stat scale at all three depths, zone and block cards led by the name, deviations named as deviations, chips for the breakdown and the zone jump, a presence line, AUTO and GATED as one band component.
- `feat(examples): hirelane contrast is measured, and the label tier carries the accent` — `design/check-contrast.mjs` composites the translucent planes and scores every token against the worst of them, chained into `lint`; the ink ladder retuned to clear AAA on the three text rungs and AA on the fourth; `--bd-accent` spent where the brief always declared it, on the level rail's rung and the region titles, and kept out of the AUTO/GATED legend and the light gated panel; `design/ui-pass-brief.md` specifies the L1 and L2 layers still to come; ADR 0021.
- `feat(examples): hirelane's dossier is one action bar` — the two stacked action panels become one bar of two zones, measured down from 230px to 95px and the head from 190 to 116, so the reading column goes from 29% of itself visible to 44%; the class sits above its controls so a long name cannot wrap the bar, arming hides the reversible zone and takes the whole row, the note becomes a disclosure instead of a permanent textarea, and the phone gets a full-height sheet with side-scrolling zones instead of a pane that was 87% chrome; ADR 0022.
- `feat(examples): the take — narrate, record, compose` — `narrate.mjs` (ElevenLabs, one clip per beat, measured durations), `tests/take.spec.ts` (the beats of `script/journey.en.json` played one at a time through the real bridge and gate, a surface strip the runner injects, act 4 rendered from the live ledger and brain, `take/take.json` offsets), `compose.mjs` (clips laid at offsets, captions, mp4); docs/demo.md section 1.

## P5 — MVP checkpoint (done)

- `fix(core): the capability block teaches the OP grammar it always assumed` — found by a live turn against a real CLI: the model read the block, hunted for a native tool API, and asked the user to run the tool instead.
- `feat(desktop): the panel module, an AG-UI client of the daemon` — `lib/api.ts` with `fetch` as an argument, `stores/run.ts` as the only run loop with its host-tool and approval continuations bounded at eight, the Panel module with the card's own parameters and the tool list; 14 headless tests against a fake daemon and a fake page.
- `fix(core): the approvals inbox is ordered by insertion, not by a random id` — five cards in one millisecond came back shuffled.
- `docs: the phase-1 status, written at the MVP checkpoint` — what runs, what only a hand-run found, how to launch it, and what P6 inherits.

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

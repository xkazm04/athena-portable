# Open items, scan-sweep --challenge, 2026-10-15

The run built 11 of its 12 cards (`.claude/scan-sweep/runs/challenge-2026-10-15/deck.md`). What
it leaves: one card the method would not build, the ideas the scouts re-homed for being under
the challenge floor (each an S or a low-impact M, the stabilize loop's work), and what the
builders found along the way. Anchors are repo-relative and were true at the run's base.

## Excluded - a direction outside the declared scope (needs an owner call)

- **demo-kit-zoom-engine/B: the level is a place: Back walks up, reload lands where you stood.**
  L, effort 7, impact 8, risk 6. URL-held levels (state.ts, nav.ts, a new place.ts and
  useNavUrl.ts, Levels.tsx, atlas Shell.tsx). The critic confirmed the premise, but URL sync is
  outside the context's declared scope (camera, level flight, identity, overlay and escape,
  roving focus, echo, tokens), so challenge mode never builds it. The card, with 8 acceptance
  cases, is in `.claude/scan-sweep/runs/challenge-2026-10-15/cards/demo-kit-zoom-engine.json`.
  The critic's one revision applies: an abort pops the entry its move pushed (it does not
  replace it), so one Back press leaves the level that was current before the click.

## Found while building (follow-ups)

- `packages/athena-bridge/test/inject.test.js:195`: the 20 ms deadline test checks after an
  80 ms settle and fails about 1 time in 10 on Windows under load (Windows timers tick at about
  15.6 ms). Pre-existing; the code was unchanged by the run.
- `tests/adopt/test_research_lanes.py::test_a_cancelled_session_stops_the_harvest_and_starts_nothing_new`:
  a 0.1 s cancel thread races the first lane under full-suite load. Pre-existing timing flake.
- `tests/channels/test_voice_gateway.py::test_a_session_remembers_the_newest_cards_and_a_bare_yes_answers_the_newest`:
  a fixture race, seen once under sibling load.
- The daemon's writes switch does not block a connector tool whose spec leaves `reversible`
  unset, while the panel (ADR 0116) now lists such a tool under writes. No built-in spec does
  this today. Fixing it in the daemon is a policy-tighten.
- None of the 11 landed changes was seen in the real Tauri window or a browser: the board's
  Undo and History band, the zoom rig's pointer capture and click swallow, the panel's Stop and
  connector line, and the one-press reconnect.

## Re-homed by the scouts (under the challenge floor; stabilize-loop material)

connector-service
- Connector write timeouts and 5xx are outcome_unknown, as ADR 0101 has it for pages (`src/athena/connectors/service.py:138` maps every VaultError on a send to engine_error). S.
- DPAPI seals with null entropy, and the ciphertext is not bound to its handle (`src/athena/connectors/seal.py:154`). Bind the name as entropy, with a read-old-then-reseal fallback. S.
- Provider dispatch is a hand-kept if-chain per tool name beside the spec's tool list (`providers/gmail.py:132`, `notion.py:121`). Add a parity test or a handler table. S.
- An OAuth admission re-merges the catalog from the flow thread outside `daemon.writing()` (`oauth.py:166`, then `vault.py:699`, then `wiring.py:387`), unlike every other connector act. S.

demo-kit-zoom-engine / page-bridge
- `camera.ts` FLY_EASE and DEFAULT_EASE retype `--dk-ease`, and BEZIER_RE re-parses what `tokens.ts` parseBezier parses. S.
- R4-5: `rig.frame()` and `(pose, frame)` for resolveGroup, resolveItem and poseFor. S.
- `echo-rule.ts` samePlace duplicates `state.ts` sameFocus. This is deliberate (the node ESM value-import rule). XS.
- page-bridge: validate call input against inputSchema in `inject.js` (defence in depth; `src/athena/core/catalog.py:357` already validates). S.
- page-bridge: give "No tool named" and "Unknown request" their own codes, apart from a handler fault (a REFUSAL_REASONS member, a contract). S.

desktop-client-lib
- `plain.ts` has no sentence for `approval_spent`, and the `plain.test.ts` REASONS list is not pinned to gate.js REFUSAL_REASONS. S.
- `events.ts` mirrors `contracts/channel.py` by hand, with no parity test. S.
- `companion/tools.ts` toolRows merges hands without withHands' tabs_read rule. S.
- Tauri command names live in four hand-kept lists (build.rs, lib.rs, capabilities, ipc), with no parity test. S/M.

harness-engines
- `child_env` strips only ANTHROPIC_API_KEY, so OPENAI_API_KEY reaches codex (`src/athena/harness/transports.py`). S.
- `engines._logged_in` treats a credential file's existence as signed in (`engines.py:175`). S-M.
- `Policy.authorize` and `Policy.to_cedar` are two hand-kept renderings of four rules (`policy.py:148`, `:274`). Impact under 7.

hirelane-board-ui
- `Board.tsx:382-393` totals obey roleFilter but not onlyBorderline. S.
- `carousel/Slide.tsx:287` has a dead `medians.size === 0` branch. XS.
- `motion.ts:72` RISE copies `--hl-space-2` by comment. S.
- `design/check-contrast.mjs:89` hand-copies the slide gradient's 8% stop. S.
- `proposeSlots` (`actions.ts:191`) holds slots for decided or pre-interview candidates and re-holds on every call. A policy-tighten, S.

voice-channel
- `home.dry_check` caches a broken verdict per exe size and mtime forever (`home.py:141`). S.
- `VoiceSession.say` and the typed text frame path have no desktop caller. S.
- A resumable, staged Kokoro install (`install.py:362`). M, impact 6.

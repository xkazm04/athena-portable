# Open items, scan-sweep --stabilize, 2026-10-16

The loop swept 60 of the root map's 64 contexts in 45 rounds (12 waves) and built 413 fixes. What
it leaves is in `.claude/scan-sweep/runs/stabilize-2026-10-16/findings/*.jsonl`, one file per
round, one card per line in the skill's section 9 shape with `lane` and (Lane B) `instrument`.
A line with `"status":"built"` was built by a later round and is not open. Round summaries,
lens coverage and gate results are in `rounds/` beside it.

## Lane B - 155 cards, drainable

Each card names the instrument that would decide it. Drain them with `/scan-sweep --ab-only`
(isolated workers, the same figure on both arms). The ones most worth a person's attention first:

- ledgerbox-app-shell: a retried payment is recorded twice; an older reminder letter can be
  re-sent; agent writes are logged as "user".
- core-gate-and-ledger: nested object params are not validated; a grant a racing decline just
  closed is refused with the wrong reason.
- contracts-seam: `ToolEntry` admits a connector entry with no executor, which the gate then
  treats as a host tool.
- harness-engines: every codex turn persists its whole prompt, page text included, on disk.
- daemon-service: every origin ever registered keeps its session, pin and tools for the
  daemon's life; the minted token file is written with default permissions and chmod-ed after.
- desktop-setup-module: after a one-press Reconnect whose browser never opened, Reconnect stays
  locked up to 10 minutes, though ADR 0117 says to press it again.
- proving-core / proving-characters-gauntlet: an unpriced role call costs nothing in the purse,
  so the cap never binds; proof 1 reads PASS when no turn was observed.

## Lane C - 58 cards, owner calls

Filter the findings files for `"lane":"C"`. By gate: 35 `direction` (mostly design calls: type
sizes, targets, tokens, unused routes and actions), 6 `policy-loosen`, 3 `architecture`,
1 `irreversible` (DPAPI seal entropy), 1 `policy-tighten`, 1 `contract`, and 11 with no gate
that need the real Tauri window or a browser to measure. The ones that change what the product
permits:

- desktop-client-lib: her window calls `tabs_focus` and `daemon_restart`, which `athena.json`
  never grants, so three of her buttons fail. Granting widens the capability.
- daemon-service: admit `http://127.0.0.1` as a page origin beside `localhost` (518fc33 built it
  from a director's table; 15c4eee restored the refusal).
- proving-hosted-server: the judge token can be guessed without limit; no record says who
  started or cancelled a run. **Owner, 2026-10-21: no lockout for now.** A per-peer throttle
  (belay wave-7 lane, 405c63a3, rejected) would let a stranger behind the same proxy lock every
  judge out; keep it here, and if it returns, budget per presented-token prefix, not per peer.
- connector-service: connector acts that widen what Athena may send leave no record.
- desktop-build-config: first paint is about 159 kB gz against ADR 0095's 125 kB; 27810da holds
  it at a 161,000 B ratchet and closing the gap is a decision.

## Carried from challenge-2026-10-15

- demo-kit-zoom-engine/B, URL-held levels: excluded direction card, unchanged
  (`.claude/scan-sweep/runs/challenge-2026-10-15/cards/demo-kit-zoom-engine.json`).
- `tests/adopt/test_research_lanes.py` cancel test: a pre-existing timing flake. It did not
  fail in any of this run's 13 full-suite runs, and nobody fixed it.
- None of the challenge's 11 features, nor any of this run's UI fixes, has been seen in the real
  Tauri window or a browser.

## Not swept

`daemon-e2e-tests`, `demo-kit-tests`, `desktop-e2e` and `tidycrm-tests` (test-only contexts; the
overlay's `neverSweep` names tests). Files in no context: `apps/desktop/src/lib/execute.ts`,
`examples/hirelane/lib/acts.ts`, `src/athena/channels/voice/speech.py` and its test; the map
also still lists files this run deleted (`rails.css`, PushToTalk). A Personas rescan fixes both.

## Drained 2026-10-18 (Lane B pass over five contexts)

Built, each marked `status: built` in its findings file: core-gate-and-ledger nested params (74e7aa1) and racing decline (a4f8374); contracts-seam connector executor (0c92247); proving-characters-gauntlet proof 1 (9757f7f); proving-core unpriced purse (675b36f) and raising role client (609f0c5); daemon-service token file (e15d64a). Still open from those contexts: daemon-service session/pin/tool pruning (M, the unregister act is a design call), the runner.py hand-kept copies card, the bench/showcase world leak, extract_json cost.

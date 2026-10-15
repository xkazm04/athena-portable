# Deck - challenge-2026-10-15

Approval: `--go`, given by the operator in advance at the run's opening question ("build every
survivor"). Critic: claude-opus-5-5 (independent subagent). 12 cards, 0 premise-false, 0 void,
7 revised, 1 excluded, 11 approved.

Ranked by impact x critic mean (ambition, grounding, falsifiability).

| # | Card | Slot | Size | Risk | Files | Gate | Critic | Verdict | Wave |
|---|------|------|------|------|-------|------|--------|---------|------|
| 1 | harness-engines/B - Stop a running turn; the 25-minute wall is the turn's | B ux | L | 6 | 11 | none | 5/5/4 | revise: stop() carries pending page results to the next exchange | 3 |
| 2 | desktop-client-lib/A - One host-call executor: spoken turns get the ADR 0101 hold | A arch | M | 6 | 9 | policy-tighten | 4/5/5 | build | 2 |
| 3 | voice-channel/A - A heard utterance ends in a typed outcome across the wire | A arch | M | 5 | 14 | contract (tests/contracts/test_channel.py) | 4/5/5 | build | 1 |
| 4 | connector-service/A - Credential health is a verdict plus an attempt | A arch | M | 5 | 10 | none | 4/4/4 | revise: probe refreshes directly, not via _fresh_token | 1 |
| 5 | demo-kit-zoom-engine/A - The rig's pointer is a pure gesture machine | A arch | M | 5 | 10 | none | 4/5/4 | revise: next down clears the click swallow | 2 |
| 6 | hirelane-board-ui/B - Every reversible act on the board gets its undo | B ux | M | 5 | 14 | none | 4/5/4 | revise: drop case 9 | 2 |
| 7 | connector-service/B - Reconnect is one press, reusing the sealed client | B ux | M | 4 | 12 | none | 3/5/4 | build | 5 |
| 8 | desktop-connectors-panel/B - A connector card names its account and readiness | B ux | M | 5 | 14 | none | 3/5/4 | build | 4 |
| 9 | voice-channel/B - Her spoken reply passes one speech door | B ux | M | 4 | 11 | none | 3/5/3 | revise: SPOKEN_BUDGET fixed at 360 | 2 |
| 10 | hirelane-board-ui/A - One act-availability module for dossier and actions | A arch | M | 5 | 13 | none | 4/5/5 | build | 1 |
| 11 | harness-engines/A - A CLI round ends in a typed exit; a gone thread reseeds once | A arch | M | 5 | 5 | none | 4/3/4 | revise: Transport.run stays str-only; exit via a separate member | 1 |
| - | demo-kit-zoom-engine/B - The level is a place: Back walks up, reload lands | B ux | L | 6 | 12 | direction, OUTSIDE scope | 4/5/3 | EXCLUDED - never built in challenge mode; backlogged | - |

Waves (disjoint write sets; shared surfaces CHANGELOG.md, docs/adr/, docs/daemon.md,
docs/kit-camera-contract.md, docs/layered-ui-formula.md under the mkdir lock):

- W1: hirelane-board-ui/A, harness-engines/A, voice-channel/A, connector-service/A
- W2: hirelane-board-ui/B, voice-channel/B, demo-kit-zoom-engine/A, desktop-client-lib/A
- W3: harness-engines/B
- W4: desktop-client-lib/B (desktop-connectors-panel)
- W5: connector-service/B

Signature order honoured: voice/A before desktop/A (VoiceTranscript), connector/A before
desktop/B and connector/B (ConnectionRecord), desktop/A before harness/B (run.ts), hirelane/A
before hirelane/B (refusal builders), desktop/B before connector/B (rowOf).

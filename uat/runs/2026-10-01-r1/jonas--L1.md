# jonas (the skeptic) - L1 (code only, no browser)

Run 2026-10-01-r1. Findings: `jonas.findings.json` (16: 13 defects, 3 strengths). Reproduction: a throwaway vitest
in the session scratchpad (not in the repo) importing `companion/model.ts`, `companion/tools.ts`, `companion/machine.ts`.

## Verdicts

| Journey | Verdict | Why |
|---|---|---|
| J3 decide-a-card | **L1-conditional** | Stamp, A/D, chord, per-card parameters in full all work on paper. The card omits its origin and expiry (jonas-7), and the Record says "approved" before the daemon has answered (jonas-6). |
| J4 trust-record | **L1-fail** | Criteria 1, 4 and 6 fail; 3 is half true. The origin switch changes no behaviour (jonas-1), the generic hands are not wired at all (jonas-2). |
| J5 workday-main | **L1-conditional** | Browser/Connectors/Setup are honest about connectors and engine probes. Two sentences are false: "Athena stays" on Close (jonas-11) and "switched off; nothing runs here" (jonas-1). |

## Scored criteria

1. New origin starts GATED or off, UI says so first: **fail** (jonas-3, jonas-4). `blankOrigin` is in-memory only; no first-sight write; a URL-bar origin has no row and Talk is not blocked on trust (`model.ts:543`).
2. Declined card in the record with reason class: **pass for this window run only** (`runtime.ts:100-103`, `views.tsx:497-503`). Not persisted, written at press time, duplicated by a "declined: card_x" tool row (jonas-10).
3. Shown-of-total: **partial**. Model calls: true daemon footer (`routes.py:225`, `views.tsx:539`). Session list: `(showing N of N)` computed from its own arrays (`views.tsx:515`). Offers: true (`model.ts:311`, executed: 12 of 30 prints "(showing 12 of 30)").
4. Page tools vs generic hands, each with a gate class: **fail**. Page tools get a word chip (`drawing.tsx:171`); hands never appear (jonas-2). Tier is not shown anywhere (`tools.ts:24` hard-codes 1).
5. No credential rendered: **pass** with a caveat (card params are model-supplied and unredacted) (jonas-15).
6. "Last hour, which site" in at most 3 actions: **fail**. Two actions reach Record, but no row carries origin or a full timestamp (jonas-5).

## 1. Surface model (control -> handler -> store/IPC -> backend)

- Seal click -> `actions.seal` (`views.tsx:57`) -> `rt.dispatch seal` (`live.tsx:246`) -> `machine.ts:313` sets mode ledger -> `athenaSetSize` (`companion.ts` -> `companion.rs` table). Record tab: `actions.tab` -> machine tab -> `live.tsx:229-243` fetches `DaemonApi.ledger()` -> `GET /ledger` -> `ledger_recent` (`routes.py:724`) -> `companion_turn`.
- Approve/Decline -> `actions.approve/decline` -> machine `decide` (`machine.ts:278`) -> effect `answer` (`runtime.ts:96`) -> `useRun.answer` (`run.ts:370`) -> `POST /decisions/<id>` (`api.ts:205`) -> `decide` (`routes.py:574`) -> lane gate replay -> `execute` row -> `onPage` -> `bridgeCall` -> Rust relay.
- Origins "Disable/Enable" -> `actions.setOrigin` (`live.tsx:261`) -> `useOrigins.setEnabled` -> `originWrite` -> `store_set` -> SQLite + `store:changed` (`store.rs:940`) -> other window `loadAll` (`origins.ts:166`). Terminates in the table; no reader enforces it.
- Browser: register (`browser/index.ts:47`) -> `save(enabled:true)` then `tabs_create`; switch off / forget -> origins store. Connectors: `stores/connectors.ts` -> `/connectors` routes (vault).
- Theme: `setTheme` -> `applyTheme` + `settingWrite` -> `store:changed` -> `readRows` in the other window (`settings.ts:131-133`). Both windows follow.

## 2. Reachability (jonas)

First launch: only `welcome` (Main hidden) until "Open your first app" or Later; Record/Origins are reachable only from `ledger`, which Esc/Later leaves reachable by seal click. Engine present (Claude Code) so Talk is enabled; Codex absent is priya's arm. Origins tab lists only origins that have a row: a never-registered origin is `unreachable` in the UI. Docked/hidden: a card while hidden shows seal/tab with ring and count, not the slip (`machine.ts:233-240`), so Record can still be opened by clicking the seal. Hands: `unreachable` (no TS caller).

## 3. Wiring audit (declared vs used)

- Tauri commands registered: 24 (incl. `hands_call`, `hands_list`); with a TS caller: 22 (**22/24**). The two with none are the whole tier-2 surface.
- `DecisionRequested` fields: 12; rendered or used: ~5 (id, action, rationale, params, options for the choice id) (**5/12**); never reached a view: origin, expires_at, decision_kind, surface, capture_id, kind. `CardView.capture` is always `null` live (`model.ts:336`).
- Daemon `/ledger` row fields: 17; kept by `ledgerFrom`: 8 (**8/17**); origin, surface, trigger, tokens, ms, conversation_id dropped (`model.ts:460-468`).
- `OriginRow` fields: 5; `first_seen` never rendered; `overrides` rendered as a count with 0 writers (`setOverride` 0 callers); `enabled` 0 enforcers.
- `activity` table + `ActivityRow` type: 0 writers, 0 readers. `Policy.disabled_origins`: 0 production writers. `gate.js decide()`: 0 callers. `CompanionModel.talk.ready`: 0 views (`model.ts:299`, test only). `activeProjectId` / `TurnBody.project_id`: 0 UI callers.
- Orphans: none of the example fixtures leak into live paths.

## 4. Grounding audit of the turn

1. Page's own tools: **yes, conditionally** - only if the page has an `athena:app` id and at least one tool (`manifest.ts:47`); otherwise nothing is published.
2. Focused page's origin: **yes** (`run.ts:126`, `host_state.page_url`).
3. User's message: **yes**.
4. Project: **no** at the surface (`project_id` never sent).
5. Prior fact from the brain: **daemon-side only, not visible to the user or verifiable at L1**.
6. Gate class of each tool: **yes for page tools** (`tools.ts:22`), no class for hands (absent).
Score **3.5 / 6**. Additions: `host_state` (up to 12 tabs, url+title; `run.ts:125-126`) and carried `tool_results`. Note the tab list leaks every open tab's URL into the fenced frame; for the skeptic that is a thing to be told, and nothing in the UI says so.

## 5. Walk

**J3.** Card arrives while the window is visible: slip opens, Approve focused (`live.tsx:75`). I read action, rationale, params in full (strength). I cannot see the site. A/D works only when not typing. Press: stamp immediately, SR says "Approved. Stamped and sent to the record." (`machine.ts:293`) though nothing has gone to the daemon. Executed branch enumeration of `recordOf`: ok host tool (chip AUTO/GATED, result ok), refused tool.result (chip, "refused", unstyled), declined card (no chip, "refused", app "declined: card_9"), hands row (no chip). All four are rendered; only the first is clean. If tab focus moved, `onPage` refuses `foreign_origin` and the daemon 403s, but the Record already says approved (jonas-6). Two cards: second is announced as "and N more waiting after this one"; fine. Voice answer: no stamp, known gap, not re-reported.

**J4.** From rest to Record: seal (1), Record tab (2). I see "Every call, by app and gate class" and a list that vanishes on Clear or restart, then "Model calls" with HH:MM, model, rounds, cost. No site. The Origins tab shows what the focused page offers (chip per tool, first 12, honest footer) and "Apps she has seen" with Enable/Disable. That toggle changes nothing downstream (jonas-1). "Disable" updates last_seen (jonas-13). Cross-window: `store:changed` re-reads both mirrors (`origins.ts:166`), so the two windows agree about the same fiction.

**J5.** Register and open writes `enabled:true` then opens the tab (`browser/index.ts:51`); rows show standing words (closed/reading/ready/hands/disabled). "hands" is a standing for a page whose generic hands do not exist in the turn path (jonas-2). Theme: one row, both windows. Min 900x600 (`lib.rs:284`). Close quits the app (`lib.rs:303`) under an aria-label that says Athena stays (jonas-11). Connectors: the token field is a password input, the seal is named, writes list is badged GATED, "off" pill says nothing runs - this one is enforced daemon-side by `connector_enabled` (`policy.py:223`), unlike origins.

Shared mapping enumerated: `rec-*` classes (approved, user_denied, waiting styled; refused, ok, recorded unstyled), gate chips (READ, AUTO, GATED all words), companion forms in `CAPTION` (7 forms all mapped), all clean except the rec classes.

## 6. Time saved

Manual 60 min of CRM cleanup. Designed (if the gate were as visible as the copy says): ~25 min saved, confidence 0.4. As built: ~5 min, confidence 0.3, because I would still verify every action in a terminal.

## Review, in my voice

Where is the log? There is one, and it is a window-run scratchpad. I asked for what ran, on which origin, what was declined, and the Record gives me a tool slug the page chose for itself, no site, no date, and it is gone when I press Clear. The model-call list is real and honestly counted ("showing 20 of M" comes from the daemon), and I will give it that. The decline is recorded as `user_denied`, in the word the gate uses, and card parameters are printed whole. That is the good half.

The bad half is that the switch lies. I turned an origin off; I read "switched off; nothing runs here"; I traced it and nothing outside the two views reads that column, and the daemon is constructed with an empty disabled list. That is the exact failure I came here to catch: a control that says off and is not. The copy "a page's tools are off until you say otherwise" is the same sentence, and it is false too. The "generic hands" are claimed on three screens and exist only in Rust. And the approval is logged as approved before the daemon has said so.

Would I adopt it: not for a client's CRM. For my own scratch data, with a terminal open next to it. Would I tell a peer: I would tell them the architecture (gate in Python, classes derived, refusals closed-set) is the right one, and that the surface does not yet show it. Missing for my job: an origin on every card and every row, a persisted resolved-decisions list, an honest off switch.

## L2 priorities

jonas-1 (disabled origin turn), jonas-6 (approve after tab move), jonas-3 (unregistered origin turn), jonas-5 (restart then Record), jonas-11 (close with a card waiting). All need: onboarded store, dev:tidycrm and dev:ledgerbox up, Claude Code signed in, one real gated turn.

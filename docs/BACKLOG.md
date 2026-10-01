# Backlog

Entries come from `/uat drain` (analysis: `docs/uat-insights/<run-id>.md`). Each names the findings that justify it, the acceptance
a re-run must show, and `standard: none` (no registry subscription in this repo). A **hypothesis** root cause is to be verified by the fixer first.
A shipped item is not done at merge: it re-enters `/uat recertify` against the originating Character's criteria.

## From run 2026-10-01-r1

### Build

| id | pri | item | justified by | acceptance (L2 unless noted) | notes |
|---|---|---|---|---|---|
| B1 | critical | Approval truth: keep the card until the daemon answers; show a refusal in plain words; re-read `GET /decisions` at start and after any failed answer so no pending decision is invisible | mira-4, jonas-6, juror-9, mira-5 | with focus on another origin, Approve shows a refusal and the card stays; after a restart every pending approval has a card; "Approved" never appears for a refused answer | hypothesis: optimistic `run.answer`, `DaemonApi.decisions()` unused. Guardrail: one-key answer, "Nothing runs until you sign" |
| B2 | critical | Enforce the per-app switch: pass the disabled origins to the policy; make the UI words match what it does | jonas-1, mira-11 | a turn on a switched-off origin is refused by the gate (including a gated action); Browser, Origins and the daemon agree | hypothesis: `wiring.py` never passes `disabled_origins`. Needs a unit test first (AGENTS.md) |
| B3 | high | Main's close button: relabel to what it does now ("Close Athena"); record the behaviour choice (quit versus hide to tray) in the next ADR | mira-6, jonas-11, juror-6, priya-12 | label and behaviour agree; with a card pending the close is not silent | trivial copy; behaviour is the owner's call |
| B4 | high | Wire the engine probe: a daemon route for `probe_all`, shown in the welcome and Setup, with a plain remedy and a working "Check again" | priya-1, 2, 3, 4, 6, mira-9, juror-1 | on a claude-absent host the welcome and Setup name the missing engine in plain words and a re-check flips it without a restart | verified L1 + live text; the missing-engine arm needs a fixture (renaming the CLI) |
| B5 | high | First launch reaches a first app: "Open your first app" opens one (or asks for its address in place); the Setup letter is not skipped; "Later" shows a way back to Main | priya-5, juror-4, mira-10 | from a fresh store: at most 3 actions to a loaded app and a mention of the engine; Later leaves a visible way back | L2 confirmed the empty Browser |
| B6 | high | Record: truthful header, origin and tool on every row, local times, resolved decisions persisted, shown-of-total on every list | jonas-5, juror-11, uat-1 | after a restart the Record answers "what did she do, on which site"; no sentence in it is contradicted by the list below | daemon ledger keeps more fields than the UI (hypothesis: 8 of 17) |
| B7 | high | Time zones: parse zone-less UTC stamps as UTC and format as local, everywhere (Browser, Connectors, Record) | uat-1 | in a UTC+2 and a UTC-5 locale a row written now reads "just now" and the clock matches | verified by reading `whenSeen` and live |
| B8 | high | Pill and status: derive "working" only from a running turn | juror-3 | pill reads "resting" in the ledger when idle | fold into B1 |
| B9 | high (hypothesis) | Arrival policy while put away or unfocused: no focus steal, no slip over the user's work, A/D scoped to her window, chords announced | mira-2, mira-3, mira-7, mira-8, ana-1, ana-4 | with another app focused and her put away, a card arrives without moving focus or opening the slip | L2 NOT proven. Do M1 first, then fix. ADR 0026 is the acceptance text |
| B10 | high | Accessibility cluster: live region naming action and recipient; focus returns after the slip tears; keys to move, dock and put away; resting dim never below 4.5:1; Main fits the work area at 150%; Tab reaches the page | ana-2, 3, 5, 7, 8, 10, 11, 12, 14 | NVDA announces a card on arrival; at 150% on 1080p every state is on screen; Tab never enters clipped controls | L1 only. Needs the rig in M2 before any `resolved-verified` |
| B11 | medium | Page tool ids versus numbers (example app): accept either or say "use the id inv_..."; fix the README demo ids | uat-3 | a reminder by number reaches a draft without a correction round | ledgerbox is a scratch host |
| B12 | medium | Honest copy for the generic hands until they are wired (three screens claim them) | jonas-2 | no screen claims a hand that no path can reach | hypothesis; wiring is C-doc follow-up |
| B13 | medium | A plain sentence for refused turns (`foreign_origin`, `no manifest`) naming the tab to focus | uat-2, priya-6 | the refusal text has no origin or manifest vocabulary | pairs with B1 |
| B14 | medium | Setup and the L2 env state where memory lives and that it survives a store reset | uat-4 | Setup says so; an L2 run can point the brain elsewhere | likely by design |

### Concept-docs (write or extend before any code)
- **C1 What a card must show, and from where** (justifies B-next after D3: recipient, subject, body, origin; source other than model prose). Needs an ADR and a contracts test.
- **C2 Vocabulary layers.** Opposing verdicts (Jonas needs precise terms, Priya needs plain words); decide the primary user and the layering.
- **C3 Batch decisions** (Mira: 37 reminders, one card each). Collides with one-decision-one-signature.
- **C4 A first prompt that reaches a card in ninety seconds** (juror), and whether a built-in demo origin is allowed given README section 8 and the stylised-label rule.
- **C5 Should Athena outlive Main** (hide to tray as her home), with B3.

### Method commitments (standing, with a trigger)
- **M1 Scripted engine through the shell.** Expose the daemon's `--transcript` (or an env var) in the sidecar launcher so a card can be produced on cue. Trigger: before the next L2 run that touches cards, hide or focus (B1, B9).
- **M2 A 1080p at 150% rig and NVDA** for the accessibility L2. Trigger: before closing B10.
- **M3 Every release re-runs, at L2:** J3 foreign-tab approve, J4 off switch, J5 close, restart-with-a-pending-decision. Trigger: each release candidate.
- **M4 Driver hygiene.** The driver asserts and prints preconditions and treats 401 or empty as a failure; a cleanup step never changes the state under test. Trigger: now (overlay `env.md`), and propose to the skill.

### Declined, with reasons
- **A third, high-contrast theme** (ana): the contrast failures are the resting dim and the composer border, not the paper pair (4.89:1 and up). Revisit if an L2 under Windows high-contrast shows otherwise.
- **Voice-answered cards get a stamp**: needs a voice backend, an accepted gap. Re-enters with a backend.
- **Product change to shorten the model's recovery from a wrong id**: the model recovered honestly; the cause is B11.

### Guardrails (do not break while building the above)
- The slip stays answerable in one key without Main; "Nothing runs until you sign" stays; Approve and Decline stay on the first screen of the 488x316 slip.
- Failed turns stay ledgered, cost per round stays visible, and the run loop keeps running while she is hidden.
- First launch stays one window; the resting form stays 92x92; type floor stays 12px; paper contrast stays at 4.87:1 or better.

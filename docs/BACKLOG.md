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
- **Voice-answered cards get a stamp**: needs a voice backend, an accepted gap. Re-enters with a backend. **Taken up (ADR 0188):** the backend exists (`src/athena/channels/voice`) and its `decision.resolved` reaches `stores/voice.ts`; a spoken or phone answer now stamps and lands on the Record.
- **Product change to shorten the model's recovery from a wrong id**: the model recovered honestly; the cause is B11.

### Guardrails (do not break while building the above)
- The slip stays answerable in one key without Main; "Nothing runs until you sign" stays; Approve and Decline stay on the first screen of the 488x316 slip.
- Failed turns stay ledgered, cost per round stays visible, and the run loop keeps running while she is hidden.
- First launch stays one window; the resting form stays 92x92; type floor stays 12px; paper contrast stays at 4.87:1 or better.

## From run 2026-10-23-chores

Analysis: `docs/uat-insights/2026-10-23-chores.md`. Spark `chores-uat` builds B-C1..B-C7 in its fix wave; each is
done only after `recertify` re-runs the touched pairs.

### Build

| id | pri | item | justified by | acceptance | notes |
|---|---|---|---|---|---|
| B-C1 | critical | One money figure per chore (example case's money back, derived) + a labelled author estimate with basis, sources, caveat | all `*-01`; health-03, family-01, housing-01 | no topic page shows two different totals for one quantity; every dollar figure states its source on the same screen | WP-N + WP-K; standard: measurement-honesty/co-published-numbers-must-reconcile, public-claim-provenance/no-data-source-labelled-inline |
| B-C2 | critical | Figures labelled by kind; only money back sums | commerce-03, construction-02, freight-03/11, employment-04 | "found" totals equal the money-back sum; no scoring weight renders with "$" | WP-N, WP-R, WP-K |
| B-C3 | critical | Brief: playbook rules "(from the playbook)", never "(my guess)"; a "Dates that matter" section | freight-01, health-01, employment-03, benefits-03, construction-08 | re-run pairs: zero playbook-sourced rules marked "my guess"; every brief with a known anchor shows a date | WP-B |
| B-C4 | high | No example-world leak (first-card options, opening line, brief facts, Start-for-real command) | benefits-05, family-02/03, construction-12, health-06 | re-run pairs: no invented app name offered; no example fact stated as the person's; the real command names no invented entity | WP-B |
| B-C5 | high | Rehearsal honesty: true label, no stale grading, not the example's script, "would propose" for list-only | housing-02, consumer-10, public-03/05, family-09 | an unshaped rehearsal never says "shaped like your case"; a shaped one shows no outcome words | WP-R |
| B-C6 | high | Time saved with review; verdict and runs shown | employment-02, public-02, health-04 | the ratio on screen equals manual / (bench + review); "fell short" is visible where it is true | WP-N |
| B-C7 | high | Fit stated (where, not for, asks for, costs) and answered in the interview | housing-04, commerce-06, benefits-04 | a person outside `fit.where` is told on the first card | WP-K, WP-N, WP-B |
| B-C8 | medium | Due cadence anchored to the chore's window for yearly chores | housing (Due) | a property-tax chore adopted in October comes due before the protest window | backlog; shipped 2026-10-25 (ADR 0131 amended: the suggestion is anchored to a dated brief line or confirmed date fact), done after recertify |

| B-C9 | high | Re-film or crop the topic stills so no picture shows a figure the page does not (R-1) | recertify R-1 | no still contradicts the tiles | evidence films predate ADR 0136 |
| B-C10 | high | The interviewer asks for the person's own anchor dates so "Dates that matter" carries dates (R-3) | recertify R-3, lien-desk--gina | re-run: >= 80% of dated rules carry a calendar date when the person has the document | built 2026-10-26 (prompts: anchor dates before trap nuance, a document option, the auditor holds the date slot open until answered once); awaits the owner's re-run, about $3.80: `uv run python -m athena.proving.chores_uat run --pairs lien-desk--gina recoverable-depreciation--marcus` |
| B-C11 | high | wotc-screening: the example says its hires predate the lapse, or the example is re-dated with a re-bench (R-5) | recertify R-5 | Carmen's number criterion passes | closed 2026-10-26: wotc-screening was cut from the roster (932ace93), so no page shows the contradiction |
| B-C12 | medium | One rounding rule for co-published figures; restricted-funds disclosure reconciled (R-2, R-6) | recertify R-2, R-6 | no two renderings of one quantity differ | shipped 2026-10-26: medical-bills' estimate is $3,424 like its headline (the one rule: whole dollars round half up, as `usd()` does); restricted-funds' basis says $59,600 throughout and names the reports as acts. Done after recertify |

### Concept-docs
- **C-C1 Answer keys a walker doubts** (parental-leave NY PFL weeks, estate RMD-disclaimer trap, stormwater thresholds): verify against a source; a truth.json fix re-keys the bench (ADR 0128), so re-bench in the same change.
- **C-C2 What a proposed card must show** (the document she would send): extends C1 from run r1.

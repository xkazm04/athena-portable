# Scope - page operation (2026-10-15)

**Thesis:** make the approval the unit of intent - one legible card per form or per turn, bound to
the exact tab and the contract the user read, honest about writes it did not see finish - and then
let Athena keep what she learned, so next week's chore on a site that never ships WebMCP is one
card.

Council: 4 live seats (Gemini 4 Argon, GPT-6.1 Sol, Grok 4.7, Opus 5.5), 2 rounds, 28 proposals.
Not single-family. Source ids refer to `pool.md`.

## Core - the thesis cannot stand without these (build order)

### C1 - Cards name the app, the tier and the target (S)
The card reads "In ledger.test - Athena's generic hand, not the app's own tool - will click the
button *Send reminder*" instead of `ref: ref_0_3fa9...`. CardView gains app and tier; hands.js
answers a panel-only `describe` for refs (role, label), no new page IPC; activity rows record the
card's real tier instead of the constant 1.
- Anchors: `apps/desktop/src/companion/model.ts:127-137,531-541`, `apps/desktop/src/stores/run.ts:849-861`, `apps/desktop/src-tauri/src/hands.js:80-115`
- Verify: vitest - a `host.web_https_sledger_dtest.page_click` card renders app `ledger.test`, "generic hand (tier 2)" and target "button - Send reminder"; activity rows for hand cards record tier 2 (today 1). Closes UAT juror-8, jonas-2.
- Sources: P07 (lead), P03, P19, P21. Peers 8.3.

### C2 - Re-gate a tool whose contract changed after trust (S)
Trust is per origin today, so after first sight an AUTO tool whose description changes from "list
invoices" to "send every invoice" still runs unattended. The surface hashes each tool's name,
description, canonical schema and flags when the origin is trusted; a different hash adds the tool
to the `gated_tools` list the snapshot already sends; the card shows old vs new. Amends ADR 0063.
- Anchors: `apps/desktop/src/lib/bridge.ts:81-86`, `apps/desktop/src/stores/tools.ts:67-99`, `apps/desktop/src/stores/run.ts:439-487`, `src/athena/harness/hooks.py:264-275`
- Verify: trusted origin, AUTO `list_invoices`; change only its description -> next OP is `pending_approval` and the card shows both descriptions; decline -> still a card; approve + execute -> AUTO again. Closes the desktop-client-lib `mcp-tools` deviation.
- Sources: P17 (lead), P13 (revision), P05 (drift pin). Peers 8.0.

### C3 - Answer a turn's cards as one ordered sheet (M)
When one turn files several cards on one app (Mira's ten overdue reminders; fill, fill, select,
Save on a portal), the user gets one sheet in proposal order, can untick rows, presses once. Each
row keeps its own single-use grant: the surface walks the existing `POST /decisions/<id>` per row,
stops at the first failure, and the model continues once instead of once per card. Clicks carry
an `expect` label checked against the element before acting, so a moved control runs nothing.
- Anchors: `apps/desktop/src/stores/run.ts:831-918`, `apps/desktop/src/stores/run.ts:909-917`, `apps/desktop/src-tauri/src/hands.js:285-293`, `src/athena/core/approvals.py:456-472`
- Verify: scripted engine files 10 `send_reminder` cards in one turn. Before: 10 answers, 11 `api.run`. After: 1 press, 10 decisions, 10 consumes, 10 page calls in proposal order, 2 `api.run`. Untick 2 -> exactly 8 sends. Fail row 4 -> rows 1-3 ran, 5-10 still pending with `consumed_at` NULL. Relabelled Save -> `validator_failed`, 0 clicks.
- Sources: P23 (lead, fusion), P02, P06, P19, P11. Depends on C1 (rows reuse its rendering).

### C4 - A timed-out write says "may have happened" (M)
Today a send that outlives 30 s is recorded `failed (timeout)`, inviting a retry and a double send.
Add `outcome_unknown` to `ERROR_REASONS` first (Python, then gate.js and hands.rs - the reverted
8cdf1e9 is why); the surface maps a timeout on a non-read call to it; the tool stays gated until a
card about it is answered; that card says "you approved this exact call at 10:02 and it may already
have run"; inject.js posts an additive `late` event for relay-issued ids so the record updates;
the demo-kit door forwards the AbortSignal it drops today.
- Anchors: `packages/athena-bridge/inject.js:95-120`, `apps/desktop/src-tauri/src/bridge.rs:148-168`, `src/athena/contracts/harness.py:119-139`, `examples/demo-kit/src/webmcp/hooks.ts:89`, `src/athena/harness/hooks.py:132-143`
- Verify: fixture tool resolving at 34 s. Before: "failed (timeout)" and a plain re-proposal card. After: `outcome_unknown`, then "finished late", and the next card for it carries the "may already have run" line; a hung `page_read` stays `timeout` and AUTO. `tests/test_refusal_parity.py` green with the new member; bridge.rs test - a late event for a foreign id is ignored.
- Sources: P10 (lead), P18, P14. Peers 6.7.

## Supporting - amplify the core

### S1 - Bind an approval to the tab it was proposed on (M)
Execute carries the tab id and document generation; with two Ledgerbox tabs open, a card filed on
tab A and approved while tab B is focused runs on A or not at all (today it runs on the focused
tab B). Fixes UAT uat-2.
- Anchors: `apps/desktop/src/stores/run.ts:340-375,618-645`, `src/athena/lane/browser_lane.py:128-152`, `apps/desktop/src-tauri/src/tabs.rs:220-228`
- Verify: card on tab A, focus same-app tab B, approve -> B receives zero calls; reload A -> the old approval does not execute.
- Sources: P13 (lead), P04, P28. Peers 7.0.

### S2 - Continue every truncated page read (S)
`page_read` and `page_find` gain a cursor over a short-lived snapshot, so a fact past character
4,000 or the 21st match is reachable instead of cut.
- Anchors: `apps/desktop/src-tauri/src/hands.js:44-49,238-282`, `apps/desktop/src-tauri/src/hands.rs:192-206`, `src/athena/lane/turn_frame.py:43-95`
- Verify: fixture with 45 matching controls yields 45 unique refs, no duplicates; a fact beyond char 4,000 reaches the frame; navigation invalidates the cursor.
- Sources: P12. Peers 7.7.

### S3 - Operating notes: Athena remembers how each app is operated (M)
Register `core.write_procedural` (GATED, provenance-checked, label/role terms, never refs); the
frame adds up to 3 "Operating notes for <app>" lines for the focused origin; the Apps depth lists
and deletes them per origin.
- Anchors: `src/athena/core/catalog.py:164-230`, `src/athena/core/brain/store.py:460-517`, `src/athena/lane/turn_frame.py:130-141`, `src/athena/daemon/routes.py:954-983`
- Verify: same tier-2 chore 3 times on one fixture; after one approved note, runs 2-3 use >= 40% fewer `page_read`+`page_find` calls at equal success; a note citing a dead episode is refused before its card; Gauntlet memory surface aimed at it: 0 breaches.
- Sources: P08 (lead), P15. Peers 6.7.

## Leaps - bold, optional, specified to build

### L1 - Saved operations for sites that never ship WebMCP (L)
After the user signs a form once (one card, steps by role + label), the steps - values turned into
slots - can be saved as a named, always-GATED tool for that origin. Next week's chore is one OP and
one card; the grant binds the slot values and the recipe hash; replay resolves each step by exactly
one label match or stops. Export as a WebMCP `registerTool` stub for the app's developer. Own ADR.
- Anchors: `apps/desktop/src/lib/hands.ts:152-184`, `src/athena/core/catalog.py:349-363`, `src/athena/contracts/manifest.py:127-131,221-256`, `src/athena/core/validators.py:88-159`
- Verify: fixture app with WebMCP off; run 1 by hands records turns T1 and cards C1; save; runs 2-5 use <= 2 turns and exactly 1 card each; a step label absent from cited episodes is refused; editing the recipe after approval makes Execute refuse with 0 mutations; renaming the button stops at that step.
- Sources: P27 (lead, fusion), P22, P09, P16, P01, P21, P06 - every seat. Depends on S3.

### L2 - Read a trusted tab by name; the rest of the turn files cards (M)
A shell hand `tabs_read(url, query?)` reads an enabled, open tab's text without acting there; after
such a read every call on the focused page until the next user message is GATED and its card names
the source tab, so a figure from tab B cannot ride into an AUTO tool on tab A unseen. Needs an ADR
amending 0047.
- Anchors: `apps/desktop/src/stores/run.ts:249-258`, `apps/desktop/src-tauri/src/hands.rs:77-93`, `src/athena/harness/policy.py:200-213`, `src/athena/harness/hooks.py:264-275`
- Verify: Ledgerbox focused, trusted bank tab with balance at char 3,000: `tabs_read` returns it fenced with a "from" line; a later `draft_reminder` (AUTO) that exchange is `pending_approval` naming the bank origin; untrusted tab -> `foreign_origin`, empty output, no hands log.
- Sources: P24 (lead, fusion), P20, P25. Bench evidence: ADR 0045 ($1,240), ADR 0048 ($4,200).

### L3 - One checklist across several tabs (L)
Extends C3 and S1 to gated actions proposed against different open tabs and apps (Ledgerbox and
TidyCRM in one checklist), each row run on its own tab with its own grant. Loosens origin pinning
for proposals - needs an ADR and a Gauntlet surface first.
- Anchors: `src/athena/harness/policy.py:187-223`, `apps/desktop/src/stores/run.ts:350-375`, `src/athena/core/approvals.py:163-195`
- Verify: Ledgerbox + TidyCRM open, one checklist with one action each; each runs on its own tab; 6 rows, 2 unticked -> 4 calls, each consumed once; a repeat answer -> `approval_spent`.
- Sources: P28 (lead, fusion), P11, P26, P04. Depends on C3, S1.

## Left out

- P05 remainder (bridge schema validation, demo-kit `"data"`, `tool` episode role): hygiene already queued in lens-scan (p-89616b redo vocabulary-first, p-a038ea); peers 3/10.
- P14 receipts and an operation-status tool: L with DOM hands; C4 takes the cheap part.
- P02's single-consume batch: per-row grants (C3) keep ADR 0038 intact.
- P26 saved chores as staged change plans: waits on L1 + C4 + L3.

# Verdict - page operation (2026-10-15)

Judge: claude-opus-5-5 (caller session; same family as one seat - see the bias note in the skill's
verdict reference). Read from `pool.md` only (seats hidden). 28 proposals: 20 round 1, 8 round-2
fusions. Peer score = mean of the other three seats' ratings (round 1 items only).

## Premises checked in code (HEAD 9bd3cce)

| Claim | Where | Result |
|---|---|---|
| `write_procedural` exists, no product caller; core tools are recall / write_fact / checkpoint | `src/athena/core/catalog.py:189-226`; grep: only `proving/world.py` wraps it | true |
| CardView has no origin or tier | `apps/desktop/src/companion/model.ts:127-137`, `:531-541` | true |
| Activity row for an answered card hard-codes tier 1 | `apps/desktop/src/stores/run.ts:849-861` (`tier: 1`) | true |
| Capture is taken once per request, before the model proposes | `run.ts:733-735` | true |
| Page tool output is stored as a `system` episode | `src/athena/lane/browser_lane.py:381-386` | true |
| `page_click` never checks the element's label | `hands.js:285-293` (resolve ref, click, report label) | true |
| `_check_value` does not recurse into object properties | `src/athena/core/validators.py:88-159` (arrays/items only) | true |
| A late page reply is dropped as an expired id | `apps/desktop/src-tauri/src/bridge.rs:160-163`; `inject.js:110-115` abandons the promise | true |
| Execute goes to the focused tab; the check compares app ids only | `run.ts:618-645` | true - a same-app second tab receives it |
| Another tab's tools are refused by policy | `src/athena/harness/policy.py:206-213` | true |
| toolchange re-lists with no diff, by design | `apps/desktop/src/lib/bridge.ts:81-86` | true |
| `page_read` cuts at 4000, `page_find` at 20 matches | `hands.js:44-49` | true |

## Triage

| id | title (short) | premise | value | conf | effort | score | peers | decision |
|---|---|---|---|---|---|---|---|---|
| P07 | Cards name app, tier, element | true | 4 | 5 | S | 20 | 8.3 | **core C1 lead** |
| P03 | Target previews + freshness guards | true | 4 | 4 | S->M | 10 | 4.7 | C1 member (label/role display); freshness part -> C3 |
| P17 | Re-gate tool on contract change | true | 4 | 4 | S | 16 | 8.0 | **core C2 lead** |
| P05 | Schema check, drift pin, tool role | partly | 3 | 4 | S | 12 | 3.0 | drift pin -> C2; rest dropped (see below) |
| P23 | One ordered sheet, per-row grants (fusion) | true | 5 | 4 | M | 12.5 | - | **core C3 lead** |
| P19 | One form as bound hand sequence | true | 5 | 4 | M | 12.5 | 8.3 | C3 member (label check, card text); sequence -> L1 |
| P06 | page_sequence, one bound card | true | 5 | 4 | M | 12.5 | 7.3 | C3 / L1 member |
| P21 | page_sequence + legible cards (fusion) | true | 5 | 4 | M | 12.5 | - | L1 member (the step runner) |
| P02 | Batch + form-plan execution | partly | 4 | 3 | M | 7.5 | 6.0 | C3 member (Mira's 37 reminders); one-consume batch rejected in favour of per-row grants |
| P10 | outcome_unknown + repeat warning | true | 4 | 4 | M (seat: S) | 10 | 6.7 | **core C4 lead** |
| P18 | Timed-out write gates the tool | true | 4 | 4 | M | 10 | 4.7 | C4 member (re-gate until answered) |
| P14 | Reconcile uncertain writes | true | 4 | 3 | M->L | 4.8 | 4.7 | C4 member (AbortSignal forwarding); receipts/status tool left out |
| P13 | Bind approval to tab + revision | true | 4 | 4 | M | 10 | 7.0 | **supporting S1 lead**; revision -> C2 |
| P04 | Cross-tab tool calls by tab handle | true | 4 | 3 | M | 7.5 | 5.3 | S1 member (tab_id on Execute); calling other tabs' tools -> L3 |
| P12 | Continue truncated page reads | true | 3 | 4 | S | 12 | 7.7 | **supporting S2** |
| P08 | Operating notes per app | true | 4 | 3 | M | 7.5 | 6.7 | **supporting S3 lead** |
| P15 | Remember how each app is operated | true | 4 | 3 | M | 7.5 | 5.3 | S3 member (explicit save action, no refs) |
| P27 | Sign a form by labels, keep as gated tool (fusion) | true | 5 | 3 | L | 6 | - | **leap L1 lead** |
| P22 | Hash-pinned learned operations (fusion) | true | 5 | 3 | L | 6 | - | L1 member (WebMCP stub export) |
| P09 | Learned tools | true | 5 | 3 | L | 6 | 7.3 | L1 member |
| P16 | Saved named operation | true | 5 | 3 | L | 6 | 7.0 | L1 member |
| P01 | Compile DOM traces into macros | true | 5 | 2 | M->L | 4 | 5.0 | L1 member |
| P24 | Read trusted tab, taint the turn (fusion) | true | 4 | 3 | M | 7.5 | - | **leap L2 lead** |
| P20 | Read another tab without acting | true | 4 | 3 | M | 7.5 | 7.0 | L2 member |
| P25 | Complete evidence across tabs (fusion) | true | 3 | 3 | M | 5.6 | - | L2 member (stable citation) |
| P28 | Tab-bound checklist across tabs (fusion) | true | 5 | 2 | L | 4 | - | **leap L3 lead** |
| P11 | Cross-app change set | true | 5 | 2 | L | 4 | 4.7 | L3 member |
| P26 | Saved chores as reviewed change plans (fusion) | true | 5 | 2 | L | 4 | - | L3 member; depends on L1 + C4 |

## Clusters (cross-seat agreement)

- **Saved operations for sites without WebMCP** - P01, P09, P16, P22, P27 (+P08, P15 for the
  non-executable half). Every seat proposed some form of it independently: the strongest signal of
  the council. Split in the scope into S3 (notes, M) and L1 (executable, L) so the cheaper half can
  land first and measure the hypothesis.
- **The unit of approval is the form / the turn, not the click** - P02, P06, P19, P21, P23 (+P11,
  P28 across tabs). Three seats, two fusions. Lead is P23 because it keeps one grant per row and
  changes no gate semantics (no ADR for "one grant covers several mutations"); P06/P21's single
  `page_sequence` grant is kept as the runner L1 needs.
- **Cards you can actually judge** - P03, P07, P19, P21. Peers rated P07 highest in the pool.
- **A write whose result was not seen** - P10, P14, P18. Three seats. Lead P10 (repeat warning on
  the next card) plus P18's re-gating.
- **Trust follows the contract the user read** - P05, P13, P17. Lead P17 (no wire change, uses the
  existing `gated_tools` path).
- **Exact destination** - P04, P13, P28. Lead P13.
- **Reading across tabs** - P20, P24, P25. P24 fixes P20's leak (a figure read from tab B riding
  into an AUTO tool on tab A) by tainting the rest of the turn to GATED.

## Dropped or left out

- **P05 remainder** (inject.js schema validation with new reasons, demo-kit `side_effects:"data"`,
  role `tool` for page episodes): hygiene that closes registry deviations, not a value move; already
  queued as lens-scan p-89616b (reverted, must redo vocabulary-first) and p-a038ea. Peers 3/10.
  Belongs to `/lens-scan execute`, not this scope.
- **P14 receipts + operation status tool**: real, but L once DOM hands are included; C4 takes the
  cheap 80% (truthful reason, warning, re-gate, AbortSignal).
- **P02's one-consume batch**: rejected in favour of P23's per-row grants (keeps ADR 0038 intact).
- **P04's calling tools in non-focused tabs** in core: moved to L3; it loosens `_origin_pinning`,
  which needs its own ADR and a Gauntlet surface first.

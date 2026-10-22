# Verdict - 2026-10-22-chores-playbooks

Judge: claude-opus-5-5 (caller session; same family as one seat - see the ledger note).
Read `pool.md` only; premises checked in code at 9beaef31. Live seats: 3 of 4 (grok skipped: free
usage limit in round 1). Round 2: 2 of 3 seats rated (one errored), so peer scores are n=2.

## Premise checks (the load-bearing ones)

| claim | result |
|---|---|
| daemon routes a minted `proj_` id into one cross-origin conversation | true - `src/athena/daemon/routes.py:584-586`, `sessions.py:49-58` |
| the desktop never sends `project_id` | true - no `project_id` in `apps/desktop/src/stores/run.ts`; only `active_project` (874-881) |
| `project_runs` table exists, nothing writes it | true - `apps/desktop/src-tauri/src/store.rs:256-263`; only the store test writes a row |
| brain reserves `goals/` and `rituals/cadence/`, nothing writes them | true - `core/brain/paths.py:29,35`, `reconcile.py:45,49`; no writer in `src/athena` |
| ledger and approvals carry `conversation_id` | true - `core/ledger.py:87-106`; approvals 115-139 |
| `outcome_unknown` already recorded as "may have completed" | true - `lane/browser_lane.py:400-404` |
| `_may_have_run` capped at 24 h | true - `harness/hooks.py:164-180`, `approvals.py:94` |
| rehearsal publishes `value_found_usd` while truth is only renamed | true - `adopt/showcase.py:10-14` vs `:557-563` |
| another tab's READ tools are gated (no unattended multi-tab run) | true - `hooks.py:128-137`; desktop needs a focused page `run.ts:1230-1239` |
| `times_per_year` present in 91, `per == year` in 71, >= 4/yr in 41 | true - counted over `playbooks/*/playbook.json` |
| `Brief.portals` holds names, not URLs (P03's open-by-URL is wrong) | true per P17; `playbooks/lien-desk/playbook.json:19` url is `""` |

## Triage

| id | premise | value | conf | effort | score | fit | note |
|---|---|---|---|---|---|---|---|
| P01 | true | 4 | 4 | S->M | 10.0 | yes | hydrates date facts as confirmed - corrected by P16 |
| P02 | true | 4 | 4 | M | 10.0 | yes | uses truth-free `_filed_total`; folded into C2 |
| P03 | partly | 4 | 3 | M | 7.5 | yes | opens `Brief.portals` as URLs (false); uses `per` not `times_per_year` |
| P04 | partly | 3 | 2 | L | 2.4 | half | live `dry_run` mode belongs to the page lane (out of scope); bench half folded into L2 |
| P05 | true | 5 | 4 | M | 12.5 | yes | best-specified receipt; carries the conv_proj bench check |
| P06 | true | 4 | 3 | M | 7.5 | yes | second-run carry-forward -> S1 |
| P07 | partly | 5 | 3 | L | 6.0 | yes | unattended prepare would hit `another_tab` gating; corrected by P15/P17 |
| P08 | true | 3 | 4 | M | 7.5 | yes | closes two recorded deviations (eval-harness, audit-logging) |
| P09 | true | 4 | 4 | S->M | 10.0 | yes | adds distinct cases per playbook |
| P10 | true | 4 | 4 | M | 10.0 | yes | 5-state receipt idea folded into C2 |
| P11 | true | 4 | 3 | M | 7.5 | yes | review-not-execute shape adopted in L1 |
| P12 | true | 3 | 3 | M | 5.6 | yes | its premise (dollars invalid on shaped worlds) becomes C3 |
| P13 | true | 5 | 2 | L | 4.0 | yes | outcome desk - too dependent; backlog |
| P14 | true | 5 | 4 | M | 12.5 | yes | fusion; overlaps P16 |
| P15 | true | 5 | 3 | M->L | 6.0 | yes | fusion; brain-only prep turn is unneeded - P17 builds the review with no model call |
| P16 | true | 5 | 4 | M | 12.5 | yes | lead for C1 + C2 + C3 |
| P17 | true | 5 | 3 | M | 9.4 | yes | lead for L1; fixes P03's URL and cadence errors |
| P18 | true | 3 | 3 | L | 3.6 | yes | lead for L2 |

Peer scores agree on the shape: P05 8, P06 7.5, P01/P08/P11 7, P04 2.5 (n=2). I rate P03/P07
higher than peers (4, 5.5) only as cluster members: the cadence idea was proposed by all three
seats and its mechanism errors are fixed by P17.

## Clusters (cross-seat agreement)

- **Case persistence** - P01, P09, P16(1), P14(1): all three seats.
- **Real runs come back to the chore** - P02, P05, P10, P16(2-3), P14(2-3): all three seats.
- **Chores come due** - P03, P07, P11, P15, P17: all three seats.
- **Second run picks up** - P06, P14(4), P17(5): two seats.
- **Honest comparisons / repeated measurement** - P08, P12, P16(4), P18: two seats.

## Left out

- P04 live dry-run on real tabs: a new harness mode on the page lane (hunted 2026-10-15); peers 2.5.
- P13 outcome desk: needs C1, C2, L1 first and a per-entity lifecycle; to backlog.
- P15's unattended brain-only prep turn: P17 shows the review needs no model call.

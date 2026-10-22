# Scope - Chores and playbooks (2026-10-22)

**Thesis:** turn a chore from a library entry you launch once into a standing case. It remembers
your setup, every real run comes back to it as a receipt measured from your cards, and it comes due
on its own. Nothing irreversible ever runs unattended.

Council: 3 live seats (Google, OpenAI, Anthropic); xAI skipped (usage limit). 18 pool ids.

## Core

**C1 - Case file that survives restarts** (M; 3 seats; P16 lead, P01, P09, P14)
On approve, mint a `proj_` id and write `goals/<proj>.md` (the brain's five-key header untouched;
playbook id, rev, brief, fitted command, portal swaps, slots with source and date in the body), with
the approval as an episode and confirmed slots as provenance-cited facts. The studio reopens from it:
unchanged slots carry over; date and amount facts reopen as `guessed` for the auditor to re-confirm.
Two cases of one playbook stay distinct.
Verify: approve, restart daemon + desktop, reopen -> same rev, slots and command, 0 repeated questions
for unchanged non-date slots; delete `index.sqlite`, reconcile -> the case reappears.
Anchors: `src/athena/adopt/loop.py:134-146`, `core/brain/reconcile.py:41-54`, `core/brain/store.py:378-396`.
Standard: agent-memory / session-resume `layered-place-restoration`.

**C2 - Your runs come back to the chore** (M; 3 seats; P05 lead, P02, P10, P16, P14) - needs C1
"Start for real" carries the case's `proj_` id; every `/run` sends `project_id` beside
`active_project`, so the daemon's existing routing puts every tab's turns in `conv_proj_<hex>`. A
read-only route folds that conversation's approvals (approved, declined, expired, pending),
`outcome_unknown` episodes ("may have completed") and ledger cost/minutes into a receipt; dollars are
"asked, from N cards you approved", never "recovered". The topic page gets "Your runs"; with no run it
says so. On "done" the receipt is appended to the case file so it survives an index rebuild.
Verify: every `/run` body carries `project_id=proj_x`, every ledger row `conversation_id=conv_proj_x`;
topic counts equal `SELECT status,count(*) FROM companion_approval WHERE conversation_id=...`, cost
equals `/ledger/rollup?by=conversation`. **Gate before shipping:** bench the top 5 playbooks with
`project_id` set (~$7) - verdicts unchanged.
Anchors: `apps/desktop/src/stores/run.ts:874-881`, `src/athena/daemon/routes.py:584-586`,
`daemon/sessions.py:49-58`, `core/approvals.py:115-139`, `core/ledger.py:87-106`, `lane/browser_lane.py:400-404`.
Standard: audit-logging `decision-records`; hitl-approval `decision-records`.

**C3 - Rehearsal dollars only where the answer key still holds** (S; 2 seats; P16(4), P12)
The rehearsal publishes `value_found_usd` though the shaped world's truth is only renamed. Send it
only when the shape made renames only (no row edits, no `today` shift); otherwise `null` with the
reason "your case changed rows the answer key was written for", and the studio compares by cards.
Verify: a shaped rehearsal with a row edit shows no dollar figure; a renames-only one still does.
Anchors: `src/athena/adopt/showcase.py:10-14,557-563`, `apps/desktop/src/scenes/chores/adopt/showcase.tsx:93-99`.
Standard: eval-harness `measurement-revision`; public-claim-provenance.

## Supporting

**S1 - The second run starts where the last stopped** (M; 2 seats; P06 lead, P14(4), P17(5)) - needs C2
A run under a case gets a bounded, fenced "Since last run" block from its last receipt (approved keys
with dates, declined keys, expired and may-have-completed first), `(showing N of M)`. For turns under
a project, `_may_have_run` looks back to the start of the last run instead of 24 h; it only informs.
Verify: a card for a call approved 20 days ago in the last run carries the dated line (today: none);
two-run bench on 10 playbooks (~$32), baseline first: duplicates of run-1 items -> 0, recall of the
rest >= bar.
Anchors: `src/athena/harness/hooks.py:164-180`, `core/approvals.py:94,570`, `proving/playbooks/bench.py:402-430`.

**S2 - Rank on repeated runs; rescore appends** (M + ~$64; 2 seats; P08 lead, P18) - independent
`bench --runs k` on comparable (world+truth+code hash) runs; ranking carries n, min/median recall,
k-of-n exceeds; any trap or false claim in a comparable run excludes. `rescore` appends a correction.
The catalogue shows "exceeds in k of n" and an n=1 badge. Top 20 first (~$64).
Verify: `ranking.json` rows carry n and min/median; `rank --check` current; rescore keeps the original
(history +1); Kendall tau between run-1 order and runs 2-3 reported.
Closes recorded deviations: eval-harness (`rank.py:165`), audit-logging (`__main__.py:222`).

## Leaps

**L1 - Chores come due, as a staged review** (M-L; 3 seats; P17 lead, P15, P07, P03, P11) - needs C1, C2 (S1 enriches)
A person-confirmed cadence in `rituals/cadence/<proj>.md` (enabled, cadence, timezone, next_run_at,
last_run_at; default suggested from `times_per_year`). A daemon reconciliation loop per the
`scheduling` standard: advance before notifying, coalesce missed occurrences into one review, no overlap,
an explainable line per fire/skip. One notification per (case, due date), quiet hours respected, a
"pause or slow?" prompt after 3 unanswered. The review is assembled with no model call from the case
file and last receipt. "Open and prepare" opens the portal tabs (app urls / the case's URL slots) and
pre-loads the composer; nothing is sent until the person presses send; that turn's ledger row is
`trigger_kind='schedule'`.
Verify: fake clock - 3 missed periods -> exactly one review naming 2 missed; crash after advance does
not notify twice; disabled never fires; quiet hours defer; DST keeps local time. Vitest: 0 `/run`
requests until send.
Anchors: `core/brain/reconcile.py:48-50`, `contracts/registry.py:207-210`, `core/ledger.py:61-67`,
`apps/desktop/src/modules/playbooks/index.ts:40-55`.
Standard: scheduling (all six techniques); proactive-nudges `attention-budgets`, `quiet-windows`, `nudge-identity-dedup`, `efficacy-feedback`.

**L2 - Prove follow-through across approval, restart and a second run** (L, ~$29; 2 seats; P18 lead, P04 bench half)
A deterministic scenario overlay on freelancer-receivables (no frozen truth or world edits): approve /
decline / lost-answer branches through the ordinary decision route, a restart on the same temp brain,
a second session with independent follow-through assertions, k-of-n over 3 repeats.
Verify: an approved action changes a later read; a declined one has no effect; a lost answer is not
blindly retried after restart; a deliberately regressed runner fails.

## Left out

- Live dry-run on real tabs (P04): a new harness mode on the page lane, hunted 2026-10-15; peers 2.5/10.
- Outcome desk per invoice (P13): needs C1, C2 and L1 first; to backlog.
- An unattended brain-only "prep turn" (P15): the review needs no model call.

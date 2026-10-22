# 0124. Your runs come back to the chore

Date: 2026-10-22

Follows [0123](0123-an-approved-brief-is-a-case-file-in-the-brain.md) (a case is `goals/<proj>.md`
with one `proj_` id), [0044](0044-a-handed-playbook-is-the-active-project-on-every-turn.md) (the
handed playbook is the active project on every turn, cleared by "done") and
[0101](0101-a-timed-out-write-is-outcome-unknown-and-a-late-answer-is-heard.md) (`outcome_unknown` is "may have
completed"). `docs/features/playbooks.md`, "Your runs".

## Context

The daemon already puts every turn sent with a minted `project_id` into one conversation,
`conv_proj_<hex>`, whatever origin it came from, and the approval table, the ledger and the
episodes all carry that conversation. The desktop never sent one: its turns named the playbook
only in `active_project` (by its slug), so a real run of a chore was spread over each portal's own
conversation and nothing could say afterwards what it came to. A case (ADR 0123) has an id; its
runs had nowhere to come back to.

## Decision

1. **The case id rides the hand-off.** "Start for real" in the studio passes the saved case's id
   (`state.caseId`, set by the approve) with the playbook to `athenaOffer`; her window keeps it on
   the active playbook (`ActivePlaybook.caseId`), and every `POST /run` while it is active sends
   `project_id: <proj>` beside the unchanged `active_project`. A playbook handed over with no case,
   or an id that is not `proj_` and twelve hex digits, sends none (the daemon would refuse it).
2. **The record is the daemon's, not the desktop's.** The receipt is folded by the daemon from the
   three records it already keeps for the conversation and is appended to the case file; the Tauri
   store's unused `project_runs` table stays unused. A desktop-side row would be a second copy of
   numbers the desktop cannot verify, and would not be in the brain a person copies.
3. **A receipt** (`contracts/adopt.Receipt`, `src/athena/adopt/receipts.py`) is, for the cards
   created in the run: the count of each state the approval table holds (approved, and of them
   `consumed`, the ones the gate let through; declined; expired; pending), the first 20 shown with
   their action and at most six key parameters as cut text (`(showing N of M)`); the episodes of
   the conversation whose result verb is the lane's `MAY_HAVE_COMPLETED`, the first 10 shown;
   **dollars asked**, the amount parameter of each approved card by the bench's own rule
   (`AMOUNT_PARAMS`, `_filed_total`), labelled "asked, from N cards you approved", never
   "recovered" and never anything from a truth file; and the ledger's rows, errors, dollars,
   unpriced rows and milliseconds summed for the conversation (`Ledger.conversation_total`, the
   rollup by conversation cut to a window). First and last activity are the earliest and latest
   stamps among the three.
4. **A run is the window since the case's last receipt.** It opens when the case's first turn (or
   the first after a receipt) is written and closes when the person presses "done" on the active
   playbook (the chip of ADR 0044). The hand-off itself writes nothing at the daemon, so the
   window is defined by what was recorded, not by a desktop event that a restart would lose. A card
   belongs to the run it was filed in, by `created_at`.
5. **Two routes, beside the cases list.** `GET /adopt/cases/<proj>/runs` (read-only) answers the
   open run folded now (`null` when nothing ran in it) and the stored receipts, latest first, at
   most 20 with `(showing N of M)`. `POST /adopt/cases/<proj>/done` folds the open run with `until`
   now and appends it as a dated `receipts` entry to the case file's JSON block (the key ADR 0123
   carries through every rewrite), with a "Your runs" section in the markdown for a person; when
   nothing ran it writes nothing and says so. It takes the brain's write lock, never the turn
   lock. Both are behind the token like every route, registered before the session prefix.
6. **On the topic page**, under each saved case, "Your runs" lists the open run ("Running now")
   and each receipt ("Run closed …"), every line saying where its number comes from (the approval
   table, each card's own amount, the ledger). With no run it says "No run yet" rather than a row
   of zeros. A card's parameters and a "may have completed" record are the page's text: shown in a
   fenced block as text, never as markup.
7. **The bench can run under a case.** `bench <id> --project` mints a `proj_` id for the run and
   sends it as `project_id` on every turn of every phase (`BenchConfig.project`); the report names
   it. Off by default, so earlier verdicts stay comparable.

## Consequences

- A chore's page says what each real run did and cost, measured from the person's own cards and
  the ledger, and that record survives a desktop restart, a daemon restart and a deleted
  `index.sqlite` (the approval and ledger tables are not rebuilt from disk; the receipt is).
- Only "done" closes a run. A person who never presses it keeps one open run that grows; it is
  still shown, as "Running now". A "done" that cannot reach the daemon clears the chip and the run
  stays open, so the next "done" on that case keeps it.
- A stored receipt is a snapshot: a card still pending at "done" stays pending in it even if it is
  answered later. The open run never shows it again (it was filed before the window).
- Every turn of a run now shares one conversation, so a turn in one portal sees the earlier
  portals' episodes. That is the point of ADR 0044's project, and it changes what the model reads;
  the bench's `--project` exists to measure that before it is relied on.
- An expired card is counted as expired once the sweep (or a late answer) has moved it; until
  then it is counted as pending, as the table holds it.
- Tests: `tests/daemon/test_case_runs.py` (two origins, one conversation; each state equal to a
  `GROUP BY status`; cost equal to `/ledger/rollup?by=conversation`; done, index deleted,
  reconciled, receipt still on the case), `tests/adopt/test_receipts.py`, the approval and ledger
  window reads, the parity test, the bench's `--project`; Vitest: `project_id` on every `/run`
  while a case-backed playbook is active and none without a case, "done" closing the run, and the
  "Your runs" states.

## Amended 2026-10-22

By [0127](0127-a-cases-turns-keep-their-conversations-and-are-stamped-under-it.md). Decision 1 is
reversed: the paid gate measured runs under one shared `conv_proj_<hex>` at 1.7 to 2.5 times the
cost per run, and estate-settlement crossed its $8 cap at turn 22 (short, 4 of 12) where its
per-tab baseline exceeds 3 of 3 at $3.10 to $3.45. The desktop now sends `case_id`, which routes
nothing; every tab keeps its own conversation, the daemon stamps each turn under the case, and the
receipt (decision 3) is joined by those turn ids, not by the conversation. The consequence "every
turn of a run now shares one conversation" no longer holds; `bench --project` stays as the
experiment that measured it.

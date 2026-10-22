# 0127. A case's turns keep their conversations and are stamped under it

Date: 2026-10-22

Supersedes decision 1 of [0124](0124-your-runs-come-back-to-the-chore.md) (every `POST /run` under
a case sent `project_id`, routing every tab into `conv_proj_<hex>`) and the receipt's join by that
conversation (its decision 3); completes the follow-up [0126](0126-the-second-run-starts-where-the-last-stopped.md)
named (`case_id` is what a turn is recorded under). `docs/features/playbooks.md`, "Your runs".

## Context

ADR 0124 made the desktop send the case's `proj_` id as `project_id` on every turn while a
case-backed playbook was active, so every tab's turns, cards and ledger rows shared one
conversation and the receipt could be folded from it. The paid gate measured what that costs:
every turn of a run now carries the other tabs' history, and runs were 1.7 to 2.5 times dearer per
run. estate-settlement crossed its $8 cap at turn 22 and came out short (4 of 12 found); its
baseline, with each tab in its own conversation, exceeds 3 runs of 3 at $3.10 to $3.45. The person
decided: each tab keeps its own conversation exactly as today, the turns are stamped under the
case, and the receipt is joined by turn id.

ADR 0126 already added `case_id` on `POST /run`, which names the case and routes nothing
(`TurnContext.case_id`). The ledger already carried each row's `turn_id`. The approval table did
not: a card knew its conversation and its time, not its turn.

## Decision

1. **The desktop sends `case_id`, never `project_id`, under a case.** `activeProject` in
   `stores/run.ts` puts `case_id: <proj>` beside the unchanged `active_project`; a playbook with no
   case, or an id that is not `proj_` and twelve hex digits, sends neither. The voice store's
   `start` and `text` frames carry the same `case_id` (`caseOf`, one helper for both channels), and
   the voice gateway reads it into the turn's context as `POST /run` does, refusing one that is not
   a `proj_` id with `unknown_ref`. Before this the spoken path sent no case at all.
2. **The daemon stamps every turn under its case** in a runtime table beside the approvals and the
   ledger, `companion_case_turn` (`core/case_turns.py`): one row per turn id, with the case, the
   turn's own conversation, `started_at` when it began and `ended_at` when it ended. It is written
   by `routes.turn_events` with the one-turn lock held, so a typed and a spoken turn are stamped
   alike. Answering a card filed by a stamped turn stamps the answer under the same case, so the
   ledger row a decline writes is in the run with its card. The table is absent from
   `INDEX_TABLES`, so a restart opens it and a reconcile leaves it, exactly as it leaves the cards
   and rows it joins.
3. **A card names the turn that filed it.** `companion_approval` gains a nullable `turn_id`
   column (added on open to an older brain, with an index); the gate passes `TurnContext.turn_id`
   when it is a minted turn id. A card filed before the column existed is in no run.
4. **The receipt is joined by turn id.** `receipts.fold` takes the case's turns that began since its
   last receipt (`CaseTurns.of_case`), counts the cards those turns filed by state
   (`Approvals.of_turns`) and sums the ledger rows of those turns (`Ledger.turns_total`); both
   pass the ids as one JSON array to SQLite's `json_each`, so a run of any length is one parameter.
   A "may have completed" episode is the run's when it was written in a stamped turn's
   conversation between that turn's start and end; a turn the daemon never saw end is its start
   alone, so it claims nothing written later. The receipt gains `turns` (the count), and its
   `conversation_id` is `""` (a receipt kept before this ADR names the `conv_proj_` it came from
   and still reads back). `GET /adopt/cases/<proj>/runs` no longer answers a `conversation_id`.
5. **The window is the turns', which settles where a run starts.** A run's `first_at` is its first
   turn's start, which is never later than that turn's ledger row or card. ADR 0126's gate
   lookback (`spent_since`, the last receipt's `since` or `first_at`) therefore starts at the run's
   first turn, not at its first card.
6. **Why this store and not the case file.** Appending each turn id to the case file's JSON block
   would rewrite `goals/<proj>.md` on every turn, under the brain's write lock, racing the studio's
   own rewrites; and it would buy nothing: deleting `index.sqlite` loses the cards and the ledger
   rows a turn id joins, so a list of ids on disk could not rebuild an open run's receipt. A
   closed run is already on disk as its receipt (ADR 0124), with its `turns` count.
7. **The bench.** `bench <id> --case` mints a case and sends it as `case_id` on every turn, and the
   report carries `case_receipt` (turns, cards by state, asked dollars, ledger rows and cost of
   those turns), printed beside the bench's own cost. `--project` stays, labelled an experiment:
   it is the measured cost of one shared conversation.

## Consequences

- A run under a case costs what the same run under no case costs: the conversation, and so every
  frame's history, is the one a turn without `case_id` gets. That is proved by a test (the same
  conversation per tab with and without `case_id`, and the same bench verdict and score with and
  without `--case` on a scripted model), not by a paid run.
- A turn in one tab no longer sees the other tabs' episodes of the run through its conversation;
  recall and the "since last run" block are what carry across tabs, as for any turn.
- A turn's card answered days later is still in the run of the turn that filed it; a ledger row
  written before its turn's first card is in it too.
- `Approvals.of_conversation` and `Ledger.conversation_total` (ADR 0124's window reads) are
  replaced by `of_turns` and `turns_total`; nothing else read them.
- Deleting `index.sqlite` loses an open run's stamps with its cards and its cost; a closed run's
  receipt is in the case file and survives, as before.
- Tests: `tests/core/test_case_turns.py`, `tests/core/test_approvals.py` and
  `tests/core/test_ledger.py` (the turn reads), `tests/adopt/test_receipts.py` (the join, the
  note window, a run's first ledger row before its card, an old receipt read back),
  `tests/daemon/test_case_runs.py` (two origins keep `conv_<app>`; counts equal a direct `SELECT`
  over the case's turn ids; cost equals the ledger's sum over them; a reconcile keeps an open run;
  done, index deleted, reconciled, receipt kept; the same conversation with and without
  `case_id`), `tests/channels/test_voice_gateway.py` (a spoken turn stamped, a bad `case_id`
  refused), `tests/proving/test_playbooks.py` (`--case`, the CLI flags); Vitest: `case_id` and
  no `project_id` on every `/run` and voice frame under a case.

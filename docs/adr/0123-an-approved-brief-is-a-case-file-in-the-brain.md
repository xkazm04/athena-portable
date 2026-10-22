# 0123. An approved brief is a case file in the brain

Date: 2026-10-22

Follows [0097](0097-adopting-a-playbook-is-a-conversation-held-outside-the-turn-lock.md) (the
studio, its in-memory sessions and its slots), [0003](0003-disk-is-truth-one-writer-many-readers.md)
(markdown on disk is truth, SQLite is a rebuildable index) and
[0044](0044-a-handed-playbook-is-the-active-project-on-every-turn.md) (a project's turns share
`conv_proj_<hex>`). `docs/features/playbooks.md`, "Adopt".

## Context

An adopt session holds the brief a person approved in daemon memory and nowhere else (ADR 0097:
"Nothing is persisted"). A daemon restart, or two hours idle, loses it, and the studio interviews
the person again from the first card. The brain reserves `goals/` and the rebuild already indexes
it as kind `goal` (`core/brain/reconcile.py`), but nothing wrote it. A chore that is meant to be a
standing case (its runs coming back to it, coming due on its own) needs one durable record with one
id that later work can name.

## Decision

1. **One case, one `proj_` id.** The first successful approve of a session mints a project id
   through `contracts/ids.py`. Every later approval in that session, and in any session reopened on
   the case, keeps it. Two conversations about one playbook are two cases with two ids.
2. **The case is a goal file, written by the adopt package through the brain.** The daemon's
   brain is handed to the studio in `wiring._wire_adopt` as a `CaseBook`
   (`src/athena/adopt/cases.py`); a new `Brain.write_goal` writes `goals/<proj>.md`. The header is
   five keys, the episode's shape with `title` in `role`'s place: `id, type, title, session,
   created` (`session` is `conv_<proj>`, `created` the first approval's time, so a rebuild makes
   the row the writer made). No chore field goes in the header.
3. **The body is for a person, then for code.** Markdown sections (the brief, the command
   indented, the apps, each slot with status, source, date and the person's words, every approval),
   then a marker line `<!-- athena:case -->` and one fenced JSON block: the `Case` contract
   (`contracts/adopt.py`, schema 1). The reader takes the last marker, so a brief that quotes one
   cannot impersonate the block. Keys in the block that this writer does not own (a later
   `receipts`, say) are carried through a rewrite untouched.
4. **Provenance, through the gate.** Each approval is an episode (role `user`, session
   `conv_<proj>`, body marked `[adopt] [project:<proj>]` with what she confirmed and her words).
   Every slot she confirmed in this session (status `confirmed`, source `user`) is written as a fact
   (scope `project`, key `case <proj> <slot>`) citing that episode with `write_fact`; no bypass. A
   slot carried from the case and not touched again keeps its earlier fact and date. Order: the
   episode, the facts, then the goal file, so a crash part way leaves evidence and never a case
   that cites what was not written.
5. **The write happens on the approve request, outside the turn lock.** It takes only the brain's
   own write lock for a few small files, so the reply can carry `case_id`; a failure to save is
   said in `case_problem` and the approval itself stands. The studio still never takes
   `daemon.writing()`.
6. **Reopening.** `POST /adopt {playbook_id, case_id}` loads the case from disk and starts a
   session that holds it: the playbook's current portal slots that match the case by id, kind and
   label carry over, gates are always the playbook's, the case's fact and trap slots carry over
   whole; carried values take source `memory` and keep their dates. A confirmed `fact` slot that
   names a date or an amount (a regex over its label and value, `cases.perishable`) reopens as
   `guessed`. The approved brief is the session's current draft at the same rev, emitted at once.
   With no reopened guess the brief is cleared for approval and no model is called; otherwise one
   interview leg runs and its card is cut to the reopened slots, so nothing else is asked twice.
   The person's saved words for each carried slot are kept as round-0 answers, so the auditor sees
   why each value stands. A research lane never overrides a slot confirmed in an earlier approval
   (`apply_updates` now guards source `memory` as it guards `user`).
7. **A read-only list.** `GET /adopt/cases?playbook_id=` lists the cases the index holds, each read
   from its file, latest approval first, at most 20 with `(showing N of M)`. After the index is
   deleted, `reconcile_from_disk` finds every case again.
8. **Desktop.** A chore's topic page asks the studio's client for its cases and shows "Your case"
   (title, last approved date, draft, how much is confirmed) with "Open your case" beside "Talk it
   through with her"; two cases each get "Open this case". The studio opens at
   `chores/<id>/case/<proj>` (a new `case` sub-level that takes the id), says whose case it is, and
   after an approval says whether the case was saved. No daemon, looking, none yet, offline and a
   refusal are each said in words.

## Consequences

- A restart costs nothing the person said: the brief, the command and every confirmed slot are on
  disk with the evidence they came from, and the second visit asks only what may have moved.
- Later work names the case by its id: runs under it (`project_id`, `conv_proj_<hex>`), a receipt
  appended to its block, a cadence in `rituals/cadence/<proj>.md`. Everything in the block is the
  person's words and a model's brief, untrusted text to be fenced by whoever puts it in a prompt.
- Re-approving an unchanged reopened brief adds an approval episode each time; facts are written
  only for slots she confirmed again in that session.
- The perishable test is a heuristic over English labels. A date written as a word it does not know
  stays confirmed; a non-date that mentions "due" or "fee" is asked again. Both fail safe toward
  asking.
- The rebuild trusts the disk: a goal file edited by hand is read as it stands, and one whose block
  no longer parses is passed over by the list (not deleted).

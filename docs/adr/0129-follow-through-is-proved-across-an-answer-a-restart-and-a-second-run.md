# 0129. Follow-through is proved across an answer, a restart and a second run

Date: 2026-10-22

Follows [0040](0040-a-playbook-is-data-and-earns-its-place-on-the-bench.md) for the bench and
[0127](0127-a-playbook-is-ranked-on-its-comparable-runs-and-a-rescore-appends.md) for comparable
runs and appended corrections; uses the `outcome_unknown` path of
[0101](0101-a-timed-out-write-is-outcome-unknown-and-a-late-answer-is-heard.md). README section 14;
`docs/features/playbooks.md`, "Follow-through".

## Context

The bench measures what Athena proposes in one session with nobody at the cards (`approve: none`),
so everything after a card is unmeasured. `approve: all` signs the cards, but the simulated page
records each action and never changes a table, so a read after a signed demand looks as if nothing
was sent. The run ends with the world, so there is no second session, no restart and no question
of what she does with a "no". The scorer's duplicate check starts empty on every `score()` call, so
a card filed again in a later run is not a duplicate of anything. A chore that comes back every
month (C1, C2, L1 in the 2026-10-22 hunt) depends on exactly these: a signed action shows up later
and is not sent again, a declined one stays declined, a call whose answer was lost is checked
before it is repeated, and new evidence changes the next proposal.

## Decision

1. **A scenario overlay beside the playbook, not in it.** `playbooks/<id>/followthrough.json`
   declares, per gated tool, the parameter that names its item, a `mark` and the table ops an
   executed action has (`append` a row, or `set` columns on the rows a `where` matches; templates
   over the call's parameters, the row and `today`). `later` holds session 2's date, the
   observations three weeks on (here: Northwind's deposit for NW-1043, a new invoice GH-03 with its
   contract and mail) and session 2's phases. `branches` names the three answers; `observed` names
   the paid item and the new work the assertions look for. It lives beside the playbook rather than
   under `src/` because it is authored data about one world, like `world.json`; it is a separate
   file because `world.json` and `truth.json` are frozen (they are what every bench run and every
   comparability key measures). The bench, the scorer and the loader of `spec.py` never read it.
   Piloted on `freelancer-receivables` only.
2. **The driver** (`proving/playbooks/followthrough.py`, verb `followthrough`) runs session 1
   through the bench's own run loop (`bench._phase`, which gained an `answer` hook and per-request
   `fields`; the bench's behaviour is unchanged), with a minted `proj_` id on every request, so both
   sessions share `conv_<proj>`. Each card is answered through `POST /decisions/<id>` by the
   branch alone: `approve` signs every card, `decline` declines every card, `lost_answer` signs
   every card, the page runs it and changes its tables, and the answer that goes back is
   `ok: false, error: outcome_unknown`; the tool is then sent in `gated_tools`, as the desktop
   holds it. Nothing reads `truth.json` or a score to decide an answer. The world is then closed
   and a new `World` built over the same brain directory (the restart); `later` lands on the same
   tables session 1 changed and session 2 runs its phases with nobody answering, so what she
   proposes is the claim.
3. **Independent assertions, from cards, decisions and reads.** `followed` (session 1 answered at
   least one card on a tool the overlay knows; otherwise there is nothing to prove and the run
   fails), then per branch: `approved_effect_read` (a session-2 read shows each signed action's
   mark) and `approved_not_refiled` (no later card on the same tool and item); `declined_no_effect`
   (nothing ran, no table changed) and `declined_not_reproposed` (no session-2 card on a declined
   item); `lost_not_retried` (no later card on a lost item: the card itself would be the blind
   retry; the detail says how many of them session 2 read as done). For every branch,
   `payment_heeded` (no chase card on the paid item, which is past its date and still Open in the
   books, so only the bank says otherwise) and `new_work_found` (a card on the new item). A run
   passes when every assertion holds. Her prose is never read.
4. **k-of-n under one key.** A run's `drive` digest is fixed when it ran: the bench's
   `content_digest` (world, truth, command, expectation, `SCORER_VERSION`), the brief, the overlay
   whole, the engine, the model, `DRIVER_VERSION` and the run loop's bound. Its `comparable` key is
   the drive and `ASSERTION_VERSION`. k-of-n per branch pools only runs under one key.
5. **Append-only results.** Each run's full record goes to
   `proving-runs/<ts>/followthrough-<id>/<branch>-<repeat>.json` (gitignored) and a line to
   `playbooks/<id>/followthrough.runs.json`, a separate file because `write_bench` rewrites
   `bench.json` from the bench's own summary and would drop a section it does not know.
   `--reassess <record>` judges a saved record with today's assertions, writes the result beside
   it, and appends a correction (`was`, `now`, when, why) without touching the run's line. A
   correction keeps the run's drive and moves its key only with `ASSERTION_VERSION`, unlike a
   rescore under 0127, which takes today's content key: the session record was driven by the old
   overlay, and judging it again does not re-drive it. The file's `tally` is k-of-n under the
   latest run's key, corrections applied.

## Consequences

- One pilot run is 2 sessions; `--branch all --repeats 3` is 18 sessions, about $29 on Sonnet at
  the bench's cost per session. Nothing is committed in `followthrough.runs.json` until that runs.
- A real model's memory across the restart is what the brain recalls: the declined card comes back
  as a `[decision] the user declined ...` episode under the project. Without the S1 "since last
  run" block a model may well re-propose; the assertion records it rather than excuses it.
- `lost_not_retried` cannot tell a blind retry from a retry the person asked for in words, because
  no assertion reads prose and no session-2 message asks for one. A card filed again after a lost
  answer always fails it, even when the gate's "may already have run" line rides on the card.
- Session 2's messages ask her to pick up where they left off, never to chase everything again, so
  a re-proposed declined item is unasked. A different session-2 message is a different overlay and
  a different key.
- The effects are the overlay author's model of the portals. A portal that, in life, would refuse a
  second submit or show a send only in the outbox is not simulated, and a mark the author did not
  put in a read cannot be read back.
- The desktop does not show the k-of-n; `followthrough.runs.json` is read by nothing but this verb.

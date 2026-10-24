# 0145. The tier bench compares paired cells of one bench digest

Date: 2026-10-25

Refines [0097](0097-adopting-a-playbook-is-a-conversation-held-outside-the-turn-lock.md) item 9
(the pick's population). Follows [0134](0134-a-brief-says-where-each-line-came-from-and-carries-the-dates.md),
which changed the bench's input and recorded that earlier figures are not comparable with a re-run.

## Context

The adopt tier bench is resumable: one JSON per (scenario, config, rep), and a complete one is
skipped forever. Nothing in a record named the studio prompts, the persona and judge prompts, the
loop's card cap or the scenario sheet that produced it, so a resume after a studio change spliced
records of two benches into one table, and `pick --write` could rewrite `tiers.json` from them.
The pick also pooled each config's complete records without checking what they covered: a config
whose hard interviews failed was ranked on its easy ones, and its first-text p50 included the few
fast legs of wall-capped or stalled interviews. The sibling docread bench already scores only the
units every reader answered.

## Decision

`proving/adopt_tiers/cells.py` holds three rules.

1. **One bench digest.** A sha256 over `INTERVIEW_SYSTEM`, `AUDIT_SYSTEM`, `BRIEF_SYSTEM`,
   `PERSONA_SYSTEM`, `JUDGE_SYSTEM`, `MAX_ROUNDS` and each scenario file's bytes. Every interview
   and shape record carries `bench_digest`, the digest of its own scenario, so a run of a subset of
   scenarios stamps what a full run would. A complete record of another digest, or none, is stale:
   the plan runs it again and counts it (`--dry` says so); the pick and the report leave it out
   and count it.
2. **Paired cells.** A cell is (scenario, rep). A config that did not complete every cell some
   config completed is out, `covered k of N cells`. Quality is read over the cells every
   remaining config completed, and the pick says `paired n of N` (N = scenarios x reps). If no
   config covers them all, the pick is the best-accuracy fallback over each config's own runs.
3. **Outcome-conditioned speed.** After the quality floor, speed ranks over the paired cells where
   every survivor ended `clear` or `brief`; the p50 over every paired cell is published beside it
   with both subset sizes, never ranked. With no such cell, speed falls back to every paired cell
   and the pick says so.

`pick_role` keeps the rule over stats already made comparable; `pick_bench` is what `report` and
`pick` call.

## Consequences

- Every record written before this change is stale: the 2026-10-14 and 2026-10-15 records run
  again on a resume and no longer feed a pick. That is the intent (ADR 0134 already called them
  not comparable).
- One failed interview puts a config out until a resume completes that cell, because the plan
  runs incomplete jobs again. A pick with a gap is a re-run, never a ranking on an easier mix.
- The digest covers the prompts, the card cap and the scenario sheets, not the studio's code or
  the playbooks the scenarios name; a change there still needs a new date or a judgment call.
- `picks.json` gains `cells`, `paired`, `conditioned`, `speed` and `pooled`; older readers ignore
  them. Records gain one key, which older code ignores.

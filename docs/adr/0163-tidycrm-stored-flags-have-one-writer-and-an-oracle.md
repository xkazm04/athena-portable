# 0163. TidyCRM's stored flags have one writer and an oracle

Date: 2026-10-25

Builds on ADR 0004 (the gate is the policy) and ADR 0149 (a dossier act is offered exactly when
its mutation would accept it).

## Context

TidyCRM stores four defect flags on every contact - `phone_ok`, `is_stale`, `conflict`,
`in_open_pair` - and indexes them, so a segment filter is one index scan. Each is a cache of a
rule: `isE164(phone)`, `isStaleAt(last_activity_at)`, more than one company spelling among the
working rows on the domain, at least one open identity pair. Every write path restamped the flags
it remembered by hand: `phone_ok` in three places (normalise, merge, undo), `is_stale` in one that
arrived only after a shipped bug (b135dbb4), `conflict` through a helper a fix had to correct
(7e9209d2), and `in_open_pair` both derived by a helper and zeroed inline. Nothing checked that a
cache equalled its rule. Merge was also the one write that changed field values with no
`revisions` row: the survivor's phone silently became the duplicate's.

## Decision

1. **One writer.** `examples/tidycrm/lib/flags.ts` holds each flag's rule (`deriveFlags`) and the
   only code that writes the four columns (`restamp`, which recomputes a scope of rows and domains
   and writes what moved). The seed inserts rows with default flags and stamps them through
   `restamp` too, so the seed cannot disagree with a write.
2. **One field-write door.** `writeField` records the revision, sets the value and restamps what
   the field feeds (the row for a phone or a date, the domain for a company). `setField` is its
   second half, without a revision, for undo, which records the reversal on the revision it
   reverts. Normalise, settle-a-company, merge adoptions and undo all go through it; delete, merge
   and pair verdicts name the rows and domains they could have moved to `restamp`.
3. **A merge adoption is a revision.** It is tagged `merge_contacts` (`MERGE_RULE`), and the
   export excludes that tag from its normalised figures exactly as it excludes `resolve_company`.
   Merge stays GATED and irreversible; the revision is history, not an undo path.
4. **An oracle.** `flagDrift(db)` recomputes every flag of every row from its rule and returns
   each disagreement as `{id, flag, stored, derived}`. `test/flag-drift.test.ts` pins it empty on
   the seed, pins that it names a corrupted row, runs a seeded random walk (3 seeds x 150 steps of
   every write and undo, ids from live and dead rows and from the activity log) asserting it stays
   empty after every step, and holds a source guard: no file under `lib/` but `flags.ts` names a
   flag in an `UPDATE contacts SET` or `INSERT INTO contacts`, or builds an `UPDATE contacts SET`
   column at run time.

## Consequences

- A new write path cannot forget a flag without the walk naming the row and the flag: taking
  the phone, company or pair-verdict restamp out (checked by hand) fails it within 20 steps.
- The survivor of a merge carries the history of what the merge changed on it, so the sheet's
  "changed" count for that record rises by its adoptions. That is correct and visible.
- `flagDrift` checks every row, merged and deleted ones included, which is stricter than the
  working list: a removed row's flags must still equal their rules.
- `isStaleAt` and `WORKING` moved to `lib/flags.ts`; `lib/db.ts` re-exports them, so readers keep
  their import. `flags.ts` imports nothing from `db.ts`, so there is no module cycle, and
  `flagDrift` takes the handle as an argument.
- No schema change and no data migration. A revision row written by a merge stays a valid row if
  this is reverted.

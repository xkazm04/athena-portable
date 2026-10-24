# 0149. A tidycrm dossier act is offered exactly when its mutation would accept it

Date: 2026-10-25

Extends ADR 0107 from `examples/hirelane` to `examples/tidycrm`. Registry: hitl-approval,
technique cosmetic-vs-enforced-threshold-invariant.

## Context

The Blocks dossier's gate (`components/blocks/dossier/Gate.tsx`) decided what it offered from
predicates of its own, and the mutations in `lib/mutations.ts` decided what they accepted from
others. The two had drifted in both directions:

- The tidy act was enabled on `table.ids.length` and labelled with it: every live row. The write,
  `normalizeFields`, changes only the rows `planNormalize` finds a change on. On the seed it labelled
  800 rows across the 46 tables where 78 would change, and was enabled on tables where nothing
  would change at all.
- The gated delete was offered on `staleIds`, the stale rows not yet flagged. `deleteContacts`
  accepts any live row, flagged or not. So flagging the stale rows, the reversible alternative the
  gate itself recommends, took the irreversible act away for good (BLK-05: 5 stale rows, then 0).

## Decision

1. **One module answers "may this act run on this table, on which records, and if not, why".**
   `examples/tidycrm/lib/acts.ts` is pure and client-safe. `actsFor(rows, pairs)` returns
   `{tidy, phone, flag, keep_both, merge, delete}`, each `{enabled, count, ids, label, reason?}`.
   The reasons are one vocabulary (`nothing_to_tidy`, `no_phone_to_rewrite`, `nothing_stale`,
   `all_flagged`, `no_pair`) and `REFUSAL` holds the sentence a shut control prints.
2. **The offer is the write's own predicate.** The two tidies ask `planChanges`, the planner
   `planNormalize` runs, so the count a control prints is the count of contacts the write reports.
   The flag targets the stale rows not yet flagged (what `flagStale` changes); the delete targets
   every live stale row, flagged or not (a subset of what `deleteContacts` accepts). The delete stays
   behind arm and confirm, so no gate is weakened. The pair acts are offered on an open pair.
3. **The sheet builds it, the gate renders it.** `buildSheet` attaches `BkTable.acts` while it
   already holds every row, adding no query. `Gate.tsx` reads every control's enabled state, label,
   count and target ids from `table.acts` and computes no availability of its own.
4. **The mutations are unchanged.** Unlike ADR 0107 decision 2, the server side keeps its own
   refusal sentences; the parity test, not a shared predicate import, holds the two together.

## Consequences

- `examples/tidycrm/test/acts.test.ts` runs every seeded table through all six acts against the
  real mutations, each call rolled back by restoring the four written tables. An act whose control
  and write disagree in either direction, or whose printed count differs from the count the write
  logs, fails it. Its last case fails if `Gate.tsx` grows an emptiness check or a record list of
  its own.
- A new availability rule for the dossier goes in `lib/acts.ts` or nowhere.
- `BkTable` keeps `ids`, `staleIds` and `phoneIds`: other readers use them.
- The agent's sheet read does not carry `acts` yet (ADR 0107 decision 4's twin); that is a
  follow-up, not part of this change.
- Rollback is one `git revert`. No schema change, no data migration, no manifest or tool change.

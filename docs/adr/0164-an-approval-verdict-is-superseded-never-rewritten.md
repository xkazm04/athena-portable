# 0164. An approval verdict is superseded, never rewritten

Date: 2026-10-25

Amends ADR 0005 (the approval table lives in the brain's index and survives a reconcile), ADR
0038 (an approval is spent once, by one conditional write) and ADR 0060 (an approved, unspent card
the replay refused can still be declined).

## Context

`companion_approval` has one `choice`, `answer`, `reason` and `resolved_at` slot per row, and its
lifecycle (five edges) was stated only in the module docstring. Four hand-written conditional
`UPDATE`s (`resolve`, `expire_due`, `consume`, `decline_approved`) each restated their own from
status. The one late edge, approved -> declined (ADR 0060), overwrote the row's `choice` and
`resolved_at` in place, so a card the user approved at T1 and declined at T2 read as a plain
decline at T2: the yes and its moment were unrecoverable. The Record (BACKLOG B6) has to answer
"what did she do, and what did I decide" from persisted decisions, and the registry's
hitl-approval standard (decision records: append-only, superseded not edited) recorded this as a
deviation.

## Decision

1. **The lifecycle is a table.** `APPROVAL_TRANSITIONS` maps `(from status, event kind)` to the
   status after, holding exactly the docstring's five edges; a test pins the two to each other.
2. **One writer.** `_transition(con, id, edge, at, ...)` is the only code that changes a row's
   state. It refuses an edge the table does not name, derives the conditional `UPDATE`'s `WHERE`
   from the edge (the from status, unspent, and due for an expiry), and appends one event to a new
   `companion_approval_event` table only when the write landed (`rowcount == 1`), inside the same
   `BEGIN IMMEDIATE`. Racing writers still split into one winner (ADR 0038) and a refused write
   leaves no event. `create` files the row and its `filed` event in one transaction.
3. **A later verdict supersedes.** The `declined` event of `decline_approved` carries
   `supersedes` = the `seq` of the `approved` event it replaces. The row keeps meaning the
   effective verdict (the head of the chain), so every reader (`pending`, `of_turns`,
   `spent_recently`, `describe`) is unchanged; `Approvals.history(id, limit)` is the trail,
   bounded and counted like `pending`.
4. **Old brains are backfilled once.** On open, a row with no events gets a trail rebuilt from its
   own columns (`filed`, then its verdict, then `consumed` if spent), every line marked
   `backfilled`. Nothing is invented: a pre-existing approved-then-declined row reads as a decline.
5. The event table is created with the same `CREATE TABLE IF NOT EXISTS` idiom and is absent from
   `INDEX_TABLES`, so a reconcile keeps it (ADR 0005).

## Consequences

- No verdict can be rewritten or lost, and a new edge cannot be added without the table naming
  it. A seeded walk of 200 operations over 10 rows pins that folding each trail yields exactly the
  row's status, choice and `consumed_at`.
- Every state change now writes two rows in one transaction; the cost is one small insert per
  answer, spend or expiry.
- The first open of an old brain inserts its backfill inside the constructor's write transaction;
  later opens run one anti-join that selects nothing.
- `companion_approval`'s schema and every public method signature are unchanged; reverting leaves
  the event table unread, which `IF NOT EXISTS` tolerates.
- Follow-up, not built here: the card precedent ("you approved this 4 times, declined once") and
  the Record reading the trail.

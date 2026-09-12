# 0005. Approvals and the ledger live in the brain's index, outside the tables a reconcile clears

Date: 2026-09-12

## Context

README §2 invariant 1 says markdown on disk is truth and SQLite is a rebuildable index, and
`core/brain/reconcile.py` makes that literal: it empties exactly the tables named in
`core/brain/schema.py`'s `INDEX_TABLES` and rebuilds them by walking the tree. Two new kinds of row
land in this commit, and neither is derivable from any file:

- an approval — the decision card of README §3.2 step 4, its lifecycle, and the grant the gate is
  replayed against in step 6;
- a ledger row — one per model invocation, the record README §2 invariant 6 requires and act 4 of
  the demo renders.

Three places they could live. A second SQLite file beside `index.sqlite` would mean a second writer
lock, a second read path, and a brain directory that is portable by copying only if whoever copies
it knows about both files. A row inside `companion_node` would make an approval a memory, which it
is not: nothing about it is markdown, and a recall over it would put last night's declined payment
into a prompt. Or the brain's own index, in tables the reconcile does not own.

There is also the question of what these two modules should hold to reach SQLite. README §3.1 says
packages depend on ports and never on concrete classes, and a connection-provider port is the
obvious reading of that rule.

## Decision

**One database, two more tables.** `companion_approval` and `companion_turn` are created in
`core/approvals.py` and `core/ledger.py` with the same `CREATE TABLE IF NOT EXISTS` idiom the brain
uses, executed once in each class's constructor under the brain's writer lock. Construction is
idempotent, so opening a brain twice, or opening the ledger before the approvals, costs nothing.

**They are absent from `INDEX_TABLES`, and that absence is the mechanism.** The reconcile clears a
closed list; anything outside it survives by construction rather than by a flag someone has to
remember to set. `tests/core/test_approvals.py` and `tests/core/test_ledger.py` each run a real
`reconcile_from_disk` over a brain holding rows and assert the rows are still there afterwards, so
a future commit that adds either name to `INDEX_TABLES` fails the gate rather than losing a week of
cost data quietly.

**They take a `Brain`, not a connection-provider port.** `contracts/` is the seam *between*
packages and holds dataclasses and Protocols with no I/O; a port whose whole purpose is to hand out
`sqlite3` connections does not belong there, and declaring one inside `core` would be a second
name for something both sides of which already live in `athena.core`. Approvals, the ledger and the
brain are sibling modules of one package: depending on the sibling crosses no seam and forks no
contract type, and `Brain` already owns the two handles these tables need — `write_txn()` (the
writer lock, one `BEGIN IMMEDIATE`, commit or full rollback) and `read_connection()` (a fresh
read-only handle per call). Both modules use exactly those, so a long turn writing an approval does
not stall a panel reading the ledger, which is the day-zero decision of README §3.5.

**Two rules inside the approval table are worth naming here.** Only a token the row itself offered
resolves it, compared by exact string equality — the answer arrives through a model paraphrasing a
human, and a table that accepts "sure, go ahead" is a gate a prompt injection can talk through.
And of the offered tokens exactly one, `approve`, moves the row to `approved`; every other offered
token records the user's answer and leaves it `declined`. The table answers one question — was this
action authorised — so a card offering `("send", "skip")` cannot be mistaken for consent.

**The ledger mints no ids.** Rule 10 of the build is one `ids.py` per language, and it has no turn
prefix. Row identity is SQLite's `AUTOINCREMENT` — honest, because "one row per invocation" is
what a monotonic row id counts — and `turn_id` stores whatever id the harness already minted.

## Consequences

A brain stays portable by copying one directory, and the copy carries its pending cards and its
spending with it. Deleting `index.sqlite` to force a rebuild now costs the approvals and the ledger
as well as the index; that is the honest trade of keeping one file, and it is stated in both module
docstrings so nobody discovers it during a demo.

`core/approvals.py` and `core/ledger.py` import `core.brain.store`, which means a test for either
opens a real brain directory rather than a fake connection. That is a feature at this size: the
tests exercise the lock and the read handle the daemon will use, and there is no in-memory double
whose behaviour under two writers would differ from production.

`rollup(by=...)` interpolates a column name into SQL. The dimension is looked up in `ROLLUP_KEYS`
and the caller's string never reaches the query, which a test asserts by asking for a rollup by an
injection string and getting a `LedgerError`.

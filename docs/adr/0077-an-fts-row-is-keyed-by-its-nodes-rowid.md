# 0077. An FTS row is keyed by its node's rowid, and the index is schema version 2

Date: 2026-10-11

Keeps [0002](0002-stdlib-only-core.md) (FTS5 from CPython's bundled SQLite, no
dependency) and [0003](0003-disk-is-truth-one-writer-many-readers.md) (the disk is the truth and
the index is derivable). Closes provenance-backed-memory council full r1 economics-2.

## Context

`companion_fts` declares `node_id UNINDEXED`, rightly: it is a join key, and indexing it would let
a query match a memory by its own id. But `Brain.index_node` found the row to replace with
`DELETE FROM companion_fts WHERE node_id = ?`. An UNINDEXED column has no index, so every write
scanned the whole FTS table. `append_episode` was linear in the size of the brain, and a cold
rebuild, which indexes every file one by one, was quadratic: 31.5 s at 10,000 files. Counted in
SQLite VM steps, one write cost 1,446 steps at 100 nodes and 22,346 at 2,000 (15.45x).

## Decision

**Each `companion_fts` row has the rowid of its `companion_node` row**, and a write deletes and
inserts by that rowid, which FTS5 looks up directly.

`companion_node` was written with `INSERT OR REPLACE`, which deletes a conflicting row and gives
the new one a new rowid, so the key would not survive an update under the same id. It is now an
upsert, `INSERT ... ON CONFLICT (id) DO UPDATE SET` every column `= excluded`, `RETURNING rowid`.
The row keeps its rowid and every column ends as `INSERT OR REPLACE` left it. This was preferred to
reading the old rowid before a replace, which costs a statement and still moves the key. Upsert
needs SQLite 3.24 and `RETURNING` 3.35; CPython's bundled SQLite is newer on every supported
platform.

The `node_id` column stays, because recall's joins read it, and the FTS columns are unchanged.

**`SCHEMA_VERSION` is 2.** `Brain.__init__` reads the stored `schema_version` before it stamps the
new one. An index stamped 1, or not stamped (or stamped with something that is not a number), is
re-keyed in the same write transaction that creates the schema: every FTS row whose node exists is
copied out with its node's rowid, the table is emptied, and the rows go back under that rowid.
Where one node had two FTS rows, the newer is kept, and a row with no node is dropped. Then the
index is stamped 2. No reader sees it half re-keyed.

Nothing on disk changes. A migration that only reshapes derivable rows is the cheap kind
ADR 0003 allows: deleting `index.sqlite` and running a reconcile gives the same index.
`reconcile.index_fingerprint` is unchanged, and a test pins that a re-keyed index has the
fingerprint of a fresh rebuild.

## Consequences

- A write is a constant number of steps, whatever the brain's size: 242 VM steps at 100 nodes and
  at 2,000. A test counts them with `set_progress_handler` rather than timing them.
- Opening a version-1 index once costs one pass over its FTS rows. A fresh index has none.
- An index written by another implementation that lets FTS5 choose its own rowids would break the
  key until a reconcile. Athena is the only writer of its index today (ADR 0003); the Personas
  parity is in the markdown tree, which this does not touch.
- A version stamped higher than 2 is not migrated down and is stamped 2, as a higher stamp was
  stamped 1 before.

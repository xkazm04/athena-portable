# 0016. The shell's store is one described schema behind four key/value commands

Date: 2026-09-12

## Context

The desktop shell needs durable local state: which engine the daemon is started on, which origins
the user has trusted and at what class, the projects a turn is filed under, one row per tool call,
and the screenshot that sits beside a decision card. Seven tables, arriving over six milestones,
written by different people on different branches.

The first build grew this table by table, and paid for it twice. Every new surface added a pair of
Rust commands (`origins_get`/`origins_set`, then `projects_*`, then `project_pages_*`,
`project_runs_*`, `activity_*`), so `lib.rs`, `build.rs` and `capabilities/ui.json` were edited by
every module author and the command list became the file everyone conflicted on. And the tables
arrived one milestone at a time, so a user who had run phase 1 carried a store that phase 2 had to
migrate — an upgrade path nobody had tested, for a file nobody had a backup of.

It also lost an argument at the IPC boundary: `store_set(key, undefined)` serialised to an object
with no `value` key, and Rust answered "missing required key" for what the caller meant as "store
nothing here".

## Decision

**One SQLite file, every table created at once, and four commands over all of them.**

- `store.rs` describes each table once — its key, its columns, each column's kind and its insert
  default — in a `TABLES` list that is simultaneously the schema, the wire contract and the
  documentation. `store_get`, `store_set`, `store_list` and `store_delete` take a table name and a
  key and work for every table in that list. A later milestone adds a *row to the list*, not a
  command, so `lib.rs`, `build.rs` and the capability file stop being shared edit surfaces.
- **All seven tables exist from this commit**, including the three nothing writes to yet. The
  schema version is recorded in `schema_migrations` and is meant never to move; re-opening an
  existing store is the ordinary path and is `CREATE TABLE IF NOT EXISTS` throughout.
- **`null` is the only empty value.** A missing row answers `null`; a column the caller omits and
  a column the caller sends as `null` both mean "leave it alone"; a column is cleared by sending
  its empty value (`""`, `{}`). `lib/ipc.ts` rejects `undefined` at the type level, so the
  ambiguity cannot be spelled by the panel in the first place.
- **`captures` carries a byte cap and an LRU sweep**, and the store measures a capture's size from
  the blob it was handed rather than believing a number the caller sent. The sweep is exercised by
  a test in this commit, one milestone before the code that will call it.

## Consequences

- A generic surface cannot enforce a table's *semantics*: nothing stops a caller writing an
  `activity` row with an empty `tool`. That is deliberate — the gate, not the store, is where
  policy lives (README invariant 3) — but it means `lib/store.ts` carries the row types and is the
  layer a store imports, never `invoke` and never the raw commands.
- `store_list` answers `{rows, showing, total}` for every table, with the total counted through the
  same `WHERE` as the page, so `(showing N of M)` is honest everywhere by construction.
- `settings` is the one table whose row *is* its value: `store_get("settings", "theme")` answers
  the value, not an object wrapping it, while `store_list("settings")` answers objects because a
  page of values with no keys beside them is a page nothing can be done with. The asymmetry is
  spelled once, in the table description.
- Ids that cross the Python/TypeScript seam are *not* minted here. The store mints exactly one
  kind — a capture id, because the shell is what takes the screenshot — so this file can never
  become the second place a `proj_` comes from.
- Tables created ahead of their code can drift from what that code eventually wants. The cost is
  bounded by the fact that every table is written and read back by a test in this commit; the
  alternative, a migration per milestone during a hackathon, is the more expensive mistake.

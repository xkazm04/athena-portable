# 0081. A damaged index is set aside and rebuilt by reconcile

Date: 2026-10-11

Implements README section 2 (invariant 1, disk is truth) and section 3.5. Closes the full-council
round 2 finding robustness-1 of provenance-backed-memory. Builds on ADR 0003 and ADR 0077.

## Context

ADR 0003 and ADR 0077 say the index is derivable: delete `index.sqlite`, run a reconcile, get the
same index. But `athena brain reconcile` opened `Brain()` before it rebuilt anything, and `Brain()`
raised `DatabaseError` ("database disk image is malformed", "file is not a database") on a damaged
file. The one repair command failed on exactly the damage it exists to repair, and the person had
to know to delete the file by hand. The same file also holds the approvals and ledger tables, which
are not on disk and which a rebuild cannot recreate, so a silent delete would drop them.

## Decision

- `Brain.__init__` wraps everything from the first PRAGMA through the schema transaction. When a
  `sqlite3.DatabaseError` carries a primary result code (`sqlite_errorcode & 0xFF`) of
  `SQLITE_CORRUPT` or `SQLITE_NOTADB`, the connection is closed and `IndexDamagedError`, a
  `sqlite3.DatabaseError`, is raised `from` it. The message names the index path and
  `athena brain reconcile`. Any other error is re-raised unchanged: a locked or read-only brain is
  never called damaged.
- `Brain()` never sets anything aside, and neither does the daemon. Only the explicit repair does.
- `athena brain reconcile` catches `IndexDamagedError` and renames `index.sqlite`, and its `-wal`
  and `-shm` files when present, to `<name>.damaged-<UTC yyyymmddThhmmssZ>` in the same directory.
  The sidecars move first, so a failure never leaves a fresh index beside an old log. Nothing is
  deleted. It then opens a fresh `Brain` and runs `reconcile_from_disk` as before.
- The JSON output gains `set_aside` (the renamed paths, `[]` on a healthy brain) and, only when
  something was set aside, `not_rebuilt`: a fixed sentence saying approvals and ledger rows in the
  damaged file were not rebuilt.
- If a rename raises `OSError` (on Windows the daemon may hold the file), the command prints one
  JSON object with `ok` false, the cause and what was already moved, returns 1, and renames and
  deletes nothing further.

## Consequences

- A damaged index is repaired by one command, and the damaged bytes stay on disk for inspection.
- The approvals and ledger rows in the damaged file are lost to the live index. They were never on
  disk (ADR 0003), so no rebuild could restore them. They remain readable in the kept file.
- The kept files accumulate until the person removes them. Two repairs in the same second collide on
  the name and the second reports the rename failure.
- Other damage, for example a table that is missing from an otherwise valid database, is not
  handled here and surfaces as before.
- Deleting the index by hand still works.

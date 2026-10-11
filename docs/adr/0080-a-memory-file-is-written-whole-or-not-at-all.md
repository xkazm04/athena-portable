# 0080. A memory file is written whole or not at all

Date: 2026-10-11

Implements README section 2 (invariant 1, disk is truth) and section 3.5 (the brain). Closes the
full-council round 2 findings robustness-2 and craft-8 of provenance-backed-memory. Builds on ADR 0003.

## Context

ADR 0003 writes the file first and the index second, so a crash between the two leaves a findable
file and a missing row that reconcile repairs. `Brain._write_file` was `Path.write_text`, which
creates the file and then encodes. A value holding a lone surrogate (JSON's `\ud800` decodes to
one, and the `core.write_fact` schema only checked length) passed the validator and the user's
approval, then failed to encode and left a 0-byte `.md` in `semantic/` or `episodes/`. The
promise of ADR 0003, a findable file, was false: the file held nothing, and reconcile skipped it.

## Decision

- `_write_file` encodes the payload to UTF-8 first. If that raises, nothing is created, not a file
  and not a directory entry.
- The bytes go to a temporary file in the target's own directory, named
  `.<target name>.<random hex>.tmp`. It does not end in `.md`, so reconcile's `rglob("*.md")` never
  indexes it. The file is flushed, fsynced, closed, and renamed onto the target with `os.replace`.
- On any exception after the temporary file exists it is removed and the original exception is
  re-raised.
- The bytes are identical to before for every input, a body with CR included (craft-6 is a
  separate question and is not changed here).
- The callers keep their order: file first, then the index transaction.
- The schema validator refuses a string that cannot be encoded as UTF-8, before `maxLength`, with
  reason `validator_failed`. The detail names the param path and says it is not valid Unicode
  text; it never echoes the value. It applies to every string the validator checks, list items
  included. No other keyword changed. The card is therefore refused before the user sees it.

## Consequences

- A write that fails leaves no empty file and no partial file. The target is either absent, the
  old file, or the complete new one.
- A crash between creating and renaming the temporary file can leave a stray `.*.tmp` file. Reconcile
  ignores it; it holds no memory and can be deleted by hand.
- The directory is not fsynced. Windows cannot open a directory for it. A power cut right after the
  rename may therefore lose the new directory entry, which is the same outcome as a crash before
  the write.
- `PRAGMA synchronous = NORMAL` is unchanged. A lost index commit leaves a durable file and a
  missing row, and reconcile repairs exactly that.
- Each write costs one fsync more than before.

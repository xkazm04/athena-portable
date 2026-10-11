# 0076. A memory store that cannot be read says so

Date: 2026-10-11

Keeps [0003](0003-disk-is-truth-one-writer-many-readers.md) (one read handle per recall) and
[0058](0058-a-recall-cut-across-tabs.md) (the shape of `core.recall`'s answer).
Closes provenance-backed-memory council full r1 robustness-1, and the NUL query of robustness-9.

## Context

`recall._rows` caught every `sqlite3.OperationalError` and returned no rows, and `_count` turned
that into 0. The intent was narrow: a user's query that made a malformed FTS5 MATCH should be an
empty answer, not a crash. The catch was wide. A locked index, a dropped `companion_fts` and an
I/O error all became "no distilled memory matched the query":

- `core.recall` returned `ok=True` with three empty blocks, so the model was told there was
  nothing to find;
- on the per-turn path the always tier rendered `(showing 0 of 0)` and the prompt said
  `(nothing recalled)`, so facts the user approved for every turn vanished without a word;
- every one of the nine or so statements waited out `BUSY_TIMEOUT_MS` on its own, so a locked
  index cost 44.3 s before the turn could start.

The one malformed-MATCH case left was a control character: SQLite reads a NUL as the end of the
string, so `"acme` NUL `invoices"` was an unterminated phrase.

## Decision

**A query cannot make a MATCH malformed.** `fts_terms` and `fts_quote` drop every Cc character that
is not whitespace before quoting. Whitespace still splits terms, as before.

**The first `sqlite3.Error` ends the recall.** `_rows` no longer catches. `recall` and
`recall_whole` catch `sqlite3.Error` around the whole read, opening the handle included, so no
further statement runs and a lock costs one busy timeout. They return `unavailable_trace`:

- every block is empty and carries `note`, `memory could not be read: <SQLite's message>`, made
  one line by `catalog.canonical_line`;
- a block with a note renders that line and no footer, because `(showing 0 of 0)` would claim a
  population nobody counted;
- `RecallTrace.unavailable` is `True` and the note is the one entry in `notes`, in place of "no
  distilled memory matched the query";
- one warning is logged per recall on `logging.getLogger("athena.core.recall")`.

**The turn still runs.** `prompt.py` is unchanged: a block with text is shown as it is, so
`memory.always` and `frame.memory` show the note instead of `(nothing recalled)`, and the model is
told memory is missing rather than empty. The episodes block shows it too, inside its fence. The
system prompt's hash changes on such a turn, because the always tier's text changed. That is
accepted: a cache miss is the honest cost of a prompt that says the store is down, and it reverts
when the store reads again.

**`core.recall` fails.** `wiring.recall_executor` returns `ExecResult.failure("engine_error",
note)` for an unavailable trace. `ERROR_REASONS` is closed, and of its members `engine_error` is
the one a tool already uses when the service behind it fails (`connectors/service.py` for a vault
or provider error). `unknown` is for a reason nobody recognised, and this one is recognised.

## Consequences

- An empty answer from recall now means the store was read and nothing matched.
- A daemon read route that returns `RecallTrace.as_dict()` gains an `unavailable` key.
- A query with a NUL in the middle of a word matches the word with the NUL removed
  (`acmeinvoices`), which is an honest miss rather than an error.
- No timing is asserted. A test shortens `BUSY_TIMEOUT_MS` by monkeypatch, holds an exclusive lock
  and counts the statements the recall ran: at most one `SELECT`.

## Amendment 2026-10-11 (memory full r2 craft-9)

- The note now goes through the fence sweep after it is made one line: `unavailable_trace` runs
  `canonical_line` and then `fence.neutralise`, the first two steps of `memory_line`, so a marker
  split by a zero-width character is whole again before the sweep looks for it.
- Why: ADR 0075 sets one rule for memory text in an unfenced block, and the always tier copies this
  note into the system prompt unfenced. Some SQLite messages embed object names read from the
  index file, which is text a page could shape.
- Why the note is not quoted or cut: it must stay a plain line that starts with
  `UNAVAILABLE_PREFIX`, which callers and tests match on, and a cut could drop the part of the
  message that names what failed. The sweep is enough to leave it no live marker.

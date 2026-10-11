# 0003. Disk is truth, the index is rebuildable, and reads get their own connection

Date: 2026-09-12

## Context

README §2 invariant 1 says markdown on disk is truth, SQLite is a rebuildable index, and a brain
is portable by copying its directory. Three questions follow that the invariant does not answer
on its own, and each has a wrong answer that is easier to write than the right one.

**In which order does a write land?** The index is the fast thing, so the tempting order is row
first, file second. A crash between them then leaves a row pointing at a file that does not
exist — a memory the system believes it has, cites in a prompt, and cannot open. No rebuild
repairs that, because a rebuild reads the disk and the disk never heard of it.

**What does a rebuild restore?** Frontmatter carries `id`, `type`, `scope`, `key`/`trigger`,
`confidence`, `created` and `sources`. Importance, the machine marker and (later) decay
timestamps are index columns — ref §8 puts them there, and the Personas writer expects them
there, so moving them into frontmatter would break the format parity that makes the directory
portable in the first place.

**How do reads and writes share the file?** The first build opened one SQLite connection with
thread affinity, so the daemon had to be single-threaded, and a `/run` that took forty seconds
stalled `/health`, `/pending` and every other read behind it for forty seconds (README §3.5,
row 1). A tab that held a keep-alive connection could starve every other client.

## Decision

**Disk first, index second.** Every writer renders the file, writes it with `newline="\n"`, and
only then opens one transaction — `BEGIN IMMEDIATE`, every row for that memory, `COMMIT`. A
memory's node row, its FTS row, its typed sidecar and its provenance arrive together or not at
all. A refusal before the file write (an unknown scope, a header that cannot be rendered, a dead
source) leaves nothing behind at all.

**The index is derivable and `reconcile_from_disk` is the proof.** The walk goes through the same
`Brain.index_node` the incremental writers use, so a rebuild cannot drift from a write; a test
copies a brain directory without its `index.sqlite`, rebuilds, and compares row sets with the
original. Runtime state that was never on disk — sessions now, approvals and the ledger later —
is not touched by a rebuild. What a rebuild cannot restore is stated rather than hidden: every
memory returns at its writer default importance, so a demotion that was never expressed on disk
is lost. That is the price of keeping the disk format byte-compatible, and it is the right way
round, because losing a demotion costs prompt space while losing a memory costs the memory.

**One writer behind a lock, a read-only connection per read.** `Brain` owns exactly one write
connection, in WAL, and every mutation takes a re-entrant lock around one transaction.
`Brain.read_connection()` returns a fresh connection opened through a `file:…?mode=ro` URI, one
per call, which the caller closes. The daemon's read routes each open their own and answer while
a turn is writing. A read handle is documented as **consistent as of the last completed write**:
each statement outside a transaction takes a fresh WAL snapshot, so a handle opened before a
write sees it afterwards, and a handle inside a transaction holds one unchanging snapshot.

The index file is named `index.sqlite` rather than `index.db` so that a person finding it in a
backup can guess what it is; that it is safe to delete is this ADR's job to say.

## Consequences

The daemon can be threaded (`ThreadingHTTPServer`, README §3.5) without the brain becoming the
bottleneck, and the starvation test that commit can write has something true to assert.
`mode=ro` makes "a read route must not write" a property of the handle rather than a convention,
so a future route that tries gets `sqlite3.OperationalError` at the statement.

Two costs. A read-only handle on a WAL database needs the `-shm` file, which exists because the
writer connection is open — so `read_connection()` is only meaningful on a live `Brain`, not as a
static helper against a path. And a read handle is one object per request rather than one for the
process, which is a connection open and close per read; SQLite opens are cheap, and the
alternative is the queue the first build shipped.

Anything that needs a memory's importance or its use history to survive a machine move has to
write that state somewhere other than the index — a decision this ADR deliberately defers until
the forgetting sweep exists and can say what it actually needs.

## Amendment, 2026-10-11: `expires_at` is removed from the writer and the rebuild

`companion_fact.expires_at` was an index column that no writer put on disk: the fact file had no
such key, so a rebuild lost whatever the index held, and recall never honoured it. It was half a
feature, and the index carried a value the disk could not.

It is removed from `Brain.write_fact` and from the rebuild. A caller that passes `expires_at`
gets a `TypeError` before any file is written, and a fact file with an `expires_at` line of any
shape is indexed like any other fact, the key ignored, as recall always ignored it. The column
stays in the schema for the Personas layout (README §8), so an existing index needs no migration
and `SCHEMA_VERSION` does not change.

An expiry that comes back must first be written to the fact's file and honoured by recall, under
its own ADR. This answers the question ADR 0082 left open (craft-1).

## Amendment, 2026-10-11: a body's line endings are LF on disk

The writer turns CRLF, then any lone CR, into LF before it renders (`Brain.append_episode`,
`write_fact` and `write_procedural`, ahead of the strip and the empty check). The file bytes,
`content_hash`, the excerpt, the FTS body and the typed row all see the same LF body, and a body
made only of CR and LF is still refused as empty.

Why: the readers translate. `reconcile_from_disk` and `Brain.read_body` open files with universal
newlines, so a CR the writer kept never came back, and the row-for-row rebuild this ADR promises
failed for pasted Windows text (craft-6).

Why not `newline=""` on read: `frontmatter.parse` finds its fences by `\n`, so a fact that a
Windows editor saved with CRLF would lose its header and be skipped. The readers keep universal
newlines.

A body with no CR is unchanged byte for byte, and `_write_file` still does no newline
translation on any platform.

A brain written before this fix keeps its CR files and rows until its next rebuild, which reads
LF. Recall's neutraliser can therefore still meet a CR, and `tests/core/test_recall.py` pins that
at the render seam, with a `Memory` and a `RecallBlock` built directly.

This supersedes the CRLF-on-disk test added with 5e91fe4, whose real guard (no newline
translation in the writer) stays in its rewritten form.

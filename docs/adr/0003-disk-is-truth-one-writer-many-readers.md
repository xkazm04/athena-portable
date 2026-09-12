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

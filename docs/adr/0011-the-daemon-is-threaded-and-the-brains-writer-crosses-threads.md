# 0011. The daemon is threaded, and the brain's writer is allowed to cross threads

Date: 2026-09-12

## Context

README §3.5 carries the first build's worst finding: the daemon was single-threaded behind one
SQLite connection, so a long `/run` stalled every read. The panel froze for the length of a turn
and looked like a hung application rather than a busy one. The day-zero decision recorded there is
`ThreadingHTTPServer`, `Connection: close`, one writer behind a lock, a read-only connection per
read request, and the starvation test written before the server.

The first four were already half in place. `athena.core.brain.store.Brain` (ADR 0003) serialises
every mutation behind `_write_lock` and hands out a fresh `mode=ro` handle per read. What was
missing was the server, and writing the starvation test first is what found the remaining half of
the problem.

`sqlite3.connect` defaults to `check_same_thread=True`, so the brain's single writer connection was
bound to the thread that constructed it. A threaded daemon constructs the brain once, at startup,
and then serves every request on a worker thread — so *every write through the daemon* would have
raised `ProgrammingError`. Not a slow write: no write at all. The existing brain tests never caught
it because they write from the thread that built the brain, which is what a CLI does and not what a
server does.

## Decision

Two things, in one commit with the test that forced them.

**The daemon is `ThreadingHTTPServer` with `daemon_threads`, and every response carries
`Connection: close`.** Threading is what makes a slow turn one thread instead of the whole server.
Closing the connection is the other half and is easy to miss: an SSE stream holds its worker for
the length of a turn, and a keep-alive connection behind it is a worker the next request cannot
have — the same starvation, arriving through the socket rather than through the lock.

**The brain's writer connection is opened with `check_same_thread=False`.** This is safe for the
reason the design already gives rather than for a new one: every mutation goes through `write_txn`,
which takes `_write_lock` for the whole transaction, so exactly one thread is ever inside that
connection. sqlite3's own check is a second and weaker guard over the same invariant — weaker
because what it actually enforces is "the thread that called `connect`", which is a property a
server cannot have and which says nothing about whether two writes overlap.

The alternative was a connection per thread, and it is worse in a way that matters here: several
writer connections on one database file means the serialisation moves from a Python lock into
SQLite's `BEGIN IMMEDIATE` and its busy timeout, so two concurrent writes become a five-second wait
and then an exception instead of a queue. "One writer" stops being a statement about the process
and becomes a hope about timing.

## Consequences

A write from any thread works and is serialised; `tests/core/test_brain_connections.py` asserts
both halves — four threads write, all four land, and no transaction opens before the previous one
closed.

The starvation test is two claims rather than one stopwatch constant. A single read answers in well
under the time a held writer runs, and eight concurrent reads cost what they cost with no write in
flight. The second is measured against a baseline taken in the same test, because what "fast" means
on loopback varies by machine and a threshold tuned on one machine is a flaky test on another; what
does not vary is that a serialised server would add the entire hold to every read behind it.

The router is a dozen lines of regular expressions over literal segments and `<name>` captures. A
daemon with fifteen routes does not need a framework, and a framework would be a runtime dependency
in the package that invariant 5 says must run on the standard library alone.

`/health` is the one route that needs no token, so a shell can tell "not listening yet" from
"listening and refusing me". The token may ride the query string as well as the `Authorization`
header, because `EventSource` cannot set a header and an SSE stream the panel cannot open is a
panel that shows nothing; the daemon is loopback-only and the token lives for one run.

CORS reflects an allow-list of the shell's own origins and never a wildcard. A page the user is
browsing is not on that list, which is what stops a visited site's own script from driving Athena
even though it can reach loopback.

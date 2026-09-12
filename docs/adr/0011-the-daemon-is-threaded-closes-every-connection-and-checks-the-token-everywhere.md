# 0011. The daemon is threaded, closes every connection, and checks the token on every route

Date: 2026-09-12

## Context

The daemon is the environment layer's front door: one Athena on 127.0.0.1, beside whatever page
is open. Everything that reaches Athena from outside this process — the shell's panel, a browser
extension, `curl`, and later the MCP server's callers — arrives here. Three questions have to be
answered before the first route is written, and the first build answered two of them wrong in a
way that took an evening of debugging to see.

**How many requests can it serve at once?** The first build's daemon was single-threaded, because
one SQLite connection had thread affinity and the brain was that connection. A `/run` that took
forty seconds therefore held `/health`, the pending inbox, the ledger and the playbooks behind it
for forty seconds (README §3.5, row 1). Every read route was hostage to the slowest write.

**What happens to a connection after the answer?** `http.server` speaking HTTP/1.1 keeps the
connection alive: after writing a response the handler loops and blocks reading the *same* socket
for a next request. On a single-threaded server that is not a slow path, it is a stopped one — the
accept loop never comes back, so one browser tab holding one idle connection starved every other
client until the tab closed. It was measured: a second client timed out.

**Which routes need the token?** A convenience argument says `/health` should be open, so a
supervisor or a shell script can probe liveness without carrying a credential. Against it: any
page in the user's browser can issue a request to `127.0.0.1` on any port. CORS stops that page
*reading the answer*; it does not stop the request, and it never was an authentication mechanism.

## Decision

**`ThreadingHTTPServer`, with the writer behind a lock.** The brain already separates the two
halves (ADR 0003): one writer connection guarded by a re-entrant lock, and a fresh read-only
handle per read. So the server is threaded, read routes take no lock and answer off their own
handle while a turn is writing, and the routes that write take `AthenaDaemon.writing()` — one turn
at a time, which was always the contract, without the reads queueing behind it. The writer
connection is shared across worker threads (`check_same_thread=False`) precisely because the lock,
not the thread, is what serialises it; that is the line of `core/brain/store.py` this decision
needed, and without it "the daemon is threaded" would have been a sentence in a docstring rather
than a property of the program.

**`Connection: close` on every response, and one request per connection.** Threading alone would
have fixed the starvation, so this is belt and braces on purpose. It bounds what an idle client
can hold to one worker thread rather than a thread plus a place in a queue; it means the SSE
stream the next commit adds ends at a closed socket rather than at a length nobody can know in
advance; and it removes the whole class of bug where a connection reused after a restart, a token
rotation or a config change carries state nobody meant it to carry. Responses are HTTP/1.1 with
1.0-style close semantics: `Connection: close`, `close_connection = True`, and a socket timeout so
a client that connects and never speaks releases its thread. The cost is a TCP handshake per
request on loopback, which is microseconds.

**The token is on every route, including `/health`. There is no unauthenticated route.** What an
open `/health` would hand any page in the browser is a fingerprint: which engine is configured,
how long the daemon has been up, how many approvals are waiting, which routes exist. None of that
is worth leaking to make a liveness probe shorter, and the probe is not shorter anyway — a
supervisor that can spawn the daemon can read the token file the ready line names. The one
exception is the CORS preflight: a browser sends `OPTIONS` with no custom headers by definition,
so requiring the token there would forbid cross-origin use entirely rather than protect anything.
The preflight reads nothing, carries no body, and answers only with which methods and headers a
caller may then try — and it is answered with CORS headers only for an allowed origin.

The token is checked *before* the path is matched, so an unauthenticated caller cannot map the
route table by telling a 404 from a 401. CORS is the browser's fence and the token is ours:
`chrome-extension://` origins are always allowed, `--allow-origin` adds the shell's own UI
origins, an origin on neither list gets no CORS headers at all, and none of that changes the token
check in either direction.

## Consequences

The starvation test is the first test in `tests/daemon/test_server.py` and it is written three
ways — a client that connects and says nothing, a client that holds its connection after an
answer, and a route that takes the writer lock and does not give it back — each timed against a
second client's `GET /health`. The test-only slow route is registered on the daemon object rather
than shipped, which is why `routes.py` keeps the route table as a value the daemon owns instead of
a chain of `if` statements inside the handler: a test can add a route, and the next two commits
add `/manifest`, `/run` and the read routes, without either editing the request handler.

Two costs, taken deliberately. A handler thread per in-flight request means an idle client costs a
thread; they are daemon threads holding nothing but a socket, `block_on_close` is `False` so
shutdown never waits for one, and the socket timeout reaps them. And every request pays a
handshake.

One thing this does not decide: what a read sees while a turn is writing. That is ADR 0003's, and
its answer — consistent as of the last completed write — is what `GET /health` reports.

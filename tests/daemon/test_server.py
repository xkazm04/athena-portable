"""The starvation test first, then the token, the connection and CORS (README §3.5; ADR 0011).

The first build's daemon was single-threaded behind one SQLite connection, speaking HTTP/1.1 with
keep-alive. Two clients were enough to hang it: the first held a connection open, the handler
blocked reading that same socket for a next request, and the accept loop never came back, so every
other client waited until the first tab closed. That is the defect this file exists to make
impossible, and it is written before anything else in this directory because the plan says so —
a starvation test written after the server is a test written against the server that exists.

Three different ways of holding the daemon, all of them answered in the same breath:

1. a client that connects and says nothing at all;
2. a client that sends a request, reads the answer, and keeps the socket;
3. a route that takes the writer lock and does not give it back.

Each one gets its own ``GET /health`` from a second client, timed.
"""

from __future__ import annotations

import json
import socket
import threading
import time

from athena.daemon.routes import Reply, Request, Route

from .conftest import EXTENSION_ORIGIN, FAST_S, SHELL_ORIGIN, TOKEN, Live, Response

# -- the starvation test -----------------------------------------------------------------------


def _timed_health(live: Live) -> tuple[Response, float]:
    started = time.monotonic()
    reply = live.request("/health")
    return reply, time.monotonic() - started


def test_a_connection_that_says_nothing_does_not_delay_another_client(live: Live) -> None:
    """The exact shape of the first build's bug: a socket opened and left silent."""
    silent = socket.create_connection((live.host, live.port), timeout=FAST_S)
    try:
        reply, elapsed = _timed_health(live)

        assert reply.status == 200
        assert elapsed < FAST_S
    finally:
        silent.close()


def test_a_client_that_holds_its_connection_open_does_not_delay_another(live: Live) -> None:
    """A browser's keep-alive: one request answered, then the socket kept.

    The daemon answers with ``Connection: close``, so the socket is finished whether the client
    believes that or not — and either way the next client is served immediately.
    """
    held = socket.create_connection((live.host, live.port), timeout=FAST_S)
    try:
        held.sendall(
            b"GET /health HTTP/1.1\r\nHost: localhost\r\n"
            b"Connection: keep-alive\r\nX-Athena-Token: " + TOKEN.encode() + b"\r\n\r\n"
        )
        assert b"HTTP/1.1 200" in held.recv(4096)

        reply, elapsed = _timed_health(live)

        assert reply.status == 200
        assert elapsed < FAST_S
    finally:
        held.close()


def test_health_answers_while_a_slow_route_holds_the_writer_lock(live: Live) -> None:
    """The other half of the first build's finding: a long turn stalled every read behind it.

    The slow route is registered on the daemon object rather than shipped, which is the seam
    ``routes.py`` describes: a test can prove a property of the server without the production
    route table growing a debug entry. It takes ``writing()`` and writes, so what ``/health``
    walks past is a real held lock and a real open write transaction, not a sleep.
    """
    entered = threading.Event()
    release = threading.Event()

    def slow(request: Request) -> Reply:
        with live.daemon.writing() as brain:
            brain.append_episode("the turn that holds the writer", role="assistant")
            entered.set()
            release.wait(timeout=30)
        return 200, {"ok": True}

    live.daemon.routes.add(Route("POST", "/slow", slow))
    answers: list[Response] = []
    caller = threading.Thread(
        target=lambda: answers.append(live.request("/slow", method="POST", body="{}", timeout=40)),
        daemon=True,
    )
    caller.start()
    try:
        assert entered.wait(timeout=10), "the slow route never started"
        assert live.daemon.lock.locked(), "the slow route was supposed to hold the writer lock"

        reply, elapsed = _timed_health(live)

        assert reply.status == 200
        assert elapsed < FAST_S
        # And the read really was a read of the brain, not a cached number.
        assert reply.body["pending"]["total"] == 0
    finally:
        release.set()
        caller.join(timeout=30)
    assert answers and answers[0].status == 200
    # And the write itself landed, from a worker thread, through the lock: the writer connection
    # is shared across threads precisely because ``write_txn`` serialises it (ADR 0003, ADR 0011).
    assert live.daemon.brain.counts()["episode"] == 1


def test_two_writers_queue_rather_than_overlap(live: Live) -> None:
    """The lock is the thing that makes "one turn at a time" true on a threaded server."""
    inside = threading.Semaphore(0)
    overlapped = threading.Event()
    depth = 0
    guard = threading.Lock()

    def write(request: Request) -> Reply:
        nonlocal depth
        with live.daemon.writing():
            with guard:
                depth += 1
                if depth > 1:
                    overlapped.set()
            inside.release()
            time.sleep(0.2)
            with guard:
                depth -= 1
        return 200, {"ok": True}

    live.daemon.routes.add(Route("POST", "/write", write))
    callers = [
        threading.Thread(target=lambda: live.request("/write", method="POST", body="{}"))
        for _ in range(4)
    ]
    for caller in callers:
        caller.start()
    for caller in callers:
        caller.join(timeout=30)

    assert all(inside.acquire(blocking=False) for _ in range(4)), "a write never ran"
    assert not overlapped.is_set()


# -- the token ---------------------------------------------------------------------------------


def test_a_request_without_the_token_is_401(live: Live) -> None:
    reply = live.request("/health", token=None)

    assert reply.status == 401
    assert reply.body == {
        "ok": False,
        "reason": "foreign_token",
        "detail": "X-Athena-Token missing or wrong",
    }


def test_a_request_with_the_wrong_token_is_401(live: Live) -> None:
    reply = live.request("/health", token=TOKEN + "x")

    assert reply.status == 401
    assert reply.body["reason"] == "foreign_token"


def test_an_empty_token_is_401_rather_than_a_way_in(live: Live) -> None:
    reply = live.request("/health", token="")

    assert reply.status == 401


def test_the_token_is_checked_before_the_path_is_matched(live: Live) -> None:
    """A 404 for an unauthenticated caller would map the daemon's routes for free."""
    reply = live.request("/no-such-route", token=None)

    assert reply.status == 401
    assert reply.body["reason"] == "foreign_token"


def test_health_needs_the_token_like_every_other_route(live: Live) -> None:
    """Recorded in ADR 0011: there is no unauthenticated route, liveness probe or otherwise."""
    assert live.request("/health", token=None).status == 401
    assert live.request("/health").status == 200


# -- one request per connection ------------------------------------------------------------------


def test_every_response_says_connection_close(live: Live) -> None:
    replies = [
        live.request("/health"),
        live.request("/health", token=None),
        live.request("/nope"),
        live.request("/health", method="OPTIONS", token=None, origin=EXTENSION_ORIGIN),
    ]

    assert [r.status for r in replies] == [200, 401, 404, 204]
    for reply in replies:
        assert reply.header("Connection").lower() == "close"


def test_the_socket_is_finished_when_the_answer_is(live: Live) -> None:
    """Close semantics, not just the header: the server hangs up after one answer."""
    connection = socket.create_connection((live.host, live.port), timeout=FAST_S)
    try:
        connection.sendall(
            b"GET /health HTTP/1.1\r\nHost: localhost\r\nX-Athena-Token: "
            + TOKEN.encode()
            + b"\r\n\r\n"
        )
        seen = b""
        while True:
            chunk = connection.recv(4096)
            if not chunk:
                break  # EOF: the server closed it, which is what "one request per connection" is
            seen += chunk

        assert b"HTTP/1.1 200" in seen
        assert b'"ok": true' in seen
    finally:
        connection.close()


# -- CORS ----------------------------------------------------------------------------------------


def test_a_preflight_from_an_allowed_origin_gets_the_headers(live: Live) -> None:
    for origin in (EXTENSION_ORIGIN, SHELL_ORIGIN):
        reply = live.request("/health", method="OPTIONS", token=None, origin=origin)

        assert reply.status == 204
        assert reply.header("Access-Control-Allow-Origin") == origin
        assert "X-Athena-Token" in reply.header("Access-Control-Allow-Headers")
        assert "OPTIONS" in reply.header("Access-Control-Allow-Methods")
        assert reply.header("Vary") == "Origin"


def test_a_preflight_from_a_disallowed_origin_gets_no_cors_headers(live: Live) -> None:
    """It is answered — a 204 with nothing on it — and the browser refuses the real request."""
    reply = live.request(
        "/health", method="OPTIONS", token=None, origin="https://not-invited.example"
    )

    assert reply.status == 204
    assert not reply.has_header("Access-Control-Allow-Origin")
    assert not reply.has_header("Access-Control-Allow-Methods")


def test_a_preflight_needs_no_token_and_an_answer_still_does(live: Live) -> None:
    """A browser cannot put a custom header on a preflight, so requiring one forbids CORS."""
    assert live.request("/health", method="OPTIONS", token=None, origin=EXTENSION_ORIGIN).status
    assert live.request("/health", token=None, origin=EXTENSION_ORIGIN).status == 401


def test_an_allowed_origin_is_echoed_on_a_real_answer(live: Live) -> None:
    reply = live.request("/health", origin=SHELL_ORIGIN)

    assert reply.status == 200
    assert reply.header("Access-Control-Allow-Origin") == SHELL_ORIGIN


def test_a_disallowed_origin_still_gets_its_answer_but_no_cors(live: Live) -> None:
    """CORS is the browser's fence, the token is ours: a valid token is served regardless."""
    reply = live.request("/health", origin="https://not-invited.example")

    assert reply.status == 200
    assert not reply.has_header("Access-Control-Allow-Origin")


# -- bodies and errors ---------------------------------------------------------------------------


def test_a_body_that_is_not_json_is_a_parse_error(live: Live) -> None:
    live.daemon.routes.add(Route("POST", "/echo", lambda request: (200, dict(request.body))))

    reply = live.request("/echo", method="POST", body="{not json")

    assert reply.status == 400
    assert reply.body["reason"] == "parse_error"


def test_a_route_that_raises_is_a_500_that_quotes_nothing(live: Live) -> None:
    """A body may hold anything the caller put in it, so the detail is the exception type."""

    def boom(request: Request) -> Reply:
        raise RuntimeError(json.dumps(dict(request.body)))

    live.daemon.routes.add(Route("POST", "/boom", boom))

    reply = live.request("/boom", method="POST", body='{"secret": "swordfish"}')

    assert reply.status == 500
    assert reply.body == {"ok": False, "reason": "unknown", "detail": "RuntimeError"}
    assert "swordfish" not in reply.raw.decode()


def test_an_unknown_path_is_404_and_a_known_path_with_the_wrong_verb_is_405(live: Live) -> None:
    assert live.request("/nope").status == 404
    assert live.request("/health", method="POST", body="{}").status == 405

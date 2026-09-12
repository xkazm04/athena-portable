"""Spawning ``athena serve`` and getting in: the ready line and the token (README §3.5; ADR 0011).

These are the two claims a shell makes before it makes any other: the console script starts and
says where it is, and nothing can be read out of it without the token — including ``/health``,
which the daemon deliberately does *not* leave open (``server.py``'s module docstring: "There is
no unauthenticated route at all", and `docs/daemon.md` says the same). The exception is the CORS
preflight, which carries no body and reads nothing.

Exit hygiene is here too, because it is the same claim seen from the other end: the process that
started is the process that is gone, and the port it held is free for the next one.
"""

from __future__ import annotations

import json
from pathlib import Path

from athena.daemon.server import ALLOWED_METHODS, MAX_BODY_BYTES, TOKEN_HEADER

from .conftest import APP_ID, ENGINE, MODEL, PAGE_ORIGIN, Spawn, child_pids, port_answers


def _probe(label: str) -> tuple[str, str]:
    """One route label from ``GET /health`` as a request to make of it.

    The prefix route is labelled ``POST /decisions/<id>``; an id that is not a card still reaches
    the route, which is all a token claim needs.
    """
    method, _, path = label.partition(" ")
    if path.endswith("<id>"):
        path = path[: -len("<id>")] + "apr_000000000000"
    return method, path


def test_the_real_daemon_prints_one_parseable_ready_line_and_mints_the_token_file_it_names(
    spawn: Spawn,
) -> None:
    daemon = spawn.real(token=None)

    assert daemon.ready["ok"] is True
    assert daemon.ready["engine"] == ENGINE
    assert daemon.ready["voice"] == "none"
    assert daemon.ready["brain"] == str(daemon.home / "brain")
    assert daemon.ready["token_file"] == str(daemon.home / "daemon.json")
    assert daemon.host == "127.0.0.1"
    assert 0 < daemon.port < 65536
    # The line names the file; the token itself is never on stdout, which is inherited and logged.
    assert "token" not in daemon.ready
    minted = json.loads(Path(daemon.ready["token_file"]).read_text(encoding="utf-8"))["token"]
    assert minted == daemon.token

    # The line was printed after the socket was bound: no retry loop, and the token in the file
    # is the token the daemon requires.
    health = daemon.request("/health")
    assert health.status == 200
    assert health.body["engine"] == ENGINE
    assert health.body["model"] == MODEL
    assert health.body["brain"] == str(daemon.home / "brain")
    assert daemon.alive


def test_every_route_including_health_is_refused_without_the_token_and_answers_with_it(
    spawn: Spawn,
) -> None:
    """The daemon's own route listing is the list, so a route added later is covered here too."""
    daemon = spawn.real()
    labels = daemon.request("/health").body["routes"]
    assert "GET /health" in labels

    for label in labels:
        method, path = _probe(label)
        anonymous = daemon.request(path, method=method, authenticated=False)
        assert anonymous.status == 401, f"{label} answered {anonymous.status} with no token"
        assert anonymous.body == {
            "ok": False,
            "reason": "foreign_token",
            "detail": f"{TOKEN_HEADER} missing or wrong",
        }

        wrong = daemon.request(path, method=method, token=daemon.token + "-not")
        assert wrong.status == 401, f"{label} accepted a wrong token"
        assert wrong.body["reason"] == "foreign_token"

        right = daemon.request(path, method=method)
        assert right.status != 401, f"{label} refused the daemon's own token"
        assert right.header("Connection") == "close"

    # A route that does not exist is a 404 *behind* the token, so an anonymous caller cannot map
    # the daemon by comparing a 404 against a 401.
    assert daemon.request("/nope", authenticated=False).status == 401
    assert daemon.request("/nope").status == 404
    assert daemon.request("/health", method="POST").status == 405


def test_the_cors_preflight_is_the_one_request_that_carries_no_token(spawn: Spawn) -> None:
    """A browser sends ``OPTIONS`` with no custom headers by definition, so requiring the token
    there would make every cross-origin request impossible rather than make anything safer."""
    origin = "chrome-extension://abcdefghijklmnopabcdefghijklmnop"
    daemon = spawn.real()

    reply = daemon.request("/manifest", method="OPTIONS", authenticated=False, origin=origin)

    assert reply.status == 204
    assert reply.header("Access-Control-Allow-Origin") == origin
    assert reply.header("Access-Control-Allow-Methods") == ALLOWED_METHODS
    assert reply.raw == b""


def test_stopping_the_daemon_leaves_no_port_bound_no_child_and_a_home_the_next_one_can_open(
    spawn: Spawn,
) -> None:
    """Exit hygiene (README §3.5; ADR 0015): no orphan holding the port, no state in the way.

    The port is checked with a ``connect`` rather than a ``bind``: ``HTTPServer`` sets
    ``SO_REUSEADDR``, so a bind would succeed even against a socket an orphan still held. The
    child check is the other half — on Windows ``athena`` is a launcher that runs the interpreter
    as a child, so a stop that reached only the top of the chain would leave the daemon itself
    listening, which is why both the shell and this suite kill the tree.
    """
    first = spawn.real()
    home, port, pid = first.home, first.port, first.process.pid
    assert port_answers(first.host, port)

    first.stop()

    assert first.process.returncode is not None, "the daemon did not exit"
    assert not first.alive
    assert not port_answers("127.0.0.1", port), "something is still listening on the port"
    assert child_pids(pid) == [], "the daemon left a child behind"

    second = spawn.real(home=home)
    health = second.request("/health")
    assert health.status == 200
    assert health.body["brain"] == str(home / "brain")
    assert second.request("/ledger").status == 200


def test_cors_names_only_the_origins_the_daemon_was_started_with(spawn: Spawn) -> None:
    """CORS is the browser's fence and the token is ours: an origin that is not allowed gets no
    CORS headers at all, and the token check is unaffected either way."""
    shell = "http://tauri.localhost"
    extension = "chrome-extension://abcdefghijklmnopabcdefghijklmnop"
    daemon = spawn.real(extra=["--allow-origin", shell])

    allowed = daemon.request("/health", origin=shell)
    assert allowed.status == 200
    assert allowed.header("Access-Control-Allow-Origin") == shell
    assert allowed.header("Access-Control-Allow-Headers") == f"Content-Type, {TOKEN_HEADER}"
    assert allowed.header("Vary") == "Origin"

    # An extension origin is always allowed; it is the one scheme that needs no flag.
    assert (
        daemon.request("/health", origin=extension).header("Access-Control-Allow-Origin")
        == extension
    )

    foreign = daemon.request("/health", origin="https://evil.example")
    assert foreign.status == 200, "CORS fences what a browser may read, never the request"
    assert not foreign.has_header("Access-Control-Allow-Origin")
    assert foreign.body["engine"] == ENGINE


def test_a_body_over_the_cap_is_refused_in_the_one_shape_rather_than_by_dropping_the_socket(
    spawn: Spawn,
) -> None:
    """``MAX_BODY_BYTES`` is a cap on nonsense, and a cap that answers is worth having.

    The refusal has to *reach the caller*: a handler that answers and closes without draining the
    request leaves the client's own ``send`` failing — ``ConnectionAbortedError`` on Windows —
    which a surface cannot tell apart from a daemon that died. One shape, always
    (``routes.error``), is the claim the route table makes.
    """
    daemon = spawn.real()
    oversized = {
        "app_id": APP_ID,
        "page_origin": PAGE_ORIGIN,
        "pad": "y" * (MAX_BODY_BYTES + 1024),
    }

    reply = daemon.request("/manifest", method="POST", json_body=oversized)

    assert reply.status == 400
    assert reply.body == {
        "ok": False,
        "reason": "parse_error",
        "detail": "body must be a JSON object",
    }
    assert daemon.request("/health").status == 200, "the daemon is still serving"

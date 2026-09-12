"""The daemon's edge: what gets in, what is refused, and how a stream is framed (README §3.5)."""

from __future__ import annotations

import json
import urllib.error
import urllib.request
from collections.abc import Iterator

import pytest

from athena.contracts.channel import ChannelEvent, TextDelta, TurnFinished
from athena.daemon.server import (
    ALLOWED_ORIGINS,
    Daemon,
    EventStream,
    Request,
    Response,
    Router,
    mint_token,
)


def call(
    url: str,
    *,
    token: str | None = None,
    method: str = "GET",
    body: bytes | None = None,
    origin: str | None = None,
) -> tuple[int, dict[str, str], str]:
    headers: dict[str, str] = {}
    if token is not None:
        headers["Authorization"] = f"Bearer {token}"
    if origin is not None:
        headers["Origin"] = origin
    request = urllib.request.Request(url, data=body, method=method, headers=headers)
    try:
        with urllib.request.urlopen(request, timeout=5) as answer:
            return answer.status, dict(answer.headers), answer.read().decode("utf-8")
    except urllib.error.HTTPError as exc:
        return exc.code, dict(exc.headers), exc.read().decode("utf-8")


@pytest.fixture
def daemon() -> Iterator[Daemon]:
    router = Router()
    router.get("/health", lambda r: Response.json({"ok": True}), public=True)
    router.get("/echo/<name>", lambda r: Response.json({"name": r.params["name"]}))
    router.post("/parse", lambda r: Response.json({"got": r.json()}))
    router.get("/boom", _boom)
    router.get("/stream", _stream)
    made = Daemon(router, token="t0ken")
    made.start()
    try:
        yield made
    finally:
        made.stop()


def _boom(request: Request) -> Response:
    raise RuntimeError("the handler fell over")


def _stream(request: Request) -> EventStream:
    def events() -> Iterator[ChannelEvent]:
        yield TextDelta(text="two invoices")
        yield TurnFinished(text="done")

    return EventStream(events())


# --- the token ---------------------------------------------------------------------------------


def test_a_request_without_a_token_is_refused_with_foreign_token(daemon: Daemon) -> None:
    status, _, body = call(f"{daemon.url}/echo/abc")
    assert status == 401
    assert json.loads(body)["error"] == "foreign_token"


def test_the_wrong_token_is_refused(daemon: Daemon) -> None:
    status, _, _ = call(f"{daemon.url}/echo/abc", token="not-the-token")
    assert status == 401


def test_health_is_the_one_public_route(daemon: Daemon) -> None:
    """So a shell can tell "not listening yet" from "listening and refusing me"."""
    status, _, body = call(f"{daemon.url}/health")
    assert status == 200 and json.loads(body) == {"ok": True}


def test_a_token_may_ride_the_query_string_for_event_source(daemon: Daemon) -> None:
    status, _, _ = call(f"{daemon.url}/echo/abc?token={daemon.token}")
    assert status == 200


def test_a_minted_token_is_not_guessable_in_length_or_shape() -> None:
    first, second = mint_token(), mint_token()
    assert first != second
    assert len(first) >= 40


# --- routing -----------------------------------------------------------------------------------


def test_a_path_capture_reaches_the_handler(daemon: Daemon) -> None:
    _, _, body = call(f"{daemon.url}/echo/apr_00", token=daemon.token)
    assert json.loads(body) == {"name": "apr_00"}


def test_an_unknown_path_is_404_and_a_wrong_method_is_405(daemon: Daemon) -> None:
    missing, _, _ = call(f"{daemon.url}/nowhere", token=daemon.token)
    wrong, headers, _ = call(f"{daemon.url}/health", token=daemon.token, method="POST", body=b"")
    assert missing == 404
    assert wrong == 405
    assert headers.get("Allow") == "GET"


def test_a_malformed_body_is_a_400_and_not_a_traceback(daemon: Daemon) -> None:
    status, _, body = call(f"{daemon.url}/parse", token=daemon.token, method="POST", body=b"{oops")
    assert status == 400
    assert json.loads(body)["error"] == "parse_error"


def test_a_handler_that_raises_does_not_kill_the_daemon(daemon: Daemon) -> None:
    status, _, _ = call(f"{daemon.url}/boom", token=daemon.token)
    assert status == 500

    after, _, _ = call(f"{daemon.url}/health")
    assert after == 200, "the daemon stopped serving after one handler raised"


# --- CORS --------------------------------------------------------------------------------------


def test_the_panels_origin_is_allowed(daemon: Daemon) -> None:
    _, headers, _ = call(f"{daemon.url}/health", origin="tauri://localhost")
    assert headers.get("Access-Control-Allow-Origin") == "tauri://localhost"


def test_a_visited_site_gets_no_cors_headers(daemon: Daemon) -> None:
    """A page the user is browsing must never be able to drive the daemon from its own script."""
    _, headers, _ = call(f"{daemon.url}/health", origin="https://invoices.example")
    assert "Access-Control-Allow-Origin" not in headers


def test_preflight_needs_no_token(daemon: Daemon) -> None:
    status, headers, _ = call(
        f"{daemon.url}/parse", method="OPTIONS", origin="http://localhost:1420"
    )
    assert status == 204
    assert headers.get("Access-Control-Allow-Origin") == "http://localhost:1420"
    assert "authorization" in headers.get("Access-Control-Allow-Headers", "")


def test_the_allowed_origins_do_not_include_a_bare_wildcard() -> None:
    assert "*" not in ALLOWED_ORIGINS


# --- streaming ---------------------------------------------------------------------------------


def test_a_stream_is_one_sse_frame_per_channel_event(daemon: Daemon) -> None:
    request = urllib.request.Request(
        f"{daemon.url}/stream", headers={"Authorization": f"Bearer {daemon.token}"}
    )
    with urllib.request.urlopen(request, timeout=5) as answer:
        assert answer.headers.get("Content-Type") == "text/event-stream"
        raw = answer.read().decode("utf-8")

    frames = [block for block in raw.split("\n\n") if block.strip()]
    assert frames[0].startswith("retry:")
    assert "event: text.delta" in frames[1]
    assert "event: turn.finished" in frames[2]

    payload = json.loads(frames[1].split("data: ", 1)[1])
    assert payload == {"kind": "text.delta", "text": "two invoices"}


def test_a_stream_event_round_trips_through_the_contracts_own_decoder(daemon: Daemon) -> None:
    """One encoder. A surface rebuilds the event with ``event_from_json`` and nothing else."""
    request = urllib.request.Request(
        f"{daemon.url}/stream?token={daemon.token}",
    )
    with urllib.request.urlopen(request, timeout=5) as answer:
        raw = answer.read().decode("utf-8")

    line = next(ln for ln in raw.splitlines() if ln.startswith("data: "))
    assert ChannelEvent.from_json(line[6:]) == TextDelta(text="two invoices")

"""A long turn must never stall a read (README §3.5, the first build's worst finding).

The first build's daemon was single-threaded behind one SQLite connection. A ``/run`` that took
ninety seconds made every other request wait ninety seconds, so the panel froze for the length of a
turn and looked like a hung application rather than a busy one.

The fix is structural — ``ThreadingHTTPServer``, ``Connection: close``, one writer behind a lock
and a read-only connection per read — and this file is the test that was written before the server
and is the reason the server has that shape. It is on the never-cut list in README §5.
"""

from __future__ import annotations

import json
import threading
import time
import urllib.error
import urllib.request
from collections.abc import Iterator
from contextlib import closing
from pathlib import Path

import pytest

from athena.core.brain.store import Brain
from athena.daemon.server import Daemon, Request, Response, Router

#: How long the slow handler holds the writer. Long enough that a serialised server could not hide
#: it, short enough that the suite stays fast.
HELD_S = 1.0

#: A read that takes longer than this while a write is in flight is a starved read.
READ_BUDGET_S = 0.5


def _get(url: str, token: str, timeout: float = 5.0) -> tuple[int, str]:
    request = urllib.request.Request(url, headers={"Authorization": f"Bearer {token}"})
    try:
        with urllib.request.urlopen(request, timeout=timeout) as answer:
            return answer.status, answer.read().decode("utf-8")
    except urllib.error.HTTPError as exc:
        return exc.code, exc.read().decode("utf-8")


@pytest.fixture
def brain(tmp_path: Path) -> Iterator[Brain]:
    made = Brain(tmp_path / "brain", session_id="sess_starve")
    try:
        yield made
    finally:
        made.close()


def test_a_read_answers_while_a_write_holds_the_writer(brain: Brain) -> None:
    """The claim, with a real SQLite writer held open for the duration of a fake turn."""
    entered = threading.Event()

    def slow_write(request: Request) -> Response:
        with brain.write_txn() as con:
            con.execute("SELECT 1")
            entered.set()
            time.sleep(HELD_S)
        return Response.json({"ok": True})

    def quick_read(request: Request) -> Response:
        with closing(brain.read_connection()) as con:
            count = con.execute("SELECT COUNT(*) FROM companion_node").fetchone()[0]
        return Response.json({"nodes": int(count)})

    router = Router()
    router.post("/run", slow_write)
    router.get("/memory", quick_read)

    with Daemon(router) as daemon:
        writer = threading.Thread(target=lambda: _post(daemon, "/run"))
        writer.start()
        assert entered.wait(timeout=5), "the slow handler never reached the writer"

        started = time.monotonic()
        status, body = _get(f"{daemon.url}/memory", daemon.token)
        elapsed = time.monotonic() - started
        writer.join(timeout=10)

    assert status == 200
    assert json.loads(body)["nodes"] == 0
    assert elapsed < READ_BUDGET_S, f"the read waited {elapsed:.2f}s behind the write"


def test_eight_reads_cost_the_same_whether_or_not_a_write_is_in_flight(brain: Brain) -> None:
    """The claim without a stopwatch constant: a held writer does not change what a read costs.

    Measuring against a baseline rather than a fixed budget is deliberate. What "fast" means on
    loopback varies by machine, and a threshold tuned on one is a flaky test on another; what does
    not vary is that a serialised server would add the *whole* hold to every read behind it.
    """
    entered = threading.Event()

    def slow(request: Request) -> Response:
        entered.set()
        time.sleep(HELD_S)
        return Response.json({"ok": True})

    router = Router()
    router.post("/run", slow)
    router.get("/health", lambda request: Response.json({"ok": True}), public=True)

    with Daemon(router) as daemon:
        baseline, quiet = _read_eight(daemon)
        assert quiet == [200] * 8

        writer = threading.Thread(target=lambda: _post(daemon, "/run"))
        writer.start()
        assert entered.wait(timeout=5), "the slow handler never started"
        concurrent, busy = _read_eight(daemon)
        writer.join(timeout=10)

    assert busy == [200] * 8
    assert concurrent < HELD_S, f"eight reads took {concurrent:.2f}s behind a {HELD_S}s write"
    assert concurrent < baseline + HELD_S / 2, (
        f"a held writer cost the reads {concurrent - baseline:.2f}s "
        f"({baseline:.2f}s quiet, {concurrent:.2f}s busy)"
    )


def _read_eight(daemon: Daemon) -> tuple[float, list[int]]:
    """Eight concurrent reads. Returns how long they all took and what they answered."""
    statuses: list[int] = []
    lock = threading.Lock()

    def read() -> None:
        status, _ = _get(f"{daemon.url}/health", daemon.token)
        with lock:
            statuses.append(status)

    threads = [threading.Thread(target=read) for _ in range(8)]
    started = time.monotonic()
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join(timeout=10)
    return time.monotonic() - started, statuses


def test_no_response_asks_the_client_to_keep_the_connection(brain: Brain) -> None:
    """``Connection: close``, on every answer.

    A keep-alive connection that an SSE stream is already holding is a worker thread the next
    request cannot have — which is the same starvation, arriving through the socket instead of
    through the lock.
    """
    router = Router()
    router.get("/health", lambda request: Response.json({"ok": True}), public=True)

    with Daemon(router) as daemon:
        req = urllib.request.Request(f"{daemon.url}/health")
        with urllib.request.urlopen(req, timeout=5) as answer:
            assert answer.headers.get("Connection", "").lower() == "close"


def _post(daemon: Daemon, path: str) -> None:
    request = urllib.request.Request(
        f"{daemon.url}{path}",
        data=b"{}",
        method="POST",
        headers={"Authorization": f"Bearer {daemon.token}", "Content-Type": "application/json"},
    )
    with urllib.request.urlopen(request, timeout=30) as answer:
        answer.read()

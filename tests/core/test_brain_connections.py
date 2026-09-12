"""One writer, a read-only handle per read, and neither waits for the other (README §3.5).

The first build ran the daemon single-threaded because one SQLite connection had thread affinity,
so a long ``/run`` stalled every read route behind it. These tests are the day-zero decision that
replaced it, written against the brain rather than the server so they hold before the server
exists.
"""

from __future__ import annotations

import sqlite3
import threading
import time
from contextlib import closing
from pathlib import Path

import pytest

from athena.core.brain import Brain


def _node_count(con: sqlite3.Connection) -> int:
    row = con.execute("SELECT COUNT(*) FROM companion_node").fetchone()
    return int(row[0])


def test_a_read_handle_opened_after_a_write_sees_that_write(tmp_path: Path) -> None:
    with Brain(tmp_path / "brain") as brain:
        brain.append_episode("the first thing said", role="user")

        with closing(brain.read_connection()) as con:
            assert _node_count(con) == 1


def test_a_read_handle_opened_before_a_write_still_works_and_then_sees_it(tmp_path: Path) -> None:
    """No lock error, no stale handle: the contract is "as of the last completed write"."""
    with Brain(tmp_path / "brain") as brain, closing(brain.read_connection()) as con:
        assert _node_count(con) == 0

        brain.append_episode("said after the handle was opened", role="user")

        assert _node_count(con) == 1


def test_a_read_handle_may_not_write(tmp_path: Path) -> None:
    with (
        Brain(tmp_path / "brain") as brain,
        closing(brain.read_connection()) as con,
        pytest.raises(sqlite3.OperationalError, match="readonly"),
    ):
        con.execute("DELETE FROM companion_node")


def test_each_read_handle_is_its_own(tmp_path: Path) -> None:
    with Brain(tmp_path / "brain") as brain:
        first = brain.read_connection()
        second = brain.read_connection()
        try:
            assert first is not second
        finally:
            first.close()
            second.close()


def test_a_write_does_not_block_a_concurrent_read(tmp_path: Path) -> None:
    """A reader holds an open snapshot in another thread while the writer commits twice.

    The write must not wait on the reader (that is the starvation the first build shipped), and
    the reader's snapshot must not change underneath it (that is the consistency the read routes
    are documented to have).
    """
    with Brain(tmp_path / "brain") as brain:
        brain.append_episode("already there", role="user")

        reading = threading.Event()
        release = threading.Event()
        seen: dict[str, int] = {}
        failure: list[BaseException] = []

        def reader() -> None:
            try:
                with closing(brain.read_connection()) as con:
                    con.execute("BEGIN")
                    seen["before"] = _node_count(con)
                    reading.set()
                    assert release.wait(10)
                    seen["during"] = _node_count(con)
                    con.execute("END")
                    seen["after"] = _node_count(con)
            except BaseException as exc:  # re-raised on the main thread below
                failure.append(exc)
                reading.set()

        thread = threading.Thread(target=reader, name="brain-reader")
        thread.start()
        assert reading.wait(10)

        started = time.monotonic()
        brain.append_episode("written while a read is open", role="assistant")
        brain.append_episode("and a second one", role="assistant")
        elapsed = time.monotonic() - started

        release.set()
        thread.join(10)
        assert not thread.is_alive()
        if failure:
            raise failure[0]

        # The busy timeout is five seconds, so a blocked write would show up as one.
        assert elapsed < 2.0, f"the writer waited {elapsed:.2f}s for an open read"
        assert seen["before"] == 1
        assert seen["during"] == 1, "an open read snapshot changed underneath the reader"
        assert seen["after"] == 3


def test_the_brains_own_reads_run_on_a_read_handle_from_another_thread(tmp_path: Path) -> None:
    """``node``, ``read_body``, ``counts``, ``sources_of`` and ``live_episode_ids`` are reads.

    The daemon is threaded, so one of these can be called from a worker thread while a turn on
    another thread is inside an open write transaction. Two things have to hold and neither did
    when they read through the writer connection: the call must not raise (a connection used by
    two threads at once), and it must see only what has been *committed* — an index row written
    inside a transaction that has not ended yet is not a memory anything may cite or count.
    """
    with Brain(tmp_path / "brain") as brain:
        committed = brain.append_episode("said before the transaction", role="user")

        answers: dict[str, object] = {}
        failure: list[BaseException] = []
        done = threading.Event()

        def worker(uncommitted_id: str) -> None:
            try:
                answers["counts"] = brain.counts()
                answers["node"] = brain.node(uncommitted_id)
                answers["committed"] = brain.node(committed.id)
                answers["body"] = brain.read_body(committed.id)
                answers["live"] = brain.live_episode_ids([committed.id, uncommitted_id])
                answers["sources"] = brain.sources_of(committed.id)
            except BaseException as exc:  # re-raised on the main thread below
                failure.append(exc)
            finally:
                done.set()

        with brain.write_txn():
            mid = brain.append_episode("said inside the transaction", role="user")
            thread = threading.Thread(target=worker, args=(mid.id,), name="brain-worker")
            thread.start()
            assert done.wait(10), "a read from a worker thread never returned"

        thread.join(10)
        if failure:
            raise failure[0]

        assert answers["counts"] == {"episode": 1}, "an uncommitted row was counted"
        assert answers["node"] is None, "an uncommitted row was visible to a reader"
        assert answers["committed"] is not None
        assert answers["body"] == "said before the transaction"
        assert answers["live"] == {committed.id}
        assert answers["sources"] == []

        # And once the transaction ended, the same calls see both.
        assert brain.counts() == {"episode": 2}
        assert brain.node(mid.id) is not None

"""A recorded transcript is a contract the harness audits, not a hope (ADR 0007, ADR 0041).

A scripted daemon replays its transcript in a child process. A round the script does not have
raises inside that child, the CLI harness turns the raise into an ``engine_error`` turn, and the
HTTP reply is still a 200 stream that ends with ``turn.finished``. So a test that asserts only
on a ``tool.result`` frame passes on a turn whose premise moved; and a test that scripted a round
nobody asked for is never told either.

``serve_scripted.py`` therefore records every provider invocation to
``ATHENA_HOME/scripted/asked.ndjson``, and the spawner reads it back: ``Daemon.run(rounds=n)``
checks one turn's spend, and the fixture's teardown fails a test whose transcript was overdrawn or
left unconsumed, unless that test opted out with ``exact=False``.

These are the negative controls: each one builds the wrong transcript on purpose and proves the
check fires, so a check that silently stopped firing would turn this file red.
"""

from __future__ import annotations

import json
from collections.abc import Iterator
from pathlib import Path

import pytest

from .conftest import Daemon, Spawn, claude_round, op

#: A connector name no daemon here can address: the op is refused before the gate and the
#: refusal is fed back to the model for one more round (ADR 0041).
UNKNOWN = "connector.gmail.search_mail"
REFUSED_ROUND = claude_round("Searching your mail.\n" + op(UNKNOWN, query="invoice"))
TOLD_ROUND = claude_round("No mail connector is set up, so I can't search your mail.")


@pytest.fixture
def own(tmp_path: Path) -> Iterator[Spawn]:
    """A spawner whose teardown check the test calls itself, so the check's failure is the claim.

    Every daemon it started is stopped at the end whatever the test did, without the check.
    """
    spawner = Spawn(tmp_path)
    try:
        yield spawner
    finally:
        for daemon in spawner.started:
            daemon.stop()


def asked(daemon: Daemon) -> list[dict[str, object]]:
    path = daemon.home / "scripted" / "asked.ndjson"
    return [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines() if line]


def test_a_round_the_turn_never_asked_for_fails_teardown_by_name(own: Spawn) -> None:
    daemon = own.scripted([claude_round("Hello."), claude_round("A spare nobody asks for.")])
    daemon.register()

    reply = daemon.run("say hello")
    assert reply.status == 200

    with pytest.raises(AssertionError, match="round 2 of 2 was never asked for"):
        own.stop_all()
    assert not daemon.alive, "the check never keeps a daemon alive"


def test_a_refused_op_overdraws_a_one_round_script_even_when_its_frame_looks_right(
    own: Spawn,
) -> None:
    daemon = own.scripted([REFUSED_ROUND])
    daemon.register()

    reply = daemon.run("search my mail for invoices")

    results = [payload for kind, payload in reply.frames() if kind == "tool.result"]
    assert len(results) == 1 and results[0]["error"] == "unknown_ref", "the frame looks right"
    with pytest.raises(AssertionError, match="round 2 was asked for; the script has 1"):
        own.stop_all()


def test_run_with_rounds_checks_what_that_one_turn_spent(own: Spawn) -> None:
    exact = own.scripted([REFUSED_ROUND, TOLD_ROUND])
    exact.register()
    reply = exact.run("search my mail for invoices", rounds=2)
    assert reply.status == 200

    short = own.scripted([REFUSED_ROUND, TOLD_ROUND])
    short.register()
    with pytest.raises(AssertionError) as raised:
        short.run("search my mail for invoices", rounds=1)
    said = str(raised.value)
    assert "asked 2" in said
    assert "expected 1" in said
    assert "search my mail for invoices" in said


def test_every_invocation_is_recorded_and_an_overdraft_agrees_with_the_ledger(
    own: Spawn,
) -> None:
    daemon = own.scripted([REFUSED_ROUND])
    daemon.register()

    daemon.run("search my mail for invoices")

    assert asked(daemon) == [
        {"index": 0, "available": 1, "served": True},
        {"index": 1, "available": 1, "served": False},
    ]
    row = daemon.request("/ledger").body["rows"][0]
    assert row["is_error"] is True
    assert row["error_reason"] == "engine_error"
    assert daemon.rounds_asked() == 2


def test_exact_false_is_the_explicit_opt_out_for_a_deliberate_over_supply(own: Spawn) -> None:
    daemon = own.scripted(
        [claude_round("Hello."), claude_round("A spare nobody asks for.")], exact=False
    )
    daemon.register()
    daemon.run("say hello")

    own.stop_all()

    assert asked(daemon) == [{"index": 0, "available": 2, "served": True}]

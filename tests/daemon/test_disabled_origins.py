"""The per-app switch, enforced where it is decided: the gate
(README §3.3 rule 2; ADR 0011). The gate-level unit tests are in ``tests/harness/test_policy.py``.

The origins table lives in the shell, so ``POST /run`` carries ``disabled_origins`` and the daemon
keeps none of it. These tests prove the three promises the switch makes: a listed app's tools are
refused before any executor for every class, they are not offered to the model that turn, and one
run's list never reaches another's.
"""

from __future__ import annotations

from .conftest import APP_ID, Live, claude_round, op

# -- over HTTP -----------------------------------------------------------------------------------


def _static_of(live: Live) -> str:
    """The static half the newest engine invocation was opened with (its prompt file)."""
    path = live.transport.requests[-1].system_prompt_file
    assert path, "the invocation resumed a session and carried no static half"
    with open(path, encoding="utf-8") as handle:
        return handle.read()


def test_a_run_with_the_app_switched_off_refuses_gated_and_auto_and_ledgers_the_turn(
    live: Live,
) -> None:
    live.register()
    live.script(
        claude_round(op("host.invoices.pay", "why", invoice="7")),
        claude_round(op("host.invoices.chase", invoice="7")),
    )

    for _ in range(2):
        reply = live.run("do it", disabled_origins=[f"host:{APP_ID}"])
        frames = reply.frames()
        results = [payload for kind, payload in frames if kind == "tool.result"]
        assert results and results[0]["error"] == "foreign_origin"
        assert "decision.requested" not in [kind for kind, _ in frames]

    assert live.daemon.approvals.pending(10).total == 0
    assert len(live.daemon.ledger.recent(10).rows) == 2, "a refused turn is still ledgered"


def test_the_switched_off_apps_tools_are_not_offered_that_turn_and_return_next_turn(
    live: Live,
) -> None:
    live.register()
    live.script(claude_round("one"), claude_round("two"), claude_round("three"))

    live.run("hi", disabled_origins=[f"host:{APP_ID}"])
    off = _static_of(live)
    live.run("hi")
    on = _static_of(live)  # a changed switch opens a new session, so the law is sent again
    live.run("hi")

    assert "host.invoices.pay" not in off
    assert "host.invoices.pay" in on
    assert live.transport.requests[2].system_prompt_file is None, "an unchanged switch resumes"


def test_runs_with_different_lists_back_to_back_do_not_leak(live: Live) -> None:
    live.register()
    live.script(
        claude_round(op("host.invoices.chase", invoice="1")),
        claude_round(op("host.invoices.chase", invoice="2")),
    )

    off = live.run("a", disabled_origins=[f"host:{APP_ID}"])
    on = live.run("b")

    assert [p["error"] for k, p in off.frames() if k == "tool.result"] == ["foreign_origin"]
    assert "tool.call" in [k for k, _ in on.frames()]
    assert live.daemon.gate.policy.disabled_origins == frozenset()


def test_a_malformed_list_is_read_as_empty(live: Live) -> None:
    live.register()
    live.script(claude_round(op("host.invoices.chase", invoice="1")))

    reply = live.run("a", disabled_origins="host:invoices")

    assert "tool.call" in [k for k, _ in reply.frames()]

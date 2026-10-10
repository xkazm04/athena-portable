"""First sight and the user's pins, carried to the gate on every request (README §3.3; ADR 0063).

The origins table lives in the shell, so ``POST /run`` carries ``gated_origins`` (the apps of open
tabs the table has no row for) and ``gated_tools`` (the names the user pinned ``GATED``), and the
daemon keeps neither. ``chase`` is the registered page's reversible, internal tool: its flags say
``AUTO``, and these tests prove the two lists turn it into a card, and that a malformed list is
read the way a malformed ``disabled_origins`` is. The gate-level tests are in
``tests/harness/test_a_page_that_understates_a_write.py``.
"""

from __future__ import annotations

from typing import Any

from athena.daemon.routes import MAX_GATED_NAMES, gated_origins_from, gated_tools_from

from .conftest import APP_ID, Live, claude_round, op

CHASE = f"host.{APP_ID}.chase"


def _kinds(frames: list[tuple[str, dict[str, Any]]]) -> list[str]:
    return [kind for kind, _ in frames]


def _errors(frames: list[tuple[str, dict[str, Any]]]) -> list[Any]:
    return [payload.get("error") for kind, payload in frames if kind == "tool.result"]


# -- over HTTP -----------------------------------------------------------------------------------


def test_an_auto_tool_on_a_first_sight_app_files_a_card(live: Live) -> None:
    live.register()
    live.script(claude_round(op(CHASE, invoice="7")))

    frames = live.run("chase it", gated_origins=[f"host:{APP_ID}"]).frames()

    assert "decision.requested" in _kinds(frames)
    assert _errors(frames) == ["pending_approval"]
    (card,) = live.daemon.approvals.pending(10).rows
    assert (card.action, card.params) == (CHASE, {"invoice": "7"})


def test_an_auto_tool_the_user_pinned_gated_files_a_card(live: Live) -> None:
    live.register()
    live.script(claude_round(op(CHASE, invoice="7")))

    frames = live.run("chase it", gated_tools=[CHASE]).frames()

    assert "decision.requested" in _kinds(frames)
    assert _errors(frames) == ["pending_approval"]


def test_a_trusted_app_with_no_pin_runs_on_its_flags_and_one_runs_list_never_reaches_the_next(
    live: Live,
) -> None:
    live.register()
    live.script(claude_round(op(CHASE, invoice="1")), claude_round(op(CHASE, invoice="2")))

    gated = live.run("a", gated_origins=[f"host:{APP_ID}"]).frames()
    trusted = live.run("b").frames()

    assert "decision.requested" in _kinds(gated)
    assert "decision.requested" not in _kinds(trusted)
    assert "tool.call" in _kinds(trusted) and _errors(trusted) == []


def test_a_malformed_list_tightens_nothing(live: Live) -> None:
    """Read the way ``disabled_origins`` is: not a list is no list (ADR 0063 names what follows)."""
    live.register()
    live.script(claude_round(op(CHASE, invoice="1")))

    frames = live.run("a", gated_origins=f"host:{APP_ID}", gated_tools={"x": CHASE}).frames()

    assert "decision.requested" not in _kinds(frames)
    assert live.daemon.approvals.pending(10).total == 0


# -- the parse -----------------------------------------------------------------------------------


def test_the_parse_keeps_strings_strips_them_and_drops_the_rest() -> None:
    body: dict[str, Any] = {
        "gated_origins": [" host:invoices ", "", 7, None, "host:crm"],
        "gated_tools": ["host.invoices.chase", ["host.invoices.pay"], "  "],
    }

    assert gated_origins_from(body) == frozenset({"host:invoices", "host:crm"})
    assert gated_tools_from(body) == frozenset({"host.invoices.chase"})


def test_the_parse_reads_an_absent_or_malformed_field_as_empty() -> None:
    for body in ({}, {"gated_origins": None, "gated_tools": None}, {"gated_origins": "host:x"}):
        assert gated_origins_from(body) == frozenset()
        assert gated_tools_from(body) == frozenset()


def test_the_parse_is_bounded() -> None:
    names = [f"host.app.t{i}" for i in range(MAX_GATED_NAMES + 10)]

    assert len(gated_tools_from({"gated_tools": names})) == MAX_GATED_NAMES

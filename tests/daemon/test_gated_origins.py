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

import pytest

from athena.daemon.routes import (
    MAX_DISABLED_ORIGINS,
    MAX_GATED_NAMES,
    ListTooLong,
    capture_id_from,
    gated_origins_from,
    gated_tools_from,
)

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


def test_the_parse_refuses_a_list_past_its_cap_and_never_cuts_it() -> None:
    names = [f"host.app.t{i}" for i in range(MAX_GATED_NAMES)] + ["host.app.the_pinned_one"]

    with pytest.raises(ListTooLong):
        gated_tools_from({"gated_tools": names})


# -- the capture ---------------------------------------------------------------------------------

PAY = f"host.{APP_ID}.pay"
CAPTURE = "cap_0123456789ab"


def test_a_gated_host_call_with_a_capture_id_files_a_card_that_carries_it(live: Live) -> None:
    live.register()
    live.script(claude_round(op(PAY, invoice="7")))

    frames = live.run("pay it", capture_id=CAPTURE).frames()

    (card,) = [payload for kind, payload in frames if kind == "decision.requested"]
    assert card["capture_id"] == CAPTURE
    (row,) = live.daemon.approvals.pending(10).rows
    assert row.capture_id == CAPTURE


def test_a_malformed_capture_id_is_read_as_none(live: Live) -> None:
    live.register()
    live.script(claude_round(op(PAY, invoice="7")))

    live.run("pay it", capture_id="cap_not-an-id").frames()

    (row,) = live.daemon.approvals.pending(10).rows
    assert row.capture_id is None


def test_the_capture_parse_takes_a_capture_id_and_nothing_else() -> None:
    assert capture_id_from({"capture_id": f" {CAPTURE} "}) == CAPTURE
    for raw in ("", "ep_01234567", "cap_xyz", 7, None, [CAPTURE]):
        assert capture_id_from({"capture_id": raw}) is None
    assert capture_id_from({}) is None


# -- a list past its cap is refused --------------------------------------------------------------


def test_a_list_past_its_cap_is_refused_whole_and_names_the_field(live: Live) -> None:
    """A cut list would loosen the gate: the one name that mattered could be past the cut."""
    live.register()
    names = [f"host.app.t{i}" for i in range(MAX_GATED_NAMES)] + [PAY]

    for key, value in (
        ("gated_tools", names),
        ("gated_origins", [f"host:a{i}" for i in range(MAX_GATED_NAMES + 1)]),
        ("disabled_origins", [f"host:a{i}" for i in range(MAX_DISABLED_ORIGINS + 1)]),
    ):
        reply = live.run("pay it", **{key: value})
        assert reply.status == 400
        assert reply.body["reason"] == "validator_failed"
        assert key in reply.body["detail"]


def test_a_list_exactly_at_its_cap_is_read_whole() -> None:
    names = [f"host.app.t{i}" for i in range(MAX_GATED_NAMES)]

    assert len(gated_tools_from({"gated_tools": names})) == MAX_GATED_NAMES

"""The registry row, the origin parser, and the one place the truncation footer is written.

contracts/registry.py, README §2 invariant 4 and §3.4.
"""

from __future__ import annotations

from typing import Any

import pytest

from athena.contracts import (
    ExecResult,
    Lane,
    ToolClass,
    ToolEntry,
    TurnContext,
    ValidationResult,
    is_origin,
    parse_origin,
)


def an_executor(params: dict[str, Any], ctx: TurnContext) -> ExecResult:
    return ExecResult(ok=True, output="done")


# --- the bounded helper ---------------------------------------------------------------------


def test_bounded_announces_showing_n_of_m_when_it_truncates() -> None:
    result = ExecResult.bounded([f"row {i}" for i in range(10)], 3)
    assert "(showing 3 of 10)" in result.output
    assert result.truncated
    assert result.footer() == "(showing 3 of 10)"
    assert result.announces_truncation()
    assert result.output.splitlines() == ["row 0", "row 1", "row 2", "(showing 3 of 10)"]


def test_bounded_says_nothing_when_it_truncates_nothing() -> None:
    result = ExecResult.bounded(["row 0", "row 1"], 5)
    assert "showing" not in result.output
    assert not result.truncated
    assert result.footer() == ""
    assert result.announces_truncation()


def test_bounded_at_exactly_the_limit_is_not_truncated() -> None:
    result = ExecResult.bounded(["a", "b", "c"], 3)
    assert not result.truncated
    assert result.output == "a\nb\nc"


def test_bounded_announces_even_when_it_shows_nothing() -> None:
    result = ExecResult.bounded(["a", "b"], 0)
    assert result.output == "(showing 0 of 2)"


def test_bounded_of_nothing_is_not_a_truncation() -> None:
    result = ExecResult.bounded([], 5)
    assert result.output == ""
    assert not result.truncated


def test_a_handwritten_result_that_forgot_the_footer_is_caught() -> None:
    dishonest = ExecResult(ok=True, output="row 0", shown=1, total=9)
    assert dishonest.truncated
    assert not dishonest.announces_truncation()


# --- origins --------------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("origin", "kind", "ident", "tier"),
    [
        ("core", "core", "", 0),
        ("host:invoicing", "host", "invoicing", 1),
        ("connector:gmail", "connector", "gmail", 3),
    ],
)
def test_parse_origin_reads_the_three_kinds(origin: str, kind: str, ident: str, tier: int) -> None:
    parsed = parse_origin(origin)
    assert (parsed.kind, parsed.id, parsed.tier) == (kind, ident, tier)
    assert str(parsed) == origin
    assert is_origin(origin)


@pytest.mark.parametrize(
    "origin", ["", "host", "host:", "connector:", "page:invoicing", "host:in.voicing", "host::a"]
)
def test_parse_origin_refuses_anything_else(origin: str) -> None:
    assert not is_origin(origin)
    with pytest.raises(ValueError):
        parse_origin(origin)


# --- the registry row -----------------------------------------------------------------------


def test_a_core_tool_needs_an_executor_and_a_host_tool_must_not_have_one() -> None:
    core = ToolEntry(
        name="core.recall", origin="core", cls=ToolClass.READ, cap_chars=1600, executor=an_executor
    )
    assert core.tier == 0
    assert core.enabled_in(Lane.BROWSER)

    with pytest.raises(ValueError, match="must have an executor"):
        ToolEntry(name="core.recall", origin="core", cls=ToolClass.AUTO)

    # The lane never holds a host executor: the page executes on approval (README §3.2 step 5).
    with pytest.raises(ValueError, match="the page executes it"):
        ToolEntry(
            name="host.inbox.send",
            origin="host:inbox",
            cls=ToolClass.GATED,
            executor=an_executor,
        )


def test_a_tool_name_must_be_namespaced() -> None:
    with pytest.raises(ValueError, match="namespaced"):
        ToolEntry(name="send", origin="host:inbox", cls=ToolClass.GATED)


def test_a_read_tool_must_declare_its_cap() -> None:
    with pytest.raises(ValueError, match="cap_chars"):
        ToolEntry(name="core.recall", origin="core", cls=ToolClass.READ, executor=an_executor)


def test_a_bad_origin_is_refused_at_construction() -> None:
    with pytest.raises(ValueError, match="origin"):
        ToolEntry(name="host.x.y", origin="page:x", cls=ToolClass.GATED)


def test_validation_result_reads_as_what_it_is() -> None:
    assert ValidationResult.accept().ok
    rejected = ValidationResult.reject("validator_failed", "amount over the cap")
    assert (rejected.ok, rejected.reason) == (False, "validator_failed")

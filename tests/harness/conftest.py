"""In-memory fakes for the three core ports (README §3.1).

The gate is policy over data. Nothing it decides needs SQLite, a subprocess or a provider, and a
gate that could only be tested with all three would be a gate nobody tests. These fakes are the
ports and nothing else; ``tests/harness/test_ports.py`` is where the real ``athena.core`` classes
are driven through the same protocols, so the fakes cannot drift into a shape core does not have.

A test that reaches a live provider is marked ``provider`` (or ``eval``), and
:func:`pytest_runtest_setup` runs it only when the run's ``-m`` names that marker: CI and
``AGENTS.md`` run bare ``uv run pytest``, so a key in the environment must never be what decides
that a test spends money (the same rule as ``tests/proving/conftest.py``).
"""

from __future__ import annotations

import json
import re
from collections.abc import Callable, Mapping
from dataclasses import dataclass, field
from typing import Any

import pytest

from athena.contracts.channel import DecisionOption, DecisionRequested
from athena.contracts.registry import (
    ExecResult,
    ExecutorFn,
    Lane,
    ToolClass,
    ToolEntry,
    TurnContext,
    ValidationResult,
    ValidatorFn,
    always_valid,
)

CONVERSATION = "conv_invoices"

#: Markers whose tests reach a live model or run the opt-in eval suite (``pyproject.toml``).
OPT_IN_MARKERS: tuple[str, ...] = ("provider", "eval")


def pytest_runtest_setup(item: pytest.Item) -> None:
    """Skip a ``provider`` or ``eval`` test unless this run's ``-m`` expression names its marker.

    ``-m "not provider"`` deselects it before this runs; ``-m provider`` names it and lets it run;
    a bare run never names it, whatever keys the environment holds.
    """
    named = set(re.findall(r"[A-Za-z_]\w*", str(item.config.getoption("markexpr", "") or "")))
    for marker in OPT_IN_MARKERS:
        if item.get_closest_marker(marker) is not None and marker not in named:
            pytest.skip(f"a {marker} test runs only when selected with -m {marker}")


def _ran(params: dict[str, Any], ctx: TurnContext) -> ExecResult:
    return ExecResult(ok=True, output="ran")


def make_entry(
    name: str,
    cls: ToolClass = ToolClass.AUTO,
    *,
    origin: str = "core",
    executor: ExecutorFn | None = None,
    validator: ValidatorFn = always_valid,
    cap_chars: int | None = None,
) -> ToolEntry:
    """One registry row, with the defaults a test that is about something else would repeat."""
    if origin == "core" and executor is None:
        executor = _ran
    if cls is ToolClass.READ and cap_chars is None:
        cap_chars = 1600
    return ToolEntry(
        name=name,
        origin=origin,
        cls=cls,
        executor=executor,
        validator=validator,
        cap_chars=cap_chars,
    )


class FakeCatalog:
    """``CatalogPort`` over a dict. The class and the validator are still the catalog's answer."""

    def __init__(self) -> None:
        self.entries: dict[str, ToolEntry] = {}

    def add(self, entry: ToolEntry) -> ToolEntry:
        self.entries[entry.name] = entry
        return entry

    def for_lane(self, lane: Lane) -> list[ToolEntry]:
        return [entry for entry in self.entries.values() if entry.enabled_in(lane)]

    def classify(self, name: str) -> ToolClass:
        return self.entries[name].cls

    def validate(self, name: str, params: dict[str, Any], ctx: TurnContext) -> ValidationResult:
        entry = self.entries.get(name)
        if entry is None:
            return ValidationResult.reject("unknown_ref", f"unknown tool {name!r}")
        return entry.validator(params, ctx)


@dataclass
class FakeCard:
    """What ``create`` hands back: enough to render the card and to find the row again."""

    id: str
    action: str
    params: dict[str, Any]
    origin: str
    conversation: str
    surface: str
    summary: str = ""
    capture_id: str | None = None
    status: str = "pending"
    consumed: bool = False
    tab_id: int | None = None
    tab_nav: int | None = None

    def to_event(self) -> DecisionRequested:
        return DecisionRequested(
            id=self.id,
            action=self.action,
            params=dict(self.params),
            rationale=self.summary,
            options=(DecisionOption("approve"), DecisionOption("decline")),
            origin=self.origin,
            surface=self.surface,
            capture_id=self.capture_id,
            tab_id=self.tab_id,
            tab_nav=self.tab_nav,
        )

    @property
    def approved(self) -> bool:
        return self.status == "approved"

    def matches(self, action: str, params: Mapping[str, Any]) -> bool:
        return action == self.action and _canonical(params) == _canonical(self.params)


def _canonical(params: Mapping[str, Any]) -> str:
    """The real table canonicalises through JSON before comparing; so does this one."""
    return json.dumps(dict(params), sort_keys=True, separators=(",", ":"))


class FakeApprovals:
    """``ApprovalsPort`` over a dict. One row is both the card and the grant, as in core."""

    def __init__(self) -> None:
        self.rows: dict[str, FakeCard] = {}

    def create(
        self,
        action: str,
        params: Mapping[str, Any],
        *,
        origin: str,
        conversation: str,
        surface: str,
        summary: str = "",
        capture_id: str | None = None,
        tab_id: int | None = None,
        tab_nav: int | None = None,
    ) -> FakeCard:
        card = FakeCard(
            id=f"apr_{len(self.rows):012d}",
            action=action,
            params=dict(params),
            origin=origin,
            conversation=conversation,
            surface=surface,
            summary=summary,
            capture_id=capture_id,
            tab_id=tab_id,
            tab_nav=tab_nav,
        )
        self.rows[card.id] = card
        return card

    def describe(self, approval_id: str) -> FakeCard:
        try:
            return self.rows[approval_id]
        except KeyError:
            raise ValueError(f"unknown approval {approval_id}") from None

    def resolve(self, approval_id: str, choice: str) -> FakeCard:
        card = self.describe(approval_id)
        card.status = "approved" if choice == "approve" else "declined"
        return card

    def consume(self, approval_id: str) -> bool:
        """Spend an approved row once, as core's conditional update does (ADR 0038)."""
        card = self.rows.get(approval_id)
        if card is None or card.status != "approved" or card.consumed:
            return False
        card.consumed = True
        return True


@dataclass
class FakeRow:
    row_id: int
    turn_id: str | None
    rounds: int
    is_error: bool
    error_reason: str | None
    fields: dict[str, Any] = field(default_factory=dict)


class FakeLedger:
    """``LedgerPort`` over a list. Keyword-only, exactly as the real one is."""

    def __init__(self) -> None:
        self.rows: list[FakeRow] = []

    def record(
        self,
        *,
        engine: str,
        model: str,
        conversation: str,
        origin: str,
        surface: str,
        trigger: str,
        rounds: int = 1,
        input_tokens: int = 0,
        output_tokens: int = 0,
        cost_usd: float | None = None,
        cost_estimated: bool = False,
        ms: int = 0,
        is_error: bool = False,
        error_reason: str | None = None,
        turn_id: str | None = None,
    ) -> FakeRow:
        row = FakeRow(
            row_id=len(self.rows) + 1,
            turn_id=turn_id,
            rounds=rounds,
            is_error=is_error,
            error_reason=error_reason,
            fields={
                "engine": engine,
                "model": model,
                "conversation": conversation,
                "origin": origin,
                "surface": surface,
                "trigger": trigger,
                "input_tokens": input_tokens,
                "output_tokens": output_tokens,
                "cost_usd": cost_usd,
                "cost_estimated": cost_estimated,
                "ms": ms,
            },
        )
        self.rows.append(row)
        return row

    @property
    def error_rows(self) -> list[FakeRow]:
        return [row for row in self.rows if row.is_error]


def make_ctx(**overrides: Any) -> TurnContext:
    kwargs: dict[str, Any] = {
        "conversation_id": CONVERSATION,
        "turn_id": "turn_000000000001",
        "lane": Lane.BROWSER,
        "surface": "panel",
    }
    kwargs.update(overrides)
    return TurnContext(**kwargs)


@pytest.fixture
def catalog() -> FakeCatalog:
    return FakeCatalog()


@pytest.fixture
def approvals() -> FakeApprovals:
    return FakeApprovals()


@pytest.fixture
def ledger() -> FakeLedger:
    return FakeLedger()


@pytest.fixture
def ctx() -> TurnContext:
    return make_ctx()


@pytest.fixture
def entry() -> Callable[..., ToolEntry]:
    return make_entry


@pytest.fixture
def context() -> Callable[..., TurnContext]:
    return make_ctx

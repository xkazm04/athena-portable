"""The tool registry row and what a validator or an executor sees (README §3.3).

Three classes, one gate:

- ``GATED`` — an approval row is written and a decision card is raised; nothing executes until
  the decision resolves.
- ``READ``  — synchronous and capped; the capped answer becomes a system episode.
- ``AUTO``  — fires immediately, but only after its validator passes.

Two kinds of entry carry no executor. A host tool (``origin = "host:<app_id>"``) is executed by
the page on ``execute``; the lane never holds it (README §3.2 step 5). A connector tool
(``origin = "connector:<id>"``, README §4) does have an executor, and it runs in the daemon's
process behind the vault.

``parse_origin`` lives here rather than in ``manifest.py`` because ``ToolEntry`` validates its own
origin at construction and ``manifest.py`` already imports this module for ``ToolClass``; one
import direction, one parser. ``athena.contracts.manifest`` re-exports it for readers who look
there first.
"""

from __future__ import annotations

from collections.abc import Callable, Sequence
from dataclasses import dataclass, field
from enum import StrEnum
from typing import Any, Literal, Protocol, runtime_checkable


class ToolClass(StrEnum):
    """What the gate does with a call. The catalog decides this; a model never does."""

    GATED = "GATED"
    READ = "READ"
    AUTO = "AUTO"


class Lane(StrEnum):
    """The browser lane is the only lane in this build (README §3.1).

    It is an enum and not a constant because ``ToolEntry.lanes`` is a mask and a second lane is a
    plausible later commit; one member today keeps the mask honest and costs nothing.
    """

    BROWSER = "browser"


ALL_LANES: frozenset[Lane] = frozenset(Lane)

#: The three tiers of capability (README §3.4). Tier 1 is the page's own WebMCP tools, tier 2 the
#: nine generic hands, tier 3 a third-party connector. ``0`` is Athena's own core tools.
Tier = Literal[0, 1, 2, 3]

OriginKind = Literal["core", "host", "connector"]


@dataclass(frozen=True)
class ToolOrigin:
    """A parsed ``origin`` string: ``core``, ``host:<app_id>`` or ``connector:<id>``."""

    kind: OriginKind
    id: str = ""

    def __str__(self) -> str:
        return self.kind if self.kind == "core" else f"{self.kind}:{self.id}"

    @property
    def tier(self) -> Tier:
        if self.kind == "core":
            return 0
        if self.kind == "connector":
            return 3
        return 1


def parse_origin(origin: str) -> ToolOrigin:
    """Parse an origin string, or raise ``ValueError`` naming what is wrong with it.

    The id is deliberately dot-free: registry names are ``host.<app_id>.<tool>``, so a dot in the
    id would make the namespace ambiguous to anything that splits on one.
    """
    if origin == "core":
        return ToolOrigin("core")
    kind, sep, ident = origin.partition(":")
    if not sep or kind not in ("host", "connector"):
        raise ValueError(f"origin must be 'core', 'host:<app_id>' or 'connector:<id>': {origin!r}")
    if not ident or "." in ident or ":" in ident:
        raise ValueError(f"{kind} origin needs a non-empty, dot-free id: {origin!r}")
    return ToolOrigin("host" if kind == "host" else "connector", ident)


def is_origin(origin: str) -> bool:
    """``True`` when :func:`parse_origin` would accept the string."""
    try:
        parse_origin(origin)
    except ValueError:
        return False
    return True


@dataclass(frozen=True)
class ValidationResult:
    """A validator's answer. ``reason`` is a member of ``ERROR_REASONS`` when it is not ``None``."""

    ok: bool
    reason: str | None = None
    detail: str = ""

    @classmethod
    def accept(cls) -> ValidationResult:
        return cls(True)

    @classmethod
    def reject(cls, reason: str, detail: str = "") -> ValidationResult:
        return cls(False, reason, detail)


@dataclass(frozen=True)
class ExecResult:
    """What an executor returns. Bounded output announces itself (README §2 invariant 4)."""

    ok: bool
    output: str = ""
    shown: int | None = None
    total: int | None = None
    error: str | None = None
    tier: Tier = 0
    ms: int = 0

    @property
    def truncated(self) -> bool:
        return self.shown is not None and self.total is not None and self.shown < self.total

    def footer(self) -> str:
        """The ``(showing N of M)`` line, or ``""`` when nothing was left out."""
        if not self.truncated:
            return ""
        return f"(showing {self.shown} of {self.total})"

    def announces_truncation(self) -> bool:
        """``True`` when this result is honest about what it left out."""
        return not self.truncated or self.footer() in self.output

    @classmethod
    def bounded(
        cls,
        items: Sequence[str],
        limit: int,
        *,
        separator: str = "\n",
        tier: Tier = 0,
        ms: int = 0,
    ) -> ExecResult:
        """Render at most ``limit`` of ``items``, appending ``(showing N of M)`` iff some were cut.

        This is the one place the footer is written. A caller that formats its own list and
        forgets the footer is what the TruncationHook exists to catch; a caller that uses this
        cannot forget.
        """
        total = len(items)
        shown = min(total, max(limit, 0))
        parts = list(items[:shown])
        if shown < total:
            parts.append(f"(showing {shown} of {total})")
        return cls(
            ok=True,
            output=separator.join(parts),
            shown=shown,
            total=total,
            tier=tier,
            ms=ms,
        )

    @classmethod
    def failure(cls, reason: str, output: str = "", *, tier: Tier = 0, ms: int = 0) -> ExecResult:
        return cls(ok=False, output=output, error=reason, tier=tier, ms=ms)


@dataclass
class TurnContext:
    """Everything a validator or an executor may consult.

    No model handle and no network client: policy is decided from data, and the data is here.
    """

    conversation_id: str
    turn_id: str
    lane: Lane = Lane.BROWSER
    #: Which surface raised the turn — ``panel``, ``voice`` or ``mcp`` (README §3.4, act 4).
    surface: str = "panel"
    session_id: str | None = None
    app_id: str | None = None
    #: The page origin (``https://…``) this session is pinned to; structural policy compares
    #: a browser tool's origin against it and refuses a mismatch with ``foreign_origin``.
    page_origin: str | None = None
    project_id: str | None = None
    #: Set when the gate is replayed for a resolved approval, so ``describe`` can prove the
    #: approval was granted for this action and these parameters.
    approval_id: str | None = None
    quiet_hours: bool = False
    extra: dict[str, Any] = field(default_factory=dict)


@runtime_checkable
class Validator(Protocol):
    """Pure policy: parameters plus context in, an accept or a reason out. No I/O."""

    def __call__(self, params: dict[str, Any], ctx: TurnContext) -> ValidationResult: ...


@runtime_checkable
class Executor(Protocol):
    """Runs a call that the gate already allowed."""

    def __call__(self, params: dict[str, Any], ctx: TurnContext) -> ExecResult: ...


ValidatorFn = Callable[[dict[str, Any], TurnContext], ValidationResult]
ExecutorFn = Callable[[dict[str, Any], TurnContext], ExecResult]


def always_valid(params: dict[str, Any], ctx: TurnContext) -> ValidationResult:
    """The default validator. Explicit, so that "no validator" is never an accident."""
    return ValidationResult.accept()


@dataclass
class ToolEntry:
    """One registry row.

    ``name`` is namespaced: ``core.write_fact``, ``host.<app_id>.<tool>`` or
    ``connector.<id>.<tool>``. The namespace is what makes two apps' identically named tools two
    different rows in the catalog and two different lines in the rendered capabilities block.
    """

    name: str
    origin: str
    cls: ToolClass
    params_schema: dict[str, Any] = field(default_factory=dict)
    description: str = ""
    validator: ValidatorFn = always_valid
    executor: ExecutorFn | None = None
    lanes: frozenset[Lane] = ALL_LANES
    #: Required for ``READ``: the character cap its answer is truncated to before it becomes an
    #: episode. README §3.3 fixes the catalog's default at 1,600.
    cap_chars: int | None = None

    def __post_init__(self) -> None:
        if not self.name or "." not in self.name:
            raise ValueError(
                f"tool name must be namespaced ('core.x', 'host.<app>.x'): {self.name!r}"
            )
        parsed = parse_origin(self.origin)
        if parsed.kind == "core" and self.executor is None:
            raise ValueError(f"core tool {self.name} must have an executor")
        if parsed.kind == "host" and self.executor is not None:
            raise ValueError(f"host tool {self.name} must have no executor; the page executes it")
        if self.cls is ToolClass.READ and self.cap_chars is None:
            raise ValueError(f"READ tool {self.name} must declare cap_chars")
        if not self.lanes:
            raise ValueError(f"tool {self.name} has an empty lane mask")

    @property
    def parsed_origin(self) -> ToolOrigin:
        return parse_origin(self.origin)

    @property
    def tier(self) -> Tier:
        return self.parsed_origin.tier

    def enabled_in(self, lane: Lane) -> bool:
        return lane in self.lanes

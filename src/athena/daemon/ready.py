"""Readiness, derived and naming its own remediation (README §4's rule, applied to the daemon).

Three-valued, like connector health, and for the same reason: "not healthy" is two different
situations and a surface that renders them the same way sends the user to fix the wrong thing.
``broken`` is a thing that is known to be wrong and has a remediation; ``unknown`` is a thing
nobody has asked about yet, and the honest answer to "is the engine there?" before the probe has
run is not "no".

Readiness is *derived*, never stored: :func:`readiness` asks each check at the moment it is called.
A cached readiness is a setup screen that keeps telling the user to install something they have
already installed.

Probing happens on events and not on render. The engine probe spawns a process, and a panel that
re-rendered every keystroke would spawn one per keystroke, so :class:`Ready` takes the probe's
last answer as data and does not reach for it itself.
"""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from typing import Any, Literal

__all__ = ["STATES", "Check", "Readiness", "readiness"]

State = Literal["healthy", "broken", "unknown"]

STATES: tuple[str, ...] = ("healthy", "broken", "unknown")


@dataclass(frozen=True)
class Check:
    """One thing that has to be true, what it says now, and what to do if it is not."""

    name: str
    state: State
    detail: str = ""
    remediation: str = ""

    @property
    def ok(self) -> bool:
        return self.state == "healthy"

    def as_dict(self) -> dict[str, Any]:
        return {
            "name": self.name,
            "state": self.state,
            "detail": self.detail,
            "remediation": self.remediation,
        }


@dataclass(frozen=True)
class Readiness:
    """Every check, and the one sentence a setup screen shows above them."""

    checks: tuple[Check, ...]

    @property
    def ready(self) -> bool:
        return all(check.ok for check in self.checks)

    @property
    def blocking(self) -> tuple[Check, ...]:
        """The checks standing between the user and a working turn, worst first."""
        broken = tuple(c for c in self.checks if c.state == "broken")
        unknown = tuple(c for c in self.checks if c.state == "unknown")
        return broken + unknown

    @property
    def summary(self) -> str:
        first = self.blocking[0] if self.blocking else None
        if first is None:
            return "ready"
        return first.remediation or first.detail or f"{first.name} is {first.state}"

    def as_dict(self) -> dict[str, Any]:
        return {
            "ready": self.ready,
            "summary": self.summary,
            "checks": [check.as_dict() for check in self.checks],
        }


def readiness(
    *,
    brain_root: str | None,
    constitution_sections: Sequence[str] = (),
    engines: Mapping[str, bool] | None = None,
    engine_detail: Mapping[str, str] | None = None,
) -> Readiness:
    """Assemble the daemon's readiness from facts the caller already holds.

    Every argument is data the daemon has at hand, not a service to call. That is what keeps this
    module free of I/O and testable without a brain, a constitution or a CLI on PATH.
    """
    checks = [
        _brain(brain_root),
        _constitution(constitution_sections),
        _engine(engines, engine_detail or {}),
    ]
    return Readiness(checks=tuple(checks))


def _brain(root: str | None) -> Check:
    if root:
        return Check("brain", "healthy", f"open at {root}")
    return Check(
        "brain",
        "broken",
        "no brain is open",
        "set ATHENA_HOME, or start the daemon with --brain pointing at a directory",
    )


def _constitution(sections: Sequence[str]) -> Check:
    """The law is not optional. A turn composed without it is a turn with no law in its prompt."""
    if "law" in sections:
        return Check("constitution", "healthy", f"loaded: {', '.join(sorted(sections))}")
    return Check(
        "constitution",
        "broken",
        "no law section was found",
        "run from a checkout with constitution/law.md, or install the wheel that carries it",
    )


def _engine(engines: Mapping[str, bool] | None, detail: Mapping[str, str]) -> Check:
    """The user's own CLI, billed to the subscription they already have (README act 1).

    ``None`` means the probe has not run, which is ``unknown`` and not ``broken``: telling someone
    to install a CLI they already have is worse than telling them nothing yet.
    """
    if engines is None:
        return Check("engine", "unknown", "no engine has been probed yet", "run the engine probe")
    available = sorted(name for name, ok in engines.items() if ok)
    if available:
        return Check("engine", "healthy", f"available: {', '.join(available)}")
    names = ", ".join(sorted(engines)) or "none"
    why = "; ".join(f"{name}: {text}" for name, text in sorted(detail.items()) if text)
    return Check(
        "engine",
        "broken",
        why or f"no engine answered a probe (tried {names})",
        "install the Claude or Codex CLI and sign in; no API key is needed",
    )

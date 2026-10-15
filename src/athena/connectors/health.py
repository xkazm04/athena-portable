"""Credential health: a verdict, or an attempt that reached none (README §4; ADR 0021, ADR 0108).

A **verdict** is what the provider said about the credential: ``healthy`` (it answered the probe,
or the token endpoint accepted the grant) or ``broken`` (it refused it). An **attempt** is a check
that reached no verdict: the provider could not be reached, rate limited the check, failed on its
own side, or the grant could not be refreshed this time. "Could not verify" is not "broken".

The two are two facts, stored as two on the :class:`~athena.connectors.vault.ConnectionRecord`:
only a verdict writes ``health``, ``health_at`` and ``health_detail``, and the next verdict clears
the attempt (``attempt_at``, ``attempt_detail``). Every door of the vault that learns something
about a credential — the probe, a brokered call, a refresh — classifies it here and records it with
:func:`record`, so the rule lives in one place.

This module imports nothing from the vault: an exception says whether it is a verdict through its
class's ``verdict`` flag (only :class:`~athena.connectors.vault.NeedsReauth` sets it) and whether
its sentence already names the obstacle through ``worded`` (a refresh that failed, a rate limit);
any other is the provider not reached. An answer is classified from its status and body.
"""

from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass
from datetime import datetime
from typing import Any, Protocol

__all__ = [
    "QUOTA_REASONS",
    "TERMINAL_GRANT_ERRORS",
    "Attempt",
    "Verdict",
    "classify",
    "is_quota_refusal",
    "record",
    "refresh_is_terminal",
]

#: The token endpoint's errors that mean the grant itself is gone (RFC 6749 §5.2).
TERMINAL_GRANT_ERRORS = frozenset({"invalid_grant", "invalid_client", "unauthorized_client"})
#: The reasons Google gives on a 403 that is a rate or a quota, not a lost grant.
QUOTA_REASONS = frozenset(
    {"rateLimitExceeded", "userRateLimitExceeded", "quotaExceeded", "dailyLimitExceeded"}
)


def is_quota_refusal(body: Any) -> bool:
    """A Google error body that names a rate or a quota reason rather than a lost grant."""
    error = body.get("error") if isinstance(body, Mapping) else None
    if not isinstance(error, Mapping):
        return False
    if error.get("status") == "RESOURCE_EXHAUSTED":
        return True
    items = error.get("errors")
    return isinstance(items, list) and any(
        isinstance(item, Mapping) and item.get("reason") in QUOTA_REASONS for item in items
    )


def refresh_is_terminal(status: int, body: Any) -> bool:
    """Whether a token endpoint's refusal means the grant is gone (and not just this attempt)."""
    if not 400 <= status < 500 or status == 429:
        return False
    error = body.get("error") if isinstance(body, Mapping) else None
    if isinstance(error, str) and error.strip():
        return error.strip() in TERMINAL_GRANT_ERRORS
    return status in (400, 401)


@dataclass(frozen=True)
class Verdict:
    """The provider's word on the credential: ``healthy`` or ``broken``, with its sentence."""

    health: str
    detail: str = ""


@dataclass(frozen=True)
class Attempt:
    """A check that reached no verdict, and the obstacle in plain words."""

    detail: str


class _Health(Protocol):
    health: str
    health_at: str
    health_detail: str
    attempt_at: str
    attempt_detail: str


def classify(
    status: int | None = None,
    body: Any = None,
    exc: BaseException | None = None,
    *,
    label: str,
    oauth: bool = False,
) -> Verdict | Attempt:
    """The one classifier. Either ``exc`` (what a door raised) or ``status`` and ``body`` (what the
    provider answered a credential with).

    An exception is a verdict only when its class says so (a lost grant is ``broken``); any other
    is an attempt: a refresh that failed this time, a rate limit, the provider not reached. An
    answer is ``healthy`` on 2xx; a 429, an OAuth 403 naming a quota, a 5xx or a 3xx is an attempt
    with the status in its sentence; any other 4xx is ``broken``."""
    if exc is not None:
        if getattr(exc, "verdict", False):
            return Verdict("broken", str(exc))
        if getattr(exc, "worded", False):
            return Attempt(str(exc))
        return Attempt(f"could not reach {label}: {exc}")
    if status is None:
        raise ValueError("classify needs an exception or a status")
    if 200 <= status < 300:
        return Verdict("healthy")
    if status == 429 or (oauth and status == 403 and is_quota_refusal(body)):
        return Attempt(f"{label} rate limited the check (it answered {status})")
    if status >= 500:
        return Attempt(f"{label} failed on its side (it answered {status})")
    if status < 400:
        return Attempt(f"{label} answered {status}, which is no verdict on the credential")
    return Verdict("broken", f"{label} refused the credential with {status}")


def record(rec: _Health, outcome: Verdict | Attempt, when: datetime) -> None:
    """Write ``outcome`` onto ``rec``: a verdict sets the verdict fields and clears the attempt; an
    attempt sets the attempt fields and leaves the verdict, and its age, as they were."""
    stamp = when.isoformat()
    if isinstance(outcome, Verdict):
        rec.health, rec.health_at, rec.health_detail = outcome.health, stamp, outcome.detail
        rec.attempt_at, rec.attempt_detail = "", ""
    else:
        rec.attempt_at, rec.attempt_detail = stamp, outcome.detail

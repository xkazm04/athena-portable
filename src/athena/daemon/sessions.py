"""Which page is which, and which application it is allowed to be (README §3.3, §3.4 tier 1).

A page claims its own identity. The ``athena:app`` meta tag says ``invoices`` and the bridge
carries that claim into a manifest, so the catalog namespaces the page's tools as
``host.invoices.<tool>``. The claim is free to make and nothing about it is verified by the page,
which is the whole reason this module exists: an ``app_id`` must be bound to exactly one web origin
at a time, and the second origin to claim it is refused.

Without that rule a site the user happened to visit could publish ``athena:app = invoices``,
register a tool called ``chase``, and inherit whatever standing the real invoicing application had
built up — a decision the user made about one origin, silently spent on another. The refusal is
``foreign_origin``, the same reason structural policy gives when a turn reaches across tabs, and
that is not a coincidence: both are the same question asked at two different moments.

A session is in memory and lives for as long as the daemon does. It is not in the brain because it
is not a memory: a tab that was open yesterday is not a fact about the user, and a brain that
carried one would stop being portable by copying (invariant 1).
"""

from __future__ import annotations

from collections.abc import Iterator, Sequence
from dataclasses import dataclass, field
from datetime import UTC, datetime
from typing import Any

from athena.contracts import ids
from athena.contracts.manifest import HostManifest

__all__ = ["Session", "SessionError", "Sessions"]


class SessionError(ValueError):
    """A page the daemon refuses to open a session for. Carries a closed-set ``reason``."""

    def __init__(self, reason: str, detail: str) -> None:
        super().__init__(detail)
        self.reason = reason
        self.detail = detail


def _now() -> str:
    return datetime.now(UTC).isoformat()


@dataclass
class Session:
    """One page, open in one tab, with the tools it registered."""

    id: str
    app_id: str
    page_origin: str
    app_name: str = ""
    app_version: str = "0"
    title: str = ""
    tools: tuple[str, ...] = ()
    opened_at: str = field(default_factory=_now)
    last_seen: str = field(default_factory=_now)

    @property
    def origin(self) -> str:
        """The catalog's origin string for this page — ``host:<app_id>``, not the web origin."""
        return f"host:{self.app_id}"

    def as_dict(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "app_id": self.app_id,
            "page_origin": self.page_origin,
            "app_name": self.app_name,
            "app_version": self.app_version,
            "title": self.title,
            "tools": list(self.tools),
            "origin": self.origin,
            "opened_at": self.opened_at,
            "last_seen": self.last_seen,
        }


class Sessions:
    """Open pages, by session id, with one application bound to one origin.

    :meth:`open` is idempotent for the same page: a tab that re-registers after a soft navigation
    updates its session rather than opening a second one, because two sessions for one tab would
    show the user two entries for one thing they can see is one thing.
    """

    def __init__(self) -> None:
        self._sessions: dict[str, Session] = {}

    # -- opening ----------------------------------------------------------------------------------

    def open(
        self, manifest: HostManifest, *, session_id: str | None = None, title: str = ""
    ) -> Session:
        """Bind a manifest to a session, or raise :class:`SessionError` naming the refusal.

        The manifest is validated whole first. README §3.3 is explicit that a manifest which fails
        validation is refused entirely — there is no "open the session with the good tools", because
        a half-merged manifest is a catalog nobody can reason about.
        """
        problems = manifest.validate()
        if problems:
            raise SessionError("manifest_invalid", "; ".join(problems))
        if not manifest.page_origin:
            raise SessionError("foreign_origin", f"{manifest.app_id}: a page must name its origin")

        held = self.for_app(manifest.app_id)
        if held is not None and held.page_origin != manifest.page_origin:
            raise SessionError(
                "foreign_origin",
                f"{manifest.app_id!r} is already bound to {held.page_origin}; "
                f"{manifest.page_origin} may not claim it",
            )

        sid = session_id or (held.id if held else ids.mint("session"))
        session = Session(
            id=sid,
            app_id=manifest.app_id,
            page_origin=manifest.page_origin,
            app_version=manifest.app_version,
            title=title,
            tools=tuple(tool.name for tool in manifest.tools),
        )
        self._sessions[sid] = session
        return session

    def touch(self, session_id: str) -> Session | None:
        session = self._sessions.get(session_id)
        if session is not None:
            session.last_seen = _now()
        return session

    # -- reading ----------------------------------------------------------------------------------

    def get(self, session_id: str) -> Session | None:
        return self._sessions.get(session_id)

    def for_app(self, app_id: str) -> Session | None:
        return next((s for s in self._sessions.values() if s.app_id == app_id), None)

    def pinned_origin(self, app_id: str) -> str | None:
        """The web origin this application is bound to, if any. What a turn is checked against."""
        session = self.for_app(app_id)
        return session.page_origin if session else None

    def live(self) -> list[Session]:
        return sorted(self._sessions.values(), key=lambda s: s.opened_at)

    def __len__(self) -> int:
        return len(self._sessions)

    def __iter__(self) -> Iterator[Session]:
        return iter(self.live())

    # -- closing ----------------------------------------------------------------------------------

    def close(self, session_id: str) -> Session | None:
        """Close one tab. Returns the session that was closed, so the caller can drop its origin
        from the catalog — a tab that is gone must not leave its tools addressable."""
        return self._sessions.pop(session_id, None)

    def close_app(self, app_id: str) -> Sequence[Session]:
        closed = [s for s in self._sessions.values() if s.app_id == app_id]
        for session in closed:
            self._sessions.pop(session.id, None)
        return closed

"""Who is talking to the daemon, keyed by the origin they are pinned to (README §3.2, §3.5).

A session is the daemon's memory of one page: the origin it is pinned to, the app id that origin
declared, the conversation its turns share, and when it was first and last seen. It is **in
memory on purpose**. Nothing here is a memory: the brain holds what was said, the approval table
holds what was asked, the ledger holds what was spent, and all three survive a restart. A session
is routing state for a socket that is already gone when the process dies, and writing it to disk
would mean a brain directory that is no longer portable by copying.

Two rules the rest of the daemon leans on:

**Keyed by origin, never by project.** A manifest belongs to one origin and a project spans
several, so a project cannot be the key without one page's tools leaking into another's session.
The project moves the *conversation* instead — see :func:`conversation_for`.

**Conversation ids are derived, never assembled here.** ``conv_<app_id>`` and ``conv_<project_id>``
both come out of ``contracts.ids``, which is the one place in Python that knows a prefix (README
§3.5: the first build minted ``conv_proj_proj_<id>`` because two modules each added one).
"""

from __future__ import annotations

import threading
from dataclasses import dataclass, replace
from datetime import UTC, datetime

from athena.contracts import ids

__all__ = ["Session", "Sessions", "conversation_for"]


def _now_iso() -> str:
    """UTC with an explicit offset — the stamp the brain's writer emits, and what parses back."""
    return datetime.now(UTC).isoformat()


@dataclass(frozen=True)
class Session:
    """One origin's standing with the daemon. Frozen: :meth:`Sessions.touch` replaces it."""

    #: The origin this session is pinned to, exactly as the surface sent it.
    origin: str
    #: The app id that origin declared; a lowercase slug, because it becomes a conversation id.
    app_id: str
    #: ``conv_<app_id>``. A turn under a project uses :func:`conversation_for` instead.
    conversation_id: str
    #: When the origin was first seen, and when it last spoke. ISO 8601, UTC.
    created_at: str
    last_seen_at: str
    #: How many tools the origin's manifest yielded, once one has been merged (c14).
    tools: int = 0


def conversation_for(session: Session, project_id: str = "") -> str:
    """The conversation a turn belongs to: the session's, or the active project's.

    A project spans origins, so while one is active every page of it talks in the same
    conversation and the episodes of that turn are found together afterwards. ``project_id`` must
    be a minted project id; a bare slug raises rather than growing a second prefix rule here.
    """
    if not project_id:
        return session.conversation_id
    return ids.conversation_for_project(project_id)


class Sessions:
    """The live sessions, one per origin, behind a lock because the server is threaded.

    The lock guards the dictionary only. A :class:`Session` is frozen, so a caller that has read
    one is holding a value that cannot change under it.
    """

    def __init__(self) -> None:
        self._by_origin: dict[str, Session] = {}
        self._lock = threading.Lock()

    def __len__(self) -> int:
        with self._lock:
            return len(self._by_origin)

    def __contains__(self, origin: object) -> bool:
        with self._lock:
            return origin in self._by_origin

    def touch(self, origin: str, app_id: str, *, tools: int | None = None) -> Session:
        """Open or refresh the session for ``origin`` and return it.

        The app id is allowed to change — a page that reloads under a new id is the same origin
        with a new conversation — and ``created_at`` survives that, because it dates the origin's
        relationship with the daemon rather than its current manifest.
        """
        if not origin:
            raise ValueError("a session needs an origin to pin to")
        conversation = ids.conversation_for_app(app_id)
        now = _now_iso()
        with self._lock:
            current = self._by_origin.get(origin)
            if current is None:
                session = Session(
                    origin=origin,
                    app_id=app_id,
                    conversation_id=conversation,
                    created_at=now,
                    last_seen_at=now,
                    tools=tools or 0,
                )
            else:
                session = replace(
                    current,
                    app_id=app_id,
                    conversation_id=conversation,
                    last_seen_at=now,
                    tools=current.tools if tools is None else tools,
                )
            self._by_origin[origin] = session
            return session

    def get(self, origin: str) -> Session | None:
        with self._lock:
            return self._by_origin.get(origin)

    def drop(self, origin: str) -> bool:
        """Forget one origin. ``True`` when there was something to forget."""
        with self._lock:
            return self._by_origin.pop(origin, None) is not None

    def all(self) -> list[Session]:
        """Every live session, in the order the origins first appeared.

        A snapshot, and the list is the caller's. The order is the dictionary's rather than a sort
        on ``created_at``, because a clock whose granularity is coarser than two calls to
        :meth:`touch` would otherwise reorder them.
        """
        with self._lock:
            return list(self._by_origin.values())

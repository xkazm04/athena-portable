"""Every route the daemon serves, and nothing that decides anything (README §3.2).

The routes are a translation layer and that is all they are. They parse, they call the lane or the
catalog, and they render an answer. No route classifies a tool, none of them decides whether
something is gated, and none of them executes anything the gate did not already allow — a route
that did would be a second gate, reachable by anyone who can spell the URL.

Two of them deserve their reasons written down.

``POST /run`` streams. The lane is an async generator and each request runs on its own thread, so
the handler drives that generator on a loop of its own and yields channel events as they arrive.
Buffering the turn and answering at the end would be simpler and would also be the thing the panel
cannot use: a decision card that arrives after the turn is a card the user answers too late.

``POST /decisions/<id>`` takes a choice and *nothing else*. The action and the parameters come from
the approval row, never from the request. A resolve endpoint that accepted parameters would be a
way to reach an executor with something other than what the user was shown, which is the whole
thing README §3.2 step 6 exists to prevent.
"""

from __future__ import annotations

import asyncio
import threading
from collections.abc import AsyncGenerator, Iterator, Mapping
from dataclasses import dataclass, field
from typing import Any

from athena.contracts.channel import ChannelEvent, TurnError
from athena.contracts.manifest import HostManifest
from athena.contracts.registry import Lane
from athena.core.approvals import ApprovalError
from athena.daemon.ready import Readiness
from athena.daemon.server import EventStream, Request, Response, Router
from athena.daemon.sessions import SessionError, Sessions
from athena.lane.browser_lane import BrowserLane
from athena.lane.turn_frame import RequestError, TurnRequest

__all__ = ["Deps", "Turnstile", "build_router"]

#: How many pending cards and ledger rows a list route returns before it announces the rest.
PAGE = 20


class Turnstile:
    """One turn at a time per conversation.

    Not a global lock: two tabs are two conversations and must run at once, which is act 2 of the
    demo. But two turns on *one* conversation would interleave inside a resumed CLI session and
    each would see the other's frame, so the second is refused rather than queued — a surface that
    hangs on a second send looks broken in a way a refusal does not.
    """

    def __init__(self) -> None:
        self._busy: set[str] = set()
        self._lock = threading.Lock()

    def claim(self, conversation_id: str) -> bool:
        with self._lock:
            if conversation_id in self._busy:
                return False
            self._busy.add(conversation_id)
            return True

    def release(self, conversation_id: str) -> None:
        with self._lock:
            self._busy.discard(conversation_id)

    def busy(self) -> list[str]:
        with self._lock:
            return sorted(self._busy)


@dataclass
class Deps:
    """What the routes were handed. Assembled by ``wiring``; every field is already built."""

    lane: BrowserLane
    sessions: Sessions
    catalog: Any
    approvals: Any
    ledger: Any
    readiness: Any
    version: str = "0.1.0"
    turnstile: Turnstile = field(default_factory=Turnstile)


def build_router(deps: Deps) -> Router:
    """Wire the routes onto a router. The only place a path string is written."""
    router = Router()
    router.get("/health", _health(deps), public=True)
    router.get("/ready", _ready(deps))
    router.get("/capabilities", _capabilities(deps))
    router.get("/sessions", _list_sessions(deps))
    router.post("/sessions", _open_session(deps))
    router.post("/sessions/<session_id>/close", _close_session(deps))
    router.get("/decisions", _list_decisions(deps))
    router.post("/decisions/<approval_id>", _resolve(deps))
    router.get("/activity", _activity(deps))
    router.post("/run", _run(deps))
    return router


# --- liveness and readiness ---------------------------------------------------------------------


def _health(deps: Deps) -> Any:
    def handler(request: Request) -> Response:
        return Response.json({"ok": True, "version": deps.version})

    return handler


def _ready(deps: Deps) -> Any:
    def handler(request: Request) -> Response:
        state: Readiness = deps.readiness()
        return Response.json(state.as_dict())

    return handler


# --- what the panel renders before a turn -------------------------------------------------------


def _capabilities(deps: Deps) -> Any:
    """The tool list, as the panel shows it on first sight (README act 1).

    Every entry carries its class, and the class is the catalog's answer rather than a hint the
    panel derives — a surface that decided this would be the second place policy lived.
    """

    def handler(request: Request) -> Response:
        app_id = request.one("app_id") or None
        parsed = TurnRequest.from_dict({"message": "-", "app_id": app_id or ""})
        entries = deps.lane.capabilities(parsed)
        return Response.json(
            {
                "app_id": app_id,
                "tools": [
                    {
                        "name": entry.name,
                        "origin": entry.origin,
                        "class": str(entry.cls),
                        "tier": entry.tier,
                        "description": entry.description,
                        "params_schema": entry.params_schema,
                    }
                    for entry in entries
                ],
                "total": len(entries),
            }
        )

    return handler


# --- the open pages -----------------------------------------------------------------------------


def _list_sessions(deps: Deps) -> Any:
    def handler(request: Request) -> Response:
        return Response.json({"sessions": [s.as_dict() for s in deps.sessions.live()]})

    return handler


def _open_session(deps: Deps) -> Any:
    """A page registered its tools. Validate whole, bind the origin, merge the catalog.

    The three happen in that order and the order is the policy: a manifest that fails validation
    never reaches the session table, and a session that is refused never reaches the catalog.
    """

    def handler(request: Request) -> Response:
        payload = request.json()
        if not isinstance(payload, Mapping):
            return Response.error(400, "parse_error", "a session request must be a JSON object")
        raw = payload.get("manifest")
        if not isinstance(raw, Mapping):
            return Response.error(400, "manifest_invalid", "no manifest in the request")

        manifest = HostManifest.from_dict(dict(raw))
        try:
            session = deps.sessions.open(
                manifest,
                session_id=_string(payload.get("session_id")),
                title=str(payload.get("title") or ""),
            )
        except SessionError as exc:
            return Response.error(409, exc.reason, exc.detail)

        merged = deps.catalog.merge_manifest(manifest)
        return Response.json({"session": session.as_dict(), "registered": merged})

    return handler


def _close_session(deps: Deps) -> Any:
    """A tab closed. Its tools stop being addressable in the same breath."""

    def handler(request: Request) -> Response:
        session = deps.sessions.close(request.params["session_id"])
        if session is None:
            return Response.error(404, "unknown_ref", "no such session")
        dropped = deps.catalog.drop_origin(session.origin)
        return Response.json({"closed": session.id, "dropped": dropped})

    return handler


# --- the approvals inbox -------------------------------------------------------------------------


def _list_decisions(deps: Deps) -> Any:
    def handler(request: Request) -> Response:
        page = deps.approvals.pending(PAGE)
        return Response.json(
            {
                "decisions": [row.to_event().to_dict() for row in page.rows],
                "shown": page.shown,
                "total": page.total,
                "footer": page.footer(),
            }
        )

    return handler


def _resolve(deps: Deps) -> Any:
    """Close a card. The choice is the only thing this route takes from the caller."""

    def handler(request: Request) -> Response:
        payload = request.json()
        choice = _string(payload.get("choice") if isinstance(payload, Mapping) else None)
        if not choice:
            return Response.error(400, "parse_error", "a decision needs a choice")
        answer = _string(payload.get("answer")) if isinstance(payload, Mapping) else None

        try:
            resolution = deps.lane.resolve(request.params["approval_id"], choice, answer)
        except ApprovalError as exc:
            reason = "expired" if "expired" in str(exc) else "unknown_ref"
            return Response.error(409, reason, str(exc))

        return Response.json(
            {
                "approved": resolution.approved,
                "reason": resolution.reason,
                "events": [event.to_dict() for event in resolution.events],
            }
        )

    return handler


# --- the record -----------------------------------------------------------------------------------


def _activity(deps: Deps) -> Any:
    """The ledger, newest first, bounded and announced (README §2 invariant 6)."""

    def handler(request: Request) -> Response:
        page = deps.ledger.recent(PAGE)
        return Response.json(
            {
                "rows": [row.to_summary().to_dict() | _row_extras(row) for row in page.rows],
                "shown": page.shown,
                "total": page.total,
                "footer": page.footer(),
            }
        )

    return handler


def _row_extras(row: Any) -> dict[str, Any]:
    """What the record shows beyond the turn summary: who asked, and how it ended."""
    return {
        "row_id": row.row_id,
        "turn_id": row.turn_id,
        "origin": row.origin,
        "surface": row.surface,
        "trigger": row.trigger,
        "is_error": row.is_error,
        "error_reason": row.error_reason,
        "created_at": row.created_at,
    }


# --- the turn -------------------------------------------------------------------------------------


def _run(deps: Deps) -> Any:
    """One turn, streamed as it happens."""

    def handler(request: Request) -> Response | EventStream:
        payload = request.json()
        if not isinstance(payload, Mapping):
            return Response.error(400, "parse_error", "a turn request must be a JSON object")
        try:
            parsed = TurnRequest.from_dict(payload)
        except RequestError as exc:
            return Response.error(400, "parse_error", str(exc))

        pinned = deps.sessions.pinned_origin(parsed.app_id) if parsed.app_id else None
        if pinned and parsed.page_origin and pinned != parsed.page_origin:
            return Response.error(
                409,
                "foreign_origin",
                f"{parsed.app_id!r} is bound to {pinned}, not {parsed.page_origin}",
            )

        if not deps.turnstile.claim(parsed.conversation_id):
            return Response.error(
                409, "pending_approval", f"{parsed.conversation_id} already has a turn in flight"
            )
        return EventStream(_drive(deps, parsed))

    return handler


def _drive(deps: Deps, parsed: TurnRequest) -> Iterator[ChannelEvent]:
    """Pump the lane's async generator on this request's own thread.

    A loop per request rather than one shared loop: the server is threaded and an asyncio loop is
    not, so a shared loop would put every turn back in one queue and undo README §3.5 one layer
    above where it was fixed.
    """
    loop = asyncio.new_event_loop()
    stream: AsyncGenerator[ChannelEvent, None] = deps.lane.run(parsed)
    try:
        while True:
            try:
                yield loop.run_until_complete(stream.__anext__())
            except StopAsyncIteration:
                return
    except Exception as exc:
        yield TurnError(reason="unknown", detail=f"{type(exc).__name__}: {exc}")
    finally:
        try:
            loop.run_until_complete(stream.aclose())
        finally:
            loop.close()
            deps.turnstile.release(parsed.conversation_id)


def _string(value: Any) -> str | None:
    return value.strip() if isinstance(value, str) and value.strip() else None


def _lane_default() -> Lane:
    return Lane.BROWSER

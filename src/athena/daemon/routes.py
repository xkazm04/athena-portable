"""The route table, and the one route the daemon answers today (README §3.5; ADR 0011).

A route is a method, a path and a function from a parsed :class:`Request` to a status and a JSON
body. The table is a value the daemon owns rather than a chain of ``if`` statements inside the
request handler, for three reasons: the handler stays about HTTP (the token, CORS, closing the
connection) and knows nothing about Athena; a later commit adds ``/manifest``, ``/run`` and the
read routes by appending to the table rather than by editing the handler; and a test can append a
route of its own to prove a property of the *server* — that a slow route does not stall a fast one
— without the daemon shipping a debug route to production.

**Read routes take no lock.** ``GET /health`` reads the approval table through
``Brain.read_connection()``, which is a fresh read-only handle per call (ADR 0003), so it answers
while a turn is writing. What it reports is consistent as of the last completed write. Only a
route that *writes* takes ``AthenaDaemon.writing()``, and the first of those arrives with ``/run``
in the next commit.

**Errors are one shape.** ``{"ok": false, "reason": ..., "detail": ...}``, where ``reason`` is a
member of ``contracts.harness.ERROR_REASONS`` — the same closed vocabulary the ledger records and
``gate.js`` speaks, so a surface never has to learn a second set of words for the same refusal.
"""

from __future__ import annotations

from collections.abc import Callable, Iterable, Mapping
from dataclasses import dataclass, field
from typing import TYPE_CHECKING, Any

from athena.contracts.harness import normalize_reason

if TYPE_CHECKING:
    from athena.daemon.server import AthenaDaemon

__all__ = [
    "HEALTH_PENDING_LIMIT",
    "Reply",
    "Request",
    "Route",
    "RouteFn",
    "RouteTable",
    "base_routes",
    "error",
    "health",
]

#: How many pending approvals ``/health`` counts before it stops counting. The number it reports
#: is the honest total up to here, and the footer says so when it stopped early.
HEALTH_PENDING_LIMIT = 200

#: A status and the JSON body that goes with it.
Reply = tuple[int, dict[str, Any]]


@dataclass(frozen=True)
class Request:
    """One parsed request. Everything the handler could learn before a route ran."""

    method: str
    path: str
    query: Mapping[str, str] = field(default_factory=dict)
    #: The decoded JSON body, or ``{}`` for a request that had none. Never ``None``: a body that
    #: would not parse is refused by the handler before a route sees it.
    body: Mapping[str, Any] = field(default_factory=dict)
    #: The ``Origin`` header, or ``""``. CORS is decided from it; trust never is.
    origin: str = ""


RouteFn = Callable[[Request], Reply]


@dataclass(frozen=True)
class Route:
    method: str
    path: str
    fn: RouteFn


def error(status: int, reason: str, detail: str = "") -> Reply:
    """A refusal in the one shape, with ``reason`` collapsed onto ``ERROR_REASONS``."""
    return status, {"ok": False, "reason": normalize_reason(reason) or "unknown", "detail": detail}


class RouteTable:
    """What the daemon answers. Ordered, exact-match on the path, first registration wins."""

    def __init__(self, routes: Iterable[Route] = ()) -> None:
        self._routes: list[Route] = []
        for route in routes:
            self.add(route)

    def __len__(self) -> int:
        return len(self._routes)

    def add(self, route: Route) -> Route:
        """Register ``route``. A duplicate method-and-path pair is a programming error."""
        if self.match(route.method, route.path) is not None:
            raise ValueError(f"{route.method} {route.path} is already routed")
        self._routes.append(route)
        return route

    def match(self, method: str, path: str) -> Route | None:
        for route in self._routes:
            if route.method == method and route.path == path:
                return route
        return None

    def knows(self, path: str) -> bool:
        """Whether any method routes ``path``; the difference between a 404 and a 405."""
        return any(route.path == path for route in self._routes)

    def listing(self) -> list[str]:
        """``METHOD /path`` for every route, in registration order."""
        return [f"{route.method} {route.path}" for route in self._routes]


def health(daemon: AthenaDaemon) -> Reply:
    """What is running, over which brain, for how long, and what is waiting on the user.

    The pending block is bounded and announces itself like every other bounded read in this
    repository (README §2, invariant 4): ``total`` counts the live rows, ``showing`` counts the
    rows this page actually looked at, and ``footer`` is the ``(showing N of M)`` sentence — empty
    when the page is the whole inbox, which is the usual case.
    """
    page = daemon.approvals.pending(HEALTH_PENDING_LIMIT)
    return 200, {
        "ok": True,
        "engine": daemon.engine,
        "model": daemon.model,
        "brain": str(daemon.brain.root),
        "uptime_s": daemon.uptime_s,
        "sessions": len(daemon.sessions),
        "tools": len(daemon.catalog),
        "pending": {
            "showing": page.shown,
            "total": page.total,
            "footer": page.footer(),
        },
        "routes": daemon.routes.listing(),
    }


def base_routes(daemon: AthenaDaemon) -> list[Route]:
    """Every route this commit ships. ``/manifest``, ``/run`` and the read routes come next."""
    return [Route("GET", "/health", lambda request: health(daemon))]

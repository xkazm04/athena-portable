"""The daemon: HTTP and SSE over loopback, threaded, token-guarded (README §3.1, §3.5).

One package between every surface and the lane. It owns the server, the routes, the open-page
sessions and the derived readiness a setup screen renders; it owns no policy, because the gate
already does.
"""

from athena.daemon.ready import STATES, Check, Readiness, readiness
from athena.daemon.server import (
    ALLOWED_ORIGINS,
    MAX_BODY,
    Daemon,
    EventStream,
    Handler,
    Request,
    Response,
    Router,
    mint_token,
)
from athena.daemon.sessions import Session, SessionError, Sessions

__all__ = [
    "ALLOWED_ORIGINS",
    "MAX_BODY",
    "STATES",
    "Check",
    "Daemon",
    "EventStream",
    "Handler",
    "Readiness",
    "Request",
    "Response",
    "Router",
    "Session",
    "SessionError",
    "Sessions",
    "mint_token",
    "readiness",
]

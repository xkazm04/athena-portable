"""The daemon: one Athena on 127.0.0.1, beside whatever page is open (README §3.1, §3.5).

The environment layer's front door. Four files rather than one long module, because a reviewer
should be able to read them one at a time:

- :mod:`athena.daemon.server` — the socket, the token, CORS, one request per connection, and the
  ``AthenaDaemon`` object every route runs against.
- :mod:`athena.daemon.routes` — the route table and the routes themselves. ``GET /health`` today;
  ``/manifest``, ``/run`` and the read routes append to the same table.
- :mod:`athena.daemon.sessions` — who is talking, keyed by origin, in memory.
- :mod:`athena.daemon.ready` — the one JSON line a spawned daemon prints once it is listening.

Nothing here decides policy. The gate lives in ``core/catalog.py`` and ``harness/hooks.py``; this
package carries a request to it and carries the answer back.
"""

from athena.daemon.ready import announce, failure_line, ready_line
from athena.daemon.routes import (
    HEALTH_PENDING_LIMIT,
    Reply,
    Request,
    Route,
    RouteFn,
    RouteTable,
    base_routes,
    error,
    health,
)
from athena.daemon.server import (
    ALLOWED_METHODS,
    DEFAULT_HOST,
    DEFAULT_PORT,
    EXTENSION_SCHEME,
    MAX_BODY_BYTES,
    TOKEN_FILENAME,
    TOKEN_HEADER,
    AthenaDaemon,
    DaemonConfig,
    DaemonServer,
    bound_url,
    build_handler,
    build_parser,
    make_server,
    new_token,
    resolve_token,
    serve,
)
from athena.daemon.sessions import Session, Sessions, conversation_for

__all__ = [
    "ALLOWED_METHODS",
    "DEFAULT_HOST",
    "DEFAULT_PORT",
    "EXTENSION_SCHEME",
    "HEALTH_PENDING_LIMIT",
    "MAX_BODY_BYTES",
    "TOKEN_FILENAME",
    "TOKEN_HEADER",
    "AthenaDaemon",
    "DaemonConfig",
    "DaemonServer",
    "Reply",
    "Request",
    "Route",
    "RouteFn",
    "RouteTable",
    "Session",
    "Sessions",
    "announce",
    "base_routes",
    "bound_url",
    "build_handler",
    "build_parser",
    "conversation_for",
    "error",
    "failure_line",
    "health",
    "make_server",
    "new_token",
    "ready_line",
    "resolve_token",
    "serve",
]

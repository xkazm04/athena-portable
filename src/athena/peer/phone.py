"""The phone page, served by the beacon on its overlay address: ``GET /m/*`` (ADR 0140, WP4).

A phone has no Athena of its own. It reaches the beacon PC's peer listener over the private
overlay and is handed a small web app - hand-written HTML, CSS and two ES modules, no build step,
no framework, no dependency - from :data:`MOBILE_DIR`, which ships inside the package and inside
the frozen sidecar (``scripts/build-sidecar.py``). The app does the rest against the peer routes
with its own bearer token: the claim (``/peer/pair/*``), ``/peer/hello``, and WP3's
``/peer/message``, ``/peer/turns/<id>`` and ``/peer/decisions*``.

**Open, but still address-gated.** These are ``open=True`` routes, so the page loads before the
phone holds a token - it is how the phone comes to hold one. The listener's admission still runs
first: only an overlay address ever gets this far. Nothing here reads a body or a query.

**A fixed set of files, by name.** The path after ``/m/`` is looked up in :data:`FILES` and nothing
else is opened: no directory listing, no path joined from the request, so ``..`` and its encodings
are a 404 like any other unknown name. Each file goes with its own content type, ``nosniff``, a
``no-referrer`` policy (the page's URL once carried the claim, in its fragment), a content
security policy that allows the page's own origin and nothing else - no inline script, no inline
style, no frame - and ``no-cache``, so a new Athena's page replaces an old one on the next load.

**The service worker.** ``sw.js`` caches the shell so that, once installed, a phone that cannot
reach the beacon still opens the page and says "Athena on <beacon> is asleep" instead of the
browser's error. A service worker needs a secure context, and ``http://100.x.y.z`` is not one, so
on the plain-HTTP overlay address it never registers (``app.js`` checks ``isSecureContext``). The
page itself then reports an unreachable beacon while it is open; a page opened afresh with the
beacon off gets the browser's own "cannot reach" page. Serving the page over HTTPS
(``tailscale serve``) would change that, and was not built: see ADR 0140, "Phone and setup".
"""

from __future__ import annotations

from pathlib import Path
from typing import TYPE_CHECKING
from urllib.parse import unquote

from athena.daemon.routes import BinaryReply, Request
from athena.peer.listener import PeerRoute

if TYPE_CHECKING:
    from athena.peer.listener import PeerHost

__all__ = ["FILES", "MOBILE_DIR", "MOBILE_PREFIX", "SECURITY_HEADERS", "peer_routes", "serve"]

MOBILE_DIR = Path(__file__).resolve().parent / "mobile"
MOBILE_PREFIX = "/m/"

#: Every file the page is made of, and its content type. Nothing outside this table is served.
FILES: dict[str, str] = {
    "index.html": "text/html; charset=utf-8",
    "app.js": "text/javascript; charset=utf-8",
    "turn.js": "text/javascript; charset=utf-8",
    "app.css": "text/css; charset=utf-8",
    "sw.js": "text/javascript; charset=utf-8",
    "manifest.webmanifest": "application/manifest+json",
    "icon.svg": "image/svg+xml",
}

SECURITY_HEADERS: dict[str, str] = {
    "Content-Security-Policy": (
        "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self'; "
        "connect-src 'self'; manifest-src 'self'; worker-src 'self'; frame-ancestors 'none'; "
        "base-uri 'none'; form-action 'none'"
    ),
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
    "X-Frame-Options": "DENY",
    "Cache-Control": "no-cache",
}

_NOT_FOUND = BinaryReply(404, b"not found\n", "text/plain; charset=utf-8", SECURITY_HEADERS)


def serve(name: str, root: Path = MOBILE_DIR) -> BinaryReply:
    """One file of the page by its exact name, or a 404."""
    content_type = FILES.get(name)
    if content_type is None:
        return _NOT_FOUND
    try:
        body = (root / name).read_bytes()
    except OSError:
        return _NOT_FOUND
    return BinaryReply(200, body, content_type, SECURITY_HEADERS)


def _redirect(request: Request) -> BinaryReply:
    # A browser keeps the fragment across a redirect, so ``/m#claim=...`` still claims.
    return BinaryReply(308, b"", "text/plain; charset=utf-8", {"Location": MOBILE_PREFIX})


def peer_routes(host: PeerHost, root: Path = MOBILE_DIR) -> list[PeerRoute]:
    """``GET /m``, ``GET /m/`` and ``GET /m/<file>``, all open. The prefix goes first: the route
    table refuses an exact route added after a prefix that claims it, and ``/m/`` alone is not a
    prefix match."""

    def one(request: Request) -> BinaryReply:
        return serve(unquote(request.path[len(MOBILE_PREFIX) :]), root)

    return [
        PeerRoute("GET", MOBILE_PREFIX, one, prefix=True, open=True),
        PeerRoute("GET", MOBILE_PREFIX, lambda request: serve("index.html", root), open=True),
        PeerRoute("GET", "/m", _redirect, open=True),
    ]

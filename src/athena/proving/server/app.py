"""The trigger page's socket: public reads, one bearer-gated write (README §9; ADR 0037).

The daemon's idiom (ADR 0011), adapted to a page that judges open from anywhere: a threaded
``http.server``, ``Connection: close`` on every response, bodies bounded and drained when
refused. Two things differ, and on purpose:

- **Reads are public.** The page, the run list, a report and a run's event stream answer anyone:
  the latest run is meant to be seen by whoever has the URL. Nothing on those routes is a secret
  — a report carries sizes, costs, verdicts and model output, never a key or a prompt — and every
  body is passed through :meth:`Runner.redact` before it is written, so a key that leaked into a
  log line still does not leave.
- **Triggering costs money, so it takes a token.** ``POST /runs`` wants ``Authorization: Bearer
  <token>``, compared with :func:`secrets.compare_digest`; with no ``PROVING_JUDGE_TOKEN`` set,
  triggering is off (403) and the page says so. ``POST /runs/<id>/cancel`` takes the same token
  and kills the running run (ADR 0039).
- **A hosted runner says what it cannot do** (ADR 0039). ``GET /status`` carries the capability
  the runner found at start (``mode``, ``claude_cli``, the kinds it can start and why the rest
  are refused); a refused kind answers 422 ``not_on_this_host``.

CORS is off: the page is served from the same origin, and no other origin gets a CORS header
unless ``--allow-origin`` names it. The page itself is served with a per-response nonce in its
``Content-Security-Policy``, so even a payload that escaped the page's text-only rendering could
not run as a script; JSON is served ``nosniff``, so a report opened directly is never sniffed as
HTML.
"""

from __future__ import annotations

import json
import secrets
from collections.abc import Iterable, Iterator, Mapping
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from importlib import resources
from typing import Any
from urllib.parse import parse_qs, urlsplit

from athena.harness.tokenfactory import key_present
from athena.proving.server.runner import (
    KINDS,
    PRESETS,
    TOKEN_ENV,
    Busy,
    CapSpent,
    NotRunning,
    Runner,
    StartFailed,
    Unavailable,
)
from athena.proving.server.runs import DEFAULT_LIMIT, RunIndex

__all__ = ["MAX_BODY_BYTES", "ProvingServer", "build_handler", "page_html"]

#: ``POST /runs`` carries two short strings and a flag; anything bigger is not a run request.
MAX_BODY_BYTES = 4096

#: How much of a refused body is read past before the connection is closed instead.
DRAIN_LIMIT = 64 * 1024

IDLE_TIMEOUT_S = 30.0

_NONCE = "__CSP_NONCE__"

_JSON_CSP = "default-src 'none'; frame-ancestors 'none'"


def page_html() -> str:
    return (resources.files("athena.proving.server") / "static" / "index.html").read_text(
        encoding="utf-8"
    )


def _page_csp(nonce: str) -> str:
    return "; ".join(
        (
            "default-src 'none'",
            f"script-src 'nonce-{nonce}'",
            "style-src 'unsafe-inline'",
            "connect-src 'self'",
            "img-src 'self' data:",
            "base-uri 'none'",
            "form-action 'none'",
            "frame-ancestors 'none'",
        )
    )


class ProvingServer(ThreadingHTTPServer):
    """Threaded; worker threads hold a socket and nothing else, so they never block exit."""

    daemon_threads = True
    block_on_close = False


def build_handler(
    runner: Runner,
    index: RunIndex,
    *,
    allow_origins: Iterable[str] = (),
) -> type[BaseHTTPRequestHandler]:
    origins = frozenset(allow_origins)

    class Handler(BaseHTTPRequestHandler):
        protocol_version = "HTTP/1.1"
        server_version = "athena-proving"
        timeout = IDLE_TIMEOUT_S

        def log_message(self, format: str, *args: Any) -> None:
            """No request log: an ``Authorization`` header is never echoed anywhere."""
            return

        # -- writing ---------------------------------------------------------------------

        def _headers(self, status: int, content_type: str, csp: str) -> None:
            self.send_response(status)
            origin = self.headers.get("Origin") or ""
            if origin and origin in origins:
                self.send_header("Access-Control-Allow-Origin", origin)
                self.send_header("Vary", "Origin")
            self.send_header("Content-Type", content_type)
            self.send_header("Content-Security-Policy", csp)
            self.send_header("X-Content-Type-Options", "nosniff")
            self.send_header("Referrer-Policy", "no-referrer")
            self.send_header("Cache-Control", "no-store")
            self.send_header("Connection", "close")

        def _send_text(self, status: int, text: str, content_type: str, csp: str) -> None:
            body = runner.redact(text).encode("utf-8")
            self._headers(status, content_type, csp)
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.close_connection = True
            if self.command != "HEAD":
                self.wfile.write(body)

        def _json(self, status: int, payload: Mapping[str, Any]) -> None:
            self._send_text(
                status, json.dumps(dict(payload)), "application/json; charset=utf-8", _JSON_CSP
            )

        def _error(self, status: int, reason: str, detail: str) -> None:
            self._json(status, {"error": reason, "detail": detail})

        def _stream(self, frames: Iterator[str]) -> None:
            self._headers(200, "text/event-stream; charset=utf-8", _JSON_CSP)
            self.send_header("X-Accel-Buffering", "no")
            self.end_headers()
            self.close_connection = True
            try:
                for frame in frames:
                    self.wfile.write(runner.redact(frame).encode("utf-8"))
                    self.wfile.flush()
            except (BrokenPipeError, ConnectionError):
                pass

        # -- reading ---------------------------------------------------------------------

        def _token_ok(self) -> bool:
            expected = runner.environ.get(TOKEN_ENV, "").strip()
            header = self.headers.get("Authorization") or ""
            scheme, _, presented = header.partition(" ")
            if scheme.lower() != "bearer":
                presented = ""
            # Bytes, so a non-ASCII header cannot make compare_digest raise; compared even when
            # the header is empty, so a missing token and a wrong one take the same path.
            return secrets.compare_digest(
                presented.strip().encode("utf-8"), expected.encode("utf-8")
            ) and bool(expected)

        def _body(self) -> dict[str, Any] | None:
            try:
                length = int(self.headers.get("Content-Length") or 0)
            except ValueError:
                return None
            if length <= 0:
                return {}
            if length > MAX_BODY_BYTES:
                remaining = min(length, DRAIN_LIMIT)
                while remaining > 0:
                    chunk = self.rfile.read(min(8192, remaining))
                    if not chunk:
                        break
                    remaining -= len(chunk)
                return None
            try:
                payload = json.loads(self.rfile.read(length))
            except (json.JSONDecodeError, UnicodeDecodeError):
                return None
            return payload if isinstance(payload, dict) else None

        # -- routes ----------------------------------------------------------------------

        def do_HEAD(self) -> None:
            self.do_GET()

        def do_GET(self) -> None:
            url = urlsplit(self.path)
            path = url.path.rstrip("/") or "/"
            query = {k: v[0] for k, v in parse_qs(url.query).items() if v}
            if path in ("/", "/index.html"):
                nonce = secrets.token_urlsafe(16)
                html = page_html().replace(_NONCE, nonce)
                self._send_text(200, html, "text/html; charset=utf-8", _page_csp(nonce))
                return
            if path == "/health":
                self._json(200, {"ok": True})
                return
            if path == "/status":
                self._json(200, status(runner))
                return
            if path == "/runs":
                try:
                    limit = int(query.get("limit", DEFAULT_LIMIT))
                except ValueError:
                    limit = DEFAULT_LIMIT
                job = runner.current
                running = job.run_id if job is not None and not job.done else ""
                self._json(200, index.listing(limit, running=running))
                return
            parts = path.split("/")
            if len(parts) in (3, 4) and parts[1] == "runs":
                run_id = parts[2]
                run_dir = index.path(run_id)
                if run_dir is None:
                    self._error(404, "unknown", "no such run")
                    return
                if len(parts) == 3:
                    text = index.report_text(run_id)
                    if text is None:
                        job = runner.current
                        live = job is not None and job.run_id == run_id and not job.done
                        self._error(
                            404,
                            "no_report",
                            "the run is still going" if live else "the run wrote no report",
                        )
                        return
                    self._send_text(200, text, "application/json; charset=utf-8", _JSON_CSP)
                    return
                if parts[3] == "events":
                    job = runner.current
                    try:
                        after = int(self.headers.get("Last-Event-ID") or 0)
                    except ValueError:
                        after = 0
                    if job is not None and job.run_id == run_id:
                        self._stream(job.frames(after=after))
                    else:
                        self._stream(runner.replay(run_dir))
                    return
            self._error(404, "unknown", f"no route for GET {url.path}")

        def _authorized(self) -> bool:
            """The judge token, or an error already sent (the body drained either way)."""
            if not runner.environ.get(TOKEN_ENV, "").strip():
                self._body()
                self._error(403, "triggering_off", f"triggering is off: {TOKEN_ENV} is not set")
                return False
            if not self._token_ok():
                self._body()
                self._error(401, "foreign_token", "Authorization: Bearer <judge token> required")
                return False
            return True

        def _cancel(self, run_id: str) -> None:
            if not self._authorized():
                return
            self._body()
            if index.path(run_id) is None:
                self._error(404, "unknown", "no such run")
                return
            try:
                job = runner.cancel(run_id)
            except NotRunning as exc:
                self._error(409, "not_running", str(exc))
                return
            self._json(200, {**job.public(), "events": f"/runs/{job.run_id}/events"})

        def do_POST(self) -> None:
            path = urlsplit(self.path).path.rstrip("/")
            parts = path.split("/")
            if len(parts) == 4 and parts[1] == "runs" and parts[3] == "cancel":
                self._cancel(parts[2])
                return
            if path != "/runs":
                self._error(404, "unknown", f"no route for POST {path}")
                return
            if not self._authorized():
                return
            body = self._body()
            if body is None:
                self._error(400, "bad_request", f"a JSON object of at most {MAX_BODY_BYTES} bytes")
                return
            kind = str(body.get("kind", ""))
            preset = str(body.get("preset", "small"))
            if kind not in PRESETS or preset not in PRESETS[kind]:
                self._error(
                    400, "bad_request", f"kind is one of {list(KINDS)}, preset small|default"
                )
                return
            claude = body.get("claude")
            if claude is not None and not isinstance(claude, bool):
                self._error(400, "bad_request", "claude is a boolean")
                return
            if kind not in runner.kinds():
                refusal = runner.capabilities()["refused"].get(kind, "")
                self._error(422, "not_on_this_host", refusal or f"{kind} cannot run here")
                return
            if not key_present(dict(runner.environ)):
                self._error(503, "no_key", "the runner has no NEBIUS_API_KEY; nothing can run")
                return
            try:
                job = runner.start(kind, preset, claude)
            except Unavailable as exc:
                self._error(422, "not_on_this_host", str(exc))
                return
            except Busy as exc:
                self._error(409, "busy", str(exc))
                return
            except CapSpent as exc:
                self._error(429, "budget_exhausted", str(exc))
                return
            except StartFailed as exc:
                self._error(502, "engine_error", f"the run did not start: {exc}")
                return
            self._json(
                202,
                {**job.public(), "events": f"/runs/{job.run_id}/events"},
            )

        def do_OPTIONS(self) -> None:
            self.send_response(204)
            origin = self.headers.get("Origin") or ""
            if origin and origin in origins:
                self.send_header("Access-Control-Allow-Origin", origin)
                self.send_header("Access-Control-Allow-Headers", "Content-Type, Authorization")
                self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
                self.send_header("Vary", "Origin")
            self.send_header("Content-Length", "0")
            self.send_header("Connection", "close")
            self.end_headers()
            self.close_connection = True

    return Handler


def status(runner: Runner) -> dict[str, Any]:
    """What the page needs before it offers the trigger: is it on, is it busy, what is left."""
    job = runner.current
    return {
        "triggering": bool(runner.environ.get(TOKEN_ENV, "").strip()),
        "key_present": key_present(dict(runner.environ)),
        "busy": runner.busy(),
        "current": job.public() if job is not None else None,
        "claude_row": runner.claude_allowed and not runner.hosted,
        "claude_cli": runner.claude_cli,
        "mode": "hosted" if runner.hosted else "full",
        "capabilities": {**runner.capabilities(), "key_present": key_present(dict(runner.environ))},
        "runs_public": True,
        "run_caps_usd": runner.per_run_caps(),
        "daily": runner.daily(),
        "day": runner.today(),
        "presets": {kind: list(PRESETS[kind]) for kind in runner.kinds()},
    }

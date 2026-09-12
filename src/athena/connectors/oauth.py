"""The delegated grant: an authorization code with PKCE over a one-shot loopback listener.

(README §4; ADR 0021.) The daemon's own routes require the token on every request, and a
provider redirecting a browser cannot carry one, so the callback lands on a listener of its own:
``127.0.0.1:0``, bound for one flow, closed the moment the flow ends or its TTL runs out. The
verifier is minted here and never leaves the process; ``state`` is signed with a per-flow key,
so a callback that is not this flow's is answered with a plain refusal and counted, never
believed. Nothing here seals or probes — the flow hands its code to the vault, which exchanges
it, probes the grant and seals it only if the provider accepted it.
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import secrets
import threading
import time
import urllib.parse
from collections.abc import Callable
from http.server import BaseHTTPRequestHandler, HTTPServer
from typing import Any

from athena.connectors.spec import AuthSpec

__all__ = [
    "FLOW_TTL_S",
    "JUNK_BUDGET",
    "FlowManager",
    "OAuthFlow",
    "build_authorize_url",
    "new_pkce",
]

#: An abandoned consent page must not hold a socket forever.
FLOW_TTL_S = 600.0
#: How many callbacks that are not this flow's are answered before the listener gives up.
JUNK_BUDGET = 32

PHASES: tuple[str, ...] = ("awaiting_consent", "exchanging", "done", "failed")


def _b64url(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).decode("ascii").rstrip("=")


def new_pkce() -> tuple[str, str]:
    verifier = _b64url(secrets.token_bytes(48))
    challenge = _b64url(hashlib.sha256(verifier.encode("ascii")).digest())
    return verifier, challenge


def sign_state(nonce: str, key: bytes) -> str:
    return f"{nonce}.{hmac.new(key, nonce.encode('ascii'), hashlib.sha256).hexdigest()[:32]}"


def verify_state(state: str, key: bytes) -> bool:
    nonce, _, _tag = state.partition(".")
    return bool(nonce) and hmac.compare_digest(sign_state(nonce, key), state)


def build_authorize_url(
    auth: AuthSpec, *, client_id: str, redirect_uri: str, state: str, challenge: str | None
) -> str:
    params: dict[str, str] = {
        "response_type": "code",
        "client_id": client_id,
        "redirect_uri": redirect_uri,
        "scope": " ".join(auth.scopes),
        "state": state,
        **auth.extra_auth_params,
    }
    if challenge is not None:
        params["code_challenge"] = challenge
        params["code_challenge_method"] = "S256"
    return f"{auth.authorize_url}?{urllib.parse.urlencode(params)}"


class OAuthFlow:
    """One consent, from the authorize URL to the code the vault exchanges."""

    def __init__(
        self,
        connector_id: str,
        auth: AuthSpec,
        *,
        client_id: str,
        on_code: Callable[[OAuthFlow, str], str],
        ttl_s: float = FLOW_TTL_S,
    ) -> None:
        self.id = f"flow_{secrets.token_hex(6)}"
        self.connector_id = connector_id
        self.auth = auth
        self.client_id = client_id
        self.verifier, challenge = new_pkce() if auth.pkce else ("", None)
        self._key = secrets.token_bytes(32)
        self.state = sign_state(secrets.token_urlsafe(12), self._key)
        self._on_code = on_code
        self.ttl_s = ttl_s
        self.started = time.monotonic()
        self.phase = "awaiting_consent"
        self.detail = "waiting for the browser"
        self._server = HTTPServer(("127.0.0.1", 0), _make_handler(self))
        self._server.timeout = 0.25
        self.redirect_uri = f"http://127.0.0.1:{self._server.server_address[1]}/callback"
        self.authorize_url = build_authorize_url(
            auth,
            client_id=client_id,
            redirect_uri=self.redirect_uri,
            state=self.state,
            challenge=challenge,
        )
        self._junk = 0
        self._done = threading.Event()
        self._thread = threading.Thread(target=self._run, name=f"oauth-{connector_id}", daemon=True)

    @property
    def port(self) -> int:
        return int(self._server.server_address[1])

    def view(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "connector": self.connector_id,
            "phase": self.phase,
            "detail": self.detail,
            "authorize_url": self.authorize_url if self.phase == "awaiting_consent" else "",
        }

    def start(self) -> OAuthFlow:
        self._thread.start()
        return self

    def cancel(self, detail: str = "cancelled") -> None:
        if self.phase in ("done", "failed"):
            return
        self._set("failed", detail)

    def wait(self, timeout: float | None = None) -> bool:
        return self._done.wait(timeout)

    def _set(self, phase: str, detail: str) -> None:
        self.phase = phase
        self.detail = detail
        if phase in ("done", "failed"):
            self._done.set()

    def accept_callback(self, state: str, code: str | None, error: str | None) -> bool:
        """The listener's one question: is this callback this flow's? Answered and counted."""
        if self.phase != "awaiting_consent" or not verify_state(state, self._key):
            self._junk += 1
            if self._junk >= JUNK_BUDGET:
                self._set("failed", "too many unrelated callbacks; the listener gave up")
            return False
        if error or not code:
            self._set("failed", f"the provider refused: {error or 'no code'}")
            return True
        self._set("exchanging", "exchanging the code for a grant")
        threading.Thread(target=self._finish, args=(code,), daemon=True).start()
        return True

    def _finish(self, code: str) -> None:
        try:
            identity = self._on_code(self, code)
        except Exception as exc:  # the vault's refusal is the detail; never a value
            self._set("failed", str(exc) or type(exc).__name__)
            return
        self._set("done", f"connected as {identity}" if identity else "connected")

    def _run(self) -> None:
        try:
            while not self._done.is_set():
                if time.monotonic() - self.started > self.ttl_s:
                    self._set("failed", "the consent page was not answered in time")
                    break
                self._server.handle_request()
        finally:
            self._server.server_close()


def _make_handler(flow: OAuthFlow) -> type[BaseHTTPRequestHandler]:
    class Callback(BaseHTTPRequestHandler):
        def do_GET(self) -> None:
            url = urllib.parse.urlsplit(self.path)
            query = {k: v[0] for k, v in urllib.parse.parse_qs(url.query).items() if v}
            ours = url.path == "/callback" and flow.accept_callback(
                query.get("state", ""), query.get("code"), query.get("error")
            )
            text = (
                "Athena is connected. You can close this tab."
                if ours and flow.phase != "failed"
                else "This page is not for this flow."
            )
            body = text.encode("utf-8")
            self.send_response(200 if ours else 404)
            self.send_header("Content-Type", "text/plain; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Connection", "close")
            self.end_headers()
            self.wfile.write(body)

        def log_message(self, format: str, *args: Any) -> None:
            return

    return Callback


class FlowManager:
    """The flows in progress, one per connector at most."""

    def __init__(self) -> None:
        self._flows: dict[str, OAuthFlow] = {}
        self._lock = threading.Lock()

    def add(self, flow: OAuthFlow) -> OAuthFlow:
        with self._lock:
            for other in list(self._flows.values()):
                if other.connector_id == flow.connector_id:
                    other.cancel("replaced by a newer flow")
                    del self._flows[other.id]
            self._flows[flow.id] = flow
        return flow.start()

    def get(self, flow_id: str) -> OAuthFlow | None:
        with self._lock:
            return self._flows.get(flow_id)

    def for_connector(self, connector_id: str) -> OAuthFlow | None:
        with self._lock:
            return next((f for f in self._flows.values() if f.connector_id == connector_id), None)

    def cancel_all(self) -> None:
        with self._lock:
            for flow in self._flows.values():
                flow.cancel("the daemon is stopping")
            self._flows.clear()

"""This device as a client of others: the outbound call and the keys it calls with (ADR 0140).

``peers.json`` holds who may call *this* device, and only as fingerprints. The other direction - the
token another PC minted for this one, which this device presents on every call it makes there -
has to be kept in a form that can be presented again, so it cannot be a fingerprint. It is sealed
by the operating system exactly as a connector's credential is (:mod:`athena.connectors.seal`:
DPAPI on Windows), one sealed value per peer, and is never written in plain by anything here.
Where that peer is reached (``http://<overlay-ip>:<port>``) is not a secret and sits beside it in
``$ATHENA_HOME/peer/reach.json``; a credential sealed on one machine opens on that machine only,
which is the seal law (``seal.py``: a copy must never carry credentials).

:func:`call` is the one outbound request: fixed timeout, JSON in and out, ``Authorization: Bearer``
when a token is given, ``Connection: close``. It never logs, and an exception is reduced to its
type before anything reports it, because a message could quote the URL or the body. WP2's puller
and WP3's message relay use it and :class:`PeerKeys` through the host; neither opens a socket of
its own.
"""

from __future__ import annotations

import json
import threading
from collections.abc import Callable
from contextlib import suppress
from dataclasses import dataclass
from http.client import HTTPConnection
from pathlib import Path
from typing import Any
from urllib.parse import urlsplit

from athena.connectors.seal import SealPort, SealUnavailable
from athena.peer.identity import write_whole

__all__ = ["CALL_TIMEOUT_S", "REACH_FILENAME", "CallResult", "PeerKeys", "call"]

CALL_TIMEOUT_S = 5.0
REACH_FILENAME = "reach.json"
#: The largest answer a peer call reads. A peer's JSON is a few kilobytes; this is a cap on a
#: broken or hostile peer, not on an honest one.
MAX_ANSWER_BYTES = 1_048_576


@dataclass(frozen=True)
class CallResult:
    """A peer's answer: the status and the decoded object, or ``status == 0`` and why not."""

    status: int
    body: dict[str, Any]
    failure: str = ""

    @property
    def reached(self) -> bool:
        return self.status != 0


def call(
    base_url: str,
    method: str,
    path: str,
    body: dict[str, Any] | None = None,
    *,
    token: str | None = None,
    timeout: float = CALL_TIMEOUT_S,
) -> CallResult:
    """One request to a peer listener at ``base_url`` (``http://host:port``)."""
    parts = urlsplit(base_url)
    if parts.scheme != "http" or not parts.hostname:
        return CallResult(0, {}, "not an http peer url")
    headers = {"Connection": "close"}
    payload: bytes | None = None
    if body is not None:
        payload = json.dumps(body).encode("utf-8")
        headers["Content-Type"] = "application/json"
    if token:
        headers["Authorization"] = f"Bearer {token}"
    connection = HTTPConnection(parts.hostname, parts.port or 80, timeout=timeout)
    try:
        connection.request(method, path, body=payload, headers=headers)
        reply = connection.getresponse()
        raw = reply.read(MAX_ANSWER_BYTES + 1)
    except (OSError, ValueError) as exc:
        return CallResult(0, {}, type(exc).__name__)
    finally:
        connection.close()
    if len(raw) > MAX_ANSWER_BYTES:
        return CallResult(reply.status, {}, "answer too large")
    try:
        decoded = json.loads(raw) if raw else {}
    except (json.JSONDecodeError, UnicodeDecodeError):
        decoded = {}
    return CallResult(reply.status, decoded if isinstance(decoded, dict) else {})


class PeerKeys:
    """The tokens this device calls other devices with, sealed, and where each one is reached."""

    def __init__(self, root: Path, seal: SealPort | Callable[[], SealPort]) -> None:
        self._seal = seal
        self.reach_path = root / REACH_FILENAME
        self._lock = threading.Lock()
        self._reach = self._load()

    @property
    def seal(self) -> SealPort:
        """The seal, built on first use (a seal's directory is created when it is built)."""
        if callable(self._seal) and not isinstance(self._seal, SealPort):
            self._seal = self._seal()
        assert isinstance(self._seal, SealPort)
        return self._seal

    def keep(self, peer_id: str, url: str, token: str) -> None:
        """Seal ``token`` for ``peer_id`` and remember where that peer listens."""
        with self._lock:
            self.seal.seal(_name(peer_id), token)
            self._reach[peer_id] = url
            write_whole(self.reach_path, self._reach)

    def url(self, peer_id: str) -> str | None:
        with self._lock:
            return self._reach.get(peer_id)

    def token(self, peer_id: str) -> str | None:
        """The sealed token, or ``None``: never kept, destroyed, or the seal would not open."""
        try:
            return self.seal.unseal(_name(peer_id))
        except SealUnavailable:
            return None

    def forget(self, peer_id: str) -> None:
        with self._lock:
            with suppress(SealUnavailable):
                self.seal.destroy(_name(peer_id))
            if self._reach.pop(peer_id, None) is not None:
                write_whole(self.reach_path, self._reach)

    def known(self) -> list[str]:
        with self._lock:
            return sorted(self._reach)

    def _load(self) -> dict[str, str]:
        try:
            data = json.loads(self.reach_path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError, UnicodeDecodeError):
            return {}
        if not isinstance(data, dict):
            return {}
        return {str(k): str(v) for k, v in data.items() if isinstance(v, str)}


def _name(peer_id: str) -> str:
    return f"peer.{peer_id}"

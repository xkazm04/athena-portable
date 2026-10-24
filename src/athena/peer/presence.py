"""Is each paired device there right now: ``presence`` on ``GET /devices`` (ADR 0140).

``last_seen`` says when a peer last called *this* device. It cannot say whether that device is on
now, and a Devices surface drawing a fleet needs that: a lit node for a computer that answers, a
dim one for a computer that is on but has Athena closed, a broken link for one that is gone. So a
background probe asks, every :data:`PRESENCE_EVERY_S`, and keeps one verdict per peer:

``online``
    An authorized ``GET /peer/hello`` - the token the other PC minted for this one, the same
    :func:`~athena.peer.client.call` every peer call goes through - answered ``200`` within
    :data:`HELLO_TIMEOUT_S`. Athena is running there and still trusts this device.
``asleep``
    The hello failed, but the private overlay lists the device's address as online: the machine
    is up and Athena there is closed, or its listener is down because it has nothing to listen
    for. (The same distinction ``probe_peer`` draws for setup as ``athena_asleep``.)
``unreachable``
    Neither: the overlay does not see it either, or there is no overlay to ask.
``None``
    Not probed yet - or not probe-able. A phone has no Athena and no listener to say hello to, so
    a phone's presence is always ``None``. So is a PC this device holds no key for yet (its
    pair-back has not been delivered): without the token there is no authorized hello, and without
    the reach address there is nothing to look up on the overlay.

``presence_at`` is when the current verdict began: the probe that first found the peer in that
state, not the latest probe that confirmed it. That keeps the row and the bus in step - the row
changes only when the verdict does, and every change publishes ``peer.changed`` with the
``peer_id`` (the Devices surface re-reads ``GET /devices`` on it). A pass that changes nothing
publishes nothing.

**When it runs.** :meth:`PresenceProbe.start` is called from :meth:`PeerHost.start
<athena.peer.listener.PeerHost.start>`, the peer lifecycle the served daemon starts once its
loopback socket is bound, and :meth:`PresenceProbe.close` from :meth:`PeerHost.close
<athena.peer.listener.PeerHost.close>`. A pass with no paired peer probes nothing - no hello, no
``tailscale`` - so a device nobody paired with never dials out. A pass's hellos run side by side
(each bounded by the timeout), and the overlay is read at most once per pass, only when a hello
failed. Passes never overlap.

Nothing here logs a URL or a token; a probe's failure is just a verdict.
"""

from __future__ import annotations

import threading
from collections.abc import Callable
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime
from typing import TYPE_CHECKING, Any, Literal
from urllib.parse import urlsplit

from athena.peer.client import call
from athena.peer.identity import now_iso
from athena.peer.listener import _log
from athena.peer.overlay import _find_tailscale, _run

if TYPE_CHECKING:
    from athena.peer.listener import PeerHost

__all__ = [
    "HELLO_TIMEOUT_S",
    "PRESENCE_EVERY_S",
    "Hello",
    "OverlayOnline",
    "Presence",
    "PresenceProbe",
    "authorized_hello",
    "overlay_online",
]

PRESENCE_EVERY_S = 30.0
HELLO_TIMEOUT_S = 3.0
#: The most hellos one pass has in flight at once.
MAX_PARALLEL = 8

Presence = Literal["online", "asleep", "unreachable"]
#: ``(base_url, token) -> answered``: did an authorized hello come back ``200``?
Hello = Callable[[str, str], bool]
#: The overlay addresses listed online right now, or ``None`` when there is no overlay to ask.
OverlayOnline = Callable[[], frozenset[str] | None]


def authorized_hello(base_url: str, token: str) -> bool:
    """``GET /peer/hello`` with this device's key for that peer, within :data:`HELLO_TIMEOUT_S`."""
    return call(base_url, "GET", "/peer/hello", token=token, timeout=HELLO_TIMEOUT_S).status == 200


def overlay_online() -> frozenset[str] | None:
    """The IPv4 overlay addresses ``tailscale status --json`` lists as online.

    ``None`` with no ``tailscale`` or no answer from it; an empty set when it is logged out. The
    document is read by setup's own :func:`~athena.peer.setup.parse_status`, imported here at
    call time because setup reaches into the core and the gate, which the listener need not load.
    """
    binary = _find_tailscale()
    if binary is None:
        return None
    text = _run([binary, "status", "--json"])
    if text is None:
        return None
    from athena.peer.setup import parse_status

    status = parse_status(text)
    if not status.logged_in:
        return frozenset()
    return frozenset(peer.ip for peer in status.peers if peer.online and peer.ip)


class PresenceProbe:
    """One verdict per paired peer, refreshed every :attr:`every_s` while the host runs."""

    def __init__(
        self,
        host: PeerHost,
        *,
        hello: Hello = authorized_hello,
        overlay: OverlayOnline = overlay_online,
        every_s: float = PRESENCE_EVERY_S,
        now: Callable[[], datetime] | None = None,
    ) -> None:
        self.host = host
        self.hello = hello
        self.overlay = overlay
        self.every_s = every_s
        self._now = now or host.now
        self._lock = threading.Lock()
        self._pass = threading.Lock()
        #: ``peer_id -> (verdict, when it began)``. A peer never probed has no entry.
        self._seen: dict[str, tuple[Presence, str]] = {}
        self._stop = threading.Event()
        self._thread: threading.Thread | None = None

    # -- what GET /devices shows ---------------------------------------------------------------

    def view(self, peer_id: str) -> dict[str, Any]:
        """``{presence, presence_at}`` for one peer; both ``None`` before its first verdict."""
        with self._lock:
            seen = self._seen.get(peer_id)
        if seen is None:
            return {"presence": None, "presence_at": None}
        return {"presence": seen[0], "presence_at": seen[1]}

    # -- the loop ------------------------------------------------------------------------------

    def start(self) -> None:
        """Probe now, then every :attr:`every_s` until :meth:`close`."""
        if self._thread is not None:
            return
        self._thread = threading.Thread(target=self._run, name="peer-presence", daemon=True)
        self._thread.start()

    def close(self, timeout: float = 5.0) -> None:
        self._stop.set()
        thread = self._thread
        if thread is not None and thread is not threading.current_thread():
            thread.join(timeout=timeout)

    def _run(self) -> None:
        while not self._stop.is_set():
            try:
                self.probe_all()
            except Exception as exc:  # a pass's bug must not end the loop
                _log(f"presence pass raised {type(exc).__name__}")
            if self._stop.wait(self.every_s):
                return

    # -- one pass ------------------------------------------------------------------------------

    def probe_all(self) -> list[str]:
        """Probe every probe-able peer once; publish and return the ids whose verdict changed."""
        with self._pass:
            rows = self.host.registry.rows()
            with self._lock:  # a revoked or expired peer's verdict goes with its row
                for gone in set(self._seen) - {row.peer_id for row in rows}:
                    del self._seen[gone]
            targets: list[tuple[str, str, str]] = []
            for row in rows:
                if row.kind != "pc":
                    continue  # a phone has no listener to say hello to
                url = self.host.keys.url(row.peer_id)
                token = self.host.keys.token(row.peer_id) if url else None
                if url and token:
                    targets.append((row.peer_id, url, token))
            if not targets:
                return []
            with ThreadPoolExecutor(max_workers=min(MAX_PARALLEL, len(targets))) as pool:
                answered = list(pool.map(lambda t: self.hello(t[1], t[2]), targets))
            online: frozenset[str] | None = None
            if not all(answered):
                online = self.overlay()
            changed: list[str] = []
            for (peer_id, url, _), ok in zip(targets, answered, strict=True):
                verdict: Presence = "online"
                if not ok:
                    address = urlsplit(url).hostname
                    seen = online is not None and address is not None and address in online
                    verdict = "asleep" if seen else "unreachable"
                if self._record(peer_id, verdict):
                    changed.append(peer_id)
        for peer_id in changed:
            self.host.publish("peer.changed", peer_id=peer_id)
        return changed

    def _record(self, peer_id: str, verdict: Presence) -> bool:
        with self._lock:
            before = self._seen.get(peer_id)
            if before is not None and before[0] == verdict:
                return False
            self._seen[peer_id] = (verdict, now_iso(self._now()))
            return True

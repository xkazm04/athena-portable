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
    The hello was not answered, but the private overlay lists the device's address as online:
    the machine is up and Athena there is closed, or its listener is down because it has nothing
    to listen for. (The same distinction ``probe_peer`` draws for setup as ``athena_asleep``.)
``unreachable``
    Neither: the overlay does not see it either, or there is no overlay to ask.
``None``
    Refused: a hello answered ``401`` means the other PC removed this one, which is neither sleep
    nor a broken network, so presence claims nothing and ``link`` says ``removed_there``.
    Otherwise not probed yet - or not probe-able. A phone has no Athena and no listener to say
    hello to, so a phone's presence is always ``None``. So is a PC this device holds no key for
    yet (its pair-back has not been delivered): without the token there is no authorized hello,
    and without the reach address there is nothing to look up on the overlay.

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

**A hello carries the peer's vitals (ADR 0143).** The authorized hello answers with the other PC's
``vitals`` snapshot - its room, slots and held reason, what it measured - and the probe keeps the
latest per peer with the moment it arrived (:meth:`PresenceProbe.vitals`). A snapshot older than
:data:`~athena.vitals.VITALS_STALE_S` is not shown or told: a stale "room ok" is worse than none.
A peer's ``peer.changed`` fires when its verdict changes *or* its ``room`` or ``held`` does - not
on every number, which moves on every hello. This PC's own snapshot reaches its hello and its
``GET /devices`` through :attr:`PresenceProbe.own_vitals`, which the vitals service sets.

**One link state (ADR 0140 "Link state").** The probe also keeps what each hello *said* - its
status, when that outcome began, when it was last confirmed, and whether the overlay listed the
address - and :meth:`PresenceProbe.view` hands that, the row and whether a key is held to
:func:`athena.peer.link.derive`, the one place a link's state is decided. ``view`` carries the
result as ``link`` ``{state, since, evidence}``. A pass publishes ``peer.changed`` when the link's
state moves too, so a peer that starts refusing this device is news exactly once.

Nothing here logs a URL or a token; a probe's failure is just a verdict.
"""

from __future__ import annotations

import threading
from collections.abc import Callable, Mapping
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime
from typing import TYPE_CHECKING, Any, Literal
from urllib.parse import urlsplit

from athena.peer.client import call
from athena.peer.identity import now_iso
from athena.peer.link import HelloSeen, derive, state_of
from athena.peer.listener import _log
from athena.peer.overlay import _find_tailscale, _run
from athena.vitals import VITALS_STALE_S, VitalsView
from athena.vitals.gate import clean_view

if TYPE_CHECKING:
    from athena.peer.listener import PeerHost

__all__ = [
    "HELLO_TIMEOUT_S",
    "PRESENCE_EVERY_S",
    "Hello",
    "HelloAnswer",
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
#: ``(status, body)``: the hello's HTTP status (``0`` when it was not reached) and its body when
#: that status was ``200``, else ``None``.
HelloAnswer = tuple[int, Mapping[str, Any] | None]
#: ``(base_url, token) -> answer``. A plain body (``200``) or ``None`` (not reached) is read as
#: the same answer, so a hello that cannot tell a refusal from silence still works - it just
#: never earns ``removed_there``.
Hello = Callable[[str, str], HelloAnswer | Mapping[str, Any] | None]
#: The overlay addresses listed online right now, or ``None`` when there is no overlay to ask.
OverlayOnline = Callable[[], frozenset[str] | None]


def authorized_hello(base_url: str, token: str) -> HelloAnswer:
    """``GET /peer/hello`` with this device's key for that peer, within :data:`HELLO_TIMEOUT_S`:
    ``(status, body)``, the body only when it answered ``200``. A ``401`` is kept apart from a
    timeout (status ``0``): it is the other PC saying it removed this one."""
    answer = call(base_url, "GET", "/peer/hello", token=token, timeout=HELLO_TIMEOUT_S)
    return answer.status, (answer.body if answer.status == 200 else None)


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
        #: ``peer_id -> what its hello last said`` (status, since, at, overlay): link evidence.
        self._hellos: dict[str, HelloSeen] = {}
        #: PCs with a reach address whose sealed key would not open on the last pass.
        self._unkeyed: set[str] = set()
        #: ``peer_id -> (its vitals off the last hello that answered, when that was)``.
        self._vitals: dict[str, tuple[VitalsView | None, datetime]] = {}
        #: This PC's own snapshot, for its hello and its ``GET /devices`` (the vitals service
        #: sets it; ``None`` until then, and on a daemon with no vitals).
        self.own_vitals: Callable[[], VitalsView | None] = lambda: None
        self._stop = threading.Event()
        self._thread: threading.Thread | None = None

    # -- what GET /devices shows ---------------------------------------------------------------

    def view(self, peer_id: str, memory: Mapping[str, Any] | None = None) -> dict[str, Any]:
        """``{presence, presence_at, vitals, link}`` for one peer; ``None`` before its first
        verdict, and ``vitals`` ``None`` too when it is stale (:meth:`vitals`). ``link`` is
        :meth:`link`, given the puller's ``memory`` view when the caller has it."""
        with self._lock:
            seen = self._seen.get(peer_id)
        vitals = self.vitals(peer_id)
        link = self.link(peer_id, memory)
        if seen is None:
            return {"presence": None, "presence_at": None, "vitals": vitals, "link": link}
        return {"presence": seen[0], "presence_at": seen[1], "vitals": vitals, "link": link}

    def link(self, peer_id: str, memory: Mapping[str, Any] | None = None) -> dict[str, Any] | None:
        """``{state, since, evidence}`` (:func:`athena.peer.link.derive`), or ``None`` for a
        device with no row: a revoked peer's link goes with it."""
        row = self.host.registry.get(peer_id)
        if row is None:
            return None
        with self._lock:
            hello = self._hellos.get(peer_id)
            unkeyed = peer_id in self._unkeyed
        keyed = row.kind == "pc" and not unkeyed and self.host.keys.url(peer_id) is not None
        return derive(row, keyed, hello, memory=memory, now=self._now(), every_s=self.every_s)

    def vitals(self, peer_id: str) -> VitalsView | None:
        """The peer's last vitals, or ``None``: never heard, or heard more than
        :data:`~athena.vitals.VITALS_STALE_S` ago. A phone says no hello, so it has none."""
        with self._lock:
            kept = self._vitals.get(peer_id)
        if kept is None or kept[0] is None:
            return None
        if (self._now() - kept[1]).total_seconds() > VITALS_STALE_S:
            return None
        return kept[0]

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
            live = {row.peer_id for row in rows}
            with self._lock:  # a revoked or expired peer's verdict goes with its row
                self._seen = {k: v for k, v in self._seen.items() if k in live}
                self._vitals = {k: v for k, v in self._vitals.items() if k in live}
                self._hellos = {k: v for k, v in self._hellos.items() if k in live}
                self._unkeyed &= live
            targets: list[tuple[str, str, str]] = []
            for row in rows:
                if row.kind != "pc":
                    continue  # a phone has no listener to say hello to
                url = self.host.keys.url(row.peer_id)
                token = self.host.keys.token(row.peer_id) if url else None
                with self._lock:
                    if url and not token:
                        self._unkeyed.add(row.peer_id)
                    else:
                        self._unkeyed.discard(row.peer_id)
                if url and token:
                    targets.append((row.peer_id, url, token))
            if not targets:
                return []
            with ThreadPoolExecutor(max_workers=min(MAX_PARALLEL, len(targets))) as pool:
                answered = list(pool.map(lambda t: self._say_hello(t[1], t[2]), targets))
            online: frozenset[str] | None = None
            if any(status not in (200, 401) for status, _ in answered):
                online = self.overlay()
            changed: list[str] = []
            for (peer_id, url, _), (status, body) in zip(targets, answered, strict=True):
                verdict: Presence | None = "online"
                listed: bool | None = None
                if status == 401:
                    verdict = None  # it removed this device: not asleep, not unreachable
                elif status != 200:
                    address = urlsplit(url).hostname
                    if online is not None:
                        listed = address is not None and address in online
                    verdict = "asleep" if listed else "unreachable"
                moved = self._record(peer_id, verdict)
                moved = self._observe(peer_id, status, listed) or moved
                if body is not None:
                    moved = self._keep_vitals(peer_id, clean_view(body.get("vitals"))) or moved
                if moved:
                    changed.append(peer_id)
        for peer_id in changed:
            self.host.publish("peer.changed", peer_id=peer_id)
        return changed

    def _say_hello(self, url: str, token: str) -> HelloAnswer:
        """One hello as ``(status, body)``; a raise is a hello that was not reached."""
        try:
            said = self.hello(url, token)
        except Exception:
            return 0, None
        if isinstance(said, Mapping):
            return 200, said
        if isinstance(said, tuple) and len(said) == 2 and isinstance(said[0], int):
            status, body = said
            return status, (body if status == 200 and isinstance(body, Mapping) else None)
        return 0, None

    def _observe(self, peer_id: str, status: int, listed: bool | None) -> bool:
        """Keep what the hello said; ``True`` when the link's state moved. ``since`` holds while
        the state does, so it is when the state began and ``at`` is the latest confirmation."""
        at = now_iso(self._now())
        with self._lock:
            before = self._hellos.get(peer_id)
            fresh = HelloSeen(status, at, at, listed)
            moved = before is None or state_of(before) != state_of(fresh)
            since = at if before is None or moved else before.since
            self._hellos[peer_id] = HelloSeen(status, since, at, listed)
        return moved

    def _keep_vitals(self, peer_id: str, vitals: VitalsView | None) -> bool:
        """Keep the vitals a hello carried; ``True`` when the peer's room or held reason moved
        (or it started or stopped sending any), which is what a ``peer.changed`` is worth."""
        with self._lock:
            before = self._vitals.get(peer_id)
            self._vitals[peer_id] = (vitals, self._now())
        old = before[0] if before is not None else None

        def said(view: VitalsView | None) -> tuple[Any, Any] | None:
            return None if view is None else (view["room"], view["held"])

        return said(old) != said(vitals)

    def _record(self, peer_id: str, verdict: Presence | None) -> bool:
        with self._lock:
            before = self._seen.get(peer_id)
            if verdict is None:
                return self._seen.pop(peer_id, None) is not None
            if before is not None and before[0] == verdict:
                return False
            self._seen[peer_id] = (verdict, now_iso(self._now()))
            return True

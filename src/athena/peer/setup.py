"""The setup leg's executors: fixed command lines and probes behind the gate (ADR 0140, WP4).

The core states the policy (:mod:`athena.core.setup`: seven names, each one's class, where they may
be called). This module is how each one runs, and it is held to one rule above all: **no string a
model wrote ever reaches a command line.** Every command is an argv list fixed in this file. The
only parameters the setup names take are an enum (``open_pairing``'s ``kind``) and an IP address
the gate has already checked is on the private overlay (``probe_peer``'s ``peer_ip``), and the
address is only ever *dialled*, never passed to a process. The peer port in the firewall rule is
this host's own integer; the sign-in URL that is opened in the browser comes from ``tailscale``'s
own status and is opened only when it is an ``https`` address on ``tailscale.com``.

What each one does (Windows only for the three that change the machine; on another platform they
answer :data:`NOT_HERE` and run nothing):

``overlay_status`` (READ)
    ``{installed, logged_in, ip, tailnet_name}`` from ``tailscale status --json``.
``list_overlay_peers`` (READ)
    The other devices in the tailnet, online or not, and for each online one whether an Athena
    peer listener answers on the peer port - an unauthenticated ``GET /peer/hello``, which the
    listener answers ``401 unauthorized``: "Athena is there". Bounded, with ``(showing N of M)``.
``probe_peer`` (READ)
    One of ``no_overlay``, ``logged_out``, ``peer_unreachable``, ``athena_asleep``, ``ok``.
    ``athena_asleep`` is "the device is online but nothing answers on the peer port": Athena is
    closed there, or it is open with nothing to listen for yet (no pairing, no beacon) - the
    listener is off until trust exists, by design.
``install_overlay`` (GATED)
    ``winget install --id Tailscale.Tailscale -e --accept-source-agreements
    --accept-package-agreements``, started and not waited for: it outlives the decision request,
    and ``overlay_status`` says when it is done.
``overlay_login`` (GATED)
    ``tailscale login`` started, then the sign-in URL read back from ``tailscale status --json``
    and opened in the default browser.
``firewall_allow`` (GATED)
    One inbound rule, ``Athena peer``, TCP on the peer port, from ``100.64.0.0/10`` only. Checked
    first (``netsh advfirewall firewall show rule``), added only when missing, through an elevated
    ``netsh`` (Windows asks the person - their consent, on their screen), and checked again.
``open_pairing`` (GATED)
    Opens a window exactly as ``POST /devices/pairing`` does. The answer carries the code for a
    PC - a person reads it out, and it dies with the five-minute window - and **never** the phone
    URL: its nonce is a claim credential, and a tool's answer is recorded as an episode, which
    replicates. The window, its code and its QR URL go to this device's own window instead, on the
    loopback ``/events`` bus as ``pair.opened``.

``setup_phase`` - the peer ``hello`` field WP1 left ``null`` - is filled from :class:`SetupState`
once this device's person has opened a setup conversation, so a paired device (or the phone) can
say what this one is waiting for.
"""

from __future__ import annotations

import json
import subprocess
import sys
import threading
import time
import webbrowser
from collections.abc import Callable, Mapping, Sequence
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, replace
from datetime import datetime
from typing import TYPE_CHECKING, Any, Protocol
from urllib.parse import urlsplit

from athena.contracts.registry import ExecResult, ExecutorFn, TurnContext
from athena.core.setup import SETUP_APP_ID, SETUP_ID, SETUP_SESSION_ORIGIN
from athena.daemon.routes import Reply, Request, Route
from athena.harness.transports import NO_WINDOW
from athena.peer.classify import peer_class
from athena.peer.client import call
from athena.peer.identity import now_iso
from athena.peer.overlay import _find_tailscale
from athena.peer.registry import KINDS

if TYPE_CHECKING:
    from athena.daemon.server import AthenaDaemon
    from athena.harness.policy import ConnectorStatePort
    from athena.peer.listener import PeerHost

__all__ = [
    "FIREWALL_RULE",
    "NOT_HERE",
    "PEER_LIMIT",
    "PROBE_STATES",
    "CommandRunner",
    "Ran",
    "SetupLive",
    "SetupState",
    "SetupTools",
    "SubprocessRunner",
    "firewall_add_argv",
    "firewall_show_argv",
    "knock",
    "overlay_peers",
    "setup_routes",
    "wire_setup",
]

#: The answer of a machine-changing setup verb on a platform it has no command for.
NOT_HERE = "not on this computer yet: setup runs on Windows"
#: The firewall rule's name, which is also how it is found again.
FIREWALL_RULE = "Athena peer"
#: The overlay's IPv4 block, the only remote addresses the rule admits.
FIREWALL_REMOTE = "100.64.0.0/10"
WINGET_ARGV: tuple[str, ...] = (
    "winget",
    "install",
    "--id",
    "Tailscale.Tailscale",
    "-e",
    "--accept-source-agreements",
    "--accept-package-agreements",
)
PROBE_STATES: tuple[str, ...] = (
    "no_overlay",
    "logged_out",
    "peer_unreachable",
    "athena_asleep",
    "ok",
)
#: The most peers ``list_overlay_peers`` names before it announces the rest.
PEER_LIMIT = 20
KNOCK_TIMEOUT_S = 1.5
STATUS_TIMEOUT_S = 5.0
#: How long the elevated ``netsh`` may wait on the person's answer to Windows' prompt.
ELEVATED_TIMEOUT_S = 120.0
#: How long ``overlay_login`` looks for the sign-in URL after starting the login.
LOGIN_WAIT_S = 8.0
LOGIN_POLL_S = 0.5


# --- running commands ---------------------------------------------------------------------------


@dataclass(frozen=True)
class Ran:
    """A finished command: its exit code and what it printed."""

    code: int
    stdout: str = ""


class CommandRunner(Protocol):
    """How a fixed argv is run. The real one is :class:`SubprocessRunner`; a test records argv."""

    def run(self, argv: Sequence[str], timeout: float) -> Ran | None:
        """Run to completion. ``None`` when it could not be started or did not finish in time."""
        ...

    def spawn(self, argv: Sequence[str]) -> bool:
        """Start and do not wait. ``True`` when it started."""
        ...


class SubprocessRunner:
    """``subprocess`` with no shell, no window, and the exception reduced to "it did not run"."""

    def run(self, argv: Sequence[str], timeout: float) -> Ran | None:
        try:
            done = subprocess.run(
                list(argv),
                capture_output=True,
                text=True,
                timeout=timeout,
                check=False,
                creationflags=NO_WINDOW,
            )
        except (OSError, subprocess.SubprocessError):
            return None
        return Ran(done.returncode, done.stdout or "")

    def spawn(self, argv: Sequence[str]) -> bool:
        try:
            subprocess.Popen(
                list(argv),
                stdin=subprocess.DEVNULL,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
                creationflags=NO_WINDOW,
            )
        except (OSError, subprocess.SubprocessError):
            return False
        return True


def firewall_show_argv() -> list[str]:
    return ["netsh", "advfirewall", "firewall", "show", "rule", f"name={FIREWALL_RULE}"]


def firewall_add_argv(port: int) -> list[str]:
    """The elevated ``netsh`` that adds the rule. ``port`` is the host's own integer."""
    rule = (
        f'advfirewall firewall add rule name="{FIREWALL_RULE}" dir=in action=allow '
        f"protocol=TCP localport={int(port)} remoteip={FIREWALL_REMOTE}"
    )
    command = (
        "Start-Process -FilePath netsh -Verb RunAs -Wait -WindowStyle Hidden "
        f"-ArgumentList '{rule}'"
    )
    return ["powershell", "-NoProfile", "-NonInteractive", "-Command", command]


def knock(ip: str, port: int) -> bool:
    """Does an Athena peer listener answer at ``ip:port``? Unauthenticated: a 401 is a yes."""
    host = f"[{ip}]" if ":" in ip else ip
    answer = call(f"http://{host}:{port}", "GET", "/peer/hello", timeout=KNOCK_TIMEOUT_S)
    return answer.status == 401 and answer.body.get("error") == "unauthorized"


# --- the overlay, as setup reads it -------------------------------------------------------------


@dataclass(frozen=True)
class Peer:
    name: str
    ip: str | None
    os: str
    online: bool


@dataclass(frozen=True)
class Status:
    """What ``tailscale status --json`` said, or that there was nothing to ask."""

    installed: bool
    logged_in: bool = False
    ip: str | None = None
    tailnet_name: str | None = None
    auth_url: str | None = None
    peers: tuple[Peer, ...] = ()


def _v4(addresses: object) -> str | None:
    if not isinstance(addresses, list):
        return None
    for item in addresses:
        if isinstance(item, str) and "." in item and peer_class(item) == "overlay":
            return item
    return None


def parse_status(text: str) -> Status:
    """A ``tailscale status --json`` document, read defensively: anything odd is "not there"."""
    try:
        data = json.loads(text)
    except (json.JSONDecodeError, TypeError):
        return Status(installed=True)
    if not isinstance(data, dict):
        return Status(installed=True)
    me = data.get("Self") if isinstance(data.get("Self"), dict) else {}
    tailnet = data.get("CurrentTailnet") if isinstance(data.get("CurrentTailnet"), dict) else {}
    name = tailnet.get("Name") if isinstance(tailnet, dict) else None
    auth = data.get("AuthURL")
    peers: list[Peer] = []
    raw_peers = data.get("Peer")
    if isinstance(raw_peers, dict):
        for row in raw_peers.values():
            if not isinstance(row, dict):
                continue
            peers.append(
                Peer(
                    name=str(row.get("HostName") or row.get("DNSName") or "a device")[:64],
                    ip=_v4(row.get("TailscaleIPs")),
                    os=str(row.get("OS") or "")[:24],
                    online=row.get("Online") is True,
                )
            )
    peers.sort(key=lambda p: (not p.online, p.name.lower()))
    return Status(
        installed=True,
        logged_in=data.get("BackendState") == "Running",
        ip=_v4(me.get("TailscaleIPs")) if isinstance(me, dict) else None,
        tailnet_name=name if isinstance(name, str) and name else None,
        auth_url=auth if isinstance(auth, str) and auth else None,
        peers=tuple(peers),
    )


def _sign_in_url(url: str | None) -> str | None:
    """The URL, when it is Tailscale's own ``https`` sign-in page; ``None`` for anything else."""
    if not url:
        return None
    try:
        parts = urlsplit(url)
    except ValueError:
        return None
    host = (parts.hostname or "").lower()
    if parts.scheme != "https" or not (host == "tailscale.com" or host.endswith(".tailscale.com")):
        return None
    return url


def _answer(payload: Mapping[str, Any], *, ok: bool = True, reason: str = "") -> ExecResult:
    text = json.dumps(dict(payload), sort_keys=True)
    return ExecResult(ok=True, output=text) if ok else ExecResult.failure(reason, text)


# --- the executors ------------------------------------------------------------------------------


class SetupTools:
    """The seven setup executors over one peer host; everything that touches the OS is injected."""

    def __init__(
        self,
        host: PeerHost,
        *,
        runner: CommandRunner | None = None,
        knock: Callable[[str, int], bool] = knock,
        opener: Callable[[str], object] = webbrowser.open,
        platform: str = sys.platform,
        binary: Callable[[], str | None] = _find_tailscale,
        sleep: Callable[[float], None] = time.sleep,
    ) -> None:
        self.host = host
        self.runner: CommandRunner = runner or SubprocessRunner()
        self.knock = knock
        self.opener = opener
        self.windows = platform == "win32"
        self.binary = binary
        self.sleep = sleep

    def executors(self) -> dict[str, ExecutorFn]:
        return {
            "overlay_status": self.overlay_status,
            "list_overlay_peers": self.list_overlay_peers,
            "probe_peer": self.probe_peer,
            "install_overlay": self.install_overlay,
            "overlay_login": self.overlay_login,
            "firewall_allow": self.firewall_allow,
            "open_pairing": self.open_pairing,
        }

    # -- reading the overlay -------------------------------------------------------------------

    def status(self) -> tuple[str | None, Status]:
        binary = self.binary()
        if binary is None:
            return None, Status(installed=False)
        ran = self.runner.run([binary, "status", "--json"], STATUS_TIMEOUT_S)
        # ``status --json`` exits non-zero when logged out and still prints the document.
        if ran is None or not ran.stdout.strip():
            return binary, Status(installed=True)
        return binary, parse_status(ran.stdout)

    def overlay_status(self, params: dict[str, Any], ctx: TurnContext) -> ExecResult:
        _, status = self.status()
        return _answer(
            {
                "installed": status.installed,
                "logged_in": status.logged_in,
                "ip": status.ip,
                "tailnet_name": status.tailnet_name,
            }
        )

    def list_overlay_peers(self, params: dict[str, Any], ctx: TurnContext) -> ExecResult:
        _, status = self.status()
        if not status.installed:
            return _answer({"state": "no_overlay", "peers": []})
        if not status.logged_in:
            return _answer({"state": "logged_out", "peers": []})
        shown = list(status.peers[:PEER_LIMIT])
        port = self.host.port
        knocked: dict[str, bool] = {}
        targets = [p.ip for p in shown if p.online and p.ip]
        if targets:
            with ThreadPoolExecutor(max_workers=min(8, len(targets))) as pool:
                for ip, answered in zip(
                    targets, pool.map(lambda ip: self.knock(ip, port), targets), strict=True
                ):
                    knocked[ip] = answered
        rows = [
            json.dumps(
                {
                    "name": p.name,
                    "ip": p.ip,
                    "os": p.os,
                    "online": p.online,
                    "athena": knocked.get(p.ip) if p.ip and p.online else None,
                },
                sort_keys=True,
            )
            for p in status.peers
        ]
        return ExecResult.bounded(rows, PEER_LIMIT) if rows else _answer({"peers": []})

    def probe_peer(self, params: dict[str, Any], ctx: TurnContext) -> ExecResult:
        ip = str(params.get("peer_ip", "")).strip()
        if peer_class(ip) != "overlay":  # the gate checked; a second look costs nothing
            return ExecResult.failure(
                "validator_failed", "peer_ip is not a private-network address"
            )
        _, status = self.status()
        peer = next((p for p in status.peers if p.ip == ip), None)
        if not status.installed:
            state = "no_overlay"
        elif not status.logged_in:
            state = "logged_out"
        elif peer is None or not peer.online:
            state = "peer_unreachable"
        elif self.knock(ip, self.host.port):
            state = "ok"
        else:
            state = "athena_asleep"
        return _answer({"state": state, "name": peer.name if peer else None, "ip": ip})

    # -- changing this machine -----------------------------------------------------------------

    def install_overlay(self, params: dict[str, Any], ctx: TurnContext) -> ExecResult:
        if not self.windows:
            return _answer({"state": "not_here", "detail": NOT_HERE}, ok=False, reason="unknown")
        if self.binary() is not None:
            return _answer({"state": "already_installed"})
        if not self.runner.spawn(list(WINGET_ARGV)):
            return _answer(
                {"state": "failed", "detail": "the Windows package manager (winget) did not start"},
                ok=False,
                reason="engine_error",
            )
        return _answer(
            {"state": "started", "detail": "installing; overlay_status says when it is done"}
        )

    def overlay_login(self, params: dict[str, Any], ctx: TurnContext) -> ExecResult:
        if not self.windows:
            return _answer({"state": "not_here", "detail": NOT_HERE}, ok=False, reason="unknown")
        binary, status = self.status()
        if binary is None:
            return _answer(
                {"state": "no_overlay", "detail": "install Tailscale first"},
                ok=False,
                reason="validator_failed",
            )
        if status.logged_in:
            return _answer({"state": "already_signed_in"})
        if not self.runner.spawn([binary, "login"]):
            return _answer(
                {"state": "failed", "detail": "Tailscale's sign-in did not start"},
                ok=False,
                reason="engine_error",
            )
        waited = 0.0
        url = _sign_in_url(status.auth_url)
        while url is None and waited < LOGIN_WAIT_S:
            self.sleep(LOGIN_POLL_S)
            waited += LOGIN_POLL_S
            url = _sign_in_url(self.status()[1].auth_url)
        if url is None:
            return _answer(
                {"state": "started", "detail": "the sign-in started; Tailscale opens its own page"}
            )
        self.opener(url)
        return _answer({"state": "opened", "detail": "the sign-in page is open in the browser"})

    def firewall_allow(self, params: dict[str, Any], ctx: TurnContext) -> ExecResult:
        if not self.windows:
            return _answer({"state": "not_here", "detail": NOT_HERE}, ok=False, reason="unknown")
        if self._rule_exists():
            return _answer({"state": "already_allowed", "port": self.host.port})
        self.runner.run(firewall_add_argv(self.host.port), ELEVATED_TIMEOUT_S)
        if self._rule_exists():
            return _answer({"state": "allowed", "port": self.host.port})
        return _answer(
            {"state": "not_allowed", "detail": "the rule was not added; Windows may have said no"},
            ok=False,
            reason="engine_error",
        )

    def _rule_exists(self) -> bool:
        ran = self.runner.run(firewall_show_argv(), STATUS_TIMEOUT_S)
        return ran is not None and ran.code == 0 and FIREWALL_RULE in ran.stdout

    def open_pairing(self, params: dict[str, Any], ctx: TurnContext) -> ExecResult:
        kind = params.get("kind")
        if kind not in KINDS:
            return ExecResult.failure("validator_failed", "kind must be pc or phone")
        host = self.host
        record = host.pairings.open_window(str(kind))
        host.reconcile()
        base = host.base_url()
        expires_at = record.pending_view()["expires_at"]
        # The code and the QR URL go to this device's own window only (loopback /events).
        # ``device_kind``, not ``kind``: the bus stamps every frame's ``kind`` with the event's own
        # name, which would overwrite a field of that name and leave the window not knowing
        # whether to show a code or a phone address.
        host.publish(
            "pair.opened",
            pairing_id=record.pairing_id,
            device_kind=record.kind,
            code=record.code,
            url=f"{base}/m/#claim={record.pairing_id}.{record.nonce}" if base else None,
            expires_at=expires_at,
        )
        answer: dict[str, Any] = {
            "state": "open",
            "kind": record.kind,
            "expires_at": expires_at,
            "listening": base is not None,
        }
        if record.kind == "pc":
            answer["code"] = record.code
        else:
            answer["detail"] = "the QR code is on the Devices page; scan it with the phone"
        return _answer(answer)


# --- the setup conversation and its phase -------------------------------------------------------


#: How long "Set up with Athena" keeps this device's peer listener up with nothing paired and no
#: window open: long enough to walk to the other computer and press it there too, so each probe
#: finds Athena on the other one. A stranger gets 401 from everything but the pairing steps.
SETUP_LISTEN_S = 30 * 60


class SetupState:
    """Whether this device's person opened a setup conversation, and what it is waiting for."""

    def __init__(self, host: PeerHost) -> None:
        self.host = host
        self._lock = threading.Lock()
        self.opened_at: datetime | None = None

    def opened(self) -> None:
        with self._lock:
            self.opened_at = self.host.now()
        # Up now, not at the next tick: the other computer's probe may already be asking.
        self.host.reconcile()

    def listening(self) -> bool:
        """Was a setup conversation opened here in the last :data:`SETUP_LISTEN_S` seconds?"""
        with self._lock:
            opened = self.opened_at
        return opened is not None and (self.host.now() - opened).total_seconds() < SETUP_LISTEN_S

    def phase(self) -> str | None:
        """``null`` until a setup conversation was opened here, then one word.

        ``installing`` (no overlay), ``signing_in`` (logged out), ``approving`` (a device waits for
        this device's person), ``waiting`` (this device waits on another's person), ``pairing`` (a
        window is open), ``paired`` (at least one peer), ``ready`` (set up, nothing paired yet).
        """
        with self._lock:
            if self.opened_at is None:
                return None
        host = self.host
        state = host.overlay().state
        if state == "absent":
            return "installing"
        if state == "logged_out":
            return "signing_in"
        if host.pairings.pending():
            return "approving"
        if any(join.get("state") == "pending" for join in host.join_views()):
            return "waiting"
        if host.pairings.window_open():
            return "pairing"
        if host.registry.live_count() > 0:
            return "paired"
        return "ready"


def open_setup(daemon: AthenaDaemon, state: SetupState, tools: int) -> Reply:
    """``POST /devices/setup``: open (or reopen) the setup conversation's session."""
    session = daemon.sessions.touch(SETUP_SESSION_ORIGIN, SETUP_APP_ID, tools=tools)
    state.opened()
    return 200, {
        "ok": True,
        "origin": session.origin,
        "conversation_id": session.conversation_id,
        "phase": state.phase(),
        "opened_at": now_iso(state.opened_at) if state.opened_at else None,
    }


def setup_routes(daemon: AthenaDaemon, state: SetupState, tools: int) -> list[Route]:
    """The loopback route the Devices page's "Set up with Athena" calls."""

    def answer(request: Request) -> Reply:
        return open_setup(daemon, state, tools)

    return [Route("POST", "/devices/setup", answer)]


def overlay_peers(tools: SetupTools) -> Reply:
    """``GET /devices/overlay``: the other devices on the private network, for the join form.

    The "I have a code" form needs the first computer's overlay address, and a person who is not
    technical does not know it. This is ``list_overlay_peers`` without the knock: the person's own
    window asking which addresses there are, to pick one - no tool call, so no episode and no
    gate, the way ``GET /devices`` is read. The knock is left out because it dials every online
    peer and the form only needs a name and an address; a peer that turns out to be asleep says so
    when the join is sent. Bounded at :data:`PEER_LIMIT`, online ones first, and it says so.
    """
    _, status = tools.status()
    state = "no_overlay" if not status.installed else "up" if status.logged_in else "logged_out"
    rows = [
        {"name": p.name, "ip": p.ip, "os": p.os, "online": p.online}
        for p in status.peers
        if p.ip and status.logged_in
    ]
    shown = rows[:PEER_LIMIT]
    return 200, {
        "ok": True,
        "state": state,
        "self_ip": status.ip,
        "peers": shown,
        "showing": len(shown),
        "total": len(rows),
        "footer": "" if len(shown) >= len(rows) else f"(showing {len(shown)} of {len(rows)})",
    }


@dataclass(frozen=True)
class SetupLive:
    """Policy rule 4's port, with ``connector:setup`` live while this peer host exists.

    The vault answers for every other connector exactly as before; with no vault, only the setup
    origin is live, which is rule 4's fail-closed reading with one reserved exception.
    """

    inner: ConnectorStatePort | None = None

    def is_live(self, connector_id: str) -> bool:
        if connector_id == SETUP_ID:
            return True
        return self.inner is not None and self.inner.is_live(connector_id)


def wire_setup(daemon: AthenaDaemon, host: PeerHost, tools: SetupTools | None = None) -> SetupTools:
    """Register the setup names, make their origin live, serve the route, fill ``setup_phase``."""
    chosen = tools or SetupTools(host)
    names = daemon.catalog.register_setup(chosen.executors())
    policy = daemon.gate.policy
    daemon.gate.policy = replace(policy, connectors=SetupLive(policy.connectors))
    state = SetupState(host)
    host.setup_phase = state.phase
    host.listen_for_setup = state.listening
    for route in setup_routes(daemon, state, len(names)):
        daemon.routes.add(route)
    daemon.routes.add(Route("GET", "/devices/overlay", lambda request: overlay_peers(chosen)))
    return chosen

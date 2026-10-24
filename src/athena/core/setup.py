"""The setup leg's policy: seven names, their classes, where they may be called (ADR 0140, WP4).

A person who is not technical sets up One Athena by talking to her. On each computer the Devices
page opens a **setup conversation**, and in that conversation - and nowhere else - Athena has seven
more names: three that read (is the overlay here, which computers are on it, does a given one
answer) and four that change this machine (install the overlay, sign in to it, open the firewall
for the peer port, open a pairing window). Every one of the four is ``GATED``: proposing it files a
card, and it runs only after the person signs it.

This module is the half of that which is policy, so it lives in the core and imports nothing but
the standard library: the names, each one's class, its parameter schema, and the reserved origins
that scope it. The executors - the fixed command lines, the probes - are the peer package's
(``athena.peer.setup``) and reach the catalog as ports from the composition root, exactly as the
memory engine's executors do (:class:`~athena.core.catalog.CoreServices`). The class is decided
*here*, by a table a reader can audit, and never by the module that runs the command: the gate is
the policy (ADR 0004).

**Why a ``connector:setup`` origin and not ``core.setup.*``.** The design brief named these core
tools. Core entries are always in the capability block and cannot be switched off per turn, so a
``core.setup.*`` name would be in every conversation's prompt, to be refused in every one of them
but the setup conversation. Filed under the reserved connector origin :data:`SETUP_TOOLS_ORIGIN`
instead, they use machinery that already exists, with no contract change: the daemon names the
origin among a turn's ``disabled_origins`` for every session but the setup one, which takes the
names out of that prompt *and* makes the gate refuse them there (policy rule 2,
``origin_enabled``); the setup session, in turn, switches every other page and connector off, so
its prompt is Athena's own names and these. Rule 4 (``connector_enabled``) still runs and asks
whether the origin is live: the composition root answers yes for it only while a peer host exists.
A connector's manifest can only derive ``AUTO`` or ``GATED`` from its flags, which is why these are
not merged as a manifest: the three reads are ``READ`` - capped, recorded - and say so here.

**The setup session.** It is keyed by :data:`SETUP_SESSION_ORIGIN`, which no page can register
(``page_origin_admitted`` takes only ``https`` or ``http://localhost``), so the only way to be in it
is the loopback route the person's own window calls (``POST /devices/setup``).
"""

from __future__ import annotations

import ipaddress
from collections.abc import Mapping
from dataclasses import dataclass
from typing import Any

from athena.contracts.registry import ToolClass, TurnContext, ValidationResult, ValidatorFn

__all__ = [
    "OVERLAY_RANGES",
    "SETUP_APP_ID",
    "SETUP_GUIDE",
    "SETUP_ID",
    "SETUP_OPENING",
    "SETUP_SESSION_ORIGIN",
    "SETUP_TOOLS",
    "SETUP_TOOLS_ORIGIN",
    "SETUP_TURN_KEY",
    "SetupTool",
    "overlay_address",
    "setup_name",
]

#: The connector id the setup tools are filed under; no vault connector may take it.
SETUP_ID = "setup"
#: The catalog origin of the setup tools (``connector.setup.<name>``).
SETUP_TOOLS_ORIGIN = f"connector:{SETUP_ID}"
#: The session key of the setup conversation. Not a web origin, so no page can ever register it.
SETUP_SESSION_ORIGIN = "athena://setup"
#: The app id of that session, which names its conversation (``conv_setup``).
SETUP_APP_ID = "setup"
#: The ``TurnContext.extra`` key the daemon sets on a turn of the setup session, and only there.
SETUP_TURN_KEY = "setup"

#: The private overlay's own ranges, as ``athena.peer.classify`` states them (a test holds the two
#: equal). Repeated rather than imported because the core never imports the peer package.
OVERLAY_RANGES: tuple[ipaddress.IPv4Network | ipaddress.IPv6Network, ...] = (
    ipaddress.IPv4Network("100.64.0.0/10"),
    ipaddress.IPv6Network("fd7a:115c:a1e0::/48"),
)

_NO_PARAMS: dict[str, Any] = {"type": "object", "properties": {}, "additionalProperties": False}


@dataclass(frozen=True)
class SetupTool:
    """One setup name as the catalog files it: its bare name, class, schema and description."""

    name: str
    cls: ToolClass
    params_schema: Mapping[str, Any]
    description: str
    #: Names a parameter that must be an overlay address, checked at the gate.
    overlay_param: str | None = None


SETUP_TOOLS: tuple[SetupTool, ...] = (
    SetupTool(
        "overlay_status",
        ToolClass.READ,
        _NO_PARAMS,
        "Is the private network (Tailscale) installed here, signed in, and this computer's "
        "address and network name on it.",
    ),
    SetupTool(
        "list_overlay_peers",
        ToolClass.READ,
        _NO_PARAMS,
        "The other devices on this person's private network, whether each is online, and "
        "whether Athena answers on it.",
    ),
    SetupTool(
        "probe_peer",
        ToolClass.READ,
        {
            "type": "object",
            "properties": {"peer_ip": {"type": "string", "maxLength": 45}},
            "required": ["peer_ip"],
            "additionalProperties": False,
        },
        "Check one other computer by its private-network address: no_overlay, logged_out, "
        "peer_unreachable, athena_asleep or ok.",
        overlay_param="peer_ip",
    ),
    SetupTool(
        "install_overlay",
        ToolClass.GATED,
        _NO_PARAMS,
        "Install Tailscale, the private network, with the Windows package manager.",
    ),
    SetupTool(
        "overlay_login",
        ToolClass.GATED,
        _NO_PARAMS,
        "Start Tailscale's sign-in and open its sign-in page in the browser.",
    ),
    SetupTool(
        "firewall_allow",
        ToolClass.GATED,
        _NO_PARAMS,
        "Let the person's other devices reach Athena here: one Windows firewall rule for "
        "Athena's peer port, from the private network's addresses only.",
    ),
    SetupTool(
        "open_pairing",
        ToolClass.GATED,
        {
            "type": "object",
            "properties": {"kind": {"type": "string", "enum": ["pc", "phone"]}},
            "required": ["kind"],
            "additionalProperties": False,
        },
        "Open a five-minute pairing window for another computer (a code) or a phone (a QR on "
        "the Devices page).",
    ),
)


def setup_name(bare: str) -> str:
    """The catalog name of one setup tool: ``connector.setup.<bare>``."""
    return f"connector.{SETUP_ID}.{bare}"


def overlay_address(field: str) -> ValidatorFn:
    """A validator: ``params[field]`` is an IP literal inside :data:`OVERLAY_RANGES`.

    No host name, no LAN address, no public one: the probe only ever knocks on the person's own
    private network, so a model cannot point it at anything else.
    """

    def _validate(params: dict[str, Any], ctx: TurnContext) -> ValidationResult:
        raw = params.get(field)
        text = raw.strip() if isinstance(raw, str) else ""
        try:
            ip = ipaddress.ip_address(text)
        except ValueError:
            return ValidationResult.reject("validator_failed", f"{field} must be an IP address")
        if isinstance(ip, ipaddress.IPv6Address) and ip.ipv4_mapped is not None:
            ip = ip.ipv4_mapped
        if not any(ip.version == net.version and ip in net for net in OVERLAY_RANGES):
            return ValidationResult.reject(
                "validator_failed", f"{field} must be an address on the private network"
            )
        return ValidationResult.accept()

    return _validate


#: What a setup conversation's frame tells Athena, every turn of it (``frame.setup``). It is ours,
#: not a page's, so it is not fenced; it names the steps and leaves the doing to the cards.
SETUP_GUIDE = """## Setting up One Athena

This conversation sets up One Athena on this computer: this computer, the person's other
computers and their phone become one Athena, talking over a private network (Tailscale). The
person is probably not technical. Say one step at a time, in plain words, and wait for them.

The same conversation runs on the other computer too. When the person is between the two, say
what the other one is waiting for ("your laptop is waiting for you to approve it on the Devices
page there").

The steps, in order. Check before you change anything; skip a step that is already done.

1. Read `connector.setup.overlay_status`. Not installed: propose `connector.setup.install_overlay`
   and say a Windows prompt may ask them to allow it.
2. Installed but not signed in: propose `connector.setup.overlay_login`. Tell them plainly that
   the sign-in page is the one step only they can do, and that every device must use the same
   account.
3. Signed in: propose `connector.setup.firewall_allow` once, so the other devices can reach
   Athena here. Windows may ask for permission.
4. Read `connector.setup.list_overlay_peers` to see the other devices. `connector.setup.probe_peer`
   tells you about one: ok, athena_asleep, peer_unreachable (that device is off or offline),
   logged_out, no_overlay. athena_asleep means nothing answers there yet: before two computers are
   paired, Athena listens only while someone is in its setup conversation or a pairing window is
   open, so it is normal at first and is not a reason to send the person away. Say so in one
   sentence and go on to step 5.
5. To join two computers: on ONE of them propose `connector.setup.open_pairing` with kind pc and
   read the code it returns to the person; on the OTHER, they type that code on the Devices page
   there, with that first computer's address (`connector.setup.list_overlay_peers` on the other
   computer names it). Each computer's person approves the other on its own Devices page.
6. For the phone: propose `connector.setup.open_pairing` with kind phone, and tell them to scan
   the QR on the Devices page with the phone's camera, then approve the phone when it asks.

Never ask the person to type a command. If a step fails, say what happened in one sentence and
what they can do next.
"""

#: The first turn of a setup conversation, written by the daemon and never by a window: "Set up
#: with Athena" sends ``start`` with no message, and this is what she is told instead, so she speaks
#: first and the person is not left facing an empty box. Most people have never heard of Tailscale,
#: so she says what it is before she proposes installing it, and every change is still a card.
SETUP_OPENING = (
    'The person just pressed "Set up with Athena" on the Devices page and is waiting for you to'
    " start. Read `connector.setup.overlay_status` first. Then, in two or three short "
    "sentences, say what you found and what the first step is. If Tailscale is not installed, "
    "say plainly what it is - a free private network that lets their own computers and phone "
    "reach each other, and nothing else - before you propose installing it, and say that "
    "Windows may ask them to allow the install. If it is installed but not signed in, tell them"
    " the sign-in page will open and that it is the one step only they can do. Propose one "
    "step, then wait for them."
)

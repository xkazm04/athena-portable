"""Who may knock on the peer listener: the address class, decided before any read (ADR 0140).

The peer listener is reachable from a network, which the loopback daemon never is, so the first
question asked of a connection is not "which token?" but "where from?". The answer is one of three
words and nothing finer:

``overlay``
    The private overlay's own ranges - Tailscale's CGNAT block ``100.64.0.0/10`` and its unique
    local block ``fd7a:115c:a1e0::/48``. A packet from there has already crossed WireGuard, which
    is the transport's encryption and its device authentication (the trust statement in ADR 0140).
``loopback``
    ``127.0.0.0/8`` and ``::1``. Admitted on the peer listener only when the listener was built
    with ``admit_loopback`` - the tests, which have no overlay - and never in production, where the
    listener binds the overlay address and a loopback caller has the loopback daemon instead.
``refused``
    Everything else: the home LAN (``192.168/16``, ``10/8``, ``172.16/12``), link-local, the public
    internet, a string that is not an address at all. A same-WiFi PC is *not* special: all peer
    traffic rides the overlay, which goes direct on a LAN anyway, so the LAN is never trusted and
    nothing on it is sent in plaintext.

An IPv4-mapped IPv6 address (``::ffff:100.64.1.2``) is unwrapped first and judged as the IPv4
address it carries, so a dual-stack socket cannot launder a public address into a v6 one that
falls through, nor refuse an overlay peer because its kernel spoke v6.
"""

from __future__ import annotations

import ipaddress
from typing import Literal

__all__ = ["OVERLAY_V4", "OVERLAY_V6", "PeerClass", "peer_class"]

PeerClass = Literal["loopback", "overlay", "refused"]

#: Tailscale's IPv4 block (RFC 6598 shared address space). Every tailnet address is inside it.
OVERLAY_V4 = ipaddress.IPv4Network("100.64.0.0/10")
#: Tailscale's IPv6 unique local block.
OVERLAY_V6 = ipaddress.IPv6Network("fd7a:115c:a1e0::/48")


def peer_class(addr: str) -> PeerClass:
    """``loopback``, ``overlay`` or ``refused`` for one remote address, as the socket reported it.

    A scope suffix (``fe80::1%eth0``) is dropped before parsing; anything that still does not parse
    is ``refused``. Pure and constant-cost: no lookup, no I/O, no exception escapes.
    """
    text = (addr or "").strip().split("%", 1)[0]
    try:
        ip = ipaddress.ip_address(text)
    except ValueError:
        return "refused"
    if isinstance(ip, ipaddress.IPv6Address) and ip.ipv4_mapped is not None:
        ip = ip.ipv4_mapped
    if ip.is_loopback:
        return "loopback"
    if isinstance(ip, ipaddress.IPv4Address):
        return "overlay" if ip in OVERLAY_V4 else "refused"
    return "overlay" if ip in OVERLAY_V6 else "refused"

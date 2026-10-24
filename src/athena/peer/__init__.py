"""One Athena across devices: identity, pairing, and the overlay-only peer listener (ADR 0140, WP1).

Each device is a full Athena. This package is how two of them - or a device and a phone - come to
trust each other and talk, and it is built to the device-pairing standard: a human approval in the
granting device's own chrome is the only thing that mints a token; tokens are born scoped
(``chat``, ``approve``, ``memory``) and optionally expiring, are claimed exactly once, and are kept
only as fingerprints; admission is decided by address class before any auth; and the listener is
off until trust exists.

The modules, in the order a request meets them:

- :mod:`~athena.peer.classify` - ``loopback`` / ``overlay`` / ``refused`` for a remote address;
- :mod:`~athena.peer.overlay` - is Tailscale here, logged in, and what is this device's address;
- :mod:`~athena.peer.listener` - the peer socket, its handler, its lifecycle, and the
  :class:`~athena.peer.listener.PeerHost` that holds everything below;
- :mod:`~athena.peer.identity` - ``$ATHENA_HOME/peer/device.json``;
- :mod:`~athena.peer.registry` - ``$ATHENA_HOME/peer/peers.json``, who may call in;
- :mod:`~athena.peer.pairing` - the ceremony's windows, requests and single claims, in memory;
- :mod:`~athena.peer.client` - the outbound call and the sealed keys this device calls out with;
- :mod:`~athena.peer.events` - the bus behind loopback ``GET /events``;
- :mod:`~athena.peer.routes` - the peer routes (``/peer/hello``, ``/peer/pair/*``);
- :mod:`~athena.peer.devices` - the loopback routes (``/devices*``, ``/events``).

**The seam for later work packages.** A package adds its routes from its own module and touches
this one not at all: it exports ``peer_routes(host) -> list[PeerRoute]`` (each
:class:`~athena.peer.listener.PeerRoute` names its ``grant``, or is ``open=True`` for no token),
and :func:`athena.wiring._wire_peer` gains one line,
``host.add_routes(<module>.peer_routes(host))``. A loopback route goes on ``daemon.routes`` the
same way. Events are published with ``host.publish(kind, **fields)``; a body larger than the
64 KiB peer cap is a :class:`~athena.daemon.server.BodyCap` appended to ``host.body_caps``.
Another device is called back through :func:`athena.peer.client.call` with the token
``host.keys`` unseals for it.
"""

from athena.peer.listener import DEFAULT_PEER_PORT, PeerHost, PeerRequest, PeerRoute

__all__ = ["DEFAULT_PEER_PORT", "PeerHost", "PeerRequest", "PeerRoute"]

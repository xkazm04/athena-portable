"""The address class is the first question, and only the overlay passes it (ADR 0140, WP1 AC).

athena/peer/classify.py; the refusal itself is proved on a socket in test_listener.py.
"""

from __future__ import annotations

import pytest

from athena.peer.classify import peer_class


@pytest.mark.parametrize(
    ("addr", "expected"),
    [
        ("100.64.0.1", "overlay"),
        ("100.101.102.103", "overlay"),
        ("100.127.255.254", "overlay"),
        ("fd7a:115c:a1e0::1", "overlay"),
        ("fd7a:115c:a1e0:ab12:4843:cd96:6258:b240", "overlay"),
        ("::ffff:100.100.1.2", "overlay"),  # v4-mapped overlay is unwrapped and admitted
        ("127.0.0.1", "loopback"),
        ("::1", "loopback"),
        ("::ffff:127.0.0.1", "loopback"),
    ],
)
def test_the_overlay_and_loopback_are_named(addr: str, expected: str) -> None:
    assert peer_class(addr) == expected


@pytest.mark.parametrize(
    "addr",
    [
        "8.8.8.8",  # public
        "2001:4860:4860::8888",  # public v6
        "192.168.1.20",  # the home LAN is not trusted, even on the same WiFi
        "10.0.0.5",
        "172.16.4.4",
        "100.63.255.255",  # just below the overlay block
        "100.128.0.0",  # just above it
        "::ffff:8.8.8.8",  # a mapped public address cannot launder itself into v6
        "::ffff:192.168.1.20",
        "fd7a:115c:a1e1::1",  # the next /48
        "fe80::1%eth0",  # link-local
        "",
        "not an address",
    ],
)
def test_everything_else_is_refused(addr: str) -> None:
    assert peer_class(addr) == "refused"

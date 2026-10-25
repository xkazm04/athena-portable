"""One link state per paired device, earned by named evidence (ADR 0140 "Link state").

Three parts of the peer host each saw a paired device in their own words - the presence probe
(``online`` / ``asleep`` / ``unreachable``), the puller (``ok`` / ``not_shared`` /
``unreachable``) and the keys (held or not) - and none of them kept what it saw. So a computer that
had removed this one read as ``asleep`` forever, a PC whose pair-back never arrived looked the same
as one not probed yet, and an ``online`` nobody re-checked never aged. :func:`derive` is the one
place a link's state is decided, from the observations it is handed, and it says which ones it
used. It is pure: the same observations and the same ``now`` give the same answer, so a surface
that recomputes it cannot disagree with the probe.

The states, first match wins:

``phone``
    A phone has no Athena and no listener; nothing is dialled and nothing is claimed about it.
``awaiting_key``
    A PC this device holds no key for (its pair-back was not delivered, or a restart lost an
    approval). Without the token there is no authorized hello. ``since`` is the row's ``created``.
``removed_there``
    The other PC answered ``401`` to the token it once minted for this one - on the hello or on
    the memory manifest. It revoked this device; only a new pairing mends it. It does not age:
    no later silence makes a refusal less true.
``stale``
    The newest hello is older than :data:`STALE_AFTER_PASSES` probe periods. Whatever it said is
    no longer evidence of now; ``since`` is when it was last confirmed.
``online``
    The hello answered ``200``.
``asleep``
    The hello did not answer, but the overlay listed the device's address.
``unreachable``
    Neither answered.

A keyed PC with no hello yet has ``state`` ``None``: not probed, and nothing pretends otherwise.

``evidence`` always carries every key, ``None`` where nothing was observed: ``key`` (``True`` /
``False``, ``None`` for a phone), ``hello`` (the hello's HTTP status, ``0`` when it was not
reached), ``hello_at`` (when that status was last seen), ``overlay`` (``True`` when the overlay
listed the address on that pass, ``False`` when it did not, ``None`` when it was not asked or there
is none) and ``memory`` (the puller's last state for the device).
"""

from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass
from datetime import datetime
from typing import Any, Literal, Protocol

__all__ = [
    "LINK_STATES",
    "STALE_AFTER_PASSES",
    "HelloSeen",
    "LinkState",
    "derive",
    "state_of",
]

LinkState = Literal[
    "phone", "awaiting_key", "online", "stale", "asleep", "unreachable", "removed_there"
]
LINK_STATES: tuple[LinkState, ...] = (
    "phone",
    "awaiting_key",
    "online",
    "stale",
    "asleep",
    "unreachable",
    "removed_there",
)
#: A hello older than this many probe periods is no longer evidence of now.
STALE_AFTER_PASSES = 3
#: The status a peer answers a token it does not know with: it removed this device.
REMOVED_STATUS = 401


class _Row(Protocol):
    @property
    def kind(self) -> str: ...

    @property
    def created(self) -> str: ...


@dataclass(frozen=True)
class HelloSeen:
    """What the presence probe saw of one peer's hello.

    ``status`` is the HTTP status (``0``: not reached). ``since`` is when the probe first saw the
    link in its current state, ``at`` the latest pass that confirmed it. ``overlay`` is whether the
    overlay listed the address on that pass (``None``: not asked, or no overlay).
    """

    status: int
    since: str
    at: str
    overlay: bool | None = None


def _fresh_state(hello: HelloSeen, memory_state: str | None) -> LinkState:
    """The state a hello earns at the moment it was taken (no ageing)."""
    if hello.status == REMOVED_STATUS:
        return "removed_there"
    if hello.status == 200:
        return "online"
    if memory_state == "removed_there":
        return "removed_there"
    return "asleep" if hello.overlay else "unreachable"


def state_of(hello: HelloSeen, memory: Mapping[str, Any] | None = None) -> LinkState:
    """The state ``hello`` earns when fresh - what the probe compares pass to pass."""
    return _fresh_state(hello, _memory_state(memory))


def _memory_state(memory: Mapping[str, Any] | None) -> str | None:
    state = memory.get("state") if memory is not None else None
    return state if isinstance(state, str) else None


def derive(
    row: _Row,
    key: object,
    hello: HelloSeen | None,
    overlay: bool | None = None,
    memory: Mapping[str, Any] | None = None,
    now: datetime | None = None,
    every_s: float = 30.0,
) -> dict[str, Any]:
    """``{state, since, evidence}`` for one paired device.

    ``key`` is truthy when this device holds a key to call the peer with. ``overlay`` overrides
    what ``hello`` recorded (``None`` keeps it). ``now`` is needed only to age a hello; without it
    nothing is ``stale``. ``every_s`` is the probe's period.
    """
    memory_state = _memory_state(memory)
    phone = row.kind == "phone"
    listed = overlay if overlay is not None else (hello.overlay if hello is not None else None)
    evidence: dict[str, Any] = {
        "key": None if phone else bool(key),
        "hello": None if phone or hello is None else hello.status,
        "hello_at": None if phone or hello is None else hello.at,
        "overlay": None if phone else listed,
        "memory": None if phone else memory_state,
    }
    state: LinkState | None
    since: str | None
    if phone:
        state, since = "phone", row.created
    elif not key:
        state, since = "awaiting_key", row.created
    elif hello is None:
        if memory_state == "removed_there":
            pulled = memory.get("last_pull_at") if memory is not None else None
            state, since = "removed_there", pulled if isinstance(pulled, str) else None
        else:
            state, since = None, None
    else:
        seen = HelloSeen(hello.status, hello.since, hello.at, listed)
        state, since = _fresh_state(seen, memory_state), hello.since
        if state != "removed_there" and now is not None and _aged(hello.at, now, every_s):
            state, since = "stale", hello.at
    return {"state": state, "since": since, "evidence": evidence}


def _aged(at: str, now: datetime, every_s: float) -> bool:
    try:
        taken = datetime.fromisoformat(at)
    except ValueError:
        return True  # an observation with no readable time is no evidence of now
    return (now - taken).total_seconds() > STALE_AFTER_PASSES * every_s

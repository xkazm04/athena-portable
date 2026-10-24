"""Who this device has let in: ``peers.json``, one row per paired device (ADR 0140, "Admission").

A row is exactly ``{peer_id, name, kind, grants, token_sha256, created, expires, last_seen}``:

- ``peer_id`` is the other device's own ``dev_`` id (a phone is given one when it is approved);
- ``kind`` is ``"pc"`` or ``"phone"``; ``grants`` a subset of :data:`GRANTS`, in that order;
- ``token_sha256`` is the fingerprint of the bearer token this device minted for that peer. The
  token itself is never written anywhere by this module: it is handed to the peer once, at the
  claim, and from then on only its digest can be checked (the device-pairing standard's
  "fingerprint-only storage"). A leaked ``peers.json`` admits nobody;
- ``expires`` and ``last_seen`` are ISO stamps or ``null``, never omitted.

**Disk is truth, one writer** (ADR 0003). The rows are read once and held; every change rewrites
the file whole (:func:`~athena.peer.identity.write_whole`) under this object's lock, and this
daemon is the only writer. A file that will not parse is moved aside as ``peers.json.unreadable``
and the registry starts empty - closed, not open: an unreadable list of who may enter admits no
one, and its bytes are kept for a person to look at.

**Revoke is immediate.** :meth:`PeerRegistry.revoke` drops the row and the next request with that
token fails :meth:`authenticate`, because authentication reads the held rows and never a cache of
answers. An expired row stops authenticating at its stamp and is reaped from disk by the
lifecycle tick (:meth:`reap`), not only when someone reads it.

``last_seen`` is written at most once per :data:`TOUCH_EVERY_S` per peer, so a phone polling a
turn does not rewrite the file on every request.
"""

from __future__ import annotations

import hashlib
import json
import secrets
import threading
from collections.abc import Callable, Iterable
from dataclasses import dataclass, replace
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any, Literal

from athena.contracts import ids
from athena.peer.identity import clean_name, now_iso, write_whole

__all__ = [
    "GRANTS",
    "KINDS",
    "PEERS_FILENAME",
    "TOUCH_EVERY_S",
    "PeerKind",
    "PeerRegistry",
    "PeerRow",
    "fingerprint",
    "mint_token",
    "ordered_grants",
]

PEERS_FILENAME = "peers.json"
#: The grants ladder: talk to this device's panel, answer its approval cards, replicate memory.
GRANTS: tuple[str, ...] = ("chat", "approve", "memory")
KINDS: tuple[str, ...] = ("pc", "phone")
PeerKind = Literal["pc", "phone"]
TOUCH_EVERY_S = 60.0


def mint_token() -> str:
    """A fresh peer bearer token: 256 bits, URL-safe."""
    return secrets.token_urlsafe(32)


def fingerprint(token: str) -> str:
    """The only form of a peer token that is ever kept: its SHA-256, hex."""
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def ordered_grants(values: Iterable[object]) -> list[str]:
    """``values`` as a list of grants in ladder order. ``ValueError`` names an unknown one."""
    asked = list(values)
    unknown = [str(value) for value in asked if value not in GRANTS]
    if unknown:
        raise ValueError(f"unknown grant {unknown[0]!r}; one of {', '.join(GRANTS)}")
    return [grant for grant in GRANTS if grant in asked]


@dataclass(frozen=True)
class PeerRow:
    peer_id: str
    name: str
    kind: str
    grants: tuple[str, ...]
    token_sha256: str
    created: str
    expires: str | None = None
    last_seen: str | None = None

    def to_dict(self) -> dict[str, Any]:
        return {
            "peer_id": self.peer_id,
            "name": self.name,
            "kind": self.kind,
            "grants": list(self.grants),
            "token_sha256": self.token_sha256,
            "created": self.created,
            "expires": self.expires,
            "last_seen": self.last_seen,
        }

    def view(self) -> dict[str, Any]:
        """The row as a surface may see it: everything but the fingerprint."""
        shown = self.to_dict()
        del shown["token_sha256"]
        return shown

    def expired(self, now: datetime) -> bool:
        return self.expires is not None and _parse(self.expires) <= now

    @staticmethod
    def from_dict(data: Any) -> PeerRow | None:
        if not isinstance(data, dict):
            return None
        peer_id = str(data.get("peer_id", ""))
        digest = str(data.get("token_sha256", ""))
        kind = str(data.get("kind", ""))
        if not ids.is_id("device", peer_id) or len(digest) != 64 or kind not in KINDS:
            return None
        try:
            grants = tuple(ordered_grants(data.get("grants") or []))
        except ValueError:
            return None
        expires, seen = data.get("expires"), data.get("last_seen")
        return PeerRow(
            peer_id=peer_id,
            name=clean_name(data.get("name"), peer_id),
            kind=kind,
            grants=grants,
            token_sha256=digest,
            created=str(data.get("created") or now_iso()),
            expires=str(expires) if expires else None,
            last_seen=str(seen) if seen else None,
        )


def _parse(stamp: str) -> datetime:
    try:
        parsed = datetime.fromisoformat(stamp)
    except ValueError:
        return datetime.min.replace(tzinfo=UTC)  # an unreadable stamp has already passed
    return parsed if parsed.tzinfo else parsed.replace(tzinfo=UTC)


class PeerRegistry:
    """``peers.json``, held in memory and written whole on every change."""

    def __init__(self, root: Path, *, now: Callable[[], datetime] | None = None) -> None:
        self.path = root / PEERS_FILENAME
        self._now = now or (lambda: datetime.now(UTC))
        self._lock = threading.RLock()
        self._rows: dict[str, PeerRow] = self._load()

    # -- reading -------------------------------------------------------------------------------

    def rows(self) -> list[PeerRow]:
        """Every row that has not expired, oldest first."""
        now = self._now()
        with self._lock:
            live = [row for row in self._rows.values() if not row.expired(now)]
        return sorted(live, key=lambda row: (row.created, row.peer_id))

    def get(self, peer_id: str) -> PeerRow | None:
        with self._lock:
            row = self._rows.get(peer_id)
        return None if row is None or row.expired(self._now()) else row

    def live_count(self) -> int:
        return len(self.rows())

    def authenticate(self, token: str) -> PeerRow | None:
        """The live row whose fingerprint ``token`` has, or ``None``.

        Every row is compared, with :func:`secrets.compare_digest`, and the loop does not stop at
        the first match: how long a refusal takes says nothing about which rows exist.
        """
        if not token:
            return None
        presented = fingerprint(token)
        found: PeerRow | None = None
        for row in self.rows():
            if secrets.compare_digest(presented, row.token_sha256):
                found = row
        return found

    # -- writing -------------------------------------------------------------------------------

    def admit(
        self,
        peer_id: str,
        *,
        name: str,
        kind: str,
        grants: Iterable[str],
        token: str,
        expires_days: int | None,
    ) -> PeerRow:
        """File one peer under its device id, replacing any earlier row for the same device."""
        if not ids.is_id("device", peer_id):
            raise ValueError(f"not a device id: {peer_id!r}")
        if kind not in KINDS:
            raise ValueError(f"kind must be one of {', '.join(KINDS)}")
        now = self._now()
        expires = None if expires_days is None else now_iso(now + timedelta(days=expires_days))
        row = PeerRow(
            peer_id=peer_id,
            name=clean_name(name, peer_id),
            kind=kind,
            grants=tuple(ordered_grants(grants)),
            token_sha256=fingerprint(token),
            created=now_iso(now),
            expires=expires,
        )
        with self._lock:
            self._rows[peer_id] = row
            self._save()
        return row

    def revoke(self, peer_id: str) -> bool:
        """Drop one row now. ``False`` when there was none."""
        with self._lock:
            if self._rows.pop(peer_id, None) is None:
                return False
            self._save()
            return True

    def touch(self, peer_id: str) -> None:
        """Stamp ``last_seen``, at most once per :data:`TOUCH_EVERY_S` for one peer."""
        now = self._now()
        with self._lock:
            row = self._rows.get(peer_id)
            if row is None:
                return
            seen = row.last_seen
            if seen is not None and (now - _parse(seen)).total_seconds() < TOUCH_EVERY_S:
                return
            self._rows[peer_id] = replace(row, last_seen=now_iso(now))
            self._save()

    def reap(self) -> list[str]:
        """Remove every expired row from disk; the ids that went."""
        now = self._now()
        with self._lock:
            gone = [peer_id for peer_id, row in self._rows.items() if row.expired(now)]
            for peer_id in gone:
                del self._rows[peer_id]
            if gone:
                self._save()
        return gone

    # -- disk ----------------------------------------------------------------------------------

    def _save(self) -> None:
        ordered = sorted(self._rows.values(), key=lambda row: (row.created, row.peer_id))
        write_whole(self.path, [row.to_dict() for row in ordered])

    def _load(self) -> dict[str, PeerRow]:
        if not self.path.exists():
            return {}
        try:
            data = json.loads(self.path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError, UnicodeDecodeError):
            data = None
        if not isinstance(data, list):
            self.path.replace(self.path.with_name(f"{self.path.name}.unreadable"))
            return {}
        rows: dict[str, PeerRow] = {}
        for item in data:
            row = PeerRow.from_dict(item)
            if row is not None:
                rows[row.peer_id] = row
        return rows

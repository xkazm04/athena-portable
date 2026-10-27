"""The pairing ceremony's state: windows, the one request each, and the one claim (ADR 0140).

This module holds the ceremony and decides nothing a person should: it never approves, and the
token it hands out at a claim is one an approval in this device's own chrome minted. The device-
pairing standard asks four things of it, and each is a line below.

**A window, and only one request per window.** ``POST /devices/pairing`` opens one: a
``pair_`` id, a nonce of :data:`NONCE_BYTES` bytes for the phone's QR (it travels in the URL
*fragment*, so it never reaches a request line or a log), a short :data:`CODE_LENGTH`-character
code from an unambiguous alphabet for a person to type on another PC, and a TTL of
:data:`WINDOW_TTL_S`. The first request against it files the one pending record. A repeat from the
same requester - the nonce again, or the code with the ``claim_secret`` the first answer returned -
may refresh a record that is still pending; nothing resets one that was resolved. A second
requester who only knows the code gets ``window_taken``.

**Wrong guesses close windows.** A code that matches no window, a wrong nonce, a wrong claim
secret: each is counted, and at :data:`WRONG_LIMIT` the windows it could have been aimed at close.
A six-character code from :data:`CODE_ALPHABET` is about thirty bits, which five guesses do not
reach.

**The token is minted at approval and handed out once.** :meth:`PairingBook.approve` mints it and
holds it *in memory only* until the claim; :meth:`PairingBook.claim` returns it exactly once and
forgets it, and a second claim is ``claim_spent`` (410). An approval nobody claims expires
:data:`WINDOW_TTL_S` after it was given, and the host removes the row it made.

**Proving the claimer is the requester.** Every request is answered with a ``claim_secret``; the
code path must present it at the claim, so a person who watched the code being typed cannot claim
what the requester was granted. The phone path proves itself with the nonce, which only the QR
carried, and may present the secret as well.

**Pairing back.** A PC that claims a token from another PC is told, in the same answer, that the
granting PC asks to be let in in return (``pair_back``). The claimer files that as a pending
record of its own (:meth:`PairingBook.file_pair_back`) which *its* person approves or declines in
*its* chrome, so each side's access is minted by a human on that side: two approvals, never one.
The host then delivers that token to the asking PC over the overlay (``POST /peer/pair/back``,
authenticated with the token it just claimed) instead of waiting to be asked for it.

States: ``open`` (a window with no request yet), ``pending``, ``approved``, ``declined``,
``expired``, ``claimed``. A resolved record is remembered for :data:`RETAIN_S` so a late claim is
told ``claim_spent`` or ``expired`` rather than "never heard of it".
"""

from __future__ import annotations

import hashlib
import secrets
import threading
from collections.abc import Callable, Sequence
from dataclasses import dataclass, field, replace
from datetime import UTC, datetime, timedelta
from typing import Any
from urllib.parse import urlsplit

from athena.contracts import ids
from athena.peer.identity import clean_name, now_iso
from athena.peer.registry import KINDS, mint_token, ordered_grants

__all__ = [
    "CODE_ALPHABET",
    "CODE_LENGTH",
    "NONCE_BYTES",
    "PAIR_BACK_TTL_S",
    "RETAIN_S",
    "WINDOW_TTL_S",
    "WRONG_LIMIT",
    "PairingBook",
    "PairingRecord",
    "PairingRefused",
    "normalize_code",
]

#: No 0/O, no 1/I/L: a code is read off one screen and typed on another.
CODE_ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ"
CODE_LENGTH = 6
#: 128 bits; the standard's floor is 96.
NONCE_BYTES = 16
WINDOW_TTL_S = 300
#: A pair-back request waits for a person who has just paired the other way, at the other screen.
PAIR_BACK_TTL_S = 900
WRONG_LIMIT = 5
RETAIN_S = 900

OPEN, PENDING, APPROVED, DECLINED, EXPIRED, CLAIMED = (
    "open",
    "pending",
    "approved",
    "declined",
    "expired",
    "claimed",
)
LIVE_STATES = frozenset({OPEN, PENDING, APPROVED})


class PairingRefused(Exception):
    """A ceremony step refused: the HTTP status, a peer error word, and the record's state."""

    def __init__(self, status: int, error: str, detail: str, state: str | None = None) -> None:
        super().__init__(detail)
        self.status = status
        self.error = error
        self.detail = detail
        self.state = state


def normalize_code(value: object) -> str:
    """A typed code as stored: upper case, without the spaces or dashes a person adds."""
    text = value if isinstance(value, str) else ""
    return "".join(ch for ch in text.upper() if ch.isalnum())


def _digest(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


@dataclass
class PairingRecord:
    pairing_id: str
    kind: str
    opened_at: datetime
    expires_at: datetime
    nonce: str = ""
    code: str = ""
    #: ``inbound`` for a window this device opened; ``pair_back`` for a request another PC made of
    #: this one in its claim answer.
    direction: str = "inbound"
    state: str = OPEN
    name: str = ""
    #: The requester's own device id; ``None`` for a phone until approval gives it one.
    device_id: str | None = None
    requested_grants: list[str] = field(default_factory=list)
    granted: list[str] = field(default_factory=list)
    expires_days: int | None = None
    claim_secret_sha: str = ""
    #: The minted token, between approval and claim (or delivery). Memory only, never logged.
    token: str = field(default="", repr=False)
    #: The id the approved peer is filed under.
    peer_id: str | None = None
    #: For ``pair_back``: where the asking PC's peer listener is, to deliver the token to.
    deliver_to: str | None = None
    #: Where the request came from, as the socket said (never the body); ``""`` when unknown.
    address: str = ""
    wrong: int = 0
    resolved_at: datetime | None = None

    def pending_view(self, replaces: dict[str, str] | None = None) -> dict[str, Any]:
        """What the person deciding sees. ``address`` is the channel-stamped one, not the claimed
        name's; ``replaces`` is the paired device approving this would overwrite (the host knows
        the registry, so it passes it), else ``None``."""
        return {
            "pairing_id": self.pairing_id,
            "name": self.name,
            "kind": self.kind,
            "requested_grants": list(self.requested_grants),
            "expires_at": now_iso(self.expires_at),
            "pair_back": self.direction == "pair_back",
            "address": self.address or None,
            "replaces": replaces,
        }


class PairingBook:
    """Every live pairing record, in memory, behind one lock. A restart forgets them all."""

    def __init__(self, *, now: Callable[[], datetime] | None = None) -> None:
        self._now = now or (lambda: datetime.now(UTC))
        self._lock = threading.RLock()
        self._records: dict[str, PairingRecord] = {}
        self._wrong_codes = 0

    # -- reading -------------------------------------------------------------------------------

    def get(self, pairing_id: str) -> PairingRecord | None:
        with self._lock:
            return self._records.get(pairing_id)

    def pending(self) -> list[PairingRecord]:
        with self._lock:
            rows = [r for r in self._records.values() if r.state == PENDING]
        return sorted(rows, key=lambda r: r.opened_at)

    def window_open(self) -> bool:
        """A window waits for a requester (the peer ``hello``'s ``window_open``)."""
        with self._lock:
            return any(r.state == OPEN for r in self._records.values())

    def active(self) -> bool:
        """Anything the listener must stay up for: a window, a request, an unclaimed approval."""
        with self._lock:
            return any(
                r.state in LIVE_STATES and r.direction == "inbound" for r in self._records.values()
            )

    def undelivered(self) -> list[PairingRecord]:
        """Approved pair-backs whose token has not reached the asking PC yet."""
        with self._lock:
            return [
                r
                for r in self._records.values()
                if r.direction == "pair_back" and r.state == APPROVED and r.token
            ]

    # -- the ceremony --------------------------------------------------------------------------

    def open_window(self, kind: str) -> PairingRecord:
        if kind not in KINDS:
            raise ValueError(f"kind must be one of {', '.join(KINDS)}")
        now = self._now()
        with self._lock:
            taken = {r.code for r in self._records.values() if r.state in LIVE_STATES}
            code = _fresh_code(taken)
            record = PairingRecord(
                pairing_id=ids.mint("pairing"),
                kind=kind,
                opened_at=now,
                expires_at=now + timedelta(seconds=WINDOW_TTL_S),
                nonce=secrets.token_urlsafe(NONCE_BYTES),
                code=code,
            )
            self._records[record.pairing_id] = record
            return record

    def request(
        self,
        *,
        pairing_id: str = "",
        nonce: str = "",
        code: str = "",
        claim_secret: str = "",
        name: object = "",
        kind: str = "",
        device_id: str | None = None,
        requested_grants: Sequence[object] | None = None,
        address: str = "",
    ) -> tuple[PairingRecord, str]:
        """File (or refresh) the one request against a window: the record and its claim secret.

        The claim secret is returned in plain once, to the requester; the book keeps its digest.
        """
        grants = ordered_grants(requested_grants or [])
        if device_id is not None and not ids.is_id("device", device_id):
            raise PairingRefused(400, "bad_request", "device_id is not a device id")
        with self._lock:
            self.sweep()
            record, by_nonce = self._find(pairing_id, nonce, code)
            if record.state not in (OPEN, PENDING):
                raise PairingRefused(409, "pairing_resolved", "already resolved", record.state)
            if kind and kind != record.kind:
                raise PairingRefused(409, "kind_mismatch", f"this window pairs a {record.kind}")
            if record.state == PENDING and not by_nonce and not _secret_ok(record, claim_secret):
                self._wrong(record)
                raise PairingRefused(409, "window_taken", "another device asked first")
            # A presented secret is kept only when it is the one this book holds: one echoed back
            # unchecked (the nonce path skips the check above) would not match the digest, and
            # the requester's every claim would then be ``wrong_secret``.
            keep = record.state == PENDING and _secret_ok(record, claim_secret)
            secret = claim_secret if keep else ""
            if not secret:
                secret = secrets.token_urlsafe(32)
                record.claim_secret_sha = _digest(secret)
            record.state = PENDING
            record.name = clean_name(name, "A device")
            record.device_id = device_id
            record.requested_grants = grants
            record.address = address
            return record, secret

    def approve(
        self, pairing_id: str, grants: Sequence[object], expires_days: int | None
    ) -> PairingRecord:
        """Mint the token for one pending record. Grants may only narrow what was asked."""
        chosen = ordered_grants(grants)
        with self._lock:
            self.sweep()
            record = self._pending(pairing_id)
            wider = [g for g in chosen if g not in record.requested_grants]
            if wider:
                raise PairingRefused(
                    409, "grant_not_requested", f"{wider[0]!r} was not asked for; grants narrow"
                )
            now = self._now()
            record.state = APPROVED
            record.granted = chosen
            record.expires_days = expires_days
            record.token = mint_token()
            record.peer_id = record.device_id or ids.mint("device")
            record.resolved_at = now
            record.expires_at = now + timedelta(seconds=WINDOW_TTL_S)
            return record

    def decline(self, pairing_id: str) -> PairingRecord:
        with self._lock:
            self.sweep()
            record = self._pending(pairing_id)
            record.state = DECLINED
            record.resolved_at = self._now()
            return record

    def claim(
        self, *, pairing_id: str = "", nonce: str = "", code: str = "", claim_secret: str = ""
    ) -> PairingRecord:
        """The approved record, once: the caller reads ``token`` and the book forgets it.

        Refused with the record's state: ``pending`` (202), ``declined`` (403), ``expired`` (410),
        ``claimed`` (410 ``claim_spent``).
        """
        with self._lock:
            self.sweep()
            record, by_nonce = self._find(pairing_id, nonce, code)
            if (not by_nonce or claim_secret) and not _secret_ok(record, claim_secret):
                self._wrong(record)
                raise PairingRefused(403, "wrong_secret", "claim_secret missing or wrong")
            if record.state in (OPEN, PENDING):
                raise PairingRefused(202, "pending", "not answered yet", PENDING)
            if record.state == DECLINED:
                raise PairingRefused(403, "pairing_declined", "the request was declined", DECLINED)
            if record.state == EXPIRED:
                raise PairingRefused(410, "pairing_expired", "the window closed", EXPIRED)
            if record.state == CLAIMED:
                raise PairingRefused(410, "claim_spent", "this pairing was claimed", CLAIMED)
            claimed = replace(record)
            record.state = CLAIMED
            record.token = ""
            record.resolved_at = self._now()
            return claimed

    def file_pair_back(
        self, *, device_id: str, name: object, requested_grants: Sequence[object], deliver_to: str
    ) -> PairingRecord:
        """The other PC asks to be let in here in return; this device's person decides."""
        if not ids.is_id("device", device_id):
            raise ValueError(f"not a device id: {device_id!r}")
        grants = ordered_grants(requested_grants)
        now = self._now()
        with self._lock:
            for record in self._records.values():
                same = record.direction == "pair_back" and record.device_id == device_id
                if same and record.state == PENDING:
                    record.state = EXPIRED  # superseded by the newer ask
                    record.resolved_at = now
            record = PairingRecord(
                pairing_id=ids.mint("pairing"),
                kind="pc",
                opened_at=now,
                expires_at=now + timedelta(seconds=PAIR_BACK_TTL_S),
                direction="pair_back",
                state=PENDING,
                name=clean_name(name, "A computer"),
                device_id=device_id,
                requested_grants=grants,
                deliver_to=deliver_to,
                address=urlsplit(deliver_to).hostname or "",
            )
            self._records[record.pairing_id] = record
            return record

    def delivered(self, pairing_id: str) -> None:
        """A pair-back token reached the asking PC; forget it."""
        with self._lock:
            record = self._records.get(pairing_id)
            if record is not None and record.state == APPROVED:
                record.state = CLAIMED
                record.token = ""
                record.resolved_at = self._now()

    def sweep(self) -> list[PairingRecord]:
        """Expire what has passed its stamp and drop what has been resolved long enough.

        Returns the records that expired *after approval*, whose rows the host removes.
        """
        now = self._now()
        lapsed: list[PairingRecord] = []
        with self._lock:
            for record in list(self._records.values()):
                if record.state in LIVE_STATES and record.expires_at <= now:
                    if record.state == APPROVED:
                        lapsed.append(record)
                    record.state = EXPIRED
                    record.token = ""
                    record.resolved_at = now
                done = record.resolved_at
                settled = record.state not in LIVE_STATES and done is not None
                if settled and done is not None and (now - done).total_seconds() > RETAIN_S:
                    del self._records[record.pairing_id]
        return lapsed

    # -- internals -----------------------------------------------------------------------------

    def _pending(self, pairing_id: str) -> PairingRecord:
        record = self._records.get(pairing_id)
        if record is None:
            raise PairingRefused(404, "pairing_unknown", "no such pairing")
        if record.state != PENDING:
            raise PairingRefused(409, "pairing_resolved", "not pending", record.state)
        return record

    def _find(self, pairing_id: str, nonce: str, code: str) -> tuple[PairingRecord, bool]:
        """The record a requester means, and whether it proved itself with the nonce."""
        if pairing_id:
            record = self._records.get(pairing_id)
            if record is None or record.direction != "inbound":
                raise PairingRefused(404, "pairing_unknown", "no such pairing")
            if not nonce or not secrets.compare_digest(nonce, record.nonce):
                self._wrong(record)
                raise PairingRefused(403, "wrong_nonce", "the nonce does not match")
            return record, True
        typed = normalize_code(code)
        for record in self._records.values():
            known = record.state in LIVE_STATES or record.state in (CLAIMED, DECLINED)
            if record.direction == "inbound" and typed and record.code == typed and known:
                return record, False
        self._wrong_codes += 1
        if self._wrong_codes >= WRONG_LIMIT:
            self._wrong_codes = 0
            for record in self._records.values():
                if record.state == OPEN:
                    record.state = EXPIRED
                    record.resolved_at = self._now()
        raise PairingRefused(403, "wrong_code", "no open window has that code")

    def _wrong(self, record: PairingRecord) -> None:
        record.wrong += 1
        if record.wrong >= WRONG_LIMIT and record.state in (OPEN, PENDING):
            record.state = EXPIRED
            record.resolved_at = self._now()


def _secret_ok(record: PairingRecord, claim_secret: str) -> bool:
    if not claim_secret or not record.claim_secret_sha:
        return False
    return secrets.compare_digest(_digest(claim_secret), record.claim_secret_sha)


def _fresh_code(taken: set[str]) -> str:
    while True:
        code = "".join(secrets.choice(CODE_ALPHABET) for _ in range(CODE_LENGTH))
        if code not in taken:
            return code

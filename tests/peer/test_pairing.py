"""The ceremony: one request per window, grants only narrow, one claim (ADR 0140, WP1 AC).

athena/peer/pairing.py, without sockets; the same steps over HTTP are in test_devices.py.
"""

from __future__ import annotations

import base64

import pytest

from athena.contracts import ids
from athena.peer.pairing import (
    CODE_ALPHABET,
    CODE_LENGTH,
    WINDOW_TTL_S,
    WRONG_LIMIT,
    PairingBook,
    PairingRefused,
)

from .conftest import Clock


def _refused(fn: object, *args: object, **kwargs: object) -> PairingRefused:
    with pytest.raises(PairingRefused) as caught:
        fn(*args, **kwargs)  # type: ignore[operator]
    return caught.value


def test_a_window_has_a_long_nonce_a_short_code_and_five_minutes() -> None:
    clock = Clock()
    book = PairingBook(now=clock)
    window = book.open_window("phone")
    assert ids.is_id("pairing", window.pairing_id)
    nonce_bits = len(base64.urlsafe_b64decode(window.nonce + "==")) * 8
    assert nonce_bits >= 96
    assert len(window.code) == CODE_LENGTH and set(window.code) <= set(CODE_ALPHABET)
    assert (window.expires_at - clock.now).total_seconds() == WINDOW_TTL_S
    assert book.window_open() and book.active()


def test_the_phone_path_requests_waits_and_claims_exactly_once() -> None:
    book = PairingBook(now=Clock())
    window = book.open_window("phone")
    record, _secret = book.request(
        pairing_id=window.pairing_id,
        nonce=window.nonce,
        name="Kazda's phone",
        kind="phone",
        requested_grants=["approve", "chat"],
    )
    assert record.state == "pending" and record.requested_grants == ["chat", "approve"]
    pending = _refused(book.claim, pairing_id=window.pairing_id, nonce=window.nonce)
    assert pending.status == 202

    approved = book.approve(window.pairing_id, ["chat"], None)
    minted = approved.token
    assert minted and ids.is_id("device", approved.peer_id or "")
    claimed = book.claim(pairing_id=window.pairing_id, nonce=window.nonce)
    assert claimed.token == minted
    assert book.get(window.pairing_id).token == ""  # type: ignore[union-attr]

    spent = _refused(book.claim, pairing_id=window.pairing_id, nonce=window.nonce)
    assert (spent.status, spent.error) == (410, "claim_spent")


def test_grants_may_only_narrow_what_was_asked() -> None:
    book = PairingBook(now=Clock())
    window = book.open_window("pc")
    book.request(code=window.code, name="Laptop", kind="pc", requested_grants=["chat"])
    wider = _refused(book.approve, window.pairing_id, ["chat", "memory"], None)
    assert (wider.status, wider.error) == (409, "grant_not_requested")
    assert book.approve(window.pairing_id, [], None).granted == []


def test_a_duplicate_cannot_reset_a_resolved_record() -> None:
    book = PairingBook(now=Clock())
    window = book.open_window("phone")
    book.request(pairing_id=window.pairing_id, nonce=window.nonce, name="Phone", kind="phone")
    book.decline(window.pairing_id)
    again = _refused(
        book.request, pairing_id=window.pairing_id, nonce=window.nonce, name="Phone", kind="phone"
    )
    assert (again.status, again.state) == (409, "declined")
    declined = _refused(book.claim, pairing_id=window.pairing_id, nonce=window.nonce)
    assert (declined.status, declined.state) == (403, "declined")


def test_the_code_path_needs_its_claim_secret_and_a_second_requester_is_turned_away() -> None:
    book = PairingBook(now=Clock())
    window = book.open_window("pc")
    device = ids.mint("device")
    _, secret = book.request(code=window.code.lower(), name="Laptop", kind="pc", device_id=device)
    taken = _refused(book.request, code=window.code, name="Intruder", kind="pc")
    assert taken.error == "window_taken"
    refreshed, same = book.request(
        code=window.code, claim_secret=secret, name="Laptop 2", kind="pc", device_id=device
    )
    assert same == secret and refreshed.name == "Laptop 2"

    book.approve(window.pairing_id, [], None)
    assert _refused(book.claim, code=window.code).error == "wrong_secret"
    assert book.claim(code=window.code, claim_secret=secret).peer_id == device


def test_wrong_codes_close_the_window() -> None:
    book = PairingBook(now=Clock())
    window = book.open_window("pc")
    for _ in range(WRONG_LIMIT):
        assert _refused(book.request, code="ZZZZZZZZ", name="x", kind="pc").error == "wrong_code"
    assert not book.window_open()
    closed = _refused(book.request, code=window.code, name="x", kind="pc")
    assert closed.error == "wrong_code"


def test_an_unclaimed_approval_lapses_and_is_handed_back_for_its_row() -> None:
    clock = Clock()
    book = PairingBook(now=clock)
    window = book.open_window("phone")
    book.request(pairing_id=window.pairing_id, nonce=window.nonce, name="Phone", kind="phone")
    record = book.approve(window.pairing_id, [], None)
    clock.advance(WINDOW_TTL_S + 1)
    lapsed = book.sweep()
    assert [r.pairing_id for r in lapsed] == [window.pairing_id]
    assert record.token == "" and not book.active()
    expired = _refused(book.claim, pairing_id=window.pairing_id, nonce=window.nonce)
    assert (expired.status, expired.state) == (410, "expired")


def test_a_refresh_by_nonce_never_hands_back_a_claim_secret_it_did_not_check() -> None:
    # The nonce proves the requester; a claim secret it sends along is only kept if it is the one
    # the book holds. Echoing an unchecked one back would leave the requester holding a secret
    # whose digest is not the record's, and every claim it then makes would be ``wrong_secret``.
    book = PairingBook(now=Clock())
    window = book.open_window("phone")
    _, first = book.request(
        pairing_id=window.pairing_id, nonce=window.nonce, name="P", kind="phone"
    )
    _, kept = book.request(
        pairing_id=window.pairing_id, nonce=window.nonce, claim_secret=first, name="P", kind="phone"
    )
    assert kept == first
    _, fresh = book.request(
        pairing_id=window.pairing_id,
        nonce=window.nonce,
        claim_secret="not-the-secret-this-book-gave",
        name="P",
        kind="phone",
    )
    assert fresh != "not-the-secret-this-book-gave"
    book.approve(window.pairing_id, [], None)
    claimed = book.claim(pairing_id=window.pairing_id, nonce=window.nonce, claim_secret=fresh)
    assert claimed.token

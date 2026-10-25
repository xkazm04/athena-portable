"""One link state per paired device, from named evidence (athena/peer/link.py, ADR 0140).

``derive`` is pure: each test hands it a row, a key, the hello the probe saw and a time.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, datetime, timedelta

from athena.peer import link
from athena.peer.link import STALE_AFTER_PASSES, HelloSeen
from athena.peer.presence import PRESENCE_EVERY_S

T = "2026-10-24T12:00:00+00:00"
T0 = datetime(2026, 10, 24, 12, 0, tzinfo=UTC)
CREATED = "2026-10-20T09:00:00+00:00"
EVIDENCE_KEYS = {"key", "hello", "hello_at", "overlay", "memory"}


@dataclass(frozen=True)
class Row:
    kind: str = "pc"
    created: str = CREATED


def test_case1_a_pc_with_no_key_is_awaiting_key_with_the_evidence_named() -> None:
    derived = link.derive(row=Row("pc"), key=None, hello=None, overlay=None)
    assert derived["state"] == "awaiting_key"
    assert derived["since"] == CREATED, "the wait began when the row was admitted"
    assert derived["evidence"]["key"] is False
    assert set(derived["evidence"]) == EVIDENCE_KEYS


def test_case4_a_200_hello_with_no_pass_for_three_periods_is_stale_since_it() -> None:
    hello = HelloSeen(200, since=T, at=T)
    window = STALE_AFTER_PASSES * PRESENCE_EVERY_S
    assert STALE_AFTER_PASSES == 3
    at_line = link.derive(Row(), "k", hello, now=T0 + timedelta(seconds=window))
    assert at_line["state"] == "online", "exactly three periods is still the last word"
    past = link.derive(Row(), "k", hello, now=T0 + timedelta(seconds=window + 1))
    assert past == {
        "state": "stale",
        "since": T,
        "evidence": {"key": True, "hello": 200, "hello_at": T, "overlay": None, "memory": None},
    }


def test_case4b_a_refusal_never_ages_into_stale() -> None:
    hello = HelloSeen(401, since=T, at=T)
    derived = link.derive(Row(), "k", hello, now=T0 + timedelta(days=3))
    assert derived["state"] == "removed_there" and derived["since"] == T


def test_case3b_a_memory_manifest_401_with_no_hello_is_removed_there() -> None:
    memory = {"state": "removed_there", "last_pull_at": T}
    derived = link.derive(Row(), "k", None, memory=memory)
    assert derived["state"] == "removed_there" and derived["since"] == T
    assert derived["evidence"]["memory"] == "removed_there"


def test_a_keyed_pc_never_probed_is_null_not_a_guess() -> None:
    assert link.derive(Row(), "k", None) == {
        "state": None,
        "since": None,
        "evidence": {"key": True, "hello": None, "hello_at": None, "overlay": None, "memory": None},
    }


def test_guard7_a_phone_is_phone_and_claims_nothing() -> None:
    derived = link.derive(Row("phone"), None, None)
    assert derived["state"] == "phone"
    assert derived["evidence"] == dict.fromkeys(EVIDENCE_KEYS)


def test_guard8_unreached_with_and_without_the_overlay_and_a_200() -> None:
    unreached = HelloSeen(0, since=T, at=T)
    assert link.derive(Row(), "k", unreached, overlay=True)["state"] == "asleep"
    assert link.derive(Row(), "k", unreached, overlay=False)["state"] == "unreachable"
    assert link.derive(Row(), "k", unreached)["state"] == "unreachable", "no overlay to ask"
    online = link.derive(Row(), "k", HelloSeen(200, since=T, at=T), now=T0)
    assert online["state"] == "online" and online["since"] == T


def test_derive_is_a_pure_function_of_its_observations() -> None:
    hello = HelloSeen(0, since=T, at=T, overlay=True)
    now = T0 + timedelta(seconds=10)
    assert link.derive(Row(), "k", hello, now=now) == link.derive(Row(), "k", hello, now=now)
    assert set(link.LINK_STATES) == {
        "phone",
        "awaiting_key",
        "online",
        "stale",
        "asleep",
        "unreachable",
        "removed_there",
    }

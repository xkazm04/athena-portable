"""One UTC stamp for every row the core writes (contracts/channel.py ``iso`` / ``now_iso``).

The ledger, the approvals table and the brain's sessions compare these strings with ``<=`` in SQL,
so a stamp must carry an explicit UTC offset whatever zone the moment arrived in: then the strings
sort the way the instants do, and every one parses back to the instant it was written from.
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta, timezone

from athena.contracts import iso, now_iso


def test_a_naive_moment_is_read_as_utc() -> None:
    assert iso(datetime(2026, 10, 21, 9, 30)) == "2026-10-21T09:30:00+00:00"


def test_an_aware_moment_is_moved_to_utc() -> None:
    prague = timezone(timedelta(hours=2))
    assert iso(datetime(2026, 10, 21, 11, 30, tzinfo=prague)) == "2026-10-21T09:30:00+00:00"


def test_stamps_sort_the_way_the_instants_do() -> None:
    later_but_east = datetime(2026, 10, 21, 11, 0, tzinfo=timezone(timedelta(hours=3)))  # 08:00 UTC
    earlier_but_west = datetime(2026, 10, 21, 7, 30, tzinfo=UTC)
    assert later_but_east > earlier_but_west
    assert iso(later_but_east) > iso(earlier_but_west)


def test_a_stamp_parses_back_to_its_instant() -> None:
    moment = datetime(2026, 10, 21, 9, 30, 15, 123456, tzinfo=UTC)
    assert datetime.fromisoformat(iso(moment)) == moment


def test_now_is_a_utc_stamp() -> None:
    stamp = now_iso()
    assert stamp.endswith("+00:00")
    assert abs(datetime.fromisoformat(stamp) - datetime.now(UTC)) < timedelta(minutes=1)

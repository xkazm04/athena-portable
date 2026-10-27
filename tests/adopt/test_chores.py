"""Chores come due, as a staged review (ADR 0131): the cadence, the loop and the review.

Every test runs on a fake clock: the loop's ``tick`` is called with the moment it is to believe,
so "three periods in the past", "a restart after the advance" and "a DST change" are exact.
"""

from __future__ import annotations

import calendar
from datetime import UTC, date, datetime, timedelta, tzinfo
from pathlib import Path
from typing import Any

import pytest

from athena.adopt import cadence as cad
from athena.adopt.cadence import CadenceBook, QuietWindow
from athena.adopt.cases import CaseBook, render_case
from athena.adopt.chores import CLAIM_HORIZON, ChoreClock, assemble, portals_of
from athena.contracts import ids
from athena.contracts.adopt import (
    ASK_SLOW_AFTER,
    CadenceRule,
    Case,
    CaseSlot,
    Receipt,
    ReceiptCard,
    ReceiptNote,
)
from athena.contracts.channel import iso
from athena.core.brain import Brain, paths, reconcile_from_disk

MONDAY = CadenceRule(kind="weekly", weekday=0, at="09:00")
#: Monday 19 October 2026, 09:00 UTC.
T0 = datetime(2026, 10, 19, 9, 0, tzinfo=UTC)
#: No quiet hours, so a notice is deliverable at any hour unless a test sets a window.
NEVER_QUIET = QuietWindow(start="00:00", end="00:00", timezone="UTC")


class EuroZone(tzinfo):
    """CET/CEST by the EU rule (last Sunday of March and of October, 01:00 UTC), written here so
    the DST test needs no zone database (this install may carry none)."""

    STD, DST = timedelta(hours=1), timedelta(hours=2)

    @staticmethod
    def _last_sunday(year: int, month: int) -> datetime:
        last = calendar.monthrange(year, month)[1]
        day = date(year, month, last)
        day -= timedelta(days=(day.weekday() - 6) % 7)
        return datetime(day.year, day.month, day.day, 1, 0)

    def _summer(self, utc_naive: datetime) -> bool:
        y = utc_naive.year
        return self._last_sunday(y, 3) <= utc_naive < self._last_sunday(y, 10)

    def utcoffset(self, dt: datetime | None) -> timedelta:
        if dt is None:
            return self.STD
        naive = dt.replace(tzinfo=None)
        return self.DST if self._summer(naive - self.STD) else self.STD

    def dst(self, dt: datetime | None) -> timedelta:
        return self.utcoffset(dt) - self.STD

    def tzname(self, dt: datetime | None) -> str:
        return "CEST" if self.dst(dt) else "CET"

    def fromutc(self, dt: datetime) -> datetime:
        naive = dt.replace(tzinfo=None)
        return dt + (self.DST if self._summer(naive) else self.STD)


EURO = EuroZone()


@pytest.fixture(autouse=True)
def _zones(monkeypatch: pytest.MonkeyPatch) -> None:
    """``Test/Euro`` is :class:`EuroZone`; every other name resolves as the module would."""
    real = cad.zone

    def zone(name: str) -> tuple[tzinfo, str]:
        return (EURO, "") if name == "Test/Euro" else real(name)

    monkeypatch.setattr(cad, "zone", zone)


def _case(brain: Brain, **over: Any) -> Case:
    case = Case(
        id=over.pop("case_id", ids.mint("project")),
        playbook_id=over.pop("playbook_id", "demo"),
        title=over.pop("title", "Demo"),
        approved_rev=1,
        approved_at=iso(T0),
        episode_id="",
        created=iso(T0),
        command="Chase every overdue invoice.",
        **over,
    )
    brain.write_goal(
        case.id,
        case.title,
        render_case(case),
        session_id=ids.conversation_for_project(case.id),
        created=case.created,
    )
    return case


def _clock(brain: Brain, playbook: dict[str, Any] | None = None) -> ChoreClock:
    clock = ChoreClock(
        CadenceBook(brain), CaseBook(brain), playbook=lambda _id: playbook or {"apps": []}
    )
    clock.set_quiet(NEVER_QUIET, now=T0)
    return clock


@pytest.fixture
def brain(tmp_path: Path) -> Brain:
    b = Brain(tmp_path / "brain")
    yield b
    b.close()


# --- the rule ------------------------------------------------------------------------------------


def test_the_rule_is_validated_at_the_door() -> None:
    assert cad.rule_from({"kind": "weekly", "weekday": 3, "at": "07:30"}).weekday == 3
    every = cad.rule_from({"kind": "every_days", "every_days": 14}, today=date(2026, 10, 1))
    assert every.start == "2026-10-15"
    for bad, says in (
        ({"kind": "hourly"}, "rule.kind"),
        ({"kind": "weekly", "weekday": 7}, "weekday"),
        ({"kind": "weekly", "weekday": True}, "weekday"),
        ({"kind": "monthly", "day": 0}, "day"),
        ({"kind": "every_days", "every_days": 400}, "every_days"),
        ({"kind": "weekly", "weekday": 0, "at": "9:00"}, "HH:MM"),
        ({"kind": "every_days", "every_days": 3, "start": "2026-02-30"}, "not a date"),
    ):
        with pytest.raises(ValueError, match=says):
            cad.rule_from(bad)


def test_next_after_is_strictly_after_and_clamps_a_short_month() -> None:
    assert cad.next_after(MONDAY, UTC, T0) == T0 + timedelta(days=7)
    assert cad.next_after(MONDAY, UTC, T0 - timedelta(seconds=1)) == T0
    last = CadenceRule(kind="monthly", day=31, at="09:00")
    assert cad.next_after(last, UTC, datetime(2026, 11, 1, tzinfo=UTC)) == datetime(
        2026, 11, 30, 9, 0, tzinfo=UTC
    )
    every = CadenceRule(kind="every_days", every_days=10, start="2026-10-01", at="09:00")
    assert cad.next_after(every, UTC, datetime(2026, 10, 25, tzinfo=UTC)) == datetime(
        2026, 10, 31, 9, 0, tzinfo=UTC
    )
    assert cad.next_after(every, UTC, datetime(2026, 9, 1, tzinfo=UTC)) == datetime(
        2026, 10, 1, 9, 0, tzinfo=UTC
    )


def test_a_weekly_monday_nine_stays_nine_local_across_the_dst_change() -> None:
    # 25 October 2026 is the last Sunday of October: CEST before it, CET after.
    before = cad.next_after(MONDAY, EURO, datetime(2026, 10, 18, tzinfo=UTC))
    after = cad.next_after(MONDAY, EURO, before)
    assert before == datetime(2026, 10, 19, 7, 0, tzinfo=UTC)  # 09:00 CEST
    assert after == datetime(2026, 10, 26, 8, 0, tzinfo=UTC)  # 09:00 CET
    assert before.astimezone(EURO).hour == after.astimezone(EURO).hour == 9


def test_the_real_zone_database_agrees_where_this_install_has_one() -> None:
    try:
        from zoneinfo import ZoneInfo

        prague = ZoneInfo("Europe/Prague")
    except Exception:  # Windows without tzdata: EuroZone above carries the claim
        pytest.skip("no zone database on this install")
    a = cad.next_after(MONDAY, prague, datetime(2026, 10, 18, tzinfo=UTC))
    b = cad.next_after(MONDAY, prague, a)
    assert (a.hour, b.hour) == (7, 8)


def test_the_suggestion_comes_from_times_per_year_and_says_so() -> None:
    today = date(2026, 10, 22)
    assert cad.suggest(52, today)[0] == MONDAY
    assert cad.suggest(50, today)[0] == MONDAY
    assert cad.suggest(12, today)[0] == CadenceRule(kind="monthly", day=1, at="09:00")
    quarterly, basis = cad.suggest(4, today)
    assert quarterly == CadenceRule(kind="every_days", every_days=91, start="2027-01-21")
    assert basis == "the playbook says 4 times a year"
    assert cad.suggest(None, today)[0] is None
    assert cad.suggest(0, today)[0] is None


def test_quiet_hours_pin_their_edges() -> None:
    night = QuietWindow(start="21:00", end="08:00", timezone="UTC")
    at = lambda h, m=0: datetime(2026, 10, 19, h, m, tzinfo=UTC)  # noqa: E731
    assert not cad.quiet_at(night, at(20, 59))
    assert cad.quiet_at(night, at(21, 0))  # the start is inside
    assert cad.quiet_at(night, at(3))
    assert cad.quiet_at(night, at(7, 59))
    assert not cad.quiet_at(night, at(8, 0))  # the end is not
    day = QuietWindow(start="12:00", end="13:00", timezone="UTC")
    assert cad.quiet_at(day, at(12, 30)) and not cad.quiet_at(day, at(13))
    assert not cad.quiet_at(QuietWindow("09:00", "09:00", "UTC"), at(9))  # equal: never quiet
    assert cad.quiet_until(night, at(23)) == datetime(2026, 10, 20, 8, 0, tzinfo=UTC)
    assert cad.quiet_until(night, at(10)) is None


# --- the loop ------------------------------------------------------------------------------------


def test_three_missed_periods_open_exactly_one_review_naming_two_missed(brain: Brain) -> None:
    case = _case(brain)
    clock = _clock(brain)
    clock.set_cadence(case.id, rule=MONDAY, timezone="UTC", enabled=True, now=T0 - timedelta(1))
    assert clock.book.load(case.id).next_run_at == iso(T0)  # type: ignore[union-attr]

    # The daemon was down three Mondays; it wakes the Tuesday after the third.
    now = T0 + timedelta(days=14, hours=25)
    assert clock.tick(now) == 1
    held = clock.book.load(case.id)
    assert held is not None and held.review is not None
    assert held.review.due_at == iso(T0)
    assert held.review.missed == 2
    assert held.review.missed_at == (iso(T0 + timedelta(days=7)), iso(T0 + timedelta(days=14)))
    assert held.next_run_at == iso(T0 + timedelta(days=21))
    assert [line.event for line in held.log] == ["set", "fired"]
    assert "2 missed occurrences folded into it" in held.log[-1].text
    notices = clock.due(now)["notices"]
    assert len(notices) == 1 and notices[0]["missed"] == 2

    # A later tick before the next Monday changes nothing.
    assert clock.tick(now + timedelta(hours=1)) == 0


def test_a_crash_after_the_advance_does_not_notify_twice(brain: Brain) -> None:
    case = _case(brain)
    clock = _clock(brain)
    clock.set_cadence(case.id, rule=MONDAY, timezone="UTC", enabled=True, now=T0 - timedelta(1))
    clock.tick(T0 + timedelta(minutes=1))  # advanced and persisted; no notice shown yet

    # The daemon dies here. A new one, on the same brain, ticks again.
    again = _clock(brain)
    assert again.tick(T0 + timedelta(minutes=2)) == 0
    first = again.due(T0 + timedelta(minutes=2))["notices"]
    assert [n["due_at"] for n in first] == [iso(T0)]
    again.answer(case.id, iso(T0), "seen", now=T0 + timedelta(minutes=3))
    assert again.due(T0 + timedelta(minutes=4))["notices"] == []
    assert again.tick(T0 + timedelta(minutes=5)) == 0
    assert again.due(T0 + timedelta(minutes=5))["notices"] == []
    # Seen twice is still once.
    again.answer(case.id, iso(T0), "seen", now=T0 + timedelta(minutes=6))
    events = [ln.event for ln in again.book.load(case.id).log]  # type: ignore[union-attr]
    assert events.count("fired") == 1 and events.count("delivered") == 1


def test_a_paused_cadence_never_fires_and_says_what_it_skipped(brain: Brain) -> None:
    case = _case(brain)
    clock = _clock(brain)
    clock.set_cadence(case.id, rule=MONDAY, timezone="UTC", enabled=False, now=T0 - timedelta(1))
    for week in range(5):
        clock.tick(T0 + timedelta(days=7 * week, minutes=1))
    held = clock.book.load(case.id)
    assert held is not None and held.review is None
    assert clock.due(T0 + timedelta(days=30))["notices"] == []
    skipped = [ln for ln in held.log if ln.event == "skipped"]
    assert len(skipped) == 5 and skipped[0].text.startswith("paused: 1 occurrence passed")
    # Resuming starts from now: nothing fires for the weeks it was paused.
    clock.set_cadence(case.id, rule=None, timezone=None, enabled=True, now=T0 + timedelta(29))
    assert clock.tick(T0 + timedelta(days=30)) == 0
    assert clock.book.load(case.id).log[-1].event == "resumed"  # type: ignore[union-attr]


def test_quiet_hours_hold_the_notice_and_never_the_advance(brain: Brain) -> None:
    case = _case(brain)
    clock = _clock(brain)
    clock.set_quiet(QuietWindow(start="21:00", end="08:00", timezone="UTC"), now=T0)
    late = CadenceRule(kind="weekly", weekday=0, at="22:00")
    clock.set_cadence(case.id, rule=late, timezone="UTC", enabled=True, now=T0)
    due = datetime(2026, 10, 19, 22, 0, tzinfo=UTC)

    clock.tick(due + timedelta(minutes=1))
    held = clock.book.load(case.id)
    assert held is not None and held.review is not None
    assert held.next_run_at == iso(due + timedelta(days=7))  # advanced in the quiet
    assert held.review.held_at and held.log[-1].event == "held"
    night = clock.due(due + timedelta(minutes=1))
    assert night["notices"] == [] and night["held"] == 1 and night["quiet"]["now"] is True
    assert night["quiet"]["until"] == iso(datetime(2026, 10, 20, 8, 0, tzinfo=UTC))

    morning = clock.due(datetime(2026, 10, 20, 8, 0, tzinfo=UTC))
    assert [n["due_at"] for n in morning["notices"]] == [iso(due)]
    # The hold is logged once, however many ticks the night holds.
    clock.tick(due + timedelta(hours=2))
    log = clock.book.load(case.id).log  # type: ignore[union-attr]
    assert [ln.event for ln in log].count("held") == 1


def test_a_dst_change_keeps_the_fire_at_local_nine(brain: Brain) -> None:
    case = _case(brain)
    clock = _clock(brain)
    clock.set_cadence(
        case.id,
        rule=MONDAY,
        timezone="Test/Euro",
        enabled=True,
        now=datetime(2026, 10, 18, tzinfo=UTC),
    )
    clock.tick(datetime(2026, 10, 19, 7, 1, tzinfo=UTC))
    first = clock.book.load(case.id).review  # type: ignore[union-attr]
    assert first is not None and first.due_at == iso(datetime(2026, 10, 19, 7, 0, tzinfo=UTC))
    clock.answer(case.id, first.due_at, "skip", now=datetime(2026, 10, 19, 8, tzinfo=UTC))
    held = clock.book.load(case.id)
    assert held is not None and held.next_run_at == iso(datetime(2026, 10, 26, 8, 0, tzinfo=UTC))
    clock.tick(datetime(2026, 10, 26, 8, 1, tzinfo=UTC))
    second = clock.book.load(case.id).review  # type: ignore[union-attr]
    assert second is not None
    for review in (first, second):
        assert datetime.fromisoformat(review.due_at).astimezone(EURO).hour == 9


def test_no_second_review_opens_while_one_is_open(brain: Brain) -> None:
    case = _case(brain)
    clock = _clock(brain)
    clock.set_cadence(case.id, rule=MONDAY, timezone="UTC", enabled=True, now=T0 - timedelta(1))
    clock.tick(T0 + timedelta(minutes=1))
    clock.tick(T0 + timedelta(days=7, minutes=1))
    held = clock.book.load(case.id)
    assert held is not None and held.review is not None
    assert held.review.due_at == iso(T0) and held.review.missed == 1
    assert held.log[-1].event == "coalesced" and "no second review" in held.log[-1].text
    # Never shown, so the chore is not counted as ignored.
    assert held.unanswered == 0
    assert len(clock.due(T0 + timedelta(days=7, minutes=2))["notices"]) == 1


def test_one_cadence_that_cannot_be_written_does_not_hold_back_the_others(
    brain: Brain, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    # On Windows a file another program holds open cannot be replaced: that chore's write fails,
    # and every chore after it on disk must still come due on this tick.
    first, second = sorted((_case(brain), _case(brain)), key=lambda c: c.id)
    clock = _clock(brain)
    for case in (first, second):
        clock.set_cadence(case.id, rule=MONDAY, timezone="UTC", enabled=True, now=T0 - timedelta(1))
    real_save = clock.book.save

    def save(cadence: Any, title: str) -> Any:
        if cadence.case_id == first.id:
            raise PermissionError("the file is open in another program")
        return real_save(cadence, title)

    monkeypatch.setattr(clock.book, "save", save)
    assert clock.tick(T0 + timedelta(minutes=1)) == 1
    held = clock.book.load(second.id)
    assert held is not None and held.review is not None and held.review.due_at == iso(T0)
    assert clock.book.load(first.id).review is None  # type: ignore[union-attr]
    assert clock.ticked_at == iso(T0 + timedelta(minutes=1))
    err = capsys.readouterr().err
    assert first.id in err and "PermissionError" in err


def test_three_unanswered_in_a_row_asks_pause_or_slow(brain: Brain) -> None:
    case = _case(brain)
    clock = _clock(brain)
    clock.set_cadence(case.id, rule=MONDAY, timezone="UTC", enabled=True, now=T0 - timedelta(1))
    clock.tick(T0 + timedelta(minutes=1))
    clock.answer(case.id, iso(T0), "seen", now=T0 + timedelta(minutes=2))
    for week in range(1, ASK_SLOW_AFTER + 1):
        review = clock.review_of(case.id)
        assert review is not None and review.ask_slow is False
        clock.tick(T0 + timedelta(days=7 * week, minutes=1))
    review = clock.review_of(case.id)
    assert review is not None and review.unanswered == ASK_SLOW_AFTER and review.ask_slow
    # An answer resets it, and changes nothing about the cadence itself.
    clock.answer(case.id, iso(T0), "skip", now=T0 + timedelta(days=22))
    after = clock.book.load(case.id)
    assert after is not None and after.unanswered == 0 and after.enabled
    assert after.rule == MONDAY


def test_the_first_turn_after_open_and_prepare_is_claimed_once(brain: Brain) -> None:
    case = _case(brain)
    clock = _clock(brain)
    clock.set_cadence(case.id, rule=MONDAY, timezone="UTC", enabled=True, now=T0 - timedelta(1))
    clock.tick(T0 + timedelta(minutes=1))
    turn, later = ids.mint("turn"), ids.mint("turn")
    assert not clock.claim_first_turn(case.id, turn, now=T0 + timedelta(minutes=2))  # no answer
    clock.answer(case.id, iso(T0), "prepare", now=T0 + timedelta(minutes=3))
    assert clock.claim_first_turn(case.id, turn, now=T0 + timedelta(minutes=4))
    assert not clock.claim_first_turn(case.id, later, now=T0 + timedelta(minutes=5))
    review = clock.book.load(case.id).review  # type: ignore[union-attr]
    assert review is not None and review.first_turn_id == turn

    # A prepare left too long is not a scheduled run any more.
    other = _case(brain)
    clock.set_cadence(other.id, rule=MONDAY, timezone="UTC", enabled=True, now=T0 - timedelta(1))
    clock.tick(T0 + timedelta(minutes=1))
    clock.answer(other.id, iso(T0), "prepare", now=T0 + timedelta(minutes=2))
    stale = T0 + timedelta(minutes=2) + CLAIM_HORIZON + timedelta(seconds=1)
    assert not clock.claim_first_turn(other.id, ids.mint("turn"), now=stale)


def test_reconcile_after_deleting_the_index_restores_the_cadence(tmp_path: Path) -> None:
    root = tmp_path / "brain"
    brain = Brain(root)
    case = _case(brain)
    clock = _clock(brain)
    set_ = clock.set_cadence(case.id, rule=MONDAY, timezone="UTC", enabled=True, now=T0)
    brain.close()
    paths.index_path(root).unlink()

    rebuilt = Brain(root)
    try:
        stats = reconcile_from_disk(rebuilt)
        assert not stats.skipped
        assert stats.by_kind.get("ritual") == 2  # the cadence and the quiet hours
        assert stats.by_kind.get("goal") == 1  # the case keeps its own id
        rows = rebuilt.rituals("cadence")
        assert [r.id for r in rows] == [set_.id]
        assert CadenceBook(rebuilt).load(case.id) == set_
    finally:
        rebuilt.close()


def test_a_ritual_is_written_only_where_the_tree_reserves_one(brain: Brain) -> None:
    rid = ids.mint("ritual")
    for args, says in (
        (("proj_0123456789ab", "cadence", "x"), "minted ritual id"),
        ((rid, "elsewhere", "x"), "not a ritual folder"),
        ((rid, "cadence", "../goals/x"), "lowercase slug"),
    ):
        with pytest.raises(ValueError, match=says):
            brain.write_ritual(*args, "T", "body", session_id="conv_x", created=iso(T0))


def test_the_file_reads_for_a_person_and_round_trips(brain: Brain) -> None:
    case = _case(brain, title="Chase the invoices")
    clock = _clock(brain)
    saved = clock.set_cadence(case.id, rule=MONDAY, timezone="UTC", enabled=True, now=T0)
    text = (brain.root / "rituals" / "cadence" / f"{case.id}.md").read_text(encoding="utf-8")
    head = f'---\nid: "{saved.id}"\ntype: ritual\ntitle: "When Chase the invoices comes due"\n'
    assert text.startswith(head)
    assert "every Monday at 09:00" in text
    assert cad.parse_cadence(text.split("---\n", 2)[2]) == saved


# --- the review ----------------------------------------------------------------------------------


def _receipt(case_id: str) -> Receipt:
    def card(n: int, status: str) -> ReceiptCard:
        return ReceiptCard(
            id=f"apr_{n:012x}",
            action=f"host.invoices.{status}",
            status=status,
            consumed=False,
            created_at=iso(T0 + timedelta(minutes=n)),
            resolved_at=iso(T0 + timedelta(minutes=n + 1)),
            params={"invoice": str(n)},
        )

    return Receipt(
        case_id=case_id,
        conversation_id="",
        until=iso(T0 + timedelta(hours=1)),
        closed_at=iso(T0 + timedelta(hours=1)),
        approved=1,
        declined=1,
        expired=1,
        cards=(card(1, "approved"), card(2, "declined"), card(3, "expired")),
        cards_total=3,
        notes=(ReceiptNote(episode_id="ep_00000001", at=iso(T0), text="may have completed"),),
        notes_total=1,
        closed_by="done",
    )


def test_the_review_lists_what_to_check_first_and_calls_no_model(brain: Brain) -> None:
    case = _case(brain)
    CaseBook(brain).append_receipt(case.id, _receipt(case.id))
    clock = _clock(brain)
    clock.set_cadence(case.id, rule=MONDAY, timezone="UTC", enabled=True, now=T0)
    review = clock.review_of(case.id)
    assert review is not None
    assert [ln.kind for ln in review.lines] == [
        "expired",
        "may_have_completed",
        "approved",
        "declined",
    ]
    assert review.lines[2].at == iso(T0 + timedelta(minutes=2))  # approved, and when
    assert review.command == case.command
    assert review.next_run_at == iso(T0 + timedelta(days=7))
    assert review.lines_footer == ""
    assert review.last_run_at == iso(T0 + timedelta(hours=1))


def test_open_and_prepare_addresses_are_the_playbooks_or_the_cases_never_a_name() -> None:
    case = Case(
        id=ids.mint("project"),
        playbook_id="demo",
        title="Demo",
        approved_rev=1,
        approved_at=iso(T0),
        episode_id="",
        created=iso(T0),
        portals={"Ledgerwren": "", "Postwren": "Gmail", "Calcwren": ""},
        slots=(
            CaseSlot(id="p2", kind="portal", label="?", value="https://mail.google.com/"),
            CaseSlot(id="p3", kind="portal", label="?", value="Calcwren"),
        ),
    )
    playbook = {
        "apps": [
            {"name": "Ledgerwren", "url": "https://ledgerwren.test/"},
            {"name": "Postwren", "url": "https://postwren.test/"},
            {"name": "Calcwren", "url": ""},
        ]
    }
    portals = portals_of(case, playbook)
    assert [(p.name, p.url, p.source) for p in portals] == [
        ("Ledgerwren", "https://ledgerwren.test/", "playbook"),
        # She uses Gmail, not the playbook's Postwren: its address is not hers.
        ("Gmail", "https://mail.google.com/", "case"),
        ("Calcwren", "", ""),
    ]
    assert assemble(case, None, [], playbook).portals == portals


# --- the suggestion anchored to her case (B-C8) --------------------------------------------------

PROTEST = (
    "Your property-tax protest.\n\n"
    "**Dates that matter:**\n"
    "- Protest deadline: May 15, 2026 (Texas Tax Code). If missed: the value stands for a year."
)
TWO_DATES = (
    "Two dates.\n\n"
    "**Dates that matter:**\n"
    "- Exemption filing: June 30 (county rule). If missed: no exemption this year.\n"
    "- Protest deadline: 15 May. If missed: the value stands for a year."
)
RULE_ONLY = (
    "A rule, no date.\n\n"
    "**Dates that matter:**\n"
    "- Protest deadline: 30 days after the notice arrives. If missed: the value stands."
)


def _yearly(start: str) -> CadenceRule:
    return CadenceRule(kind="every_days", every_days=365, start=start, at="09:00")


def test_case_1_a_yearly_chore_comes_due_two_weeks_before_her_brief_deadline() -> None:
    rule, basis = cad.suggest_for_case(1, PROTEST, (), date(2026, 10, 25))
    assert rule == _yearly("2027-05-01")
    assert "Protest deadline" in basis and "May 15" in basis and "two weeks before" in basis


def test_case_2_this_years_date_still_ahead_is_the_anchor() -> None:
    rule, _ = cad.suggest_for_case(1, PROTEST, (), date(2026, 3, 1))
    assert rule == _yearly("2026-05-01")


def test_case_3_inside_the_two_weeks_it_comes_due_tomorrow_still_before_the_date() -> None:
    rule, basis = cad.suggest_for_case(1, PROTEST, (), date(2026, 5, 10))
    assert rule == _yearly("2026-05-11")
    assert "before May 15" in basis


def test_case_4_of_two_dated_lines_the_first_to_come_round_anchors() -> None:
    rule, basis = cad.suggest_for_case(1, TWO_DATES, (), date(2026, 10, 25))
    assert rule == _yearly("2027-05-01")
    assert "May 15" in basis and "June 30" not in basis


def test_case_5_a_date_that_names_only_a_rule_is_not_an_anchor() -> None:
    today = date(2026, 10, 25)
    rule, basis = cad.suggest_for_case(1, RULE_ONLY, (), today)
    plain, plain_basis = cad.suggest(1, today)
    assert rule == plain
    assert basis.startswith(plain_basis) and "no calendar date" in basis
    # "may 30 days after" is a verb before a rule, never 30 May.
    assert cad.calendar_date("the county may 30 days after the notice") is None


def test_case_6_other_counts_get_exactly_todays_suggestion() -> None:
    today = date(2026, 10, 25)
    for times in (12, 52, None):
        assert cad.suggest_for_case(times, PROTEST, (), today) == cad.suggest(times, today)


def test_case_7_a_confirmed_date_fact_anchors_when_the_brief_has_no_date() -> None:
    notice = CaseSlot(
        id="f1", kind="fact", label="Notice date", status="confirmed", value="2026-04-20"
    )
    rule, basis = cad.suggest_for_case(1, RULE_ONLY, (notice,), date(2026, 10, 25))
    assert rule == _yearly("2027-04-06")
    assert "Notice date" in basis and "your case" in basis


def test_case_8_the_cadence_route_suggests_from_the_saved_case(brain: Brain) -> None:
    from athena.adopt.chores import case_route
    from athena.daemon.routes import Request

    case = _case(brain, brief_md=PROTEST)
    clock = _clock(brain, {"economics": {"times_per_year": 1}, "apps": []})
    clock.clock = lambda: datetime(2026, 10, 25, 9, 0, tzinfo=UTC)
    status, reply = case_route(
        clock, Request("GET", f"/adopt/cases/{case.id}/cadence"), case.id, "cadence"
    )
    assert status == 200 and reply["cadence"] is None
    assert reply["suggested"]["start"] == "2027-05-01"
    assert "Protest deadline" in reply["suggested_basis"]

"""ADR 0131 (chores come due, as a staged review): a chore's cadence, kept as a ritual in the brain.

A case (ADR 0123) is a chore a person runs again. When it comes due is **durable data**, not a
timer: ``rituals/cadence/<proj>.md`` holds the rule she confirmed, the zone it is read in, the
computed ``next_run_at``, ``last_run_at``, the one review that may be open, and a log of every
decision about it. The loop that reads it (:mod:`athena.adopt.chores`) is cheap and dumb; this
module is the data and the one calendar function.

**The rule** is one of three shapes and nothing else (scheduling ``next-run-computation``): a
weekday, a day of the month, or every N days from a first date, each at a local ``HH:MM``.
Validated at the door (:func:`rule_from`), so a rule that would fail when it first comes due is
refused when it is written. :func:`next_after` is the only place calendar math happens: it
computes in the rule's own zone and answers a UTC instant, so "Monday 09:00" stays 09:00 local
across a DST change; a time inside a spring-forward gap falls an hour later that day, once, and a
time that repeats at fall-back is its first occurrence. A monthly day past the month's end is
the month's last day. ``next_run_at`` is a cache of the rule and is recomputed on every change
of the rule, the zone or ``enabled``.

**The zone.** The desktop sends the person's IANA zone name. This install may carry no zone
database (Windows without ``tzdata``; the core stays stdlib-only, ADR 0002), so a name the
install does not know is read as the computer's own local time, which is the same zone for a
person setting a chore on her own machine, and the cadence says so (:func:`zone`).

**The file.** The ritual header is the goal's five keys with ``type: ritual`` and a minted
``rit_`` id (the case's ``proj_`` id is the goal's, and one id in two files is a collision the
rebuild refuses); the body is for a person (the rule, what is next, the log), then a marker line
and one JSON block, the :class:`~athena.contracts.adopt.Cadence`. The reader takes the last
marker. Deleting ``index.sqlite`` loses nothing: the loop reads the files, and the rebuild indexes
them again as kind ``ritual``.

**Quiet hours** are a ritual too, ``rituals/quiet_hours/chores.md``: one window in local
wall-clock time that usually wraps midnight. Nothing read that folder before; the chores loop is
its first reader. With no file the window is :data:`DEFAULT_QUIET` (proactive-nudges
``quiet-windows``: the people most harmed by a 03:00 notice are the ones who never open
settings).
"""

from __future__ import annotations

import calendar
import json
import re
import threading
import time
from collections.abc import Mapping, Sequence
from dataclasses import asdict, dataclass, replace
from datetime import UTC, date, datetime, timedelta, tzinfo
from pathlib import Path
from typing import Any
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from athena.contracts import ids
from athena.contracts.adopt import (
    CADENCE_KINDS,
    CADENCE_SCHEMA,
    Cadence,
    CadenceKind,
    CadenceLine,
    CadenceRule,
    CaseSlot,
    ChoreReview,
    ReviewAnswer,
)
from athena.contracts.channel import iso
from athena.core.brain import frontmatter
from athena.core.brain.store import Brain

__all__ = [
    "CADENCE_MARKER",
    "DEFAULT_QUIET",
    "LOG_KEEP",
    "SYSTEM_ZONE",
    "CadenceBook",
    "CadenceUnreadable",
    "QuietWindow",
    "brief_dates",
    "calendar_date",
    "next_after",
    "occurrences",
    "parse_cadence",
    "quiet_at",
    "quiet_until",
    "render_cadence",
    "rule_from",
    "rule_text",
    "suggest",
    "suggest_for_case",
    "with_line",
    "zone",
]

CADENCE_MARKER = "<!-- athena:cadence -->"
QUIET_MARKER = "<!-- athena:quiet -->"
_OPEN = "```json"
_CLOSE = "```"
#: How many log lines the file keeps; ``log_total`` counts every one ever written.
LOG_KEEP = 40
#: The most missed due times a review lists by date; ``missed`` counts them all.
MISSED_KEEP = 10
_AT = re.compile(r"([01]\d|2[0-3]):([0-5]\d)\Z")
_DAY = re.compile(r"\d{4}-\d{2}-\d{2}\Z")
_WEEKDAYS = ("Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday")
QUIET_NAME = "chores"


class CadenceUnreadable(ValueError):
    """A cadence file this module cannot read (no block, bad JSON, wrong schema)."""


# --- the zone ------------------------------------------------------------------------------------


class _SystemLocal(tzinfo):
    """This computer's local time, DST included, from the C library's own tables.

    ``datetime.astimezone()`` with no argument answers a *fixed* offset, the one in force now,
    which would move a Monday 09:00 an hour across a DST change; this asks the platform for each
    instant instead. Used only when the person's IANA zone is not known to this install.
    """

    def utcoffset(self, dt: datetime | None) -> timedelta:
        if dt is None:
            return timedelta(seconds=time.localtime().tm_gmtoff)
        fields = (dt.year, dt.month, dt.day, dt.hour, dt.minute, dt.second, 0, 1, -1)
        stamp = time.mktime(fields)
        return timedelta(seconds=time.localtime(stamp).tm_gmtoff)

    def dst(self, dt: datetime | None) -> timedelta:
        return timedelta(0)

    def tzname(self, dt: datetime | None) -> str:
        return "local"

    def fromutc(self, dt: datetime) -> datetime:
        stamp = (dt.replace(tzinfo=None) - datetime(1970, 1, 1)).total_seconds()
        return dt + timedelta(seconds=time.localtime(stamp).tm_gmtoff)


SYSTEM_ZONE: tzinfo = _SystemLocal()


def zone(name: str) -> tuple[tzinfo, str]:
    """The zone ``name`` names, and ``""``; or this computer's local time and a sentence saying
    why it stands in (no name, or one this install's zone database does not hold)."""
    if name in ("UTC", "Etc/UTC"):
        return UTC, ""  # needs no zone database
    if name:
        try:
            return ZoneInfo(name), ""
        except (ZoneInfoNotFoundError, ValueError):
            return (
                SYSTEM_ZONE,
                f"{name} is not known to this install, so this computer's clock is used",
            )
    return SYSTEM_ZONE, "no zone was given, so this computer's clock is used"


# --- the rule ------------------------------------------------------------------------------------


def rule_from(raw: Any, *, today: date | None = None) -> CadenceRule:
    """A :class:`CadenceRule` from a request body's ``rule``, or ``ValueError`` saying what is
    wrong. ``every_days`` with no ``start`` starts ``every_days`` after ``today``."""
    if not isinstance(raw, Mapping):
        raise ValueError("rule must be an object")
    kind = raw.get("kind")
    if kind not in CADENCE_KINDS:
        raise ValueError(f"rule.kind must be one of {', '.join(CADENCE_KINDS)}")
    at = raw.get("at", "09:00")
    if not isinstance(at, str) or not _AT.fullmatch(at):
        raise ValueError("rule.at must be a local time HH:MM")
    chosen: CadenceKind = kind
    if chosen == "weekly":
        weekday = _int(raw.get("weekday"))
        if weekday is None or not 0 <= weekday <= 6:
            raise ValueError("rule.weekday must be 0 (Monday) to 6 (Sunday)")
        return CadenceRule(kind="weekly", weekday=weekday, at=at)
    if chosen == "monthly":
        day = _int(raw.get("day"))
        if day is None or not 1 <= day <= 31:
            raise ValueError("rule.day must be 1 to 31")
        return CadenceRule(kind="monthly", day=day, at=at)
    every = _int(raw.get("every_days"))
    if every is None or not 1 <= every <= 366:
        raise ValueError("rule.every_days must be 1 to 366")
    start = raw.get("start", "")
    if not isinstance(start, str):
        raise ValueError("rule.start must be a date YYYY-MM-DD")
    if start:
        if not _DAY.fullmatch(start):
            raise ValueError("rule.start must be a date YYYY-MM-DD")
        try:
            date.fromisoformat(start)
        except ValueError as exc:
            raise ValueError(f"rule.start is not a date: {exc}") from exc
    else:
        start = ((today or datetime.now(UTC).date()) + timedelta(days=every)).isoformat()
    return CadenceRule(kind="every_days", every_days=every, start=start, at=at)


def rule_text(rule: CadenceRule) -> str:
    """The rule in words, as the topic page and the file say it."""
    if rule.kind == "weekly":
        return f"every {_WEEKDAYS[rule.weekday % 7]} at {rule.at}"
    if rule.kind == "monthly":
        tail = " (the month's last day when it is shorter)" if rule.day > 28 else ""
        return f"on day {rule.day} of every month at {rule.at}{tail}"
    unit = "day" if rule.every_days == 1 else f"{rule.every_days} days"
    return f"every {unit} at {rule.at}, counted from {rule.start}"


def _wall(day: date, at: str, tz: tzinfo) -> datetime:
    hour, minute = int(at[:2]), int(at[3:])
    # fold=0: a time that repeats at fall-back is its first occurrence; a time inside a
    # spring-forward gap converts with the offset before the gap, which lands an hour later.
    local = datetime(day.year, day.month, day.day, hour, minute, tzinfo=tz)
    return local.astimezone(UTC)


def next_after(rule: CadenceRule, tz: tzinfo, after: datetime) -> datetime:
    """The first occurrence of ``rule`` strictly after ``after``, as a UTC instant.

    Computed on the local calendar of ``tz``: the weekday, the day of the month and the N days
    are local dates, and the time is local wall-clock time on each, whatever the offset that day.
    """
    after = after.astimezone(UTC)
    base = after.astimezone(tz).date()
    if rule.kind == "weekly":
        for k in range(15):
            day = base + timedelta(days=k)
            if day.weekday() == rule.weekday % 7:
                moment = _wall(day, rule.at, tz)
                if moment > after:
                    return moment
    elif rule.kind == "monthly":
        year, month = base.year, base.month
        for _ in range(14):
            last = calendar.monthrange(year, month)[1]
            moment = _wall(date(year, month, min(rule.day, last)), rule.at, tz)
            if moment > after:
                return moment
            year, month = (year + 1, 1) if month == 12 else (year, month + 1)
    else:
        every = max(1, rule.every_days)
        start = date.fromisoformat(rule.start) if rule.start else base
        k0 = max(0, (base - start).days // every - 1)
        for k in range(k0, k0 + 4):
            moment = _wall(start + timedelta(days=k * every), rule.at, tz)
            if moment > after:
                return moment
    raise ValueError(f"no next occurrence of {rule!r} after {after.isoformat()}")  # unreachable


def occurrences(
    rule: CadenceRule, tz: tzinfo, first: datetime, now: datetime, cap: int = 1000
) -> tuple[list[datetime], datetime]:
    """Every occurrence from ``first`` (itself one) up to ``now``, at most ``cap`` of them, and the
    first one after ``now``. Past the cap the rest are counted out of the list, never replayed."""
    due = [first]
    moment = next_after(rule, tz, first)
    while moment <= now and len(due) < cap:
        due.append(moment)
        moment = next_after(rule, tz, moment)
    if moment <= now:
        moment = next_after(rule, tz, now)
    return due, moment


def suggest(times_per_year: Any, today: date) -> tuple[CadenceRule | None, str]:
    """The cadence a playbook's ``economics.times_per_year`` suggests, and the reason in words; or
    ``None`` and why there is none. A suggestion only: nothing is written until she confirms it.

    ``n`` is 365 over the count, rounded: seven days or fewer is weekly (on Monday), 28 to 31 is
    monthly (on the 1st), anything else is every ``n`` days, first ``n`` days from today. Always
    at 09:00 local.
    """
    if isinstance(times_per_year, bool) or not isinstance(times_per_year, int | float):
        return None, "the playbook does not say how often the job comes round"
    if times_per_year <= 0:
        return None, "the playbook does not say how often the job comes round"
    count = float(times_per_year)
    every = max(1, min(366, round(365 / count)))
    said = f"{count:g} times a year"
    if every <= 7:
        return CadenceRule(kind="weekly", weekday=0, at="09:00"), f"the playbook says {said}"
    if 28 <= every <= 31:
        return CadenceRule(kind="monthly", day=1, at="09:00"), f"the playbook says {said}"
    start = (today + timedelta(days=every)).isoformat()
    return (
        CadenceRule(kind="every_days", every_days=every, start=start, at="09:00"),
        f"the playbook says {said}",
    )


#: How far ahead of her dated deadline a yearly chore comes due.
LEAD_DAYS = 14
_MONTH_NAMES = (
    r"jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|"
    r"sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?"
)
_ORD = r"(?:st|nd|rd|th)?"
#: "may 30 days after ..." is a verb before a rule, not 30 May.
_NOT_A_SPAN = r"(?!\s+(?:business\s+|calendar\s+|working\s+)?(?:days?|weeks?|months?|years?)\b)"
#: "May 15", "May 15, 2026", "15 May", "2026-05-15": a calendar date, never a rule.
_CAL = (
    re.compile(
        rf"\b(?P<mon>{_MONTH_NAMES})\.?\s+(?P<day>\d{{1,2}}){_ORD}\b(?!:){_NOT_A_SPAN}", re.I
    ),
    re.compile(rf"\b(?P<day>\d{{1,2}}){_ORD}\s+(?:of\s+)?(?P<mon>{_MONTH_NAMES})\b", re.I),
    re.compile(r"\b\d{4}-(?P<mon>\d{1,2})-(?P<day>\d{1,2})\b"),
)
_DATES_HEADING = re.compile(r"^\*\*Dates that matter:\*\*\s*$", re.I)


def _month(token: str) -> int:
    if token.isdigit():
        return int(token)
    return next(
        (i for i in range(1, 13) if calendar.month_name[i].lower().startswith(token[:3].lower())),
        0,
    )


def calendar_date(text: str) -> tuple[int, int] | None:
    """The first calendar month and day ``text`` names, or ``None``. "30 days after the notice"
    names a rule, not a date. The year, when one is written, is not kept: a yearly chore comes
    round on the month and day."""
    found: list[tuple[int, int, int]] = []
    for pattern in _CAL:
        for match in pattern.finditer(text):
            month, day = _month(match["mon"]), int(match["day"])
            if 1 <= month <= 12 and 1 <= day <= calendar.monthrange(2000, month)[1]:
                found.append((match.start(), month, day))
                break
    if not found:
        return None
    _, month, day = min(found)
    return month, day


def brief_dates(brief_md: str) -> list[tuple[str, tuple[int, int]]]:
    """``(what, (month, day))`` for each line of the brief's "Dates that matter" that names a
    calendar date in its "when" (the text after "what:" and before ". If missed:")."""
    out: list[tuple[str, tuple[int, int]]] = []
    inside = False
    for raw in brief_md.splitlines():
        line = raw.strip()
        if _DATES_HEADING.match(line):
            inside = True
            continue
        if not inside:
            continue
        if not line.startswith("- "):
            if line:
                break
            continue
        body = line[2:].split(". If missed:", 1)[0]
        what, sep, when = body.partition(":")
        if not sep:
            what, when = "date", body
        when_md = calendar_date(when)
        if when_md is not None:
            out.append((what.strip().strip("*").strip() or "date", when_md))
    return out


def _next_on(month: int, day: int, today: date) -> date:
    """The first ``month``/``day`` after ``today`` (a 29 February is the 28th in a common year)."""
    for year in (today.year, today.year + 1, today.year + 2):
        moment = date(year, month, min(day, calendar.monthrange(year, month)[1]))
        if moment > today:
            return moment
    raise ValueError("unreachable")  # pragma: no cover


def suggest_for_case(
    times_per_year: Any, brief_md: str, slots: Sequence[CaseSlot], today: date
) -> tuple[CadenceRule | None, str]:
    """:func:`suggest`, anchored to her own case for a chore that comes round once or twice a
    year (B-C8, ADR 0131 decision 4).

    The anchors are the calendar dates in the approved brief's "Dates that matter" lines and in
    her confirmed date facts. The first that comes round after ``today`` sets the start:
    :data:`LEAD_DAYS` before it, or tomorrow when it is closer than that. Every other chore, and
    a yearly one with no calendar date, gets exactly :func:`suggest`'s rule; the yearly one's
    basis says the case names no date.
    """
    rule, basis = suggest(times_per_year, today)
    if rule is None or rule.kind != "every_days" or rule.every_days < 182:
        return rule, basis
    anchors: list[tuple[date, str]] = []
    for what, (month, day) in brief_dates(brief_md):
        anchors.append((_next_on(month, day, today), f"your brief's {what}"))
    for slot in slots:
        if slot.kind != "fact" or slot.status != "confirmed":
            continue
        found = calendar_date(slot.value)
        if found is not None:
            label = slot.label.strip().rstrip(":") or "date"
            anchors.append((_next_on(*found, today), f"the {label} in your case"))
    if not anchors:
        return rule, f"{basis}, and your brief names no calendar date to count from"
    when, name = min(anchors, key=lambda a: a[0])
    named = f"{calendar.month_name[when.month]} {when.day}"
    start = when - timedelta(days=LEAD_DAYS)
    if start <= today:
        start = today + timedelta(days=1)
        why = f"so it comes due tomorrow, still before {named}"
    else:
        why = f"so it comes due two weeks before {named}"
    return (
        replace(rule, start=start.isoformat()),
        f"{basis} and {name} falls on {named}, {why}",
    )


# --- quiet hours ---------------------------------------------------------------------------------


@dataclass(frozen=True)
class QuietWindow:
    """One window of the day in which no chore notice is shown, local ``HH:MM`` to ``HH:MM``.

    The start is inside the window and the end is not. A window whose end is before its start
    wraps midnight (the usual case); one whose start equals its end is never quiet.
    """

    start: str = "21:00"
    end: str = "08:00"
    timezone: str = ""


DEFAULT_QUIET = QuietWindow()


def _minutes(at: str) -> int:
    return int(at[:2]) * 60 + int(at[3:])


def quiet_at(window: QuietWindow, now: datetime) -> bool:
    """Is ``now`` inside ``window``, read in the window's own zone?"""
    tz, _ = zone(window.timezone)
    local = now.astimezone(tz)
    t = local.hour * 60 + local.minute
    s, e = _minutes(window.start), _minutes(window.end)
    if s == e:
        return False
    if s < e:
        return s <= t < e
    return t >= s or t < e


def quiet_until(window: QuietWindow, now: datetime) -> datetime | None:
    """When the window ``now`` is in ends (UTC), or ``None`` when ``now`` is not quiet."""
    if not quiet_at(window, now):
        return None
    tz, _ = zone(window.timezone)
    local = now.astimezone(tz)
    end = _wall(local.date(), window.end, tz)
    return end if end > now else _wall(local.date() + timedelta(days=1), window.end, tz)


def quiet_from(raw: Any) -> QuietWindow:
    """A :class:`QuietWindow` from a request body, or ``ValueError``."""
    if not isinstance(raw, Mapping):
        raise ValueError("quiet hours must be an object")
    start, end, tzname = raw.get("start"), raw.get("end"), raw.get("timezone", "")
    for name, value in (("start", start), ("end", end)):
        if not isinstance(value, str) or not _AT.fullmatch(value):
            raise ValueError(f"{name} must be a local time HH:MM")
    if not isinstance(tzname, str) or len(tzname) > 64:
        raise ValueError("timezone must be a zone name")
    assert isinstance(start, str) and isinstance(end, str)
    return QuietWindow(start=start, end=end, timezone=tzname)


# --- the file ------------------------------------------------------------------------------------


def with_line(cadence: Cadence, at: datetime, event: str, text: str, due_at: str = "") -> Cadence:
    """``cadence`` with one more log line, the oldest dropped past :data:`LOG_KEEP`."""
    line = CadenceLine(at=iso(at), event=event, due_at=due_at, text=text)
    log = (*cadence.log, line)[-LOG_KEEP:]
    return replace(cadence, log=log, log_total=cadence.log_total + 1, updated_at=iso(at))


def render_cadence(cadence: Cadence, title: str) -> str:
    """The cadence file's body: what a person reads, then the block the code reads."""
    state = "on" if cadence.enabled else "paused"
    parts = [
        f"# When {title} comes due",
        f"Your chore `{cadence.case_id}` comes due {rule_text(cadence.rule)} "
        f"({cadence.timezone or 'this computer'}'s time). It is {state}.",
        f"- next: {cadence.next_run_at or 'none'}\n- last: {cadence.last_run_at or 'never'}",
    ]
    review = cadence.review
    if review is not None and not review.answer:
        missed = f", and {review.missed} more since" if review.missed else ""
        parts.append(f"A review is open for {review.due_at}{missed}.")
    if cadence.log:
        shown = len(cadence.log)
        footer = (
            "" if shown >= cadence.log_total else f"\n\n(showing {shown} of {cadence.log_total})"
        )
        rows = "\n".join(f"- {ln.at} {ln.event}: {ln.text}" for ln in cadence.log)
        parts += ["## What happened", rows + footer]
    block = json.dumps(asdict(cadence), indent=2, sort_keys=True, ensure_ascii=False)
    parts.append(f"{CADENCE_MARKER}\n{_OPEN}\n{block}\n{_CLOSE}")
    return "\n\n".join(parts) + "\n"


def _block(body: str, marker: str) -> dict[str, Any]:
    at = body.rfind(f"{marker}\n{_OPEN}\n")
    if at == -1:
        raise CadenceUnreadable("no data block")
    start = at + len(marker) + len(_OPEN) + 2
    end = body.find(f"\n{_CLOSE}", start)
    if end == -1:
        raise CadenceUnreadable("the data block is not closed")
    try:
        raw = json.loads(body[start:end])
    except json.JSONDecodeError as exc:
        raise CadenceUnreadable(f"the data block is not JSON: {exc.msg}") from exc
    if not isinstance(raw, dict):
        raise CadenceUnreadable("the data block is not an object")
    return raw


def parse_cadence(body: str) -> Cadence:
    """The cadence in a ritual body, or :class:`CadenceUnreadable`."""
    raw = _block(body, CADENCE_MARKER)
    if raw.get("schema") != CADENCE_SCHEMA:
        raise CadenceUnreadable(f"cadence schema {raw.get('schema')!r} is not {CADENCE_SCHEMA}")
    cid, case_id = _s(raw.get("id")), _s(raw.get("case_id"))
    if not ids.is_id("ritual", cid) or not ids.is_id("project", case_id):
        raise CadenceUnreadable("the cadence names no ritual id or no case")
    try:
        rule = rule_from(_d(raw.get("rule")))
    except ValueError as exc:
        raise CadenceUnreadable(f"the rule does not read: {exc}") from exc
    review = raw.get("review")
    return Cadence(
        id=cid,
        case_id=case_id,
        enabled=raw.get("enabled") is True,
        rule=rule,
        timezone=_s(raw.get("timezone")),
        next_run_at=_s(raw.get("next_run_at")),
        last_run_at=_s(raw.get("last_run_at")),
        created=_s(raw.get("created")),
        updated_at=_s(raw.get("updated_at")),
        review=_review(review) if isinstance(review, Mapping) else None,
        unanswered=_i(raw.get("unanswered")),
        log=tuple(
            CadenceLine(
                at=_s(x.get("at")),
                event=_s(x.get("event")),
                due_at=_s(x.get("due_at")),
                text=_s(x.get("text")),
            )
            for x in _l(raw.get("log"))
            if isinstance(x, Mapping)
        ),
        log_total=_i(raw.get("log_total")),
    )


def _review(raw: Mapping[str, Any]) -> ChoreReview:
    answer = raw.get("answer")
    answers: tuple[ReviewAnswer, ...] = ("", "prepare", "skip", "paused")
    return ChoreReview(
        due_at=_s(raw.get("due_at")),
        opened_at=_s(raw.get("opened_at")),
        missed=_i(raw.get("missed")),
        missed_at=tuple(_s(x) for x in _l(raw.get("missed_at")) if _s(x)),
        delivered_at=_s(raw.get("delivered_at")),
        held_at=_s(raw.get("held_at")),
        answer=answer if answer in answers else "",
        answered_at=_s(raw.get("answered_at")),
        first_turn_id=_s(raw.get("first_turn_id")),
    )


# --- the book ------------------------------------------------------------------------------------


@dataclass
class CadenceBook:
    """The cadences in one brain, read from disk (the truth) and written through the brain.

    ``lock`` is the one lock every change takes, the loop's and the routes' alike, so a tick and
    a person's answer never interleave on one file.
    """

    brain: Brain

    def __post_init__(self) -> None:
        self.lock = threading.RLock()

    @property
    def folder(self) -> Path:
        return self.brain.root / "rituals" / "cadence"

    def load(self, case_id: str) -> Cadence | None:
        """The cadence of ``case_id`` from disk, or ``None`` (none set, or unreadable)."""
        if not ids.is_id("project", case_id):
            return None
        return self._read(self.folder / f"{case_id}.md", case_id)

    def all(self) -> list[Cadence]:
        """Every readable cadence on disk, by case id. A file that does not read is passed over."""
        if not self.folder.is_dir():
            return []
        out: list[Cadence] = []
        for path in sorted(self.folder.glob("proj_*.md")):
            found = self._read(path, path.stem)
            if found is not None:
                out.append(found)
        return out

    def _read(self, path: Path, case_id: str) -> Cadence | None:
        try:
            _, body = frontmatter.parse(path.read_text(encoding="utf-8"))
            cadence = parse_cadence(body)
        except (OSError, UnicodeDecodeError, CadenceUnreadable):
            return None
        return cadence if cadence.case_id == case_id else None

    def save(self, cadence: Cadence, title: str) -> Cadence:
        """Write ``cadence`` to ``rituals/cadence/<proj>.md``; one write, whole or not at all."""
        self.brain.write_ritual(
            cadence.id,
            "cadence",
            cadence.case_id,
            f"When {title} comes due",
            render_cadence(cadence, title),
            session_id=ids.conversation_for_project(cadence.case_id),
            created=cadence.created,
        )
        return cadence

    # -- quiet hours --------------------------------------------------------------------------

    def quiet(self) -> QuietWindow:
        """The quiet window, from ``rituals/quiet_hours/chores.md``; :data:`DEFAULT_QUIET` when
        there is none or it does not read."""
        path = self.brain.root / "rituals" / "quiet_hours" / f"{QUIET_NAME}.md"
        try:
            _, body = frontmatter.parse(path.read_text(encoding="utf-8"))
            return quiet_from(_block(body, QUIET_MARKER))
        except (OSError, UnicodeDecodeError, CadenceUnreadable, ValueError):
            return DEFAULT_QUIET

    def set_quiet(self, window: QuietWindow, now: datetime) -> QuietWindow:
        """Write the quiet window. The file keeps the id and the date it was first written."""
        path = self.brain.root / "rituals" / "quiet_hours" / f"{QUIET_NAME}.md"
        rid, created = ids.mint("ritual"), iso(now)
        try:
            meta, _ = frontmatter.parse(path.read_text(encoding="utf-8"))
            if ids.is_id("ritual", str(meta.get("id") or "")):
                rid, created = str(meta["id"]), str(meta.get("created") or created)
        except (OSError, UnicodeDecodeError):
            pass
        block = json.dumps(asdict(window), indent=2, sort_keys=True)
        where = window.timezone or "this computer"
        body = (
            f"# Quiet hours\n\nNo chore notice is shown from {window.start} to {window.end} "
            f"({where}'s time); a chore that comes due in them waits until they end.\n\n"
            f"{QUIET_MARKER}\n{_OPEN}\n{block}\n{_CLOSE}\n"
        )
        self.brain.write_ritual(
            rid,
            "quiet_hours",
            QUIET_NAME,
            "Quiet hours",
            body,
            session_id=ids.conversation_for_app("rituals"),
            created=created,
        )
        return window


def _s(value: Any) -> str:
    return value if isinstance(value, str) else ""


def _i(value: Any) -> int:
    return value if isinstance(value, int) and not isinstance(value, bool) else 0


def _int(value: Any) -> int | None:
    return value if isinstance(value, int) and not isinstance(value, bool) else None


def _d(value: Any) -> dict[str, Any]:
    return value if isinstance(value, dict) else {}


def _l(value: Any) -> list[Any]:
    return value if isinstance(value, list) else []

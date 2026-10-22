"""ADR 0131 (chores come due, as a staged review): the loop that notices, and the review it stages.

Nothing here reads a portal or sends a turn. When a case's cadence (:mod:`athena.adopt.cadence`)
comes due, the loop opens a **review**: a page the person reads, assembled with no model call
from the case file and its last receipt, with one button, "Open and prepare", that opens her tabs
and puts the case's command in Athena's composer. Nothing is sent until she presses send.

**The loop** (:class:`ChoreClock`) is a reconciliation loop over durable data (scheduling's
golden path): every :data:`TICK_S` it compares now with each cadence's persisted
``next_run_at``. When one is due it

1. enumerates every occurrence up to now and the first after it (``next-run-computation``);
2. **coalesces** them (``missed-run-semantics``): with no review open, one review opens for the
   first, naming the rest as missed; with one open, they are folded into it and no second review
   opens (``overlap-and-reentrancy``: single-flight, the open review is the claim);
3. writes the advanced ``next_run_at``, the review and an explainable log line in **one** file
   write, and only after that can a notice be delivered: the desktop reads notices off the file
   (``GET /adopt/chores/due``), so a crash after the write delivers the one notice once, and a
   crash before it changes nothing.

A paused cadence never opens a review; an occurrence that passes while it is paused is logged as
skipped and the pointer moves past it (``schedule-observability``: every non-fire leaves a
line). The loop's last tick is kept as its heartbeat and answered on the due route.

**Attention** (proactive-nudges). A notice is keyed on (case, due date) and is delivered once:
the desktop stamps it seen (``delivered_at``) and the route never offers it again
(``nudge-identity-dedup``). The quiet window is checked when a notice would be delivered, not when
the review opened, and holds the notice, never the advance (``quiet-windows``). A chore comes due
at most once per its own period and a coalesced backlog is one notice, so the cadence the person
chose is the budget (``attention-budgets``; no global daily cap, recorded in ADR 0131). An
occurrence that comes due while a review she was shown sits unanswered counts against the chore;
at :data:`~athena.contracts.adopt.ASK_SLOW_AFTER` in a row the review asks "pause or slow this
chore?" and changes nothing itself (``efficacy-feedback``: down on ignore, and only she moves it).
A review never shown counts nothing.

**The first turn.** "Open and prepare" answers the review ``prepare``; her first turn after it,
sent with ``trigger: "schedule"``, is claimed here (:meth:`ChoreClock.claim_first_turn`) and its
ledger rows carry ``trigger_kind='schedule'``. One claim per review, within
:data:`CLAIM_HORIZON`; every later turn is an ordinary one.
"""

from __future__ import annotations

import sys
import threading
from collections.abc import Callable, Mapping, Sequence
from dataclasses import asdict, dataclass, field, replace
from datetime import UTC, datetime, timedelta
from typing import Any
from urllib.parse import urlparse

from athena.adopt import cadence as cad
from athena.adopt.cadence import CadenceBook, QuietWindow
from athena.adopt.cases import CaseBook
from athena.adopt.slots import PlaybookMissing, load_playbook_json
from athena.contracts import ids
from athena.contracts.adopt import (
    ASK_SLOW_AFTER,
    Cadence,
    CadenceRule,
    Case,
    ChoreReview,
    DueNotice,
    DueReview,
    Receipt,
    ReviewAnswer,
    ReviewLine,
    ReviewPortal,
)
from athena.contracts.channel import iso
from athena.daemon.routes import Reply, Request, announced, error

__all__ = [
    "CHORES_DUE_PATH",
    "CHORES_QUIET_PATH",
    "CLAIM_HORIZON",
    "LINES_CAP",
    "MAX_NOTICES",
    "TICK_S",
    "ChoreClock",
    "assemble",
    "case_route",
    "chores_due",
    "chores_quiet",
]

CHORES_DUE_PATH = "/adopt/chores/due"
CHORES_QUIET_PATH = "/adopt/chores/quiet"
#: How often the loop looks. A chore comes due at most this late; precision is not a feature here.
TICK_S = 30.0
#: How long after "Open and prepare" her first send is still that run's first turn.
CLAIM_HORIZON = timedelta(hours=12)
#: The most lines a review lists; past it ``(showing N of M)``.
LINES_CAP = 16
#: The most notices one ``GET /adopt/chores/due`` answers.
MAX_NOTICES = 20
#: The answers ``POST /adopt/cases/<proj>/review`` takes. ``seen`` is not an answer: it stamps
#: that the notice was shown.
ANSWERS = ("prepare", "skip", "seen")


def _utcnow() -> datetime:
    return datetime.now(UTC)


def _at(value: str) -> datetime | None:
    try:
        parsed = datetime.fromisoformat(value)
    except (TypeError, ValueError):
        return None
    return parsed if parsed.tzinfo else parsed.replace(tzinfo=UTC)


def _plural(n: int, one: str, many: str = "") -> str:
    return f"{n} {one if n == 1 else (many or one + 's')}"


@dataclass
class ChoreClock:
    """The cadences of one brain, the loop over them and every change a person makes to them."""

    book: CadenceBook
    cases: CaseBook
    #: The clock. Tests hand a fake; nothing else here reads the time.
    clock: Callable[[], datetime] = _utcnow
    #: ``playbooks/<id>/playbook.json``, for the suggestion and the portal addresses.
    playbook: Callable[[str], Mapping[str, Any]] = load_playbook_json
    #: The heartbeat: the last tick's time (ISO UTC), ``""`` before the first.
    ticked_at: str = ""
    _generation: int = field(default=0, repr=False)
    _thread: threading.Thread | None = field(default=None, repr=False)
    _wake: threading.Event = field(default_factory=threading.Event, repr=False)
    _state: threading.Lock = field(default_factory=threading.Lock, repr=False)

    # -- the loop -----------------------------------------------------------------------------

    def start(self, interval_s: float = TICK_S) -> None:
        """Run :meth:`tick` every ``interval_s`` on a daemon thread. A second start while one runs
        is a no-op; a stop bumps the generation, so a loop left behind by a restart retires."""
        with self._state:
            if self._thread is not None and self._thread.is_alive():
                return
            self._generation += 1
            self._wake = threading.Event()
            thread = threading.Thread(
                target=self._loop,
                args=(self._generation, interval_s, self._wake),
                name="athena-chores",
                daemon=True,
            )
            self._thread = thread
        thread.start()

    def stop(self) -> None:
        with self._state:
            self._generation += 1
            self._wake.set()
            self._thread = None

    def _loop(self, generation: int, interval_s: float, wake: threading.Event) -> None:
        while generation == self._generation:
            try:
                self.tick()
            except Exception as exc:  # a bad file or a full disk is a line, never a dead loop
                print(f"[chores] tick failed: {type(exc).__name__}: {exc}", file=sys.stderr)
            if wake.wait(interval_s):
                return

    def tick(self, now: datetime | None = None) -> int:
        """One pass over every cadence on disk; answers how many files it wrote."""
        moment = (now or self.clock()).astimezone(UTC)
        written = 0
        with self.book.lock:
            quiet = self.book.quiet()
            for cadence in self.book.all():
                changed = self._reconcile(cadence, moment, quiet)
                if changed is not None:
                    self._save(changed)
                    written += 1
            self.ticked_at = iso(moment)
        return written

    def _reconcile(self, c: Cadence, now: datetime, quiet: QuietWindow) -> Cadence | None:
        tz, _ = cad.zone(c.timezone)
        due = _at(c.next_run_at)
        if due is None:
            # A hand-edited or half-written next: recomputed from the rule, and said.
            nxt = cad.next_after(c.rule, tz, now)
            return cad.with_line(
                replace(c, next_run_at=iso(nxt)),
                now,
                "recomputed",
                f"next_run_at did not read, so it was recomputed from the rule: {iso(nxt)}",
            )
        if due > now:
            return self._hold(c, now, quiet)
        times, nxt = cad.occurrences(c.rule, tz, due, now)
        first, count = iso(times[0]), len(times)
        if not c.enabled:
            return cad.with_line(
                replace(c, next_run_at=iso(nxt)),
                now,
                "skipped",
                f"paused: {_plural(count, 'occurrence')} passed from {first} with no review; "
                f"the next would be {iso(nxt)}",
                due_at=first,
            )
        review = c.review
        if review is not None and not review.answer:
            shown = bool(review.delivered_at)
            kept = (*review.missed_at, *(iso(t) for t in times))[: cad.MISSED_KEEP]
            folded = replace(review, missed=review.missed + count, missed_at=kept)
            c = replace(
                c,
                review=folded,
                unanswered=c.unanswered + (count if shown else 0),
                next_run_at=iso(nxt),
                last_run_at=iso(times[-1]),
            )
            why = "you had been shown it" if shown else "it had not been shown yet"
            c = cad.with_line(
                c,
                now,
                "coalesced",
                f"{_plural(count, 'more occurrence')} came due while the review of "
                f"{review.due_at} was open ({why}); no second review; next {iso(nxt)}",
                due_at=first,
            )
        else:
            missed = tuple(iso(t) for t in times[1:])
            opened = ChoreReview(
                due_at=first,
                opened_at=iso(now),
                missed=count - 1,
                missed_at=missed[: cad.MISSED_KEEP],
            )
            c = replace(c, review=opened, next_run_at=iso(nxt), last_run_at=iso(times[-1]))
            folded_text = (
                f", with {_plural(count - 1, 'missed occurrence')} folded into it"
                if count > 1
                else ""
            )
            c = cad.with_line(
                c, now, "fired", f"review opened{folded_text}; next {iso(nxt)}", due_at=first
            )
        return self._hold(c, now, quiet) or c

    def _hold(self, c: Cadence, now: datetime, quiet: QuietWindow) -> Cadence | None:
        """Log, once per review, that quiet hours are holding its notice."""
        review = c.review
        if review is None or review.answer or review.delivered_at or review.held_at:
            return None
        until = cad.quiet_until(quiet, now)
        if until is None:
            return None
        held = replace(c, review=replace(review, held_at=iso(now)))
        return cad.with_line(
            held,
            now,
            "held",
            f"quiet hours ({quiet.start} to {quiet.end}): the notice waits until {iso(until)}",
            due_at=review.due_at,
        )

    def _title(self, case_id: str) -> str:
        case = self.cases.load(case_id)
        return (case.title or case.playbook_id) if case is not None else case_id

    def _save(self, cadence: Cadence) -> Cadence:
        return self.book.save(cadence, self._title(cadence.case_id))

    # -- what the person does -----------------------------------------------------------------

    def set_cadence(
        self,
        case_id: str,
        *,
        rule: CadenceRule | None,
        timezone: str | None,
        enabled: bool | None,
        now: datetime | None = None,
    ) -> Cadence:
        """Set, change, pause or resume ``case_id``'s cadence; only the person calls this.

        ``None`` keeps what the cadence had. A new cadence needs a ``rule``. ``next_run_at`` is
        recomputed from now on every call, so a resume never fires for the time it was paused.
        Pausing with a review open closes it as ``paused``.
        """
        moment = (now or self.clock()).astimezone(UTC)
        with self.book.lock:
            held = self.book.load(case_id)
            if held is None and rule is None:
                raise ValueError("rule is required to set a cadence")
            chosen_rule = rule or (held.rule if held else None)
            assert chosen_rule is not None
            zone_name = timezone if timezone is not None else (held.timezone if held else "")
            on = enabled if enabled is not None else (held.enabled if held else True)
            tz, note = cad.zone(zone_name)
            nxt = iso(cad.next_after(chosen_rule, tz, moment))
            said = cad.rule_text(chosen_rule)
            if held is None:
                c = Cadence(
                    id=ids.mint("ritual"),
                    case_id=case_id,
                    enabled=on,
                    rule=chosen_rule,
                    timezone=zone_name,
                    next_run_at=nxt,
                    last_run_at="",
                    created=iso(moment),
                )
                event, text = "set", f"you set it to come due {said}; next {nxt}"
            else:
                c = replace(held, rule=chosen_rule, timezone=zone_name, enabled=on, next_run_at=nxt)
                if held.enabled and not on:
                    event, text = "paused", "you paused it; nothing comes due until you resume"
                    review = held.review
                    if review is not None and not review.answer:
                        c = replace(
                            c,
                            review=replace(review, answer="paused", answered_at=iso(moment)),
                        )
                    c = replace(c, unanswered=0)
                elif on and not held.enabled:
                    event, text = "resumed", f"you resumed it, {said}; next {nxt}"
                else:
                    event, text = "set", f"you set it to come due {said}; next {nxt}"
            if note:
                text = f"{text} ({note})"
            return self._save(cad.with_line(c, moment, event, text))

    def answer(
        self, case_id: str, due_at: str, answer: str, now: datetime | None = None
    ) -> Cadence:
        """Answer the open review of ``due_at``: ``prepare``, ``skip``, or ``seen`` (its notice
        was shown). ``LookupError`` for no cadence, ``ValueError`` for a review that is not the
        open one (answered, or another due date)."""
        if answer not in ANSWERS:
            raise ValueError(f"answer must be one of {', '.join(ANSWERS)}")
        moment = (now or self.clock()).astimezone(UTC)
        with self.book.lock:
            c = self.book.load(case_id)
            if c is None:
                raise LookupError(f"no cadence for {case_id!r}")
            review = c.review
            if review is None or review.answer or review.due_at != due_at:
                raise ValueError(f"stale_review: no open review due {due_at!r}")
            shown = review.delivered_at or iso(moment)
            if answer == "seen":
                if review.delivered_at:
                    return c
                c = replace(c, review=replace(review, delivered_at=shown))
                return self._save(
                    cad.with_line(c, moment, "delivered", "the notice was shown", due_at=due_at)
                )
            chosen: ReviewAnswer = "prepare" if answer == "prepare" else "skip"
            c = replace(
                c,
                review=replace(review, delivered_at=shown, answer=chosen, answered_at=iso(moment)),
                unanswered=0,
            )
            text = (
                "you pressed Open and prepare; nothing is sent until you press send"
                if chosen == "prepare"
                else "you skipped this one"
            )
            return self._save(cad.with_line(c, moment, "answered", text, due_at=due_at))

    def claim_first_turn(self, case_id: str, turn_id: str, now: datetime | None = None) -> bool:
        """Is ``turn_id`` the first turn of the run "Open and prepare" staged for ``case_id``?
        ``True`` once per review, within :data:`CLAIM_HORIZON` of the answer; the turn's ledger
        rows then carry ``trigger_kind='schedule'``. Anything else is ``False``, never an error."""
        if not ids.is_id("project", case_id) or not ids.is_id("turn", turn_id):
            return False
        moment = (now or self.clock()).astimezone(UTC)
        with self.book.lock:
            c = self.book.load(case_id)
            review = c.review if c is not None else None
            if c is None or review is None or review.answer != "prepare" or review.first_turn_id:
                return False
            answered = _at(review.answered_at)
            if answered is None or moment - answered > CLAIM_HORIZON:
                return False
            c = replace(c, review=replace(review, first_turn_id=turn_id))
            self._save(
                cad.with_line(
                    c,
                    moment,
                    "run",
                    f"your first send after Open and prepare, {turn_id}, is recorded as scheduled",
                    due_at=review.due_at,
                )
            )
            return True

    def set_quiet(self, window: QuietWindow, now: datetime | None = None) -> QuietWindow:
        with self.book.lock:
            return self.book.set_quiet(window, (now or self.clock()).astimezone(UTC))

    # -- what the desktop reads ---------------------------------------------------------------

    def due(self, now: datetime | None = None) -> dict[str, Any]:
        """The notices to show now: every open review not yet shown, unless quiet hours hold
        them, which is checked here, at delivery. Read-only."""
        moment = (now or self.clock()).astimezone(UTC)
        quiet = self.book.quiet()
        until = cad.quiet_until(quiet, moment)
        waiting: list[DueNotice] = []
        for c in self.book.all():
            review = c.review
            if not c.enabled or review is None or review.answer or review.delivered_at:
                continue
            case = self.cases.load(c.case_id)
            waiting.append(
                DueNotice(
                    case_id=c.case_id,
                    playbook_id=case.playbook_id if case else "",
                    title=(case.title or case.playbook_id) if case else c.case_id,
                    due_at=review.due_at,
                    missed=review.missed,
                    ask_slow=c.unanswered >= ASK_SLOW_AFTER,
                )
            )
        waiting.sort(key=lambda n: (n.due_at, n.case_id))
        shown = [] if until is not None else waiting[:MAX_NOTICES]
        reply = announced([asdict(n) for n in shown], 0 if until else len(waiting), "notices")
        reply["held"] = len(waiting) if until else 0
        reply["quiet"] = {
            **asdict(quiet),
            "now": until is not None,
            "until": iso(until) if until else "",
        }
        reply["ticked_at"] = self.ticked_at
        return reply

    def review_of(self, case_id: str) -> DueReview | None:
        """The case's review, assembled with no model call; ``None`` for no saved case."""
        case = self.cases.load(case_id)
        if case is None:
            return None
        try:
            playbook: Mapping[str, Any] | None = self.playbook(case.playbook_id)
        except PlaybookMissing:
            playbook = None
        return assemble(case, self.book.load(case_id), self.cases.receipts(case_id), playbook)


# --- the review ----------------------------------------------------------------------------------


def _web(url: str) -> bool:
    try:
        parsed = urlparse(url)
    except ValueError:
        return False
    return parsed.scheme in ("http", "https") and bool(parsed.netloc)


def portals_of(case: Case, playbook: Mapping[str, Any] | None) -> tuple[ReviewPortal, ...]:
    """The apps "Open and prepare" opens, in the playbook's order: the playbook's own address
    while she uses the playbook's app; else the address she gave in that app's slot; else none,
    which the desktop says rather than guess. A name is never an address."""
    slots = {s.id: s for s in case.slots}
    apps = [a for a in (playbook or {}).get("apps", []) if isinstance(a, Mapping)]
    names = [str(a.get("name") or "") for a in apps] or list(case.portals)
    out: list[ReviewPortal] = []
    for index, name in enumerate(names, start=1):
        if not name:
            continue
        theirs = case.portals.get(name, "")
        own = str(apps[index - 1].get("url") or "").strip() if index <= len(apps) else ""
        slot = slots.get(f"p{index}")
        given = slot.value.strip() if slot is not None and slot.kind == "portal" else ""
        if own and not theirs and _web(own):
            out.append(ReviewPortal(name=name, url=own, source="playbook"))
        elif _web(given):
            out.append(ReviewPortal(name=theirs or name, url=given, source="case"))
        else:
            out.append(ReviewPortal(name=theirs or name))
    return tuple(out)


def _lines(last: Receipt | None) -> tuple[list[ReviewLine], int]:
    """The last run's cards and notes as review lines, the ones to check first first: expired
    cards, calls that may have completed, cards still waiting, then approved, then declined."""
    if last is None:
        return [], 0
    by: dict[str, list[ReviewLine]] = {
        k: [] for k in ("expired", "pending", "approved", "declined")
    }
    for card in last.cards:
        if card.status in by:
            by[card.status].append(
                ReviewLine(
                    kind=card.status,  # type: ignore[arg-type]
                    action=card.action,
                    params=dict(card.params),
                    at=card.resolved_at or card.created_at,
                )
            )
    notes = [ReviewLine(kind="may_have_completed", at=n.at, text=n.text) for n in last.notes]
    ordered = [*by["expired"], *notes, *by["pending"], *by["approved"], *by["declined"]]
    return ordered, max(len(ordered), last.cards_total + last.notes_total)


def assemble(
    case: Case,
    cadence: Cadence | None,
    receipts: Sequence[Receipt],
    playbook: Mapping[str, Any] | None,
) -> DueReview:
    """A case's review from its file, its cadence and its last receipt. No model, no ledger."""
    last = receipts[-1] if receipts else None
    lines, total = _lines(last)
    shown = lines[:LINES_CAP]
    review = cadence.review if cadence is not None else None
    unanswered = cadence.unanswered if cadence is not None else 0
    return DueReview(
        case_id=case.id,
        playbook_id=case.playbook_id,
        title=case.title or case.playbook_id,
        command=case.command,
        enabled=bool(cadence and cadence.enabled),
        rule_text=cad.rule_text(cadence.rule) if cadence is not None else "",
        timezone=cadence.timezone if cadence is not None else "",
        next_run_at=cadence.next_run_at if cadence is not None and cadence.enabled else "",
        review=review,
        unanswered=unanswered,
        ask_slow=bool(review and not review.answer and unanswered >= ASK_SLOW_AFTER),
        last_run_at=(last.closed_at or last.until or last.last_at) if last is not None else "",
        lines=tuple(shown),
        lines_total=total,
        lines_footer="" if len(shown) >= total else f"(showing {len(shown)} of {total})",
        portals=portals_of(case, playbook),
    )


# --- the routes ----------------------------------------------------------------------------------


def _cadence_reply(clock: ChoreClock, case: Case) -> dict[str, Any]:
    held = clock.book.load(case.id)
    now = clock.clock().astimezone(UTC)
    try:
        playbook: Mapping[str, Any] = clock.playbook(case.playbook_id)
    except PlaybookMissing:
        playbook = {}
    economics = playbook.get("economics")
    times = economics.get("times_per_year") if isinstance(economics, Mapping) else None
    tz, note = cad.zone(held.timezone if held is not None else "")
    suggested, basis = cad.suggest(times, now.astimezone(tz).date())
    upcoming: list[str] = []
    if held is not None and held.enabled:
        moment = now
        for _ in range(3):
            moment = cad.next_after(held.rule, tz, moment)
            upcoming.append(iso(moment))
    log = [asdict(line) for line in reversed(held.log)] if held is not None else []
    total = held.log_total if held is not None else 0
    reply = announced(log, total, "log")
    reply.update(
        case_id=case.id,
        cadence=asdict(held) if held is not None else None,
        rule_text=cad.rule_text(held.rule) if held is not None else "",
        zone_note=note if held is not None else "",
        suggested=asdict(suggested) if suggested is not None else None,
        suggested_text=cad.rule_text(suggested) if suggested is not None else "",
        suggested_basis=basis,
        upcoming=upcoming,
    )
    return reply


def case_route(clock: ChoreClock, request: Request, case_id: str, verb: str) -> Reply:
    """``GET``/``POST /adopt/cases/<proj>/cadence`` and ``/review`` (ADR 0131)."""
    if not ids.is_id("project", case_id):
        return error(400, "validator_failed", f"not a case id: {case_id!r}")
    case = clock.cases.load(case_id)
    if case is None:
        return error(404, "unknown_ref", f"no saved case {case_id!r}")
    body = request.body
    if verb == "cadence":
        if request.method == "POST":
            try:
                rule = cad.rule_from(body["rule"]) if body.get("rule") is not None else None
                zone_name = body.get("timezone")
                if zone_name is not None and (
                    not isinstance(zone_name, str) or len(zone_name) > 64
                ):
                    raise ValueError("timezone must be a zone name")
                enabled = body.get("enabled")
                if enabled is not None and not isinstance(enabled, bool):
                    raise ValueError("enabled must be true or false")
                clock.set_cadence(case_id, rule=rule, timezone=zone_name, enabled=enabled)
            except ValueError as exc:
                return error(400, "validator_failed", str(exc))
            except OSError as exc:
                return error(500, "unknown", f"the cadence was not saved: {exc}")
        return 200, _cadence_reply(clock, case)
    if request.method == "POST":
        due_at, answer = body.get("due_at"), body.get("answer")
        if not isinstance(due_at, str) or not isinstance(answer, str):
            return error(400, "validator_failed", "due_at and answer are required")
        try:
            clock.answer(case_id, due_at, answer)
        except LookupError as exc:
            return error(404, "unknown_ref", str(exc))
        except ValueError as exc:
            status = 409 if str(exc).startswith("stale_review") else 400
            return error(status, "validator_failed", str(exc))
    review = clock.review_of(case_id)
    return 200, {"ok": True, "review": asdict(review) if review is not None else None}


def chores_due(clock: ChoreClock, request: Request) -> Reply:
    """``GET /adopt/chores/due``: the notices to show now, read-only."""
    return 200, clock.due()


def chores_quiet(clock: ChoreClock, request: Request) -> Reply:
    """``GET``/``POST /adopt/chores/quiet``: the quiet window, ``{start, end, timezone}``."""
    if request.method == "POST":
        try:
            window = cad.quiet_from(request.body)
            clock.set_quiet(window)
        except ValueError as exc:
            return error(400, "validator_failed", str(exc))
    return 200, {"ok": True, **asdict(clock.book.quiet())}

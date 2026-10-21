"""ADR 0098 (the Chores front door is an intake leg): the conversation that ends in a verdict.

A person tells the Chores page a need. Athena asks one or two cards of questions, then gives a
verdict: ``template`` (a chore in the library fits; open its studio with the need as the opening
message) or ``custom`` (no chore is worth reusing; here is a command for Athena).

It is the adopt machinery with no playbook: an :class:`~athena.adopt.session.IntakeSession` has
the event log, the stream, the one actor, the warm process, idle expiry, the shared
:data:`~athena.adopt.session.MAX_LIVE` places and the ledger of an adopt session, and none of its
slots or research lanes. Every model call is the ``intake`` leg.

**What the leg reads.** The person's words (the need, then the answers), fenced as untrusted, and
the library summary: per playbook an id, a title, its area, its job and a one-line summary, read
from ``playbooks/*/playbook.json`` and ``taxonomy.json`` and nothing else (never ``truth.json``,
which is the answer key of a chore's proving world), fenced as data.

**Three rounds.** The third model round is asked for a verdict and refuses another card; "decide
now" (``POST /intake/<sid>/decide``) forces one at any round. A malformed answer gets the leg's
one retry; one that still fails is an ``adopt.error`` (``engine_error``). A verdict is never
made up: the checks here only correct what the rules in :func:`build_verdict` define.
"""

from __future__ import annotations

import json
import re
from collections.abc import Mapping, Sequence
from dataclasses import asdict
from pathlib import Path
from typing import Any

from athena.adopt import loop
from athena.adopt.legs import LegResult
from athena.adopt.prompts import (
    INTAKE_SCHEMA,
    INTAKE_SYSTEM,
    MAX_INTAKE_ROUNDS,
    intake_opening,
    intake_prompt,
)
from athena.adopt.session import UNASKED, AskedQuestion, GivenAnswer, IntakeSession
from athena.adopt.slots import playbooks_root
from athena.contracts.adopt import (
    Alternate,
    Answer,
    Error,
    Progress,
    Questions,
    Say,
    Verdict,
    cap_text,
)

__all__ = [
    "MAX_ALTERNATES",
    "NEED_CAP",
    "build_verdict",
    "decide",
    "library_summary",
    "receive_answers",
    "start",
]

NEED_CAP = 300
MAX_ALTERNATES = 2
WHY_CAP = 500
COMMAND_CAP = 2000
SUMMARY_CAP = 160
TITLE_CAP = 120


# --- the library, as the model is told of it ------------------------------------------------------


def library_summary(root: Path | None = None) -> list[dict[str, str]]:
    """``[{id, title, area, job, summary}]`` for every playbook in the library, by id.

    Reads only ``playbooks/<id>/playbook.json`` and the library's ``taxonomy.json`` (for the
    labels of area and job). ``truth.json``, ``world.json`` and the rest of a chore's folder are
    never opened. A playbook that cannot be read is left out."""
    library = root if root is not None else playbooks_root()
    if library is None:
        return []
    areas, jobs = _labels(library / "taxonomy.json")
    rows: list[dict[str, str]] = []
    for folder in sorted(p for p in library.iterdir() if p.is_dir()):
        path = folder / "playbook.json"
        try:
            raw = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            continue
        if not isinstance(raw, dict) or not isinstance(raw.get("command"), str):
            continue
        area = _line(raw.get("category"))
        job = _line(raw.get("job"))
        rows.append(
            {
                "id": folder.name,
                "title": _line(raw.get("short_title") or raw.get("title"))[:TITLE_CAP],
                "area": areas.get(area, area),
                "job": jobs.get(job, job),
                "summary": _first_sentence(_line(raw.get("promise")))[:SUMMARY_CAP],
            }
        )
    return rows


def _labels(path: Path) -> tuple[dict[str, str], dict[str, str]]:
    try:
        raw = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}, {}
    if not isinstance(raw, dict):
        return {}, {}

    def table(key: str) -> dict[str, str]:
        rows = raw.get(key)
        if not isinstance(rows, list):
            return {}
        return {
            _line(r.get("id")): _line(r.get("label"))
            for r in rows
            if isinstance(r, dict) and _line(r.get("id"))
        }

    return table("categories"), table("jobs")


# --- the public verbs (each queued on the session's actor) ---------------------------------------


def start(session: IntakeSession) -> None:
    session.submit(lambda: _start(session))


def receive_answers(session: IntakeSession, answers: Sequence[Answer], via: str) -> None:
    """Record ``answers`` now and queue the next round."""
    with session.lock:
        for answer in answers:
            if not answer.question_id:
                session.answers.append(
                    GivenAnswer(
                        round=session.round,
                        question_id="",
                        question=UNASKED,
                        slot_ids=(),
                        choices=(),
                        text=answer.text.strip(),
                        via=via,
                    )
                )
                continue
            asked = session.asked[answer.question_id]
            labels = {o.id: o.label for o in asked.question.options}
            session.answers.append(
                GivenAnswer(
                    round=asked.round,
                    question_id=answer.question_id,
                    question=asked.question.text,
                    slot_ids=(),
                    choices=tuple(labels[c] for c in answer.choice_ids if c in labels),
                    text=answer.text.strip(),
                    via=via,
                )
            )
    session.submit(lambda: _round(session, decide_now=False))


def decide(session: IntakeSession) -> None:
    """Just decide for me: the next round is a verdict, whatever round it is."""
    session.submit(lambda: _round(session, decide_now=True))


# --- the rounds -----------------------------------------------------------------------------------


def _start(session: IntakeSession) -> None:
    session.emit(Say(text=intake_opening()))
    session.warm = session.runner.warm_session("intake", INTAKE_SYSTEM, str(session.temp_dir))
    # A need given at POST is read by this first leg, which may already know enough; with
    # none, the leg asks what the person needs.
    _round(session, decide_now=False)


def _round(session: IntakeSession, *, decide_now: bool) -> None:
    with session.lock:
        if session.verdict is not None:
            return
        session.legs += 1
        round_no = session.legs
        answers = [asdict(a) for a in session.answers]
    forced = decide_now or round_no >= MAX_INTAKE_ROUNDS
    library = session.library_rows()
    session.emit(Progress(text="Looking through the chores for yours…"))
    result = session.run_leg(
        "intake",
        INTAKE_SYSTEM,
        intake_prompt(library, answers, round_no=round_no, decide_now=forced),
        json_schema=INTAKE_SCHEMA,
        check=lambda value: _problem(value, forced=forced, spoken=bool(answers)),
        warm=True,
    )
    if not result.ok or result.value is None:
        _fail(session, result)
        return
    value = result.value
    if isinstance(value.get("verdict"), dict):
        _give_verdict(session, value["verdict"], library, answers)
        return
    questions = loop.card_questions(value, round_no)
    if not questions:  # unreachable after _problem, but never stall in silence
        session.emit(
            Error(reason="engine_error", detail="the intake asked nothing and decided nothing")
        )
        return
    say = str(value.get("say") or "").strip()
    # With nothing said yet, the opening already greeted: a second greeting is noise.
    if say and answers:
        session.emit(Say(text=say))
    with session.lock:
        session.round = round_no
        session.cards = max(session.cards, round_no)
        for question in questions:
            session.asked[question.id] = AskedQuestion(round=round_no, question=question)
    session.emit(Questions(round=round_no, questions=tuple(questions)))


def _fail(session: IntakeSession, result: LegResult) -> None:
    session.count("malformed_intake" if result.malformed else "failed_intake")
    reason = "engine_error" if result.malformed else (result.error_reason or "engine_error")
    session.emit(Error(reason=reason, detail=result.detail))


def _give_verdict(
    session: IntakeSession,
    raw: Mapping[str, Any],
    library: Sequence[Mapping[str, str]],
    answers: Sequence[Mapping[str, Any]],
) -> None:
    said = " ".join(str(a.get("text", "")) for a in answers if str(a.get("text", "")).strip())
    verdict = build_verdict(raw, library, fallback_need=said)
    if verdict.fit == "custom" and raw.get("fit") == "template":
        session.count("verdict_demoted")
    with session.lock:
        session.verdict = verdict
        session.round = 0
    session.emit(verdict)


# --- the checks -----------------------------------------------------------------------------------


def _problem(value: dict[str, Any], *, forced: bool, spoken: bool) -> str:
    """A structural problem worth the leg's one retry; anything finer is corrected, not retried."""
    verdict = value.get("verdict")
    if verdict is not None:
        if not isinstance(verdict, dict):
            return "verdict must be an object"
        if not spoken:
            return "the person has said nothing yet: ask a card, do not give a verdict"
        fit = verdict.get("fit")
        if fit not in ("template", "custom"):
            return "verdict.fit must be 'template' or 'custom'"
        if fit == "template":
            if not _line(verdict.get("playbook_id")):
                return "a template verdict names a playbook_id from the library"
            if not _line(verdict.get("why")):
                return "a template verdict says why it fits (verdict.why)"
        elif not _line(verdict.get("command")):
            return "a custom verdict carries a non-empty command"
        return ""
    if forced:
        return 'decide now: answer {"verdict": {...}}, not another card'
    questions = value.get("questions")
    if not isinstance(questions, list) or not questions:
        return "answer either a verdict or questions (a non-empty list)"
    for index, raw in enumerate(questions):
        if not isinstance(raw, dict) or not _line(raw.get("text")):
            return f"questions[{index}].text must be a non-empty string"
    return ""


def build_verdict(
    raw: Mapping[str, Any], library: Sequence[Mapping[str, str]], *, fallback_need: str = ""
) -> Verdict:
    """The model's verdict object as the wire :class:`Verdict`, after the rules.

    - A template verdict whose ``playbook_id`` is not in the library becomes ``custom``; its
      ``command`` is the model's, or the person's own need when the model gave none.
    - Alternates: only real ids, never the main one, no repeats, two at most; the title is the
      library's.
    - A custom verdict has ``playbook_id`` ``""`` and a command; a template one has command ``""``.
    - ``need`` is the model's first-person need, else the person's words, at most
      :data:`NEED_CAP` characters.
    """
    titles = {r["id"]: r.get("title", "") for r in library}
    main = _line(raw.get("playbook_id"))
    template = raw.get("fit") == "template" and main in titles
    need = cap_text(_line(raw.get("need")) or _line(fallback_need), NEED_CAP)
    command = _text(raw.get("command"), COMMAND_CAP)
    alternates: list[Alternate] = []
    seen = {main} if template else set()
    rows = raw.get("alternates")
    for row in rows if isinstance(rows, list) else []:
        if not isinstance(row, dict) or len(alternates) >= MAX_ALTERNATES:
            continue
        alt = _line(row.get("playbook_id"))
        if alt not in titles or alt in seen or alt == main:
            continue
        seen.add(alt)
        alternates.append(
            Alternate(
                playbook_id=alt, title=titles[alt], why=cap_text(_line(row.get("why")), WHY_CAP)
            )
        )
    if template:
        return Verdict(
            fit="template",
            playbook_id=main,
            why=cap_text(_line(raw.get("why")), WHY_CAP),
            differs=cap_text(_line(raw.get("differs")), WHY_CAP),
            alternates=tuple(alternates),
            need=need,
            command="",
        )
    return Verdict(
        fit="custom",
        playbook_id="",
        why=cap_text(_line(raw.get("why")), WHY_CAP),
        differs=cap_text(_line(raw.get("differs")), WHY_CAP),
        alternates=tuple(alternates),
        need=need,
        command=command or need,
    )


# --- text helpers ---------------------------------------------------------------------------------


def _line(value: Any) -> str:
    return " ".join(value.split()) if isinstance(value, str) else ""


def _text(value: Any, cap: int) -> str:
    return value.strip()[:cap] if isinstance(value, str) else ""


def _first_sentence(text: str) -> str:
    match = re.match(r"(.+?[.!?])(\s|$)", text)
    return match.group(1) if match else text

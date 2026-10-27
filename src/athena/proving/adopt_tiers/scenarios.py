"""ADR 0097 (tier bench, scenarios): nine people adopting nine playbooks, each with a fact sheet.

A scenario is one playbook from the library, chosen by complexity band, and one *different* person
than the playbook's own: someone whose answers are not in the playbook text, so a model cannot pass
the interview by reading the brief back. The person's truth is the **fact sheet** — the true value
of every slot the session derives mechanically for that playbook (each portal: the same app or her
own; each gate: ask first or go ahead), plus the ``fact`` and ``trap`` things the auditor should
learn about her. The simulated person answers from the sheet alone; the scorer reads the slots
against it. Neither the sheet nor the person ever reaches a leg under test.

**Bands** (Design decisions, Wave 3): *easy* = difficulty 3 with 3 or 4 portals; *typical* =
difficulty 4 with 4 portals; *hard* = difficulty 5 or more, or 6 portals and more. Three each.

**Scoring patterns are regular expressions, case-insensitive.** A ``portal`` entry is strict: her
truth is ``"same"`` (the playbook's app) or the name of her own app, and any other value is wrong.
A ``gate`` entry names her ``consent`` — ``ask`` (ask her before each such act) or ``go`` (go ahead
without asking) — and her words, which the simulated person says and the sheet's brief carries; a
gate is never scored (approval before a gated act is policy, settled before the first card), so
it carries no patterns. A ``fact`` or ``trap`` entry carries its own ``keys`` (which derived slot
it is: a match on the slot's label), ``accept`` (a value that is right) and ``reject`` (a value
that contradicts her). Matching a derived slot by its label is a heuristic, and it is said so in
the report.

``stated_up_front`` is what she volunteers before she is asked (1 or 2 things), to test that Athena
never asks again what she already said.
"""

from __future__ import annotations

import json
import re
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Literal

from athena.adopt.slots import load_playbook_json, mechanical_slots, portal_names
from athena.contracts.adopt import Brief, Slot

__all__ = [
    "BANDS",
    "SCENARIOS_DIR",
    "Entry",
    "Scenario",
    "ScenarioError",
    "band_of",
    "load_scenario",
    "load_scenarios",
    "sheet_brief",
    "sheet_slots",
]

SCENARIOS_DIR = Path(__file__).with_name("scenarios")

Band = Literal["easy", "typical", "hard"]
BANDS: tuple[Band, ...] = ("easy", "typical", "hard")
PER_BAND = 3

EntryKind = Literal["portal", "gate", "fact", "trap"]
_KINDS: tuple[str, ...] = ("portal", "gate", "fact", "trap")


class ScenarioError(ValueError):
    """A scenario file that does not hold together, with every problem in it."""

    def __init__(self, where: str, problems: Sequence[str]) -> None:
        self.where = where
        self.problems = list(problems)
        super().__init__(f"{where}: " + "; ".join(self.problems))


@dataclass(frozen=True)
class Entry:
    """One line of the fact sheet."""

    id: str
    kind: EntryKind
    about: str
    truth: str
    keys: tuple[str, ...] = ()
    accept: tuple[str, ...] = ()
    reject: tuple[str, ...] = ()
    consent: str = ""

    @property
    def strict(self) -> bool:
        """A portal value is right or wrong, never merely unclear."""
        return self.kind == "portal"


@dataclass(frozen=True)
class Stated:
    """Something she says before she is asked: the sheet entry it settles, in her words."""

    entry: str
    text: str


@dataclass(frozen=True)
class Scenario:
    id: str
    band: Band
    playbook_id: str
    person: str
    sheet: tuple[Entry, ...]
    stated_up_front: tuple[Stated, ...]
    playbook: Mapping[str, Any]

    def entry(self, entry_id: str) -> Entry:
        for item in self.sheet:
            if item.id == entry_id:
                return item
        raise KeyError(entry_id)

    @property
    def difficulty(self) -> int:
        edge = self.playbook.get("edge")
        value = edge.get("difficulty") if isinstance(edge, Mapping) else None
        return int(value) if isinstance(value, int) else 0

    @property
    def portal_count(self) -> int:
        return len(portal_names(self.playbook))

    def mechanical(self) -> list[Slot]:
        return mechanical_slots(self.playbook)


# --- bands --------------------------------------------------------------------------------------


def band_of(difficulty: int, portals: int) -> Band | None:
    """The complexity band a playbook falls in, or ``None`` when it is in none of them."""
    if difficulty >= 5 or portals >= 6:
        return "hard"
    if difficulty == 4 and portals == 4:
        return "typical"
    if difficulty == 3 and portals in (3, 4):
        return "easy"
    return None


# --- loading ------------------------------------------------------------------------------------


def load_scenario(path: str | Path, *, library: Path | None = None) -> Scenario:
    """One scenario file, checked against its playbook — or :class:`ScenarioError`."""
    source = Path(path)
    where = source.name
    try:
        raw = json.loads(source.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise ScenarioError(where, [f"cannot read: {exc}"]) from exc
    if not isinstance(raw, dict):
        raise ScenarioError(where, ["not a JSON object"])
    problems: list[str] = []
    sid = _str(raw.get("id"))
    if sid != source.stem:
        problems.append(f"id {sid!r} is not the file name {source.stem!r}")
    band = raw.get("band")
    if band not in BANDS:
        problems.append(f"band {band!r} is not one of {BANDS}")
    playbook_id = _str(raw.get("playbook_id"))
    try:
        playbook = load_playbook_json(playbook_id, library)
    except LookupError as exc:
        raise ScenarioError(where, [*problems, str(exc)]) from exc
    person = _str(raw.get("person"))
    if not person:
        problems.append("person is empty")
    names = portal_names(playbook)
    entries: list[Entry] = []
    seen: set[str] = set()
    for index, item in enumerate(raw.get("sheet") or []):
        entry = _entry(item, index, names, problems)
        if entry is None:
            continue
        if entry.id in seen:
            problems.append(f"sheet: {entry.id} appears twice")
        seen.add(entry.id)
        entries.append(entry)
    stated: list[Stated] = []
    for item in raw.get("stated_up_front") or []:
        ref = _str(item.get("entry")) if isinstance(item, dict) else ""
        text = _str(item.get("text")) if isinstance(item, dict) else ""
        if ref not in seen:
            problems.append(f"stated_up_front names {ref!r}, which is not on the sheet")
        if not text:
            problems.append(f"stated_up_front {ref!r} says nothing")
        stated.append(Stated(entry=ref, text=text))
    if not 1 <= len(stated) <= 2:
        problems.append(f"stated_up_front holds {len(stated)} things; 1 or 2")
    scenario = Scenario(
        id=sid,
        band="hard" if band == "hard" else "typical" if band == "typical" else "easy",
        playbook_id=playbook_id,
        person=person,
        sheet=tuple(entries),
        stated_up_front=tuple(stated),
        playbook=playbook,
    )
    # Every mechanically derived slot has its truth on the sheet, of the same kind.
    by_id = {e.id: e for e in entries}
    for slot in scenario.mechanical():
        entry = by_id.get(slot.id)
        if entry is None:
            problems.append(f"sheet has no entry for mechanical slot {slot.id} ({slot.kind})")
        elif entry.kind != slot.kind:
            problems.append(f"sheet {slot.id} is a {entry.kind}; the slot is a {slot.kind}")
    actual = band_of(scenario.difficulty, scenario.portal_count)
    if band in BANDS and actual != band:
        problems.append(
            f"band {band!r}, but {playbook_id} (difficulty {scenario.difficulty}, "
            f"{scenario.portal_count} portals) is {actual or 'in no band'}"
        )
    if problems:
        raise ScenarioError(where, problems)
    return scenario


def load_scenarios(
    ids: Sequence[str] = (),
    *,
    directory: Path = SCENARIOS_DIR,
    library: Path | None = None,
    full: bool = True,
) -> list[Scenario]:
    """Every scenario (or the named ones), in band then name order. ``full`` asks that the set
    is the designed one: three per band."""
    files = sorted(directory.glob("*.json"))
    scenarios = [load_scenario(f, library=library) for f in files]
    if full and not ids:
        counts = {b: sum(1 for s in scenarios if s.band == b) for b in BANDS}
        wrong = [f"{b}: {n}" for b, n in counts.items() if n != PER_BAND]
        if wrong:
            raise ScenarioError(
                directory.name, [f"want {PER_BAND} per band, have {', '.join(wrong)}"]
            )
    if ids:
        known = {s.id for s in scenarios}
        missing = [i for i in ids if i not in known]
        if missing:
            raise ScenarioError(directory.name, [f"no scenario {i!r}" for i in missing])
        scenarios = [s for s in scenarios if s.id in ids]
    return sorted(scenarios, key=lambda s: (BANDS.index(s.band), s.id))


# --- the sheet as slots and as a brief (the shape bench's input) ---------------------------------


def sheet_slots(scenario: Scenario) -> list[Slot]:
    """The mechanical slots as her sheet fills them, every one confirmed by her."""
    out: list[Slot] = []
    names = portal_names(scenario.playbook)
    for slot in scenario.mechanical():
        entry = scenario.entry(slot.id)
        if slot.kind == "portal":
            index = int(slot.id[1:]) - 1
            name = names[index] if 0 <= index < len(names) else slot.value
            value = name if entry.truth.lower() == "same" else entry.truth
        else:
            value = entry.truth
        out.append(Slot(slot.id, slot.kind, slot.label, "confirmed", value, "user"))
    return out


def sheet_brief(scenario: Scenario) -> Brief:
    """The brief her sheet implies, built mechanically (no model): the input every config's
    ``shape`` leg is given, so the shaper is measured on the same brief whatever interviewed her."""
    from athena.adopt.loop import fitted_command
    from athena.adopt.slots import portal_swaps

    slots = sheet_slots(scenario)
    facts = [e for e in scenario.sheet if e.kind in ("fact", "trap")]
    lines = [f"- {e.about}: {e.truth}" for e in facts]
    md = "\n\n".join(
        [
            _str(scenario.playbook.get("promise")) or _str(scenario.playbook.get("title")),
            "**Your setup:**\n"
            + "\n".join(f"- {s.label.rstrip(' ?.:')}: {s.value}" for s in slots),
            "**Your case:**\n" + "\n".join(lines) if lines else "",
        ]
    ).strip()
    return Brief(
        rev=1,
        md=md,
        command=fitted_command(scenario.playbook, slots),
        portals=portal_swaps(scenario.playbook, slots),
        open_slot_ids=(),
    )


# --- helpers ------------------------------------------------------------------------------------


def _entry(item: Any, index: int, names: Sequence[str], problems: list[str]) -> Entry | None:
    where = f"sheet[{index}]"
    if not isinstance(item, dict):
        problems.append(f"{where} is not an object")
        return None
    eid = _str(item.get("id"))
    kind = item.get("kind")
    if not eid or kind not in _KINDS:
        problems.append(f"{where}: needs an id and a kind in {_KINDS}")
        return None
    truth = _str(item.get("truth"))
    if not truth:
        problems.append(f"{eid}: truth is empty")
    about = _str(item.get("about"))
    keys = _patterns(item.get("keys"), f"{eid}.keys", problems)
    accept = _patterns(item.get("accept"), f"{eid}.accept", problems)
    reject = _patterns(item.get("reject"), f"{eid}.reject", problems)
    consent = _str(item.get("consent"))
    if kind == "portal":
        index_ = int(eid[1:]) - 1 if eid[1:].isdigit() else -1
        name = names[index_] if 0 <= index_ < len(names) else ""
        if not name:
            problems.append(f"{eid}: the playbook has no portal {eid}")
        mine = name if truth.lower() == "same" else truth
        accept = (re.escape(mine),) + ((r"\bsame\b",) if truth.lower() == "same" else ())
        reject = ()
        about = about or f"which app she uses where the playbook uses {name}"
    elif kind == "gate":
        if consent not in ("ask", "go"):
            problems.append(f"{eid}: consent must be 'ask' or 'go'")
        # Never scored (score.slot_verdicts skips gates): no patterns to carry.
        accept = reject = ()
        about = about or "whether to ask her before this act, or go ahead"
    else:
        if not keys:
            problems.append(f"{eid}: a {kind} entry needs keys to find its slot")
        if not accept:
            problems.append(f"{eid}: a {kind} entry needs accept patterns")
        if not about:
            problems.append(f"{eid}: about is empty")
    return Entry(
        id=eid,
        kind="portal"
        if kind == "portal"
        else "gate"
        if kind == "gate"
        else "fact"
        if kind == "fact"
        else "trap",
        about=about,
        truth=truth,
        keys=keys,
        accept=accept,
        reject=reject,
        consent=consent,
    )


def _patterns(value: Any, where: str, problems: list[str]) -> tuple[str, ...]:
    if value is None:
        return ()
    if not isinstance(value, list) or not all(isinstance(v, str) for v in value):
        problems.append(f"{where} must be a list of strings")
        return ()
    for pattern in value:
        try:
            re.compile(pattern)
        except re.error as exc:
            problems.append(f"{where}: {pattern!r} is not a regular expression ({exc})")
    return tuple(value)


def _str(value: Any) -> str:
    return " ".join(value.split()) if isinstance(value, str) else ""

"""ADR 0097 (slots + auditor): what Athena must know about this person, derived from the playbook.

A *slot* is one thing the run depends on. Two kinds are mechanical and come straight from
``playbook.json``: one ``portal`` slot per ``apps[]`` entry (does she use that app for that job,
or another one?) and one ``gate`` slot per ``gates[]`` entry (the precondition its ``why``
names). The other two are written by the first ``audit`` leg: ``fact`` slots for the dates,
places, amounts and thresholds the rules turn on, and ``trap`` slots for the traps that need
telling apart for this person. Never more than :data:`MAX_SLOTS`; ids are ``p1..``, ``g1..``,
``f1..``, ``t1..`` in the order they were made, and an id is never reused.

The person's word wins. An update from research, memory, a document or an account never
overwrites a slot the person confirmed; only another of her answers (through the auditor) does.

Playbooks are found where the daemon runs from: the frozen bundle's ``playbooks/`` first
(PyInstaller's ``_MEIPASS``, which the sidecar build ships), then the source checkout's, guarded by
the library's own ``taxonomy.json`` so a stray ``playbooks/`` directory is not read as the library.
Only ``playbook.json`` is read here: ``truth.json`` is the scorer's and never reaches a prompt.
"""

from __future__ import annotations

import json
import re
import sys
from collections.abc import Iterable, Mapping, Sequence
from dataclasses import replace
from pathlib import Path
from typing import Any

from athena.contracts.adopt import Slot, SlotKind, SlotSource, SlotStatus

__all__ = [
    "ENV_VAR",
    "LABEL_CAP",
    "MAX_SLOTS",
    "PLAYBOOKS_DIRNAME",
    "SLOT_PREFIX",
    "VALUE_CAP",
    "PlaybookMissing",
    "add_slots",
    "apply_updates",
    "load_playbook_json",
    "mechanical_slots",
    "open_slot_ids",
    "playbooks_root",
    "portal_swaps",
]

PLAYBOOKS_DIRNAME = "playbooks"
#: The file that marks a directory as the playbook library rather than any ``playbooks/``.
LIBRARY_MARKER = "taxonomy.json"
#: An explicit library directory (a test, a non-default install). The only candidate when set.
ENV_VAR = "ATHENA_PLAYBOOKS"

MAX_SLOTS = 12
LABEL_CAP = 200
VALUE_CAP = 400

SLOT_PREFIX: dict[str, str] = {"portal": "p", "gate": "g", "fact": "f", "trap": "t"}
_KINDS: tuple[SlotKind, ...] = ("portal", "gate", "fact", "trap")
_STATUSES: tuple[SlotStatus, ...] = ("open", "guessed", "confirmed")
_SOURCES: tuple[SlotSource, ...] = ("user", "research", "memory", "document", "account", "default")

_PLAYBOOK_ID = re.compile(r"[a-z0-9][a-z0-9-]{0,79}\Z")


class PlaybookMissing(LookupError):
    """No playbook by that id in the library (or no library at all)."""


# --- finding the library ------------------------------------------------------------------------


def playbooks_root(environ: Mapping[str, str] | None = None) -> Path | None:
    """The playbook library's directory, or ``None`` when this install carries none."""
    import os

    env = environ if environ is not None else os.environ
    explicit = env.get(ENV_VAR, "").strip()
    if explicit:
        path = Path(explicit)
        return path if path.is_dir() else None
    for candidate in _candidates():
        if (candidate / LIBRARY_MARKER).is_file():
            return candidate
    return None


def _candidates() -> list[Path]:
    out: list[Path] = []
    if getattr(sys, "frozen", False):
        base = getattr(sys, "_MEIPASS", None)
        root = Path(str(base)) if base else Path(sys.executable).resolve().parent
        out.append(root / PLAYBOOKS_DIRNAME)
    # src/athena/adopt/slots.py -> the checkout root is three parents above the package.
    out.append(Path(__file__).resolve().parents[3] / PLAYBOOKS_DIRNAME)
    return out


def load_playbook_json(playbook_id: str, root: Path | None = None) -> dict[str, Any]:
    """``playbooks/<id>/playbook.json`` as a dict, or :class:`PlaybookMissing`."""
    if not _PLAYBOOK_ID.fullmatch(playbook_id or ""):
        raise PlaybookMissing(f"not a playbook id: {playbook_id!r}")
    library = root if root is not None else playbooks_root()
    if library is None:
        raise PlaybookMissing("this install carries no playbook library")
    path = library / playbook_id / "playbook.json"
    if not path.is_file():
        raise PlaybookMissing(f"no playbook {playbook_id!r}")
    try:
        raw = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise PlaybookMissing(f"playbook {playbook_id!r} could not be read: {exc}") from exc
    if not isinstance(raw, dict) or not isinstance(raw.get("command"), str):
        raise PlaybookMissing(f"playbook {playbook_id!r} has no command")
    return raw


# --- the mechanical slots -----------------------------------------------------------------------


def mechanical_slots(playbook: Mapping[str, Any]) -> list[Slot]:
    """One ``portal`` slot per app and one ``gate`` slot per gate, in the playbook's order."""
    slots: list[Slot] = []
    for app in _dicts(playbook.get("apps")):
        name = _text(app.get("name"))
        if not name:
            continue
        role = _text(app.get("role")).split(":", 1)[0].strip() or "this part of the job"
        slots.append(
            Slot(
                id=f"p{_count(slots, 'portal') + 1}",
                kind="portal",
                label=_cap(f"Do you use {name} for {role}, or something else?", LABEL_CAP),
                value=name,
                status="open",
                source="default",
            )
        )
    for gate in _dicts(playbook.get("gates")):
        label = _text(gate.get("label")) or _text(gate.get("action"))
        if not label:
            continue
        why = _first_sentence(_text(gate.get("why")))
        slots.append(
            Slot(
                id=f"g{_count(slots, 'gate') + 1}",
                kind="gate",
                label=_cap(f"Before “{label}”: {why}" if why else label, LABEL_CAP),
                status="open",
                source="default",
            )
        )
    return slots[:MAX_SLOTS]


def portal_names(playbook: Mapping[str, Any]) -> list[str]:
    return [n for n in (_text(a.get("name")) for a in _dicts(playbook.get("apps"))) if n]


def portal_swaps(playbook: Mapping[str, Any], slots: Sequence[Slot]) -> dict[str, str]:
    """``{playbook app name: hers}``; ``""`` when she uses the same one (``Brief.portals``)."""
    names = portal_names(playbook)
    by_id = {s.id: s for s in slots}
    swaps: dict[str, str] = {}
    for index, name in enumerate(names, start=1):
        slot = by_id.get(f"p{index}")
        value = slot.value.strip() if slot is not None else ""
        swaps[name] = "" if not value or value.lower() == name.lower() else value
    return swaps


# --- growing and updating -----------------------------------------------------------------------


def add_slots(slots: Sequence[Slot], proposed: Iterable[Mapping[str, Any]]) -> list[Slot]:
    """``slots`` plus the proposed ``fact``/``trap`` slots, up to :data:`MAX_SLOTS`, de-duplicated
    by label. A proposal of another kind, or with no label, is dropped."""
    out = list(slots)
    seen = {s.label.strip().lower() for s in out}
    for raw in proposed:
        if len(out) >= MAX_SLOTS:
            break
        kind = raw.get("kind")
        if kind not in ("fact", "trap"):
            continue
        label = _cap(_text(raw.get("label")), LABEL_CAP)
        if not label or label.lower() in seen:
            continue
        value = _cap(_text(raw.get("value")), VALUE_CAP)
        status: SlotStatus = "guessed" if value and raw.get("status") == "guessed" else "open"
        out.append(
            Slot(
                id=f"{SLOT_PREFIX[kind]}{_count(out, kind) + 1}",
                kind="fact" if kind == "fact" else "trap",
                label=label,
                value=value,
                status=status,
                source="default",
            )
        )
        seen.add(label.lower())
    return out


def apply_updates(
    slots: Sequence[Slot],
    updates: Iterable[Mapping[str, Any]],
    *,
    source: SlotSource,
) -> tuple[list[Slot], bool]:
    """Apply ``[{slot_id, value, status}]`` from ``source``; answers ``(slots, changed)``.

    An unknown slot id or status is skipped, never raised: the updates come from a model or a
    lane. A non-user source never touches a slot the person confirmed herself, and never marks
    anything ``open`` (only the auditor, reading her words, reopens).
    """
    by_id = {s.id: s for s in slots}
    changed = False
    for raw in updates:
        slot = by_id.get(_text(raw.get("slot_id")) or _text(raw.get("id")))
        if slot is None:
            continue
        status = raw.get("status", "guessed")
        if status not in _STATUSES:
            continue
        if source != "user" and (
            (slot.status == "confirmed" and slot.source == "user") or status == "open"
        ):
            continue
        value = _cap(_text(raw.get("value")), VALUE_CAP) if "value" in raw else slot.value
        new_status: SlotStatus = (
            "open" if status == "open" else "confirmed" if status == "confirmed" else "guessed"
        )
        updated = replace(
            slot,
            value=value,
            status=new_status,
            source=source if source in _SOURCES else "default",
        )
        if updated != slot:
            by_id[slot.id] = updated
            changed = True
    return [by_id[s.id] for s in slots], changed


def open_slot_ids(slots: Sequence[Slot]) -> list[str]:
    """Slots still ``open`` by status, in order."""
    return [s.id for s in slots if s.status == "open"]


# --- helpers ------------------------------------------------------------------------------------


def _dicts(value: Any) -> list[Mapping[str, Any]]:
    return [v for v in value if isinstance(v, Mapping)] if isinstance(value, list) else []


def _text(value: Any) -> str:
    return " ".join(value.split()) if isinstance(value, str) else ""


def _count(slots: Sequence[Slot], kind: str) -> int:
    return sum(1 for s in slots if s.kind == kind)


def _cap(text: str, limit: int) -> str:
    return text if len(text) <= limit else text[: limit - 1].rstrip() + "…"


def _first_sentence(text: str) -> str:
    match = re.match(r"(.+?[.;!?])(\s|$)", text)
    return (match.group(1) if match else text).strip()

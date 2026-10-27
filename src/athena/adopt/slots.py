"""ADR 0097 (slots + auditor): what Athena must know about this person, derived from the playbook.

A *slot* is one thing the run depends on. Two kinds are mechanical and come straight from
``playbook.json``: one ``portal`` slot per ``apps[]`` entry (which app or site does she use for
that part of the job?) and one ``gate`` slot per ``gates[]`` entry (the precondition its ``why``
names). A portal slot starts empty and is asked by the app's *role*: the playbook's app names are
invented for its example world, so they are never offered to her as hers (:func:`example_terms`).
The other two are written by the first ``audit`` leg: ``fact`` slots for the dates, places,
amounts and thresholds the rules turn on, and ``trap`` slots for the traps that need
telling apart for this person. Never more than :data:`MAX_SLOTS`; ids are ``p1..``, ``g1..``,
``f1..``, ``t1..`` in the order they were made, and an id is never reused.

A ``fact`` or ``trap`` slot that holds a rule the playbook itself states (its traps, steps, job
text or cited sources) is ``confirmed`` with source ``default``, the pair a gate already carries:
settled by the library, neither her word nor a guess. The desktop words source ``default`` as
"the playbook"; the brief marks it "(from the playbook)", never "(my guess)" (:func:`provenance`).

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

from athena.contracts.adopt import Slot, SlotKind, SlotSource, SlotStatus, cap_text

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
    "example_terms",
    "from_playbook",
    "invented_names",
    "load_playbook_json",
    "mechanical_slots",
    "mentions",
    "open_slot_ids",
    "playbooks_root",
    "portal_roles",
    "portal_swaps",
    "portal_value",
    "provenance",
    "scrub",
]

PLAYBOOKS_DIRNAME = "playbooks"
#: The file that marks a directory as the playbook library rather than any ``playbooks/``.
LIBRARY_MARKER = "taxonomy.json"
#: An explicit library directory (a test, a non-default install). The only candidate when set.
ENV_VAR = "ATHENA_PLAYBOOKS"

MAX_SLOTS = 12
LABEL_CAP = 200
VALUE_CAP = 400

#: What every gate slot holds: approval before each act is fixed, so it is shown, not asked.
GATE_VALUE = "She asks you first, every time"

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
    """One ``portal`` slot per app and one ``gate`` slot per gate, in the playbook's order.

    A portal slot is asked by the app's role and starts empty: the playbook's app name is the
    example world's invention, never a default answer for her (UAT 2026-10-23, benefits-05).
    """
    slots: list[Slot] = []
    for role in portal_roles(playbook):
        slots.append(
            Slot(
                id=f"p{_count(slots, 'portal') + 1}",
                kind="portal",
                label=cap_text(f"Which app or site do you use for {role}?", LABEL_CAP),
                value="",
                status="open",
                source="default",
            )
        )
    for gate in _dicts(playbook.get("gates")):
        label = _text(gate.get("label")) or _text(gate.get("action"))
        if not label:
            continue
        slots.append(
            Slot(
                id=f"g{_count(slots, 'gate') + 1}",
                kind="gate",
                label=cap_text(f"Asks you before: {label}", LABEL_CAP),
                # A gate is the catalog's policy, never the person's choice or a model's
                # (AGENTS.md "The gate is the policy"): settled from the start, never asked.
                status="confirmed",
                value=GATE_VALUE,
                source="default",
            )
        )
    return slots[:MAX_SLOTS]


def portal_names(playbook: Mapping[str, Any]) -> list[str]:
    return [_text(a.get("name")) for a in _named_apps(playbook)]


def portal_roles(playbook: Mapping[str, Any]) -> list[str]:
    """Each named app's role, in order: the part before a colon, with the names the example
    itself declares invented taken out ("Novabridge's 835 remittances" -> "the 835
    remittances")."""
    names = invented_names(playbook)
    out: list[str] = []
    for app in _named_apps(playbook):
        role = _text(app.get("role")).split(":", 1)[0].strip()
        out.append(scrub(role, names) or "this part of the job")
    return out


def _named_apps(playbook: Mapping[str, Any]) -> list[Mapping[str, Any]]:
    return [a for a in _dicts(playbook.get("apps")) if _text(a.get("name"))]


# --- the example world, told apart from her case ------------------------------------------------

#: "<names> are invented" / "<name> is invented": the caveat's own list of the example's inventions.
_INVENTED = re.compile(r"^(?P<names>.+?)\s+(?:are|is)\s+(?:all\s+)?invented\b", re.S)
#: A run of capitalised words: a name, when it is not the first word of its sentence.
_CAPITALS = re.compile(r"[A-Z][\w'&-]*(?:\s+[A-Z][\w'&-]*)*")
#: A dollar amount as the example states it ("$2,573.70", "$48,600").
_AMOUNT = re.compile(r"\$\s?\d[\d,]*(?:\.\d+)?")
#: Capitalised words a command uses that name no one: pronouns, months, weekdays, family words.
_COMMON = frozenset(
    {"I", "I'm", "I've", "I'd", "I'll", "Mom", "Dad", "Mum", "Mother", "Father"}
    | {
        "January",
        "February",
        "March",
        "April",
        "May",
        "June",
        "July",
        "August",
        "September",
        "October",
        "November",
        "December",
        "Monday",
        "Tuesday",
        "Wednesday",
        "Thursday",
        "Friday",
        "Saturday",
        "Sunday",
    }
)
_CORPORATE = re.compile(r",?\s+(?:LLC|Inc\.?|Co\.?|Corp\.?|Ltd\.?|LLP)$")
_ACRONYM = re.compile(r"[A-Z0-9&-]{2,}(?:'?s)?")


def invented_names(playbook: Mapping[str, Any]) -> frozenset[str]:
    """The names the playbook itself declares invented: its app names (unless its general text
    names the app too, as a real one: "Seller Central"), and the names its caveat lists ("Noor
    Haddad, Corbel Property Management, ... are invented")."""
    # Traps and gates may name the example's apps; fit and cited sources name only real ones.
    real = " ".join(
        [_fit_text(playbook), *(_text(s.get("label")) for s in _sources(playbook))]
    ).lower()
    names: set[str] = set()
    for app in _named_apps(playbook):
        name = _text(app.get("name"))
        bare = re.sub(r"\s*\([^)]*\)", "", name).strip()
        if re.search(rf"(?<!\w){re.escape((bare or name).lower())}(?!\w)", real):
            continue
        names.add(name)
        if bare:
            names.add(bare)
    caveat = _text(playbook.get("caveat"))
    first = re.split(r"(?<=[.;])\s", caveat, maxsplit=1)[0] if caveat else ""
    listed = _INVENTED.match(first)
    if listed:
        for raw in re.split(r",\s*|\s+and\s+", listed.group("names")):
            item = _possessive(re.sub(r"\s*\(.*$", "", raw).strip(" ,;()"))
            if item[:1].isupper() and not item.lower().startswith(("every ", "all ", "the ")):
                names.add(item)
                names.add(_CORPORATE.sub("", item))
    return frozenset(n for n in names if len(n) > 1)


def example_terms(playbook: Mapping[str, Any]) -> frozenset[str]:
    """The proper names and dollar amounts that belong to the playbook's invented example.

    :func:`invented_names`, plus the capitalised words the example command uses mid-sentence
    (not a month, a weekday, a family word or an acronym) unless the library's general text
    (title, domain, traps, gates, sources, fit) uses them too, which makes them a rule's or a
    program's name (California, Medicare). Plus every dollar amount in the example's command,
    brief and promise. Names match case-sensitively on word boundaries (:func:`mentions`).
    """
    terms: set[str] = set(invented_names(playbook))
    general = _general_text(playbook)
    for sentence in re.split(r"(?<=[.!?:;])\s+", _text(playbook.get("command"))):
        for match in _CAPITALS.finditer(sentence):
            words = match.group(0).split()
            if match.start() == 0:
                words = words[1:]  # the sentence's own first word
            # An acronym (ABN, IRS, RFIs) is a real term of the field, not an invented name.
            words = [w for w in words if w not in _COMMON and not _ACRONYM.fullmatch(w)]
            name = _possessive(" ".join(words).strip(" ()"))
            if len(name) > 1 and name.lower() not in general:
                terms.add(name)
    for field in ("command", "brief", "promise"):
        terms.update(a.replace(" ", "") for a in _AMOUNT.findall(_text(playbook.get(field))))
    return frozenset(t for t in terms if len(t) > 1)


def _general_text(playbook: Mapping[str, Any]) -> str:
    """The library's general text, lower-cased: what names a rule, a program or a real app
    rather than the example (title, domain, traps, gates, cited sources, fit)."""
    return " ".join(
        [
            _text(playbook.get("title")),
            _text(playbook.get("short_title")),
            _text(playbook.get("domain")),
            *(_text(t) for t in playbook.get("traps", []) if isinstance(t, str)),
            *(
                f"{_text(g.get('label'))} {_text(g.get('why'))}"
                for g in _dicts(playbook.get("gates"))
            ),
            *(_text(s.get("label")) for s in _sources(playbook)),
            _fit_text(playbook),
        ]
    ).lower()


def mentions(text: str, term: str) -> bool:
    """``term`` appears in ``text`` as a whole word or as the same dollar amount.

    Case counts: a name is written with its capitals, and "garden" in a sentence is not the
    example's "Garden"."""
    if term.startswith("$"):
        want = re.sub(r"[^\d.]", "", term)
        return any(re.sub(r"[^\d.]", "", a) == want for a in _AMOUNT.findall(text))
    return re.search(rf"(?<!\w){re.escape(term)}(?!\w)", text) is not None


def scrub(text: str, terms: Iterable[str]) -> str:
    """``text`` with each example name (and its possessive) replaced by "the"."""
    out = text
    for term in sorted((t for t in terms if not t.startswith("$")), key=len, reverse=True):
        out = re.sub(rf"(?<!\w){re.escape(term)}(?:'s)?(?!\w)", "the", out, flags=re.I)
    out = re.sub(r"\b(?:the|a|an)\s+the\b", "the", out, flags=re.I)
    out = re.sub(r"^the,\s*", "", out)
    out = re.sub(r"\s+(?:to|for|from|by|of|at)?\s*the$", "", out)
    return " ".join(out.split())


def _possessive(text: str) -> str:
    return re.sub(r"'s$", "", text.strip())


def _sources(playbook: Mapping[str, Any]) -> list[Mapping[str, Any]]:
    economics = playbook.get("economics")
    return _dicts(economics.get("sources")) if isinstance(economics, Mapping) else []


def _fit_text(playbook: Mapping[str, Any]) -> str:
    fit = playbook.get("fit")
    if not isinstance(fit, Mapping):
        return ""
    parts: list[str] = []
    for value in fit.values():
        if isinstance(value, str):
            parts.append(value)
        elif isinstance(value, list):
            parts.extend(v for v in value if isinstance(v, str))
    return " ".join(parts)


# --- where a value came from --------------------------------------------------------------------

#: How a value that is not the person's own words is marked in the brief and the command.
_FROM: dict[str, str] = {
    "research": "from research",
    "document": "from your document",
    "account": "from your account",
}


def provenance(slot: Slot) -> str:
    """The marker a held value carries in the brief and the command.

    ``""`` for the person's own words (now, or carried from her approved case); "(from the
    playbook)" for a rule the library states (confirmed, source ``default``); "(from research)"
    and the like for what a lane read; "(your earlier answer, to check)" for her own words from
    an earlier case that a reopening turned back into a guess; "(my guess)" only for Athena's
    own inference about this person.
    """
    if slot.status == "confirmed":
        if slot.source in ("user", "memory"):
            return ""
        return f" ({_FROM.get(slot.source, 'from the playbook')})"
    if slot.source in _FROM:
        return f" ({_FROM[slot.source]})"
    if slot.source == "memory":
        return " (your earlier answer, to check)"
    return " (my guess)"


def portal_swaps(playbook: Mapping[str, Any], slots: Sequence[Slot]) -> dict[str, str]:
    """``{playbook app name: hers}``; ``""`` when she uses the same one (``Brief.portals``)."""
    names = portal_names(playbook)
    by_id = {s.id: s for s in slots}
    swaps: dict[str, str] = {}
    for index, name in enumerate(names, start=1):
        slot = by_id.get(f"p{index}")
        swaps[name] = portal_value(name, slot.value) if slot is not None else ""
    return swaps


#: A portal value that names the playbook's own app in words instead of by name.
_SAME_APP = re.compile(r"\b(the )?same\b|as in the playbook|as listed", re.I)
#: What a value says it is NOT ("Gmail, not Postwren"): never read as the app it names.
_NEGATED = re.compile(r"[,;]?\s*\b(not|instead of|rather than)\b[^,;.]*", re.I)
#: What an auditor appends to an app's name ("RTS Pro, as you said").
_NAME_TAIL = re.compile(
    r"\s*[,;:(]\s*(as you (said|use it)|as in the playbook|as listed)\b.*$", re.I
)


def portal_value(name: str, value: str) -> str:
    """The app she uses in place of the playbook's ``name``, read from a portal slot's
    ``value``; ``""`` when it is the playbook's own app.

    The auditor is asked for a bare app name, but a value may still read "RTS Pro, as in the
    playbook", "Proton Mail" or "Gmail, not Postwren". What the value says it is *not* is cut
    first; then a value that holds the playbook's name (spaces, case and punctuation aside,
    with or without its parenthetical) or says "same" is the same app, and anything else is
    hers, trimmed of the auditor's tail — so "Gmail, not Postwren" renames Postwren to Gmail and
    never reads as Postwren.
    """
    text = _NEGATED.sub("", " ".join(value.split())).strip(" ,;:.")
    if not text:
        return ""
    held = _compact(text)
    bare = re.sub(r"\s*\([^)]*\)", "", name)
    if any(c and c in held for c in (_compact(name), _compact(bare))) or _SAME_APP.search(text):
        return ""
    return _NAME_TAIL.sub("", text).strip(" ,;:.")


def _compact(text: str) -> str:
    return re.sub(r"[\W_]+", "", text.lower())


# --- growing and updating -----------------------------------------------------------------------


def add_slots(slots: Sequence[Slot], proposed: Iterable[Mapping[str, Any]]) -> list[Slot]:
    """``slots`` plus the proposed ``fact``/``trap`` slots, up to :data:`MAX_SLOTS`, de-duplicated
    by label. A proposal of another kind, or with no label, is dropped.

    A proposal marked ``"from": "playbook"`` with a value holds a rule the playbook states: it is
    ``confirmed`` (source ``default``), not a guess. Anything else with a value is a guess."""
    out = list(slots)
    seen = {s.label.strip().lower() for s in out}
    for raw in proposed:
        if len(out) >= MAX_SLOTS:
            break
        kind = raw.get("kind")
        if kind not in ("fact", "trap"):
            continue
        label = cap_text(_text(raw.get("label")), LABEL_CAP)
        if not label or label.lower() in seen:
            continue
        value = cap_text(_text(raw.get("value")), VALUE_CAP)
        status: SlotStatus = (
            "confirmed"
            if value and from_playbook(raw)
            else "guessed"
            if value and raw.get("status") == "guessed"
            else "open"
        )
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
    lane. A non-user source never touches a slot the person confirmed herself (now, or in an
    approved case this session reopened: source ``memory``, ADR 0123), and never marks anything
    ``open`` (only the auditor, reading her words, reopens).
    """
    by_id = {s.id: s for s in slots}
    changed = False
    for raw in updates:
        slot = by_id.get(_text(raw.get("slot_id")) or _text(raw.get("id")))
        if slot is None or slot.kind == "gate":
            continue
        status = raw.get("status", "guessed")
        if status not in _STATUSES:
            continue
        if source != "user" and (
            (slot.status == "confirmed" and slot.source in ("user", "memory")) or status == "open"
        ):
            continue
        value = cap_text(_text(raw.get("value")), VALUE_CAP) if "value" in raw else slot.value
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


def from_playbook(raw: Mapping[str, Any]) -> bool:
    """An auditor's slot or update that says its value is a rule the playbook states."""
    return _text(raw.get("from")).lower() in ("playbook", "the playbook")


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


def _first_sentence(text: str) -> str:
    match = re.match(r"(.+?[.;!?])(\s|$)", text)
    return (match.group(1) if match else text).strip()

"""Every id prefix in this system, in one place (README §3.5, the day-zero lessons).

The first build minted ids in two modules and each added a prefix, so a conversation for a project
came out as ``conv_proj_proj_<id>``. The fix is structural, not a convention: one table, one
``mint``, one ``is_id``, and derived ids built by a function that is handed an already-minted id
instead of a bare slug. :data:`ID_PREFIXES` is a plain dict of strings and nothing cleverer so
that another language can read it as text. None does yet: the desktop has no ``lib/ids.ts``
(AGENTS.md names it as later work, with a parity test), and the one id it mints that crosses this
seam - the shell's capture id, in ``apps/desktop/src-tauri/src/store.rs`` - is held to this table
by ``tests/contracts/test_ids.py``, which reads that file's prefix and hex width.

Episode ids are minted ``ep_`` plus **twelve** hex digits, like every other kind, since ADR 0140
("Memory replication"). They were eight - the Personas Rust writer's ``short_id(8)`` - and that was
safe while one brain minted them all. Once paired devices replicate episodes into each other's
brains, every device mints into one shared id space: at 32 bits two devices writing a few thousand
episodes each meet the birthday bound, and a collision there is not a crash but a memory filed as a
conflict and never recalled. So the width grows for **new** mints only. Every eight-hex episode id
already on disk - this brain's own, or one a Personas tree carries - stays valid on read
(:data:`ID_ACCEPTED_HEX`), because provenance cites them and a rename would orphan every fact that
does. A reader of the brain tree, in any language, accepts both widths.
"""

from __future__ import annotations

import re
import secrets

#: kind → prefix. Read by the TypeScript half; keep it a flat dict of literals.
#:
#: ``turn`` is a kind and not a local ``uuid4`` because a turn id is the join between three
#: things a reader has to line up after the fact: the ledger's ``turn_id`` column, the events a
#: surface rendered, and the tripwires a harness flagged against it. A harness that minted its
#: own would be the second place ids are made, which is the finding this module exists to answer.
#:
#: ``ritual`` names a file under ``rituals/`` (ADR 0131): a chore's cadence is filed by its case's
#: ``proj_`` id, which is the goal's id already, so the ritual carries one of its own.
#:
#: ``device`` is one Athena install (ADR 0140): minted once into ``$ATHENA_HOME/peer/device.json``
#: and, on another device, the id that device files this one under in its ``peers.json`` - a
#: peer's id *is* the remote device id, so there is no separate ``peer`` kind. A phone has no
#: install of its own and is given a ``dev_`` id by the device that approved it. ``pairing`` is one
#: open pairing window and the one request filed against it, which lives in memory for minutes.
#:
#: ``task`` is one job Athena delegated to a background run (ADR 0141). Its conversation is derived
#: from it - ``conv_task_<hex>``, the same hex - by :func:`conversation_for_task`, never assembled.
#:
#: ``cycle`` is one pass of the sleep cycle (ADR 0143): its row in ``companion_cycle`` and the
#: journal it leaves under ``cycles/``. ``proposal`` is one thing that pass offers a person to keep
#: or forget, rather than deciding it (``companion_proposal``).
#:
#: ``space`` is one project the person made (ADR 0225): ``spaces/<spc_id>.md``, a brief and the
#: apps it pairs, and the wall around the memory written inside it. The UI word is "project"; the
#: wire word is ``space``, because ``proj_`` already names a chore's case and is never reused.
ID_PREFIXES: dict[str, str] = {
    "episode": "ep_",
    "fact": "fact_",
    "procedural": "proc_",
    "approval": "apr_",
    "turn": "turn_",
    "conversation": "conv_",
    "project": "proj_",
    "capture": "cap_",
    "session": "sess_",
    "job": "job_",
    "ritual": "rit_",
    "device": "dev_",
    "pairing": "pair_",
    "task": "task_",
    "cycle": "cyc_",
    "proposal": "prp_",
    "space": "spc_",
}

#: kind → how many hex digits ``mint`` puts after the prefix.
ID_SUFFIX_HEX: dict[str, int] = dict.fromkeys(ID_PREFIXES, 12)

#: kind → every hex width ``is_id`` accepts: the minted width first, then any older one ids of that
#: kind were minted at and still exist on disk. Only episodes have one (ADR 0140): eight hex, the
#: width before replication, which a fact's ``sources`` may cite for as long as the brain lives.
ID_ACCEPTED_HEX: dict[str, tuple[int, ...]] = {
    kind: (digits,) for kind, digits in ID_SUFFIX_HEX.items()
} | {"episode": (12, 8)}

#: A conversation id is usually *derived* — ``conv_<app_id>`` or ``conv_<project_id>`` — so its
#: suffix is a slug or another id, not hex. Every other kind is minted and only ever hex.
_DERIVED_SUFFIX = re.compile(r"[a-z0-9][a-z0-9_-]{0,63}\Z")

ID_KINDS: tuple[str, ...] = tuple(ID_PREFIXES)


def prefix_of(kind: str) -> str:
    """The prefix for ``kind``, or ``KeyError`` naming the kinds that exist."""
    try:
        return ID_PREFIXES[kind]
    except KeyError:
        raise KeyError(f"unknown id kind {kind!r}; known kinds: {', '.join(ID_KINDS)}") from None


def mint(kind: str) -> str:
    """A fresh id of ``kind``: its prefix plus a short random hex suffix."""
    prefix = prefix_of(kind)
    digits = ID_SUFFIX_HEX[kind]
    return f"{prefix}{secrets.token_hex((digits + 1) // 2)[:digits]}"


def is_id(kind: str, value: str) -> bool:
    """``True`` when ``value`` is an id of ``kind``.

    No prefix in the table is a prefix of another, so this answers for exactly one kind and a
    ``proj_`` id is never mistaken for a ``proc_`` one.
    """
    prefix = prefix_of(kind)
    if not value.startswith(prefix):
        return False
    suffix = value[len(prefix) :]
    if kind == "conversation":
        return bool(_DERIVED_SUFFIX.fullmatch(suffix))
    return len(suffix) in ID_ACCEPTED_HEX[kind] and bool(re.fullmatch("[0-9a-f]+", suffix))


def kind_of(value: str) -> str | None:
    """Which kind ``value`` is, or ``None``. Longest prefix first, so ``proj_`` beats nothing."""
    for kind in sorted(ID_KINDS, key=lambda k: len(ID_PREFIXES[k]), reverse=True):
        if is_id(kind, value):
            return kind
    return None


def conversation_for_app(app_id: str) -> str:
    """``conv_<app_id>``: the conversation a page's turns share when no project is active."""
    slug = app_id.strip().lower()
    if not slug or not _DERIVED_SUFFIX.fullmatch(slug):
        raise ValueError(f"app_id must be a lowercase slug: {app_id!r}")
    return f"{ID_PREFIXES['conversation']}{slug}"


def conversation_for_project(project_id: str) -> str:
    """``conv_<project_id>`` — ``conv_proj_<hex>``, with the project's prefix already on it.

    Takes a minted project id rather than a bare one precisely so that no caller is ever in a
    position to add ``proj_`` a second time.
    """
    if not is_id("project", project_id):
        raise ValueError(f"not a project id: {project_id!r}")
    return f"{ID_PREFIXES['conversation']}{project_id}"


def conversation_for_task(task_id: str) -> str:
    """``conv_<task_id>`` - ``conv_task_<hex>``: where a delegated task talks (ADR 0141).

    Takes the minted task id for the same reason :func:`conversation_for_project` takes a project
    id: no caller is ever in a position to add ``task_`` a second time.
    """
    if not is_id("task", task_id):
        raise ValueError(f"not a task id: {task_id!r}")
    return f"{ID_PREFIXES['conversation']}{task_id}"


def is_task_conversation(conversation_id: str) -> bool:
    """``True`` when ``conversation_id`` is a delegated task's own (``conv_task_<hex>``)."""
    prefix = ID_PREFIXES["conversation"]
    return conversation_id.startswith(prefix) and is_id("task", conversation_id[len(prefix) :])

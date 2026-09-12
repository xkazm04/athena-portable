"""Every id prefix in this system, in one place (README §3.5, the day-zero lessons).

The first build minted ids in two modules and each added a prefix, so a conversation for a project
came out as ``conv_proj_proj_<id>``. The fix is structural, not a convention: one table, one
``mint``, one ``is_id``, and derived ids built by a function that is handed an already-minted id
instead of a bare slug. The panel's ``lib/ids.ts`` is the same table in TypeScript and
``tests/test_ids_parity.py`` asserts the two agree — which is why :data:`ID_PREFIXES` is a plain
dict of strings and nothing cleverer.

Episode ids are ``ep_`` plus **eight** hex digits rather than the twelve every other kind uses.
That is not tidiness: the brain's markdown and frontmatter stay byte-compatible with the Personas
Rust writer, and its ``short_id(8)`` is what an episode id looks like there.
"""

from __future__ import annotations

import re
import secrets

#: kind → prefix. Read by the TypeScript half; keep it a flat dict of literals.
ID_PREFIXES: dict[str, str] = {
    "episode": "ep_",
    "fact": "fact_",
    "procedural": "proc_",
    "approval": "apr_",
    "conversation": "conv_",
    "project": "proj_",
    "capture": "cap_",
    "session": "sess_",
    "job": "job_",
}

#: kind → how many hex digits ``mint`` puts after the prefix.
ID_SUFFIX_HEX: dict[str, int] = dict.fromkeys(ID_PREFIXES, 12) | {"episode": 8}

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
    return bool(re.fullmatch(f"[0-9a-f]{{{ID_SUFFIX_HEX[kind]}}}", suffix))


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

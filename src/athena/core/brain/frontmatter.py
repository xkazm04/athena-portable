"""The memory file format: ``---``-fenced frontmatter, then the body (README §2 invariant 1).

Key **order** is part of the format, not a preference. An episode is written ``id, type, role,
session, created`` because that is the order the Personas Rust writer emits, and a brain
directory has to stay readable by both implementations (ref §8 "The disk tree"). Importance,
decay timestamps and machine markers are deliberately *not* here: they are index columns, so a
rebuild from disk restores every live memory at its writer default rather than inventing values.
The additions are a fact's ``every_turn: true``, written last and only when true (ADR 0071), and
the device stamp ``device: "dev_<hex>"`` on an episode, fact or procedural written on a device that
has an identity (ADR 0140), written after everything else - after ``every_turn`` too - and omitted
when there is none, so a legacy file and a file from a device that never paired are the bytes they
always were. The space stamp ``space: "spc_<hex>"`` (ADR 0225) goes just before the device's, and
only on a memory written inside a project, so a core file is the bytes it always was too. This
module renders and parses all of them like any other scalar and knows nothing of what they mean;
:mod:`~athena.core.brain.store` owns the order and the meaning.

The one refusal in this module is the interesting part. A scalar is interpolated into the header
with no escaping, so a line break inside one is header injection: a model-authored ``key`` that
carries ``\\nid: ep_deadbeef`` writes a second ``id:`` line, :func:`parse` takes the last
occurrence, and the next reconcile overwrites a different memory's row. Our own parse splits on
LF only, but ``str.splitlines()`` and YAML 1.1 readers break a line on ten characters: LF, CR,
VT, FF, U+001C to U+001E, NEL, LS and PS. A foreign reader of the brain directory must not see a
line break inside one value, so all ten are refused. We refuse rather than escape: refusing
leaves every legal value's bytes untouched, which is what byte parity requires; escaping would
change them.
"""

from __future__ import annotations

from collections.abc import Sequence
from typing import Any

#: Keys rendered bare rather than quoted, because the Rust writer emits them bare.
BARE_KEYS: frozenset[str] = frozenset({"type", "role"})

#: Exactly the ten characters ``str.splitlines()`` breaks a line on below U+10000.
_LINE_BREAKS = frozenset("\n\r\x0b\x0c\x1c\x1d\x1e\x85\u2028\u2029")

FENCE = "---"


class FrontmatterError(ValueError):
    """A key or value could not be rendered without changing the meaning of the header."""


def _reject_line_break(key: str, value: Any) -> None:
    if isinstance(value, str) and _LINE_BREAKS & set(value):
        raise FrontmatterError(f"frontmatter value for {key!r} may not contain a line break")


def _render_scalar(value: Any) -> str:
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, (int, float)):
        return str(value)
    return f'"{value!s}"'


def render(pairs: Sequence[tuple[str, Any]], body: str) -> str:
    """Render one memory file.

    A value is a scalar or a sequence; a sequence becomes a YAML block sequence, which is how
    ``sources:`` is written. Raises :class:`FrontmatterError` for a key or value carrying any of
    the ten characters ``str.splitlines()`` breaks a line on (not only CR and LF), and never
    escapes them, so a legal value renders byte for byte as before. The catalog turns that into
    an ``ExecResult(ok=False, ...)`` the model reads back.
    """
    lines = [FENCE]
    for key, value in pairs:
        _reject_line_break(key, key)
        if isinstance(value, (list, tuple)):
            for item in value:
                _reject_line_break(key, item)
            lines.append(f"{key}:")
            lines.extend(f'  - "{item}"' for item in value)
        else:
            _reject_line_break(key, value)
            if key in BARE_KEYS:
                lines.append(f"{key}: {value}")
            else:
                lines.append(f"{key}: {_render_scalar(value)}")
    lines.append(FENCE)
    return "\n".join(lines) + "\n\n" + body.rstrip("\n") + "\n"


def parse(text: str) -> tuple[dict[str, Any], str]:
    """The inverse of :func:`render`, tolerant enough to walk a foreign brain directory.

    A file with no header is not an error: the whole text is the body and the reconcile walk
    records it as skipped, by name, rather than guessing an id for it.

    A byte order mark before the fence is not text. No writer emits one, but an editor that saves
    "UTF-8" with one (PowerShell 5.1's ``Set-Content -Encoding UTF8``) put it before the ``---``,
    and the rebuild then skipped the file as having "no id in frontmatter".
    """
    text = text.removeprefix("﻿")
    head_fence = f"{FENCE}\n"
    if not text.startswith(head_fence):
        return {}, text
    end = text.find(f"\n{FENCE}\n", len(FENCE))
    if end == -1:
        return {}, text
    head = text[len(head_fence) : end]
    body = text[end + len(FENCE) + 2 :]
    meta: dict[str, Any] = {}
    current_list: list[str] | None = None
    for line in head.split("\n"):
        if line.startswith("  - "):
            if current_list is not None:
                current_list.append(_unquote(line[4:].strip()))
            continue
        current_list = None
        if ":" not in line:
            continue
        key, _, raw = line.partition(":")
        key = key.strip()
        raw = raw.strip()
        if raw == "":
            current_list = []
            meta[key] = current_list
        else:
            meta[key] = _coerce(raw)
    return meta, body.lstrip("\n")


def _unquote(raw: str) -> str:
    if len(raw) >= 2 and raw[0] == raw[-1] and raw[0] in "\"'":
        return raw[1:-1]
    return raw


def _coerce(raw: str) -> Any:
    """Type one value as ADR 0084 records it: a bare scalar is typed, a quoted one stays text."""
    if raw[:1] in ('"', "'"):
        return _unquote(raw)
    if raw in ("true", "false"):
        return raw == "true"
    try:
        return int(raw)
    except ValueError:
        pass
    try:
        return float(raw)
    except ValueError:
        return raw

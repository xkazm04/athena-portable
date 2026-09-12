"""The memory file format: ``---``-fenced frontmatter, then the body (README §2 invariant 1).

Key **order** is part of the format, not a preference. An episode is written ``id, type, role,
session, created`` because that is the order the Personas Rust writer emits, and a brain
directory has to stay readable by both implementations (ref §8 "The disk tree"). Importance,
decay timestamps and machine markers are deliberately *not* here: they are index columns, so a
rebuild from disk restores every live memory at its writer default rather than inventing values.

The one refusal in this module is the interesting part. A scalar is interpolated into the header
with no escaping, so a line break inside one is header injection: a model-authored ``key`` that
carries ``\\nid: ep_deadbeef`` writes a second ``id:`` line, :func:`parse` takes the last
occurrence, and the next reconcile overwrites a different memory's row. We refuse rather than
escape — refusing leaves every legal value's bytes untouched, which is what byte parity requires;
escaping would change them.
"""

from __future__ import annotations

from collections.abc import Sequence
from typing import Any

#: Keys rendered bare rather than quoted, because the Rust writer emits them bare.
BARE_KEYS: frozenset[str] = frozenset({"type", "role"})

_LINE_BREAKS = frozenset("\r\n")

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
    ``sources:`` is written. Raises :class:`FrontmatterError` for a key or value carrying a line
    break — the catalog turns that into an ``ExecResult(ok=False, ...)`` the model reads back.
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
    """
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

"""ADR 0225 (projects are walled spaces): the space files, read and written whole.

One project is one file, ``<brain>/spaces/<spc_id>.md``. Its body is for a person - ``# <name>``
and then the brief, exactly as they wrote it - and it ends in one data block the code reads,
after a marker line, the way a chore's case file does (ADR 0123, :mod:`athena.adopt.cases`)::

    <!-- athena:space -->
    ```json
    {"schema": 1, "id": "spc_…", "name": "…", "brief": "…", "apps": [...], "hue": 210, ...}
    ```

The block is the truth; the heading and the brief above it are a rendering of it. The reader takes
the **last** marker, so a brief that quotes one cannot stand in for the real block, and every key
of the block this module does not own is carried forward untouched by a rewrite. A file is
written whole or not at all (ADR 0080): to a temporary sibling, fsynced, then moved over the
target in one step, so a reader never meets half a project.

``spaces/`` is not in the brain's rebuild walk (``core.brain.reconcile.WALK``): a space is not a
memory and has no index row. It is not replicated to paired devices in v1 either; a project lives
on the PC it was made on.

**Validation is here, once.** :func:`check_input` is what ``POST /spaces`` and ``POST
/spaces/<id>`` both run, so a cap is refused in the same words on either. A value past a cap is
refused, never cut: the person's brief cut silently would be a brief they did not write.
"""

from __future__ import annotations

import builtins
import json
import os
import secrets
import threading
from collections.abc import Mapping
from dataclasses import asdict, dataclass, fields, replace
from pathlib import Path
from typing import Any
from urllib.parse import urlsplit

from athena.contracts import ids
from athena.contracts.channel import now_iso
from athena.contracts.spaces import (
    APPS_CAP,
    BRIEF_CAP,
    CORE,
    HUE_MAX,
    NAME_CAP,
    SPACE_SCHEMA,
    Space,
)
from athena.core.brain.store import Brain

__all__ = [
    "MAX_SPACES",
    "SPACES_DIRNAME",
    "SPACE_MARKER",
    "SpaceBook",
    "SpaceInvalid",
    "SpaceUnreadable",
    "check_input",
    "default_hue",
    "normalise_origin",
    "parse_space",
    "render_space",
]

#: The line before the data block. The reader takes the last one in the body.
SPACE_MARKER = "<!-- athena:space -->"
_OPEN = "```json"
_CLOSE = "```"
#: The directory under the brain root that holds one file per space.
SPACES_DIRNAME = "spaces"
#: The most spaces one brain holds. ``GET /spaces`` answers all of them, so the list is bounded by
#: refusing the one past this at create rather than by cutting the answer.
MAX_SPACES = 100

_OWNED = frozenset(f.name for f in fields(Space)) | {"schema"}


class SpaceUnreadable(ValueError):
    """A space file this module cannot read (no block, bad JSON, wrong schema, wrong id)."""


class SpaceInvalid(ValueError):
    """A request's name, brief, apps or hue is not one a space may have; the message names it."""


# --- validation ----------------------------------------------------------------------------------


def default_hue(space_id: str) -> int:
    """The hue a space is drawn in when the person chose none: derived from its id, so it is the
    same on every read and two spaces made a second apart rarely share one."""
    digits = space_id[len(ids.prefix_of("space")) :]
    try:
        return int(digits, 16) % (HUE_MAX + 1)
    except ValueError:
        return 0


def normalise_origin(value: str) -> str:
    """``value`` as a web origin, ``scheme://host[:port]``, lower-cased with any default port
    dropped; or :class:`SpaceInvalid`. A path, a query, a fragment or a user part is refused rather
    than cut away, because an app is an origin and a URL with more in it is a different claim."""
    raw = value.strip()
    try:
        parts = urlsplit(raw)
        port = parts.port
    except ValueError as exc:
        raise SpaceInvalid(f"apps: {value!r} is not a web origin") from exc
    scheme = parts.scheme.lower()
    host = (parts.hostname or "").lower()
    if (
        scheme not in ("http", "https")
        or not host
        or parts.username is not None
        or parts.password is not None
        or parts.path not in ("", "/")
        or parts.query
        or parts.fragment
    ):
        raise SpaceInvalid(f"apps: {value!r} is not a web origin (scheme://host[:port])")
    if ":" in host:
        host = f"[{host}]"
    default = {"http": 80, "https": 443}[scheme]
    return f"{scheme}://{host}" if port in (None, default) else f"{scheme}://{host}:{port}"


def _name(value: Any) -> str:
    if not isinstance(value, str):
        raise SpaceInvalid("name must be a string")
    printable = "".join(ch if ch.isprintable() else " " for ch in value)
    folded = " ".join(printable.split())
    if not folded:
        raise SpaceInvalid(f"name: a project needs a name of 1 to {NAME_CAP} characters")
    if len(folded) > NAME_CAP:
        raise SpaceInvalid(f"name: {len(folded)} characters is more than {NAME_CAP}")
    return folded


def _brief(value: Any) -> str:
    if not isinstance(value, str):
        raise SpaceInvalid("brief must be a string")
    text = value.replace("\r\n", "\n").replace("\r", "\n").strip()
    if len(text) > BRIEF_CAP:
        raise SpaceInvalid(f"brief: {len(text)} characters is more than {BRIEF_CAP}")
    return text


def _apps(value: Any) -> tuple[str, ...]:
    if not isinstance(value, list) or not all(isinstance(item, str) for item in value):
        raise SpaceInvalid("apps must be a list of web origins")
    out: list[str] = []
    for item in value:
        origin = normalise_origin(item)
        if origin not in out:
            out.append(origin)
    if len(out) > APPS_CAP:
        raise SpaceInvalid(f"apps: {len(out)} apps is more than {APPS_CAP}")
    return tuple(out)


def _hue(value: Any) -> int:
    if not isinstance(value, int) or isinstance(value, bool) or not 0 <= value <= HUE_MAX:
        raise SpaceInvalid(f"hue must be a whole number from 0 to {HUE_MAX}")
    return value


def check_input(body: Mapping[str, Any], *, partial: bool) -> dict[str, Any]:
    """The fields of a create (``partial=False``: ``name`` required) or a patch (any of them),
    validated and normalised; or :class:`SpaceInvalid` naming the first one that is not."""
    out: dict[str, Any] = {}
    if "name" in body or not partial:
        out["name"] = _name(body.get("name"))
    if "brief" in body:
        out["brief"] = _brief(body["brief"])
    if "apps" in body:
        out["apps"] = _apps(body["apps"])
    if "hue" in body:
        out["hue"] = _hue(body["hue"])
    return out


# --- the file ------------------------------------------------------------------------------------


def render_space(space: Space, extra: Mapping[str, Any] | None = None) -> str:
    """The space file: the name and the brief for a person to read, then the data block."""
    parts = [f"# {space.name}", space.brief.strip() or "(no brief yet)"]
    data = {
        **{k: v for k, v in dict(extra or {}).items() if k not in _OWNED},
        **asdict(space),
        "apps": list(space.apps),
        "schema": SPACE_SCHEMA,
    }
    block = json.dumps(data, indent=2, sort_keys=True, ensure_ascii=False)
    parts.append(f"{SPACE_MARKER}\n{_OPEN}\n{block}\n{_CLOSE}")
    return "\n\n".join(parts) + "\n"


def parse_space(text: str) -> tuple[Space, dict[str, Any]]:
    """The space in a file's text and the keys of its block this module does not own; or
    :class:`SpaceUnreadable`. A value the block holds out of shape reads as its default, so one
    bad key costs that key and not the project."""
    at = text.rfind(f"{SPACE_MARKER}\n{_OPEN}\n")
    if at == -1:
        raise SpaceUnreadable("no space block")
    start = at + len(SPACE_MARKER) + len(_OPEN) + 2
    end = text.find(f"\n{_CLOSE}", start)
    if end == -1:
        raise SpaceUnreadable("the space block is not closed")
    try:
        raw = json.loads(text[start:end])
    except json.JSONDecodeError as exc:
        raise SpaceUnreadable(f"the space block is not JSON: {exc.msg}") from exc
    if not isinstance(raw, dict):
        raise SpaceUnreadable("the space block is not an object")
    if raw.get("schema") != SPACE_SCHEMA:
        raise SpaceUnreadable(f"space schema {raw.get('schema')!r} is not {SPACE_SCHEMA}")
    space_id = raw.get("id")
    if not isinstance(space_id, str) or not ids.is_id("space", space_id):
        raise SpaceUnreadable(f"not a space id: {space_id!r}")
    name = _s(raw.get("name")).strip()
    if not name:
        raise SpaceUnreadable("the space has no name")
    apps = raw.get("apps")
    hue = raw.get("hue")
    space = Space(
        id=space_id,
        name=name,
        brief=_s(raw.get("brief")),
        apps=tuple(a for a in apps if isinstance(a, str) and a) if isinstance(apps, list) else (),
        hue=hue
        if isinstance(hue, int) and not isinstance(hue, bool) and 0 <= hue <= HUE_MAX
        else default_hue(space_id),
        created=_s(raw.get("created")),
        updated=_s(raw.get("updated")),
    )
    return space, {k: v for k, v in raw.items() if k not in _OWNED}


def _s(value: Any) -> str:
    return value if isinstance(value, str) else ""


# --- the book ------------------------------------------------------------------------------------


@dataclass
class SpaceBook:
    """The spaces in one brain: list, read, create, patch, delete - every write whole.

    One lock serialises the writes, so a create never mints past :data:`MAX_SPACES` beside another
    and a patch never reads a file another patch is replacing. Reads take no lock: a file is
    replaced in one step, so a reader sees the old project or the new one, never half of either.
    """

    brain: Brain

    def __post_init__(self) -> None:
        self.lock = threading.RLock()

    @property
    def folder(self) -> Path:
        return self.brain.root / SPACES_DIRNAME

    def path(self, space_id: str) -> Path:
        """Where ``space_id``'s file is. Only a minted id gets a path, so it stays in the folder."""
        if not ids.is_id("space", space_id):
            raise ValueError(f"not a space id: {space_id!r}")
        return self.folder / f"{space_id}.md"

    # -- reads ----------------------------------------------------------------------------------

    def get(self, space_id: str) -> Space | None:
        """``space_id``'s space from disk, or ``None``: not an id, no file, or a file that does not
        read. ``None`` is what "this space does not exist" means everywhere (ADR 0225: fail
        closed), so core (``""``) is ``None`` too."""
        if space_id == CORE or not ids.is_id("space", space_id):
            return None
        found = self._read(self.path(space_id))
        return found[0] if found is not None and found[0].id == space_id else None

    def exists(self, space_id: str) -> bool:
        return self.get(space_id) is not None

    def list(self) -> builtins.list[Space]:
        """Every readable space, most recently updated first. A file that does not read is passed
        over, as a case that does not read is (ADR 0123)."""
        if not self.folder.is_dir():
            return []
        out: builtins.list[Space] = []
        for path in sorted(self.folder.glob("spc_*.md")):
            found = self._read(path)
            if found is not None and path.stem == found[0].id:
                out.append(found[0])
        out.sort(key=lambda s: (s.updated, s.id), reverse=True)
        return out

    def _read(self, path: Path) -> tuple[Space, dict[str, Any]] | None:
        try:
            return parse_space(path.read_text(encoding="utf-8"))
        except (OSError, UnicodeDecodeError, SpaceUnreadable):
            return None

    # -- writes ---------------------------------------------------------------------------------

    def create(self, fields_: Mapping[str, Any]) -> Space:
        """A new space from :func:`check_input`'s create fields. Raises :class:`SpaceInvalid` past
        :data:`MAX_SPACES`, and what the disk raises."""
        with self.lock:
            if len(self.list()) >= MAX_SPACES:
                raise SpaceInvalid(f"a brain holds at most {MAX_SPACES} projects")
            space_id = ids.mint("space")
            while self.path(space_id).exists():  # a 48-bit collision: mint again, never overwrite
                space_id = ids.mint("space")
            now = now_iso()
            space = Space(
                id=space_id,
                name=str(fields_["name"]),
                brief=str(fields_.get("brief", "")),
                apps=tuple(fields_.get("apps", ())),
                hue=int(fields_.get("hue", default_hue(space_id))),
                created=now,
                updated=now,
            )
            self._write(space, {})
            return space

    def update(self, space_id: str, patch: Mapping[str, Any]) -> Space | None:
        """Apply :func:`check_input`'s patch fields to ``space_id`` and rewrite its file, carrying
        every key of the block this module does not own. ``None`` when there is no such space."""
        with self.lock:
            if space_id == CORE or not ids.is_id("space", space_id):
                return None
            found = self._read(self.path(space_id))
            if found is None or found[0].id != space_id:
                return None
            space, extra = found
            changed = replace(
                space,
                name=str(patch.get("name", space.name)),
                brief=str(patch.get("brief", space.brief)),
                apps=tuple(patch.get("apps", space.apps)),
                hue=int(patch.get("hue", space.hue)),
                updated=now_iso(),
            )
            self._write(changed, extra)
            return changed

    def delete_file(self, space_id: str) -> bool:
        """Remove ``space_id``'s file; ``False`` when there was none. Only the file: erasing what
        was written inside the space is the caller's, before this (``DELETE /spaces/<id>``)."""
        with self.lock:
            if not ids.is_id("space", space_id):
                return False
            try:
                self.path(space_id).unlink()
            except FileNotFoundError:
                return False
            return True

    def _write(self, space: Space, extra: Mapping[str, Any]) -> None:
        """The file, whole or not at all (ADR 0080): a temporary sibling, fsynced, then replaced
        in one step. Bytes as they are, LF only, so the tree is portable by copying."""
        target = self.path(space.id)
        target.parent.mkdir(parents=True, exist_ok=True)
        temp = target.with_name(f".{target.name}.{secrets.token_hex(6)}.tmp")
        data = render_space(space, extra).encode("utf-8")
        try:
            with temp.open("xb") as handle:
                handle.write(data)
                handle.flush()
                os.fsync(handle.fileno())
            os.replace(temp, target)
        except BaseException:
            temp.unlink(missing_ok=True)
            raise

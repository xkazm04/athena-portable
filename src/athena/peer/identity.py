"""This device's identity: one ``dev_`` id and a name a person recognises (ADR 0140, "Identity").

``$ATHENA_HOME/peer/device.json`` is ``{"device_id", "name", "created"}`` and nothing else. It is
minted the first time a peer feature asks for it and never again: every other device files this
one under that id, so a second mint would be a stranger arriving with this device's name.

**Why ``$ATHENA_HOME`` and not the brain's parent.** The shell starts the daemon with ``--brain
<app data>/brain`` and a token file beside it, while a headless ``athena serve`` defaults both to
``~/.athena``. The connector vault and the voice studio already resolve through
:func:`athena.core.brain.paths.athena_home`, which the shell does not override, so it is the one
home both ways of running Athena agree on. A device is the install, not the brain: rooting its
identity next to the brain would give one machine two identities depending on how it was started,
and a brain copied to another machine would carry this machine's id with it.

**The name defaults to the computer's.** :func:`socket.gethostname` is read here and nowhere else
in the peer package; a person renames it with ``PUT /devices/self``. A name is shown to people,
never used to decide anything, and is held to :data:`NAME_MAX` printable characters.

Every file in the peer directory is written whole or not at all (ADR 0080) through
:func:`write_whole`: a temporary sibling, fsynced, replaced into place.
"""

from __future__ import annotations

import json
import os
import secrets
import socket
import threading
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from athena.contracts import ids

__all__ = [
    "DEVICE_FILENAME",
    "NAME_MAX",
    "DeviceIdentity",
    "IdentityStore",
    "clean_name",
    "now_iso",
    "write_whole",
]

DEVICE_FILENAME = "device.json"
#: The longest device name kept. Longer is cut, never refused: a hostname is not the person's fault.
NAME_MAX = 64


def now_iso(now: datetime | None = None) -> str:
    """A UTC stamp to the second, the one shape every peer file and body carries."""
    return (now or datetime.now(UTC)).astimezone(UTC).isoformat(timespec="seconds")


def clean_name(value: object, fallback: str = "") -> str:
    """A shown name: control characters dropped, whitespace folded, cut to :data:`NAME_MAX`."""
    text = value if isinstance(value, str) else ""
    printable = "".join(ch if ch.isprintable() else " " for ch in text)
    folded = " ".join(printable.split())[:NAME_MAX].strip()
    return folded or fallback


def write_whole(path: Path, payload: Any) -> None:
    """``payload`` as JSON at ``path``, whole or not at all (ADR 0080; ``Brain._write_file``).

    The bytes go to a temporary sibling created exclusively with mode ``0600``, are fsynced, and
    replace the target in one step, so a reader never sees half a file and a crash never leaves
    one. The directory is not fsynced; Windows cannot.
    """
    data = json.dumps(payload, indent=2, sort_keys=True).encode("utf-8")
    path.parent.mkdir(parents=True, exist_ok=True)
    temp = path.with_name(f".{path.name}.{secrets.token_hex(6)}.tmp")
    flags = os.O_WRONLY | os.O_CREAT | os.O_EXCL | getattr(os, "O_BINARY", 0)
    try:
        descriptor = os.open(temp, flags, 0o600)
        with os.fdopen(descriptor, "wb") as handle:
            handle.write(data)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temp, path)
    except BaseException:
        temp.unlink(missing_ok=True)
        raise


@dataclass(frozen=True)
class DeviceIdentity:
    device_id: str
    name: str
    created: str

    def to_dict(self) -> dict[str, str]:
        return {"device_id": self.device_id, "name": self.name, "created": self.created}


class IdentityStore:
    """``device.json``: read on first use, minted if absent or unreadable, rewritten by a rename.

    Nothing is read or written until something asks who this device is, so a daemon that never
    pairs leaves no peer directory behind.
    """

    def __init__(self, root: Path) -> None:
        self.path = root / DEVICE_FILENAME
        self._lock = threading.Lock()
        self._identity: DeviceIdentity | None = None

    @property
    def identity(self) -> DeviceIdentity:
        with self._lock:
            if self._identity is None:
                self._identity = self._load()
            return self._identity

    def rename(self, name: object) -> DeviceIdentity:
        """A new shown name. ``ValueError`` for a name that is empty once cleaned."""
        cleaned = clean_name(name)
        if not cleaned:
            raise ValueError("a device name needs at least one printable character")
        current = self.identity
        with self._lock:
            renamed = DeviceIdentity(current.device_id, cleaned, current.created)
            write_whole(self.path, renamed.to_dict())
            self._identity = renamed
            return renamed

    def _load(self) -> DeviceIdentity:
        try:
            data = json.loads(self.path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError, UnicodeDecodeError):
            data = None
        if isinstance(data, dict) and ids.is_id("device", str(data.get("device_id", ""))):
            return DeviceIdentity(
                device_id=str(data["device_id"]),
                name=clean_name(data.get("name"), _computer_name()),
                created=str(data.get("created") or now_iso()),
            )
        if self.path.exists():
            # Kept rather than overwritten: a damaged identity file is evidence, and the next
            # mint is a new device to every peer either way.
            self.path.replace(self.path.with_name(f"{self.path.name}.unreadable"))
        minted = DeviceIdentity(ids.mint("device"), _computer_name(), now_iso())
        write_whole(self.path, minted.to_dict())
        return minted


def _computer_name() -> str:
    """The one place the peer package reads the machine's name."""
    try:
        name = socket.gethostname()
    except OSError:
        name = ""
    return clean_name(name, "This computer")

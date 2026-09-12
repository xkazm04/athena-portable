"""Where a credential rests: sealed by the operating system, or refused (README §4; ADR 0021).

A credential is written once, read by the broker on each call, and destroyed on disconnect. It is
never in a brain — a brain is portable by copying, and a copy of a brain must not be a copy of a
mailbox — and never in the daemon's ledger or a log. This module is the only place plaintext is
put to rest.

Two seals, chosen once at start:

- :class:`DpapiSeal` on Windows: ``CryptProtectData`` through ``ctypes``, bound to the user's
  logon, no extra dependency. The ciphertext is kept as one file per name under the vault
  directory; another user or another machine cannot open it.
- :class:`FileSeal` elsewhere: the value in a file with mode ``0600``, and the record says
  ``sealed: false`` so a surface can show that the protection is the file system's and not a
  keystore's. A machine that wants a keystore installs the ``keyring`` extra, which
  :func:`select_seal` prefers when it is importable.

Names are opaque handles the vault mints (``<connector>.<kind>``); nothing here reads a value it
was not asked to.
"""

from __future__ import annotations

import ctypes
import os
import sys
from contextlib import suppress
from pathlib import Path
from typing import Any, Protocol, runtime_checkable

__all__ = ["DpapiSeal", "FileSeal", "KeyringSeal", "SealPort", "SealUnavailable", "select_seal"]


class SealUnavailable(RuntimeError):
    """No seal could be built here; the vault stores nothing rather than storing plaintext."""


@runtime_checkable
class SealPort(Protocol):
    @property
    def kind(self) -> str:
        """``dpapi``, ``keyring`` or ``file`` — what a surface says protects the value."""

    def seal(self, name: str, value: str) -> None: ...

    def unseal(self, name: str) -> str | None: ...

    def destroy(self, name: str) -> None: ...


def _path_for(root: Path, name: str) -> Path:
    safe = "".join(ch if ch.isalnum() or ch in "._-" else "_" for ch in name)
    return root / f"{safe}.sealed"


class FileSeal:
    """A file per name, owner-readable only. Honest about being the weakest rung."""

    kind = "file"

    def __init__(self, root: Path) -> None:
        self.root = root
        root.mkdir(parents=True, exist_ok=True)
        with suppress(OSError):
            root.chmod(0o700)

    def seal(self, name: str, value: str) -> None:
        path = _path_for(self.root, name)
        path.write_bytes(self._encode(value))
        with suppress(OSError):
            path.chmod(0o600)

    def unseal(self, name: str) -> str | None:
        path = _path_for(self.root, name)
        if not path.exists():
            return None
        try:
            return self._decode(path.read_bytes())
        except (OSError, ValueError):
            return None

    def destroy(self, name: str) -> None:
        with suppress(OSError):
            _path_for(self.root, name).unlink()

    def _encode(self, value: str) -> bytes:
        return value.encode("utf-8")

    def _decode(self, raw: bytes) -> str:
        return raw.decode("utf-8")


class _DataBlob(ctypes.Structure):
    _fields_ = [("cbData", ctypes.c_uint32), ("pbData", ctypes.POINTER(ctypes.c_char))]


class DpapiSeal(FileSeal):
    """Windows only: the file holds ``CryptProtectData`` output bound to this user's logon."""

    kind = "dpapi"

    def __init__(self, root: Path) -> None:
        if sys.platform != "win32":
            raise SealUnavailable("DPAPI is Windows only")
        super().__init__(root)
        self._crypt32 = ctypes.windll.crypt32
        self._kernel32 = ctypes.windll.kernel32

    def _call(self, fn: Any, raw: bytes) -> bytes:
        blob_in = _DataBlob(
            len(raw),
            ctypes.cast(ctypes.create_string_buffer(raw, len(raw)), ctypes.POINTER(ctypes.c_char)),
        )
        blob_out = _DataBlob()
        # The entropy and the prompt struct are both null: the user's logon is the key.
        ok = fn(ctypes.byref(blob_in), None, None, None, None, 0, ctypes.byref(blob_out))
        if not ok:
            raise ValueError("DPAPI refused the value")
        try:
            return ctypes.string_at(blob_out.pbData, blob_out.cbData)
        finally:
            self._kernel32.LocalFree(blob_out.pbData)

    def _encode(self, value: str) -> bytes:
        return self._call(self._crypt32.CryptProtectData, value.encode("utf-8"))

    def _decode(self, raw: bytes) -> str:
        return self._call(self._crypt32.CryptUnprotectData, raw).decode("utf-8")


class KeyringSeal:
    """The platform keystore through the optional ``keyring`` extra, imported lazily."""

    kind = "keyring"

    def __init__(self, service: str = "athena-connectors") -> None:
        try:
            import keyring
        except ImportError as exc:  # pragma: no cover - depends on the environment
            raise SealUnavailable("install the 'connectors' extra for keyring") from exc
        self._keyring: Any = keyring
        self.service = service

    def seal(self, name: str, value: str) -> None:
        self._keyring.set_password(self.service, name, value)

    def unseal(self, name: str) -> str | None:
        found = self._keyring.get_password(self.service, name)
        return str(found) if found is not None else None

    def destroy(self, name: str) -> None:
        with suppress(Exception):
            self._keyring.delete_password(self.service, name)


def select_seal(root: Path, *, prefer: str | None = None) -> SealPort:
    """The strongest seal this machine offers: keyring, then DPAPI, then the file system.

    ``prefer`` names one for a test or a flag; an unavailable preference raises rather than
    falling through silently, because a person who asked for the keystore should not get a file.
    """
    if prefer is not None:
        if prefer == "file":
            return FileSeal(root)
        if prefer == "dpapi":
            return DpapiSeal(root)
        if prefer == "keyring":
            return KeyringSeal()
        raise SealUnavailable(f"unknown seal {prefer!r}")
    with suppress(SealUnavailable):
        return KeyringSeal()
    with suppress(SealUnavailable):
        return DpapiSeal(root)
    if os.name == "nt":  # pragma: no cover - DPAPI is always there on Windows
        raise SealUnavailable("neither keyring nor DPAPI could be used")
    return FileSeal(root)

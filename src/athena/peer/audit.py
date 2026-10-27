"""The peer audit trail: one appended row for every act that changes who may enter (ADR 0140).

The device-pairing standard's timing-defenses technique says the refusal a caller sees is uniform
while the record the defender writes carries the true cause. This is that record, for the peer
surface: ``<peer root>/audit.jsonl``, one JSON object per line, appended and fsynced.

**The acts.** ``approve``, ``decline``, ``claim``, ``claim_spent``, ``revoke``, ``lapse`` and
``refusal`` (a wrong code, nonce or claim secret, a second device on a taken window, or a stranger
without a token). Each row carries ``at``, ``act`` and the fields that act has: a pairing id or peer
id, the peer's address, the device kind, the cause. **Never a secret**: no token, nonce, code or
claim secret is ever an argument to :meth:`AuditLog.record`; an id a caller *presented* is kept
only when it has the shape of a ``pair_`` id, so a stranger cannot get free text into the file.

**Bounded.** The file rotates once to ``audit.1.jsonl`` at :data:`MAX_BYTES`, so two files of at
most that size is all the trail ever takes. Refusals are the only act a stranger can repeat, so
the same cause from the same address is written once per :data:`COALESCE_S` with a ``repeats``
count of the ones it stood for: a flood cannot push the approvals out of the file.

**Never in the way.** A write that fails is swallowed: the trail is a record of the ceremony, not
a gate on it.
"""

from __future__ import annotations

import json
import os
import threading
from collections.abc import Callable
from contextlib import suppress
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from athena.contracts import ids
from athena.peer.identity import now_iso

__all__ = ["AUDIT_FILENAME", "COALESCE_S", "MAX_BYTES", "AuditLog"]

AUDIT_FILENAME = "audit.jsonl"
#: One file's ceiling; the previous file is kept beside it as ``audit.1.jsonl``.
MAX_BYTES = 256 * 1024
#: The same refusal from the same address is one row per this many seconds.
COALESCE_S = 60.0
#: The longest a free-text field (a path, a name) is kept.
MAX_FIELD = 80


class AuditLog:
    """Append-only, rotated, and silent when it cannot write."""

    def __init__(self, root: Path, *, now: Callable[[], datetime] | None = None) -> None:
        self.path = root / AUDIT_FILENAME
        self._now = now or (lambda: datetime.now(UTC))
        self._lock = threading.Lock()
        #: (cause, address) -> (last written, refusals swallowed since)
        self._seen: dict[tuple[str, str], tuple[datetime, int]] = {}

    def record(self, act: str, **fields: Any) -> None:
        """One row for ``act``; ``None`` fields are left out, strings are cut short."""
        row: dict[str, Any] = {"at": now_iso(self._now()), "act": act}
        for key, value in fields.items():
            if value is None:
                continue
            row[key] = value[:MAX_FIELD] if isinstance(value, str) else value
        self._append(row)

    def refusal(self, cause: str, *, address: str, pairing_id: str = "", path: str = "") -> None:
        """A pre-trust refusal. Coalesced per (cause, address); ``pairing_id`` only if it is one."""
        now = self._now()
        key = (cause, address)
        with self._lock:
            last = self._seen.get(key)
            if last is not None and (now - last[0]).total_seconds() < COALESCE_S:
                self._seen[key] = (last[0], last[1] + 1)
                return
            repeats = last[1] if last is not None else 0
            if len(self._seen) > 1024:  # a scan from many addresses must not grow this forever
                self._seen.clear()
            self._seen[key] = (now, 0)
        self.record(
            "refusal",
            cause=cause,
            address=address,
            pairing_id=pairing_id if ids.is_id("pairing", pairing_id) else None,
            path=path or None,
            repeats=repeats or None,
        )

    def _append(self, row: dict[str, Any]) -> None:
        line = (json.dumps(row, sort_keys=True) + "\n").encode("utf-8")
        with self._lock, suppress(OSError):
            self.path.parent.mkdir(parents=True, exist_ok=True)
            with suppress(OSError):
                if self.path.stat().st_size >= MAX_BYTES:
                    os.replace(self.path, self.path.with_name("audit.1.jsonl"))
            flags = os.O_WRONLY | os.O_CREAT | os.O_APPEND | getattr(os, "O_BINARY", 0)
            descriptor = os.open(self.path, flags, 0o600)
            with os.fdopen(descriptor, "ab") as handle:
                handle.write(line)
                handle.flush()
                os.fsync(handle.fileno())

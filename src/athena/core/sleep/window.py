"""The one read: this PC's episodes since the last cycle (ADR 0143).

Pressure is the body characters of the episodes **this PC wrote** since the boundary. An episode's
device is its file's ``device:`` stamp (ADR 0140), which is on disk only - ``companion_node`` has no
column for it - so the read walks the index oldest first and opens each file's header once. Files
are write-once, so a header read is cached by id for as long as the row is in the window; the next
measurement opens only the files that arrived since. A PC before pairing stamps nothing, so with no
device id an episode with no ``device:`` key is this PC's.

**One boundary, one read.** :class:`Window` is both the measurement admission decides on and the
material the compress leg reads: the cycle is handed the same object, read in one SQLite snapshot,
never a second query that agrees with the first today.

**The boundary is a position, not a time.** Two episodes can carry the same ``created`` instant, so
the boundary is ``(created, id)`` and is stored ``<created>|<id>``; a bare instant (the first
window's ``now - 7 days``) is "everything at or after it".

**Drain forward.** :meth:`Window.take` consumes oldest first under the compress caps and says where
it stopped: the newest row it read, or passed as a peer's, before the first of this PC's episodes it
did not read. That is the next boundary, so the residue is the next cycle's oldest material, and a
peer's episodes ahead of it are walked past rather than left to block it.
"""

from __future__ import annotations

import sqlite3
from collections.abc import Callable, Mapping
from contextlib import closing
from dataclasses import dataclass, field
from datetime import datetime, timedelta

from athena.contracts.channel import iso
from athena.core.brain import frontmatter
from athena.core.brain.store import DEVICE_KEY, Brain, device_of
from athena.core.sleep import (
    COMPRESS_CHARS,
    COMPRESS_EPISODES,
    EPISODE_CHARS,
    EPISODE_FETCH,
    FIRST_WINDOW_D,
    SCAN_ROWS,
)

#: What a header read found when the file had no ``device:`` key (or could not be read).
_NO_DEVICE = ""
#: The mark at the end of an episode cut to :data:`EPISODE_CHARS`.
CUT_MARK = " [cut]"


@dataclass(frozen=True)
class Boundary:
    """Where a window starts: strictly after ``(at, after_id)``, or at ``at`` when no id."""

    at: str
    after_id: str = ""

    def encode(self) -> str:
        return f"{self.at}|{self.after_id}" if self.after_id else self.at

    @classmethod
    def decode(cls, raw: str) -> Boundary:
        at, _, after = raw.partition("|")
        return cls(at, after)

    @classmethod
    def first(cls, now: datetime) -> Boundary:
        """The first cycle's boundary: :data:`FIRST_WINDOW_D` days before ``now``."""
        return cls(iso(now - timedelta(days=FIRST_WINDOW_D)))


@dataclass(frozen=True)
class Row:
    """One episode the walk met. ``own`` is whether this PC wrote it; ``chars`` its body length."""

    id: str
    created_at: str
    own: bool
    chars: int
    role: str = ""


@dataclass(frozen=True)
class Read:
    """One episode the compress leg reads: its row and its body, cut to :data:`EPISODE_CHARS`."""

    row: Row
    body: str
    cut: bool


@dataclass(frozen=True)
class Take:
    """What :meth:`Window.take` consumed, and where the next window starts.

    ``truncated`` is true when this PC's episodes were left for the next cycle by a cap - the
    compress caps or the walk's own - which makes the cycle ``partial``.
    """

    reads: tuple[Read, ...]
    consumed_through: Boundary
    truncated: bool
    chars_in: int

    @property
    def ids(self) -> frozenset[str]:
        return frozenset(read.row.id for read in self.reads)


@dataclass(frozen=True)
class Window:
    """This PC's episodes since ``boundary``, measured once.

    ``rows`` is the walk in order, a peer's episodes included (they are passed, not read).
    ``bodies`` holds the bodies of the oldest :data:`COMPRESS_EPISODES` of this PC's, the most the
    compress leg can read. ``counted_all`` is false when the walk stopped at a ceiling
    (:data:`EPISODE_FETCH` of this PC's episodes, or :data:`SCAN_ROWS` rows), so the counts below
    are "at least".
    """

    boundary: Boundary
    rows: tuple[Row, ...] = ()
    bodies: Mapping[str, str] = field(default_factory=dict)
    counted_all: bool = True

    @property
    def own(self) -> tuple[Row, ...]:
        return tuple(row for row in self.rows if row.own)

    @property
    def pressure_chars(self) -> int:
        return sum(row.chars for row in self.rows if row.own)

    @property
    def episodes_available(self) -> int:
        return sum(1 for row in self.rows if row.own)

    def take(self) -> Take:
        """The oldest of this PC's episodes the caps allow, and the boundary after them."""
        reads: list[Read] = []
        chars = 0
        stop: int | None = None
        for index, row in enumerate(self.rows):
            if not row.own:
                continue
            body = self.bodies.get(row.id)
            if body is None or len(reads) >= COMPRESS_EPISODES:
                stop = index
                break
            cut = len(body) > EPISODE_CHARS
            text = body[:EPISODE_CHARS] + CUT_MARK if cut else body
            if reads and chars + len(text) > COMPRESS_CHARS:
                stop = index
                break
            reads.append(Read(row, text, cut))
            chars += len(text)
        if stop is not None:
            last = self.rows[stop - 1] if stop > 0 else None
        else:
            last = self.rows[-1] if self.rows else None
        through = Boundary(last.created_at, last.id) if last is not None else self.boundary
        return Take(
            reads=tuple(reads),
            consumed_through=through,
            truncated=stop is not None or not self.counted_all,
            chars_in=chars,
        )


class EpisodeReader:
    """Reads :class:`Window` s for one brain, remembering each episode's device by id.

    ``device_id`` is asked at each read (the daemon's stamp is ``None`` until this install pairs).
    The cache holds only the ids of the last walk, so it never outgrows one window.
    """

    def __init__(self, brain: Brain, device_id: Callable[[], str | None]) -> None:
        self.brain = brain
        self.device_id = device_id
        self._devices: dict[str, str] = {}

    def read(self, boundary: Boundary) -> Window:
        """One snapshot of every episode after ``boundary``: the walk and the bodies, together."""
        me = self.device_id()
        mine = _NO_DEVICE if me is None else me
        rows: list[Row] = []
        devices: dict[str, str] = {}
        own = 0
        counted_all = True
        with closing(self.brain.read_connection()) as con:
            # One read transaction: the walk and the bodies are one snapshot (ADR 0003).
            con.execute("BEGIN")
            try:
                cursor = con.execute(
                    """SELECT n.id, n.created_at, n.file_path, length(f.body)
                       FROM companion_node n LEFT JOIN companion_fts f ON f.rowid = n.rowid
                       WHERE n.kind = 'episode' AND n.importance > 0 AND n.machine = 0
                         AND (n.created_at > ? OR (n.created_at = ? AND n.id > ?))
                       ORDER BY n.created_at, n.id""",
                    (boundary.at, boundary.at, boundary.after_id),
                )
                for node_id, created_at, rel, length in cursor:
                    if len(rows) >= SCAN_ROWS or own >= EPISODE_FETCH:
                        counted_all = False
                        break
                    key = str(node_id)
                    device = self._devices.get(key)
                    if device is None:
                        device = self._device_of(str(rel or ""))
                    devices[key] = device
                    is_own = device == mine
                    own += is_own
                    rows.append(
                        Row(
                            id=key,
                            created_at=str(created_at),
                            own=is_own,
                            chars=int(length or 0),
                            role=_role(key, str(rel or "")),
                        )
                    )
                cursor.close()
                wanted = [row.id for row in rows if row.own][:COMPRESS_EPISODES]
                bodies = _bodies(con, wanted)
            finally:
                con.execute("ROLLBACK")
        self._devices = devices
        return Window(boundary, tuple(rows), bodies, counted_all)

    def _device_of(self, rel: str) -> str:
        """The ``device:`` an episode file names; :data:`_NO_DEVICE` for none or no file."""
        try:
            text = (self.brain.root / rel).read_text(encoding="utf-8")
        except (OSError, UnicodeDecodeError):
            return _NO_DEVICE
        meta, _ = frontmatter.parse(text)
        if DEVICE_KEY not in meta:
            return _NO_DEVICE
        # A key that is present but not a device id is no one's: never this PC's.
        return device_of(meta) or "?"


def _bodies(con: sqlite3.Connection, wanted: list[str]) -> dict[str, str]:
    """The full bodies of ``wanted`` episodes, by id, from the same snapshot as the walk."""
    if not wanted:
        return {}
    marks = ",".join("?" for _ in wanted)
    rows = con.execute(
        f"""SELECT n.id, COALESCE(f.body, n.body_excerpt)
            FROM companion_node n LEFT JOIN companion_fts f ON f.rowid = n.rowid
            WHERE n.id IN ({marks})""",
        tuple(wanted),
    ).fetchall()
    return {str(node_id): str(body or "") for node_id, body in rows}


def _role(node_id: str, rel: str) -> str:
    """The role in an episode's file name ``<id>_<role>.md``, or ``""``."""
    name = rel.rsplit("/", 1)[-1]
    prefix = f"{node_id}_"
    if name.startswith(prefix) and name.endswith(".md"):
        return name[len(prefix) : -len(".md")]
    return ""

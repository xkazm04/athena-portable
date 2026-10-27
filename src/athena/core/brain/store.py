"""The brain: markdown on disk is truth, SQLite is the index (README §2 invariants 1 and 2).

Three rules hold this module together, and each is a lesson the first build learned late
(README §3.5, ADR 0003).

**Disk first, index second.** A writer renders the file, writes it, and only then opens one
transaction that inserts every index row for it. A crash between the two leaves a findable file
and a missing row — which the next :func:`~athena.core.brain.reconcile.reconcile_from_disk`
repairs. The other order would leave a row pointing at a file that does not exist, and no
rebuild can repair that. The file itself is written whole or not at all (ADR 0080): the payload is
encoded first, written to a temporary file beside its target, fsynced and renamed into place, so a
write that fails leaves neither an empty file nor a half-written one.

**Provenance at write.** :meth:`Brain.write_fact` and :meth:`Brain.write_procedural` refuse any
``sources`` list that does not resolve to live episode ids *in this brain*. There is no bypass,
not for a script and not for a test: a fixture builds its episodes first and cites them. A
distilled claim whose evidence cannot be opened is the failure mode memory systems die of.

**One writer, many readers.** The writer connection is private and every write takes
the write lock; :meth:`read_connection` hands out a fresh read-only handle per call.
The daemon is threaded, so a long turn holds the writer while eight read routes answer from their
own handles — and, in WAL, without waiting for it. What a read handle sees is defined in
:meth:`read_connection`: the state as of the last completed write.

**A memory says which device wrote it** (ADR 0140). A brain built with a ``device_id`` stamps
``device: "dev_<hex>"`` as the last key of every episode, fact and procedural it writes, and
:meth:`Brain.receive_file` adopts one that another paired device wrote - its bytes untouched, its
stamp with them - through the same disk-first write, the same provenance gate and the same
per-file index function the rebuild uses. A brain with no device writes exactly the bytes it
always did.

**A memory says which space it was written in** (ADR 0225). A writer given a ``space`` stamps
``space: "spc_<hex>"`` after every other key but the device's, and omits it for core (``""``), so a
memory written outside every project is the bytes it always was. The stamp is written once, here,
by the path that captured the memory, and ``companion_node.space`` is derived from it like every
other column - a rebuild restores it. A distilled memory written in a space may cite only episodes
that space can see (:func:`~athena.contracts.spaces.visible_spaces`), and may close only memories of
its own space: a wall that a citation or a supersede could cross would not be one. Moving a memory
out of a space is an explicit act (:meth:`Brain.unstamp`), and so is erasing one
(:meth:`Brain.erase_space`); no query that happens to span spaces moves anything.

**Every pure read takes a read handle, including this class's own.** :meth:`node`,
:meth:`read_body`, :meth:`counts`, :meth:`sources_of` and :meth:`live_episode_ids` once read
through the writer connection, which was correct on one thread and wrong on several: a daemon read
route calling one of them would have been a second thread on a connection the writer lock does not
cover for reads, and it would have seen a half-written transaction's rows. They open their own
handle now, so the answer is what every other reader gets — the state as of the last completed
write — and ``tests/core/test_brain_connections.py`` asserts exactly that from a worker thread
while a write transaction is open.

The one place this matters to a *writer* is provenance: :meth:`_require_provenance` asks
:meth:`live_episode_ids` before the transaction it guards is opened, so it reads committed
episodes, which is the only thing "a live episode of this brain" can honestly mean. An episode
written inside the same uncommitted transaction is not yet a memory anything can cite.
"""

from __future__ import annotations

import hashlib
import json
import logging
import math
import os
import re
import secrets
import sqlite3
import threading
from collections.abc import Callable, Iterator, Sequence
from contextlib import closing, contextmanager
from dataclasses import dataclass, field
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from athena.contracts import ids
from athena.contracts.channel import now_iso
from athena.contracts.spaces import CORE, visible_spaces
from athena.core.brain import frontmatter, paths, text
from athena.core.brain.schema import SCHEMA, SCHEMA_VERSION, SPACE_COLUMNS, SPACE_INDEXES

#: The scopes each distilled kind may be filed under. A scope is a directory on disk, so an
#: unknown one would write outside the tree a reconcile walks and the memory would vanish on
#: rebuild — which is why these are refused rather than created. They live in :mod:`paths`,
#: which builds the tree and the rebuild's walk from the same two lists.
FACT_SCOPES: tuple[str, ...] = paths.FACT_SCOPES
PROCEDURAL_SCOPES: tuple[str, ...] = paths.PROCEDURAL_SCOPES

#: The only SQLite result codes that mean the index file itself is damaged (ADR 0081). A locked or
#: read-only brain is a different failure and must never be called damaged.
_DAMAGE_CODES = (sqlite3.SQLITE_CORRUPT, sqlite3.SQLITE_NOTADB)
#: The result codes of contention: another connection holds the lock. Expected, never a fault.
_BUSY_CODES = (sqlite3.SQLITE_BUSY, sqlite3.SQLITE_LOCKED)
#: A ritual's file name (ADR 0131): a lowercase slug, so ``rituals/<folder>/<name>.md`` stays put.
_RITUAL_NAME = re.compile(r"[a-z0-9][a-z0-9_-]{0,63}\Z")

_log = logging.getLogger(__name__)


class IndexDamagedError(sqlite3.DatabaseError):
    """``index.sqlite`` is not a readable database. ``athena brain reconcile`` repairs it."""


EPISODE_ROLES: tuple[str, ...] = ("user", "assistant", "system")

#: The frontmatter key naming the device a memory was written on (ADR 0140). Written last on an
#: episode, fact or procedural - after ``every_turn`` - and only when the brain has a device, so a
#: brain that never paired writes the bytes it always did and a legacy file reads as "unknown".
#: It lives on disk only: ``companion_node`` has no column it fits (``machine`` is chatter, not a
#: host), no query asks for it, and a column would be a schema migration with no reader. A rebuild
#: therefore has nothing to restore and loses nothing; :func:`device_of` reads it from a header.
DEVICE_KEY = "device"

#: The kinds that replicate between paired devices (ADR 0140): the write-once ones, so a copy can
#: never go stale. Goals, cases and rituals are rewritten in place and stay on the device.
REPLICATED_KINDS: tuple[str, ...] = ("episode", "fact", "procedural")

#: The one path each replicated kind may arrive at, which is the path this module's own writer
#: would have chosen for it: a received file is filed where the sender filed it, and anything else
#: - another directory, a ``..``, a scope the walk does not know - is refused before a byte lands.
_REPLICATED_PATHS: dict[str, re.Pattern[str]] = {
    "episode": re.compile(
        r"episodes/[0-9]{4}/[0-9]{2}/[0-9]{2}/(?P<id>ep_[0-9a-f]+)_(?:"
        + "|".join(EPISODE_ROLES)
        + r")\.md\Z"
    ),
    "fact": re.compile(
        r"semantic/(?:" + "|".join(FACT_SCOPES) + r")/(?P<id>fact_[0-9a-f]+)_[a-z0-9-]{1,64}\.md\Z"
    ),
    "procedural": re.compile(
        r"procedurals/(?:"
        + "|".join(PROCEDURAL_SCOPES)
        + r")/(?P<id>proc_[0-9a-f]+)_[a-z0-9-]{1,64}\.md\Z"
    ),
}


def replicated_path(kind: str, rel: str) -> str:
    """The id a replicated file at brain-relative ``rel`` must carry; ``ValueError`` if refused.

    The path must be exactly the shape this brain's writer gives ``kind``, and the id in its name
    a valid id of that kind, so a path cannot leave its directory or claim another kind's.
    """
    pattern = _REPLICATED_PATHS.get(kind)
    if pattern is None:
        raise ValueError(f"{kind!r} does not replicate; one of {', '.join(REPLICATED_KINDS)}")
    found = pattern.match(rel)
    if found is None or not ids.is_id(kind, found.group("id")):
        raise ValueError(f"not where this brain files a {kind}: {rel!r}")
    return found.group("id")


#: The frontmatter key naming the space a memory was written in (ADR 0225). Written on an episode,
#: fact or procedural after every other key but :data:`DEVICE_KEY`, and only for a space: core
#: omits it, so every file written outside a project - all of them, before projects - keeps its
#: bytes. Unlike the device it is a column too (``companion_node.space``): recall filters on it.
SPACE_KEY = "space"
#: What :func:`space_of` answers for a ``space:`` key that is present but is not a space id: a
#: value no space can ever be, so the memory is outside every wall and visible nowhere (fail
#: closed). Never core: a stamp that cannot be read is not the absence of one.
UNKNOWN_SPACE = "?"
#: The kinds a space stamp is written on and erased with (ADR 0225).
STAMPED_KINDS: tuple[str, ...] = ("episode", "fact", "procedural")


def space_of(meta: dict[str, Any]) -> str:
    """The space a parsed header says the memory was written in: ``""`` (core) when there is no
    ``space:`` key or it is empty, the ``spc_`` id when it is one, else :data:`UNKNOWN_SPACE`."""
    if SPACE_KEY not in meta:
        return CORE
    value = meta[SPACE_KEY]
    if value == CORE:
        return CORE
    return value if isinstance(value, str) and ids.is_id("space", value) else UNKNOWN_SPACE


def check_space(space: str) -> str:
    """``space`` if a writer may stamp it - core (``""``) or a minted space id - else ValueError.
    Whether the space's file exists is the caller's question: a stamp naming a space that has none
    is invisible everywhere, so a writer that raced an erase writes a memory no turn will see."""
    if space != CORE and not ids.is_id("space", space):
        raise ValueError(f"not a space id: {space!r}")
    return space


def device_of(meta: dict[str, Any]) -> str | None:
    """The device a parsed header says wrote the memory, or ``None``: legacy, or not a device id."""
    value = meta.get(DEVICE_KEY)
    return value if isinstance(value, str) and ids.is_id("device", value) else None


#: Importance a writer starts a memory at (ref §8): conversation at 3, machine chatter at 1.
DEFAULT_IMPORTANCE = 3
MACHINE_IMPORTANCE = 1
#: Importance of a fact the user approved to ride every turn: the always tier's floor in recall.
#: It is the one importance a file records, as :data:`EVERY_TURN_KEY`, so a rebuild restores it
#: (ADR 0071); every other importance stays an index column (ADR 0003).
ALWAYS_IMPORTANCE = 4
#: The frontmatter key that records that approval. Written last, and only when true, so a fact
#: without it is the seven keys it was before ADR 0071, byte for byte.
EVERY_TURN_KEY = "every_turn"
DEFAULT_CONFIDENCE = 0.7

#: The frontmatter keys of supersedence (ADR 0143), on a fact or a procedural. ``supersedes`` lists
#: the ids this memory closes: recall serves this one and never those, which stay on disk with their
#: lineage. ``retired: true`` is a memory written to be hidden - the marker a person's "forget"
#: leaves - and is indexed at importance 0. Both are written after ``sources`` and before
#: ``every_turn``, and only when present, so every file written before them keeps its bytes. Unlike
#: importance they are on disk, so a rebuild restores them and replication carries them.
SUPERSEDES_KEY = "supersedes"
RETIRED_KEY = "retired"
#: The kinds a memory may supersede: the distilled ones.
SUPERSEDABLE_KINDS: tuple[str, ...] = ("fact", "procedural")
#: How long :meth:`Brain.note_recalled` waits for the write lock before it lets a hit go. A hit is
#: a ranking hint, and a recall must never queue behind a long write for one.
SEEN_LOCK_S = 0.25

#: Five seconds is the whole budget a read route has; waiting longer for a lock is a timeout the
#: caller can do nothing with, so it surfaces as an error instead of a hang.
BUSY_TIMEOUT_MS = 5000


class ProvenanceError(ValueError):
    """A distilled memory cited a source that is not a live episode of this brain."""


@dataclass(frozen=True)
class MemoryRef:
    """What a writer returns: the minted id, the brain-relative path, and the kind."""

    id: str
    path: str
    kind: str


@dataclass(frozen=True)
class NodeRow:
    """One index row, as the read path sees it."""

    id: str
    kind: str
    file_path: str
    body_excerpt: str
    importance: int
    created_at: str
    session_id: str | None = None
    machine: bool = False
    tags: list[str] = field(default_factory=list)
    #: The space the memory was written in (ADR 0225), ``""`` for core.
    space: str = CORE


def sha256(payload: str) -> str:
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


def node_from_row(row: Sequence[Any]) -> NodeRow:
    """Build a :class:`NodeRow` from :data:`NODE_COLUMNS` in order."""
    return NodeRow(
        id=str(row[0]),
        kind=str(row[1]),
        file_path=str(row[2] or ""),
        body_excerpt=str(row[3] or ""),
        importance=int(row[4]),
        created_at=str(row[5]),
        session_id=None if row[6] is None else str(row[6]),
        machine=bool(row[7]),
        tags=list(json.loads(str(row[8]))) if row[8] else [],
        space=str(row[9] or CORE) if len(row) > 9 else CORE,
    )


#: The projection :func:`node_from_row` reads, in order. One string so the SELECTs cannot drift.
NODE_COLUMNS = (
    "id, kind, file_path, body_excerpt, importance, created_at, session_id, machine, tags_json, "
    "space"
)


class Brain:
    """One brain directory and its index.

    Construction is cheap and idempotent: the tree is created if absent, the schema applied with
    ``CREATE ... IF NOT EXISTS``, and nothing is read. Closing is optional but polite; the class
    is a context manager.
    """

    def __init__(
        self,
        root: str | Path | None = None,
        *,
        session_id: str = "cli",
        device_id: str | Callable[[], str | None] | None = None,
    ) -> None:
        self.root: Path = paths.ensure_tree(root)
        self.db_path: Path = self.root / paths.INDEX_FILENAME
        self.session_id = session_id
        # A ``dev_`` id, or a callable asked at each write (the daemon's: ``None`` until this
        # install has an identity, so a brain that never paired mints none - ADR 0140).
        if isinstance(device_id, str) and not ids.is_id("device", device_id):
            raise ValueError(f"not a device id: {device_id!r}")
        self._device = device_id
        self._write_lock = threading.RLock()
        # isolation_level=None puts this connection in autocommit, which is what makes
        # ``write_txn`` the only thing that opens a transaction — an implicit BEGIN that Python
        # starts on the first INSERT and commits on some later statement is exactly the
        # half-written index a read handle must never see.
        # ``check_same_thread=False`` is what makes "the daemon is threaded" (above) true rather
        # than aspirational: the server answers on a worker thread, so the turn that writes is on
        # a worker thread too, and the default would refuse the connection there. What replaces
        # the affinity is ``_write_lock``: every mutation goes through ``write_txn``, which takes
        # it, so the writer is used by one thread at a time. Reads do not come here at all — they
        # open their own handle through :meth:`read_connection` (ADR 0003).
        self._con = sqlite3.connect(
            str(self.db_path),
            timeout=BUSY_TIMEOUT_MS / 1000,
            isolation_level=None,
            check_same_thread=False,
        )
        try:
            self._con.execute(f"PRAGMA busy_timeout = {BUSY_TIMEOUT_MS}")
            # WAL is what lets a reader hold a snapshot while the writer commits. Without it the
            # per-request read handle of README §3.5 would trade a stalled write queue for a
            # stalled read queue and change nothing.
            self._con.execute("PRAGMA journal_mode = WAL")
            self._con.execute("PRAGMA synchronous = NORMAL")
            with self.write_txn():
                for statement in SCHEMA:
                    self._con.execute(statement)
                # The wall's columns before its index, which names them (ADR 0225). Asked of the
                # table, not of the stamp: a stamp says what a build meant to do, the table what is.
                _add_space_columns(self._con)
                for statement in SPACE_INDEXES:
                    self._con.execute(statement)
                # Read before the stamp below overwrites it: an older index is migrated in this same
                # transaction, so no reader ever sees it half re-keyed.
                stored = _stored_version(self._con)
                if stored < 2:
                    _rekey_fts(self._con)
                if stored < 3:
                    _fill_spaces(self._con, self.root)
                # Never lower the stamp: an older build opening a newer index must leave it, or the
                # newer build re-runs its migration.
                self._con.execute(
                    "INSERT OR REPLACE INTO companion_meta (key, value) "
                    "VALUES ('schema_version', ?)",
                    (str(max(stored, SCHEMA_VERSION)),),
                )
            # Inside the guard: the schema reads only the catalog, so this upsert can be the first
            # statement to meet a damaged page, and it must close the handle and name it the same.
            self.ensure_session(session_id)
        except BaseException as exc:
            self._con.close()
            if (
                isinstance(exc, sqlite3.DatabaseError)
                and (exc.sqlite_errorcode & 0xFF) in _DAMAGE_CODES
            ):
                raise IndexDamagedError(
                    f"the index {self.db_path} is damaged ({exc}); "
                    "run `athena brain reconcile` to set it aside and rebuild it"
                ) from exc
            raise

    # -- lifecycle -----------------------------------------------------------------------------

    def close(self) -> None:
        self._con.close()

    def __enter__(self) -> Brain:
        return self

    def __exit__(self, *exc: object) -> None:
        self.close()

    # -- connections ---------------------------------------------------------------------------

    @property
    def writer(self) -> sqlite3.Connection:
        """The one writer connection. Take :meth:`write_txn` around anything that changes it."""
        return self._con

    @contextmanager
    def write_txn(self) -> Iterator[sqlite3.Connection]:
        """The lock, one ``BEGIN IMMEDIATE``, and a commit or a full rollback.

        ``IMMEDIATE`` takes the write lock at the start rather than on the first write, so two
        writers queue here instead of discovering each other halfway through a memory. The lock
        is re-entrant because a writer may call another writer's helper; only the outermost
        frame opens and closes the transaction, which keeps "one memory, one transaction" true.

        A COMMIT that fails (a full disk, an I/O error, SQLITE_BUSY) can leave the transaction
        open, and a frame that finds one open joins it rather than opening its own: every later
        write would then sit uncommitted, unseen by every reader, until the connection closed and
        dropped them all. So a failed COMMIT is rolled back before it is raised. The file is
        already on disk, and a reconcile indexes it, as after any failed write.
        """
        with self._write_lock:
            if self._con.in_transaction:
                yield self._con
                return
            self._con.execute("BEGIN IMMEDIATE")
            try:
                yield self._con
            except BaseException:
                self._con.execute("ROLLBACK")
                raise
            try:
                self._con.execute("COMMIT")
            except BaseException:
                if self._con.in_transaction:
                    self._con.execute("ROLLBACK")
                raise

    def read_connection(self) -> sqlite3.Connection:
        """A fresh **read-only** handle, one per call. The caller closes it.

        This is the read path of README §3.5: the daemon is threaded and each read route opens
        its own handle rather than queueing behind whatever the current turn is writing. The
        handle is opened through a ``mode=ro`` URI, so a route that tries to write gets
        ``sqlite3.OperationalError`` at the statement rather than corrupting the index.

        **Consistency.** What this handle reads is *consistent as of the last completed write*.
        Each statement outside an explicit transaction takes a fresh WAL snapshot, so a handle
        opened before a write sees that write on its next statement, and a handle that opens a
        transaction sees one unchanging snapshot until it ends. It never sees a partial memory:
        a memory's rows are committed together, so a fact and its provenance arrive at once.
        """
        con = sqlite3.connect(
            f"{self.db_path.as_uri()}?mode=ro", uri=True, timeout=BUSY_TIMEOUT_MS / 1000
        )
        con.execute(f"PRAGMA busy_timeout = {BUSY_TIMEOUT_MS}")
        return con

    # -- the device stamp ----------------------------------------------------------------------

    @property
    def device_id(self) -> str | None:
        """The device this brain stamps its new memories with, or ``None`` for none (ADR 0140)."""
        device = self._device
        value = device() if callable(device) else device
        return value if isinstance(value, str) and ids.is_id("device", value) else None

    def _stamped(self, header: list[tuple[str, Any]], space: str = CORE) -> list[tuple[str, Any]]:
        """``header`` with :data:`SPACE_KEY` after it for a space (ADR 0225), then
        :data:`DEVICE_KEY` last when this brain has a device; core on a brain with no device is
        ``header`` unchanged."""
        if space != CORE:
            header = [*header, (SPACE_KEY, space)]
        device = self.device_id
        return header if device is None else [*header, (DEVICE_KEY, device)]

    # -- sessions ------------------------------------------------------------------------------

    def ensure_session(self, session_id: str, title: str = "Athena") -> None:
        now = now_iso()
        with self.write_txn() as con:
            con.execute(
                """INSERT OR IGNORE INTO companion_session
                   (id, title, status, origin, created_at, last_active_at)
                   VALUES (?, ?, 'active', 'panel', ?, ?)""",
                (session_id, title, now, now),
            )
            con.execute(
                "UPDATE companion_session SET last_active_at = ? WHERE id = ?", (now, session_id)
            )

    # -- episodes ------------------------------------------------------------------------------

    def append_episode(
        self,
        content: str,
        role: str = "user",
        *,
        session_id: str | None = None,
        importance: int | None = None,
        created: datetime | None = None,
        space: str = CORE,
    ) -> MemoryRef:
        """Append one episode. Episodes are the only kind that is its own provenance.

        The file is ``episodes/YYYY/MM/DD/<ep_id>_<role>.md`` with the header ref §8 fixes:
        ``id, type, role, session, created``, in that order. ``space`` is the project the turn
        that said it ran in (ADR 0225), stamped after them; core omits it.
        """
        check_space(space)
        body = _lf(content).strip()
        if not body:
            raise ValueError("refusing to append an empty episode")
        if role not in EPISODE_ROLES:
            raise ValueError(f"episode role must be one of {EPISODE_ROLES}: {role!r}")
        sid = session_id or self.session_id
        self.ensure_session(sid)

        node_id = ids.mint("episode")
        when = created or datetime.now(UTC)
        created_at = when.isoformat()
        rel = f"episodes/{when:%Y}/{when:%m}/{when:%d}/{node_id}_{role}.md"
        machine = text.is_machine(body)
        file_text = frontmatter.render(
            self._stamped(
                [
                    ("id", node_id),
                    ("type", "episode"),
                    ("role", role),
                    ("session", sid),
                    ("created", created_at),
                ],
                space,
            ),
            body,
        )
        self._write_file(rel, file_text)

        imp = (
            importance
            if importance is not None
            else (MACHINE_IMPORTANCE if machine else DEFAULT_IMPORTANCE)
        )
        with self.write_txn() as con:
            self.index_node(
                con,
                node_id=node_id,
                kind="episode",
                rel=rel,
                file_text=file_text,
                body=body,
                importance=imp,
                created_at=created_at,
                session_id=sid,
                machine=machine,
                tags=[f"role:{role}"],
                fts_tags=f"session:{sid} role:{role}",
                space=space,
            )
        return MemoryRef(node_id, rel, "episode")

    # -- provenance ----------------------------------------------------------------------------

    def live_episode_ids(self, candidates: Sequence[str]) -> set[str]:
        """Which of ``candidates`` are episodes of this brain that have not been demoted."""
        return set(self.live_episode_spaces(candidates))

    def live_episode_spaces(self, candidates: Sequence[str]) -> dict[str, str]:
        """The live episodes among ``candidates``, each with the space it was written in."""
        if not candidates:
            return {}
        marks = ",".join("?" for _ in candidates)
        with closing(self.read_connection()) as con:
            rows = con.execute(
                f"""SELECT id, space FROM companion_node
                    WHERE kind = 'episode' AND importance > 0 AND id IN ({marks})""",
                tuple(candidates),
            ).fetchall()
        return {str(row[0]): str(row[1] or CORE) for row in rows}

    def _require_provenance(self, sources: Sequence[str], space: str = CORE) -> list[str]:
        """The gate of README §2 invariant 2. Deduplicates, preserving the caller's order.

        Three refusals, and they read differently on purpose. An empty list is a writer that never
        had evidence; a dangling id is a writer that cited something this brain cannot open —
        a hallucinated id, an episode from another brain, or one that has been demoted since. The
        third is the wall (ADR 0225): a memory written in ``space`` may cite only episodes that
        space can see - its own and core's - so a fact in one project can never stand on what was
        said in another, and a core fact never on anything said inside a project.
        """
        if not sources:
            raise ProvenanceError("a fact or a procedural must cite at least one live episode id")
        malformed = [s for s in sources if not ids.is_id("episode", s)]
        if malformed:
            raise ProvenanceError(f"sources are not episode ids: {sorted(malformed)}")
        live = self.live_episode_spaces(sources)
        dangling = [s for s in sources if s not in live]
        if dangling:
            raise ProvenanceError(
                f"sources are not live episodes of this brain: {sorted(dangling)}"
            )
        seen = visible_spaces(space)
        walled = [s for s in sources if live[s] not in seen]
        if walled:
            where = "core" if space == CORE else f"space {space}"
            raise ProvenanceError(
                f"sources are not live episodes visible in {where}: {sorted(walled)}"
            )
        return list(dict.fromkeys(sources))

    def sources_of(self, node_id: str) -> list[str]:
        with closing(self.read_connection()) as con:
            rows = con.execute(
                "SELECT source_id FROM companion_provenance WHERE node_id = ? ORDER BY source_id",
                (node_id,),
            ).fetchall()
        return [str(row[0]) for row in rows]

    def source_counts(self, node_ids: Sequence[str]) -> dict[str, int]:
        """How many sources each node cites, on one read connection.

        Every asked id is in the answer, with 0 for a node that cites nothing or does not exist,
        so ``counts[i] == len(sources_of(i))``.
        """
        wanted = list(dict.fromkeys(node_ids))
        counts = {node_id: 0 for node_id in wanted}
        if not wanted:
            return counts
        with closing(self.read_connection()) as con:
            for start in range(0, len(wanted), 500):
                batch = wanted[start : start + 500]
                marks = ",".join("?" * len(batch))
                rows = con.execute(
                    f"""SELECT node_id, COUNT(*) FROM companion_provenance
                        WHERE node_id IN ({marks}) GROUP BY node_id""",
                    tuple(batch),
                ).fetchall()
                for node_id, count in rows:
                    counts[str(node_id)] = int(count)
        return counts

    # -- distilled memories --------------------------------------------------------------------

    def write_fact(
        self,
        key: str,
        value: str,
        *,
        scope: str = "user",
        sources: Sequence[str],
        confidence: float = DEFAULT_CONFIDENCE,
        importance: int = DEFAULT_IMPORTANCE,
        every_turn: bool = False,
        supersedes: Sequence[str] = (),
        retired: bool = False,
        space: str = CORE,
    ) -> MemoryRef:
        """Write one distilled claim, citing the episodes it was drawn from.

        ``sources`` is keyword-only and has no default, so "I forgot the provenance" is a
        ``TypeError`` at the call site rather than an empty list at the gate.

        ``every_turn`` puts the fact in the always tier and on disk says so (ADR 0071): the file
        gains ``every_turn: true`` as its last key and the row is written at
        :data:`ALWAYS_IMPORTANCE`, whatever ``importance`` says, which is the value a rebuild
        restores. The product reaches it only through an approved ``core.write_fact`` card.

        ``supersedes`` names the facts or procedurals of this brain this one closes (ADR 0143); an
        id that is not one is refused before the file is written. ``retired`` writes a memory that
        is hidden from the start (importance 0): the marker a person's "forget" leaves, which must
        travel to every paired device like any other fact. The two keys are on disk, so a rebuild
        restores both; a retired fact cannot also ride every turn.

        ``space`` is the project the claim was captured in (ADR 0225), ``""`` for core: stamped on
        disk, it may cite only episodes that space can see and close only that space's memories.
        """
        check_space(space)
        if retired and every_turn:
            raise ValueError("a retired fact cannot ride every turn")
        if scope not in FACT_SCOPES:
            raise ValueError(f"fact scope must be one of {FACT_SCOPES}: {scope!r}")
        _require_finite(confidence)
        if not key.strip():
            raise ValueError("refusing to write a fact with no key")
        body = _lf(value).strip()
        if not body:
            raise ValueError("refusing to write an empty fact")
        cited = self._require_provenance(sources, space)
        closes = self._require_supersedable(supersedes, space)

        node_id = ids.mint("fact")
        created_at = now_iso()
        rel = f"semantic/{scope}/{node_id}_{text.slug(key)}.md"
        header: list[tuple[str, Any]] = [
            ("id", node_id),
            ("type", "fact"),
            ("scope", scope),
            ("key", key),
            ("confidence", confidence),
            ("created", created_at),
            ("sources", cited),
            *_lineage(closes, retired),
        ]
        if every_turn:
            header.append((EVERY_TURN_KEY, True))
            importance = ALWAYS_IMPORTANCE
        if retired:
            importance = 0
        file_text = frontmatter.render(self._stamped(header, space), body)
        self._write_file(rel, file_text)

        with self.write_txn() as con:
            self.index_node(
                con,
                node_id=node_id,
                kind="fact",
                rel=rel,
                file_text=file_text,
                body=body,
                importance=importance,
                created_at=created_at,
                space=space,
            )
            con.execute(
                """INSERT INTO companion_fact (id, scope, fact_key, confidence)
                   VALUES (?, ?, ?, ?)""",
                (node_id, scope, key, confidence),
            )
            self.index_provenance(con, node_id, cited, created_at)
            self.index_supersedes(con, node_id, closes)
        return MemoryRef(node_id, rel, "fact")

    def write_procedural(
        self,
        trigger: str,
        behavior: str,
        *,
        scope: str = "chat",
        sources: Sequence[str],
        confidence: float = DEFAULT_CONFIDENCE,
        importance: int = DEFAULT_IMPORTANCE,
        supersedes: Sequence[str] = (),
        retired: bool = False,
        space: str = CORE,
    ) -> MemoryRef:
        """Write one "when X, do Y" rule, citing the episodes that taught it.

        ``supersedes`` and ``retired`` mean what they mean on :meth:`write_fact` (ADR 0143), and so
        does ``space`` (ADR 0225).
        """
        check_space(space)
        if scope not in PROCEDURAL_SCOPES:
            raise ValueError(f"procedural scope must be one of {PROCEDURAL_SCOPES}: {scope!r}")
        _require_finite(confidence)
        if not trigger.strip():
            raise ValueError("refusing to write a procedural with no trigger")
        body = _lf(behavior).strip()
        if not body:
            raise ValueError("refusing to write an empty procedural")
        cited = self._require_provenance(sources, space)
        closes = self._require_supersedable(supersedes, space)

        node_id = ids.mint("procedural")
        created_at = now_iso()
        rel = f"procedurals/{scope}/{node_id}_{text.slug(trigger)}.md"
        file_text = frontmatter.render(
            self._stamped(
                [
                    ("id", node_id),
                    ("type", "procedural"),
                    ("scope", scope),
                    ("trigger", trigger),
                    ("confidence", confidence),
                    ("created", created_at),
                    ("sources", cited),
                    *_lineage(closes, retired),
                ],
                space,
            ),
            body,
        )
        if retired:
            importance = 0
        self._write_file(rel, file_text)

        with self.write_txn() as con:
            self.index_node(
                con,
                node_id=node_id,
                kind="procedural",
                rel=rel,
                file_text=file_text,
                body=body,
                importance=importance,
                created_at=created_at,
                space=space,
            )
            con.execute(
                """INSERT INTO companion_procedural (id, scope, trigger_pattern, confidence)
                   VALUES (?, ?, ?, ?)""",
                (node_id, scope, trigger, confidence),
            )
            self.index_provenance(con, node_id, cited, created_at)
            self.index_supersedes(con, node_id, closes)
        return MemoryRef(node_id, rel, "procedural")

    def _require_supersedable(
        self, supersedes: Sequence[str], space: str = CORE, *, arriving: bool = False
    ) -> list[str]:
        """The ids a new memory may close: facts or procedurals this brain holds. Deduplicated.

        A sleep cycle's merge leg names them, and a model's reference is untrusted until it is
        checked (ADR 0143): an id that is not a distilled memory here is refused, before the file
        is written, rather than recorded as closing something that was never there.

        Only a memory of the writer's own ``space`` may be closed (ADR 0225). Recall serves the
        successor and never what it closed, in every space: a project's fact closing a core one
        would take it from core and from every other project, where the successor is not visible.

        ``arriving`` is :meth:`receive_file`'s: another device's file may name a memory that has
        not reached this one yet, so an absent id passes; one held here must still be the space's.
        """
        wanted = list(dict.fromkeys(supersedes))
        if not wanted:
            return []
        malformed = [
            s for s in wanted if not any(ids.is_id(kind, s) for kind in SUPERSEDABLE_KINDS)
        ]
        if malformed:
            raise ValueError(f"supersedes names ids that are not facts or procedurals: {malformed}")
        marks = ",".join("?" for _ in wanted)
        with closing(self.read_connection()) as con:
            rows = con.execute(
                f"""SELECT id, space FROM companion_node
                    WHERE kind IN ('fact', 'procedural') AND id IN ({marks})""",
                tuple(wanted),
            ).fetchall()
        known = {str(row[0]): str(row[1] or CORE) for row in rows}
        missing = [s for s in wanted if s not in known]
        if missing and not arriving:
            raise ValueError(f"supersedes names memories this brain does not hold: {missing}")
        walled = [s for s in wanted if s in known and known[s] != space]
        if walled:
            where = "core" if space == CORE else f"space {space}"
            raise ValueError(f"supersedes names memories that are not {where}'s: {walled}")
        return wanted

    # -- goals ---------------------------------------------------------------------------------

    def write_goal(
        self, goal_id: str, title: str, body: str, *, session_id: str, created: str
    ) -> MemoryRef:
        """Write (or rewrite) ``goals/<goal_id>.md``: one standing case (ADR 0123).

        The header is five keys, the episode's shape with ``title`` in ``role``'s place: ``id,
        type, title, session, created``. Everything a writer of goals needs beyond that is the
        body's, so the header stays what the rebuild reads and nothing more. The id is a minted
        project id (``contracts/ids.py``), which is also what keeps the path inside ``goals/``.
        ``created`` is the first write's and a rewrite passes it again, so the row a rebuild
        makes is the row this writes. A goal is not a distilled claim and cites nothing here;
        the facts drawn from it do (:meth:`write_fact`).
        """
        if not ids.is_id("project", goal_id):
            raise ValueError(f"a goal id is a minted project id: {goal_id!r}")
        if not title.strip():
            raise ValueError("refusing to write a goal with no title")
        text_body = _lf(body).strip()
        if not text_body:
            raise ValueError("refusing to write an empty goal")
        rel = f"goals/{goal_id}.md"
        file_text = frontmatter.render(
            [
                ("id", goal_id),
                ("type", "goal"),
                ("title", title.strip()),
                ("session", session_id),
                ("created", created),
            ],
            text_body,
        )
        self._write_file(rel, file_text)
        with self.write_txn() as con:
            self.index_node(
                con,
                node_id=goal_id,
                kind="goal",
                rel=rel,
                file_text=file_text,
                body=text_body,
                importance=DEFAULT_IMPORTANCE,
                created_at=created,
                session_id=session_id,
            )
        return MemoryRef(goal_id, rel, "goal")

    def goals(self) -> list[NodeRow]:
        """Every goal the index holds, oldest first (a rebuild finds them again from disk)."""
        with closing(self.read_connection()) as con:
            rows = con.execute(
                f"""SELECT {NODE_COLUMNS} FROM companion_node
                    WHERE kind = 'goal' ORDER BY created_at, id"""
            ).fetchall()
        return [node_from_row(row) for row in rows]

    # -- rituals -------------------------------------------------------------------------------

    def write_ritual(
        self,
        ritual_id: str,
        folder: str,
        name: str,
        title: str,
        body: str,
        *,
        session_id: str,
        created: str,
    ) -> MemoryRef:
        """Write (or rewrite) ``rituals/<folder>/<name>.md``: one standing ritual (ADR 0131).

        The header is the goal's five keys with ``type: ritual``: ``id, type, title, session,
        created``; whatever the ritual holds is the body's. ``folder`` is one of the ritual
        directories the tree reserves (``quiet_hours``, ``cadence``, ``focus_window``) and
        ``name`` a lowercase slug, so the path stays inside it. The id is a minted ``rit_`` id
        (``contracts/ids.py``), not the name: a chore's cadence is named for its case's ``proj_``
        id, which is already the goal's id, and two files claiming one id is a collision the
        rebuild refuses. ``created`` is the first write's and a rewrite passes it again.
        """
        if not ids.is_id("ritual", ritual_id):
            raise ValueError(f"a ritual id is a minted ritual id: {ritual_id!r}")
        if f"rituals/{folder}" not in paths.TREE:
            raise ValueError(f"not a ritual folder: {folder!r}")
        if not _RITUAL_NAME.fullmatch(name):
            raise ValueError(f"a ritual file name is a lowercase slug: {name!r}")
        if not title.strip():
            raise ValueError("refusing to write a ritual with no title")
        text_body = _lf(body).strip()
        if not text_body:
            raise ValueError("refusing to write an empty ritual")
        rel = f"rituals/{folder}/{name}.md"
        file_text = frontmatter.render(
            [
                ("id", ritual_id),
                ("type", "ritual"),
                ("title", title.strip()),
                ("session", session_id),
                ("created", created),
            ],
            text_body,
        )
        self._write_file(rel, file_text)
        with self.write_txn() as con:
            self.index_node(
                con,
                node_id=ritual_id,
                kind="ritual",
                rel=rel,
                file_text=file_text,
                body=text_body,
                importance=DEFAULT_IMPORTANCE,
                created_at=created,
                session_id=session_id,
            )
        return MemoryRef(ritual_id, rel, "ritual")

    def rituals(self, folder: str) -> list[NodeRow]:
        """Every ritual the index holds under ``rituals/<folder>/``, oldest first."""
        with closing(self.read_connection()) as con:
            rows = con.execute(
                f"""SELECT {NODE_COLUMNS} FROM companion_node
                    WHERE kind = 'ritual' AND file_path LIKE ? ORDER BY created_at, id""",
                (f"rituals/{folder}/%",),
            ).fetchall()
        return [node_from_row(row) for row in rows]

    # -- replication ---------------------------------------------------------------------------

    def receive_file(self, kind: str, rel: str, data: bytes) -> MemoryRef:
        """Adopt one write-once memory another device wrote, byte for byte (ADR 0140).

        This is the third way a memory enters a brain, beside the writers and the rebuild, and it
        is built from both rather than beside them. The file is refused unless ``rel`` is exactly
        where this brain's writer files ``kind`` (:func:`replicated_path`) and its header says the
        same id and type. A fact or procedural must cite only episodes that are live *here*,
        through the same :meth:`_require_provenance` every writer passes: replication is not a
        bypass, so the caller sends episodes first and defers a claim whose evidence has not
        arrived. Then disk first, whole or not at all (ADR 0080) - the sender's bytes, its
        ``device:`` stamp among them - and the index rows through
        :func:`~athena.core.brain.reconcile.index_file`, the function the rebuild runs for each
        file, so a rebuild over the merged tree builds the rows this did.

        Raises :class:`FileExistsError` when the id or the path is already here (the caller
        compares the two copies), :class:`ProvenanceError` for a source that is not a live
        episode of this brain, and :class:`ValueError` for any other reason the file is refused.
        """
        from athena.core.brain import reconcile  # reconcile imports this module

        node_id = replicated_path(kind, rel)
        try:
            # What a rebuild reads (``read_text``: universal newlines), so the rows are its rows.
            file_text = _lf(data.decode("utf-8"))
        except UnicodeDecodeError:
            raise ValueError(f"{rel}: not UTF-8") from None
        meta, body = frontmatter.parse(file_text)
        if str(meta.get("id") or "") != node_id or meta.get("type") != kind:
            raise ValueError(f"{rel}: the header does not name {node_id} as a {kind}")
        confidence = DEFAULT_CONFIDENCE
        if kind != "episode":
            sources = meta.get("sources")
            if not isinstance(sources, list):
                raise ProvenanceError(f"{rel}: a fact or a procedural must cite its episodes")
            self._require_provenance([str(source) for source in sources], space_of(meta))
            closes = meta.get(SUPERSEDES_KEY)
            if isinstance(closes, list):
                # The supersede wall, as every writer passes it (ADR 0225). A memory named here
                # that has not arrived yet is let through: replication sends what cites before
                # what is closed only by the order things were written in.
                self._require_supersedable(
                    [str(old) for old in closes], space_of(meta), arriving=True
                )
            checked = reconcile.confidence_of(meta)
            if checked is None:
                raise ValueError(f"{rel}: confidence is not a number")
            confidence = checked
        with self._write_lock:
            if self.node(node_id) is not None or (self.root / rel).exists():
                raise FileExistsError(node_id)
            self._write_bytes(rel, data)
            with self.write_txn() as con:
                reconcile.index_file(
                    self, con, node_id, kind, rel, file_text, body, meta, confidence
                )
        return MemoryRef(node_id, rel, kind)

    # -- write plumbing ------------------------------------------------------------------------

    def _write_file(self, rel: str, payload: str) -> None:
        """Disk first, whole or not at all (ADR 0080).

        Bytes are written as they are, with no newline translation on any platform: the tree is
        portable by copying. The payload is encoded first, so text that is not valid Unicode
        creates nothing. The bytes go to a temporary file whose name does not end in ``.md`` (a
        reconcile never indexes it), are fsynced, and replace the target in one step. The
        directory is not fsynced; Windows cannot.
        """
        self._write_bytes(rel, payload.encode("utf-8"))

    def _write_bytes(self, rel: str, data: bytes) -> None:
        """:meth:`_write_file` for bytes already encoded: a received file keeps the sender's."""
        target = self.root / rel
        target.parent.mkdir(parents=True, exist_ok=True)
        temp = target.with_name(f".{target.name}.{secrets.token_hex(6)}.tmp")
        try:
            with temp.open("xb") as handle:
                handle.write(data)
                handle.flush()
                os.fsync(handle.fileno())
            os.replace(temp, target)
        except BaseException:
            temp.unlink(missing_ok=True)
            raise

    def index_node(
        self,
        con: sqlite3.Connection,
        *,
        node_id: str,
        kind: str,
        rel: str,
        file_text: str,
        body: str,
        importance: int,
        created_at: str,
        session_id: str | None = None,
        machine: bool = False,
        tags: Sequence[str] | None = None,
        fts_tags: str | None = None,
        space: str = CORE,
    ) -> None:
        tag_list = list(tags or [])
        # An upsert, not INSERT OR REPLACE: a replace deletes the row and gives the new one a new
        # rowid, and the rowid is the key of this node's FTS row (ADR 0077).
        ((rowid,),) = con.execute(
            """INSERT INTO companion_node
               (id, kind, session_id, file_path, content_hash, importance, body_excerpt,
                tags_json, machine, created_at, updated_at, space)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
               ON CONFLICT (id) DO UPDATE SET
                 kind = excluded.kind, session_id = excluded.session_id,
                 file_path = excluded.file_path, content_hash = excluded.content_hash,
                 importance = excluded.importance, body_excerpt = excluded.body_excerpt,
                 tags_json = excluded.tags_json, machine = excluded.machine,
                 created_at = excluded.created_at, updated_at = excluded.updated_at,
                 space = excluded.space
               RETURNING rowid""",
            (
                node_id,
                kind,
                session_id,
                rel,
                sha256(file_text),
                importance,
                text.excerpt(body),
                json.dumps(tag_list),
                1 if machine else 0,
                created_at,
                created_at,
                space,
            ),
        ).fetchall()
        con.execute("DELETE FROM companion_fts WHERE rowid = ?", (rowid,))
        con.execute(
            "INSERT INTO companion_fts (rowid, node_id, body, tags) VALUES (?, ?, ?, ?)",
            (
                rowid,
                node_id,
                body,
                fts_tags if fts_tags is not None else (" ".join(tag_list) or kind),
            ),
        )

    @staticmethod
    def index_provenance(
        con: sqlite3.Connection, node_id: str, sources: Sequence[str], created_at: str
    ) -> None:
        con.executemany(
            """INSERT OR IGNORE INTO companion_provenance (node_id, source_id, created_at)
               VALUES (?, ?, ?)""",
            [(node_id, source, created_at) for source in sources],
        )

    @staticmethod
    def index_supersedes(con: sqlite3.Connection, node_id: str, superseded: Sequence[str]) -> None:
        """One ``companion_supersede`` row per id ``node_id`` closes (ADR 0143)."""
        con.executemany(
            """INSERT OR IGNORE INTO companion_supersede (node_id, superseded_id)
               VALUES (?, ?)""",
            [(node_id, old) for old in superseded if old != node_id],
        )

    # -- the sleep cycle's journal and recall's use marks (ADR 0143) ----------------------------

    def write_cycle_report(self, cycle_id: str, body: str, *, created: str) -> MemoryRef:
        """Write ``cycles/<YYYY-MM-DD>-<cycle_id>.md``: one sleep cycle's journal, whole.

        The header is three keys, ``id, type, created``, and the rest is markdown for a person.
        The rebuild walks ``cycles/`` as ``cycle_report``, so the row written here is the row a
        rebuild makes from the file (no session, no tags, the default importance). It is never
        replicated: what one PC's cycle did is that PC's record.
        """
        if not ids.is_id("cycle", cycle_id):
            raise ValueError(f"not a cycle id: {cycle_id!r}")
        text_body = _lf(body).strip()
        if not text_body:
            raise ValueError("refusing to write an empty cycle report")
        rel = f"cycles/{created[:10]}-{cycle_id}.md"
        file_text = frontmatter.render(
            [("id", cycle_id), ("type", "cycle_report"), ("created", created)], text_body
        )
        self._write_file(rel, file_text)
        with self.write_txn() as con:
            self.index_node(
                con,
                node_id=cycle_id,
                kind="cycle_report",
                rel=rel,
                file_text=file_text,
                body=text_body,
                importance=DEFAULT_IMPORTANCE,
                created_at=created,
            )
        return MemoryRef(cycle_id, rel, "cycle_report")

    def note_recalled(self, node_ids: Sequence[str], *, at: str | None = None) -> bool:
        """Mark distilled memories as just recalled: their use row moves, their fade row goes.

        Runtime state, not memory (``companion_recall_seen`` and ``companion_fade`` are outside
        ``INDEX_TABLES``), so it is written to the index alone. A hit is a ranking hint, so this
        never waits long: when the write lock is not free within :data:`SEEN_LOCK_S`, or the index
        refuses the write, the hit is let go and the answer is ``False``. A refusal is logged at
        warning: a busy lock is expected and passes in silence, but an index that will not take the
        mark (a full disk, a damaged page) lets every memory in use fade, and that must be seen.
        The index's own busy timeout is held to :data:`SEEN_LOCK_S` for the mark too, so another
        connection's write is waited on no longer than this process's own.
        """
        wanted = list(dict.fromkeys(node_ids))
        if not wanted:
            return True
        when = at or now_iso()
        if not self._write_lock.acquire(timeout=SEEN_LOCK_S):
            return False
        try:
            # The same bound on the index's own lock: another connection's write (a CLI
            # reconcile) would otherwise hold this mark for the whole BUSY_TIMEOUT_MS.
            self._con.execute(f"PRAGMA busy_timeout = {int(SEEN_LOCK_S * 1000)}")
            try:
                with self.write_txn() as con:
                    con.executemany(
                        """INSERT INTO companion_recall_seen (node_id, last_at, hits)
                           VALUES (?, ?, 1)
                           ON CONFLICT (node_id) DO UPDATE SET
                             last_at = excluded.last_at, hits = hits + 1""",
                        [(node_id, when) for node_id in wanted],
                    )
                    con.executemany(
                        "DELETE FROM companion_fade WHERE node_id = ?", [(n,) for n in wanted]
                    )
            finally:
                self._con.execute(f"PRAGMA busy_timeout = {BUSY_TIMEOUT_MS}")
        except sqlite3.Error as exc:
            if ((getattr(exc, "sqlite_errorcode", None) or 0) & 0xFF) not in _BUSY_CODES:
                _log.warning("recall use marks not written for %d memories: %s", len(wanted), exc)
            return False
        finally:
            self._write_lock.release()
        return True

    # -- the memory wall's two explicit acts (ADR 0225) ------------------------------------------

    def unstamp(self, node_id: str, space: str) -> str | None:
        """Move the fact or procedural ``node_id`` out of ``space`` into core: its file rewritten
        whole without its ``space:`` line, its row's ``space`` and ``content_hash`` updated.

        Answers the memory's kind, or ``None`` when no fact or procedural of that space has that
        id - on disk, which is the truth: a row that says the space over a file that does not is
        not moved. Every other byte of the file is kept, so the file is the one its writer would
        have written in core, plus nothing; every index-only column (importance, fade, use) is
        kept too, which a reindex would reset. Its citations are kept as they are: a promoted
        memory may cite what was said in the space, and a core memory's citation of an episode
        nobody can see is recorded, never followed by recall (the episode block draws on its own).
        """
        if space == CORE or not ids.is_id("space", space):
            return None
        with self._write_lock:
            with closing(self.read_connection()) as con:
                row = con.execute(
                    "SELECT kind, file_path, space FROM companion_node WHERE id = ?", (node_id,)
                ).fetchone()
            if row is None or row[0] not in SUPERSEDABLE_KINDS or row[2] != space:
                return None
            kind, rel = str(row[0]), str(row[1])
            try:
                raw = (self.root / rel).read_bytes().decode("utf-8")
            except (OSError, UnicodeDecodeError):
                return None
            moved = _without_space(raw, space)
            if moved is None:
                return None
            self._write_file(rel, moved)
            with self.write_txn() as con:
                con.execute(
                    "UPDATE companion_node SET space = ?, content_hash = ? WHERE id = ?",
                    (CORE, sha256(_lf(moved)), node_id),
                )
        return kind

    def erase_space(self, space: str) -> dict[str, int]:
        """Erase every episode, fact and procedural stamped with ``space``: the files, then every
        index row of them, then the sleep proposals stamped with it. Answers how many of each kind
        went, as ``{"episode": n, "fact": n, "procedural": n}``.

        What is erased is what the index holds under ``space`` **and** what the disk holds under it
        - a file written and never indexed (a crash between the two) is found by its header, so it
        cannot come back on the next rebuild. The rows are every table that names one of them:
        ``companion_node`` and its FTS row, the fact and procedural sidecars, provenance (the
        memory's own citations), supersedence (either side), and the use and fade marks. A memory
        of another space or of core that *cites* an erased episode keeps its citation: the row is
        that memory's, and what it records is what its file says (a rebuild writes it back).

        Files go first. A crash part way leaves rows whose files are gone, which the next erase
        finds again in the index and removes; rows first would leave files no index names, which
        an erase pressed again could not see.
        """
        if not ids.is_id("space", space):
            raise ValueError(f"not a space id: {space!r}")
        with self._write_lock:
            found: dict[str, tuple[str, set[str]]] = {}
            with closing(self.read_connection()) as con:
                marks = ",".join("?" for _ in STAMPED_KINDS)
                for node_id, kind, rel in con.execute(
                    f"""SELECT id, kind, file_path FROM companion_node
                        WHERE space = ? AND kind IN ({marks})""",
                    (space, *STAMPED_KINDS),
                ).fetchall():
                    found[str(node_id)] = (str(kind), {str(rel)})
            for node_id, kind, rel in _stamped_on_disk(self.root, space):
                held = found.setdefault(node_id, (kind, set()))
                held[1].add(rel)
            for _, rels in found.values():
                for rel in rels:
                    (self.root / rel).unlink(missing_ok=True)
            erased = json.dumps(sorted(found))
            each = "(SELECT value FROM json_each(?))"
            with self.write_txn() as con:
                con.execute(
                    f"""DELETE FROM companion_fts WHERE rowid IN
                        (SELECT rowid FROM companion_node WHERE id IN {each})""",
                    (erased,),
                )
                # And any FTS row whose node row is already gone (a crash between the two, or an
                # older index): by ``node_id``, which is UNINDEXED and so a scan - an erase is rare
                # and must leave no searchable word of the space behind.
                con.execute(f"DELETE FROM companion_fts WHERE node_id IN {each}", (erased,))
                for table, column in (
                    ("companion_node", "id"),
                    ("companion_fact", "id"),
                    ("companion_procedural", "id"),
                    ("companion_provenance", "node_id"),
                    ("companion_supersede", "node_id"),
                    ("companion_supersede", "superseded_id"),
                    ("companion_recall_seen", "node_id"),
                    ("companion_fade", "node_id"),
                ):
                    con.execute(f"DELETE FROM {table} WHERE {column} IN {each}", (erased,))
                con.execute("DELETE FROM companion_proposal WHERE space = ?", (space,))
        counts = dict.fromkeys(STAMPED_KINDS, 0)
        for kind, _ in found.values():
            counts[kind] = counts.get(kind, 0) + 1
        return counts

    # -- reads ---------------------------------------------------------------------------------

    def node(self, node_id: str) -> NodeRow | None:
        with closing(self.read_connection()) as con:
            row = con.execute(
                f"SELECT {NODE_COLUMNS} FROM companion_node WHERE id = ?", (node_id,)
            ).fetchone()
        return None if row is None else node_from_row(row)

    def read_body(self, node_id: str) -> str:
        """Hydrate a memory from its file. The excerpt in SQL is an index, not the memory.

        Stripped, so this is the exact inverse of the writer: ``render`` normalised the body to
        one trailing newline on the way in and this takes it back off.
        """
        with closing(self.read_connection()) as con:
            row = con.execute(
                "SELECT file_path FROM companion_node WHERE id = ?", (node_id,)
            ).fetchone()
        if row is None:
            raise KeyError(node_id)
        _, body = frontmatter.parse((self.root / str(row[0])).read_text(encoding="utf-8"))
        return body.strip()

    def counts(self) -> dict[str, int]:
        """How many live memories of each kind. The doctor's brain stage prints this."""
        with closing(self.read_connection()) as con:
            rows = con.execute(
                "SELECT kind, COUNT(*) FROM companion_node WHERE importance > 0 GROUP BY kind"
            ).fetchall()
        return {str(kind): int(count) for kind, count in rows}


def _lf(text: str) -> str:
    """A body's line endings as the readers see them: CRLF, then a lone CR, become LF (ADR 0003).

    The readers open files with universal newlines, so a CR the writer kept never came back.
    """
    return text.replace("\r\n", "\n").replace("\r", "\n")


def _lineage(closes: Sequence[str], retired: bool) -> list[tuple[str, Any]]:
    """The supersedence keys of a header, in their order, and only those that are present."""
    pairs: list[tuple[str, Any]] = []
    if closes:
        pairs.append((SUPERSEDES_KEY, list(closes)))
    if retired:
        pairs.append((RETIRED_KEY, True))
    return pairs


def _require_finite(confidence: float) -> None:
    """Refuse a NaN or infinite confidence before the file is written.

    The ``REAL NOT NULL`` column refuses NaN only at the INSERT, after the file is on disk, which
    left a file with no row.
    """
    if not math.isfinite(confidence):
        raise ValueError(f"confidence: {confidence} is not a finite number")


def _stored_version(con: sqlite3.Connection) -> int:
    """The schema version an index was stamped with; 0 for none or one that is not a number."""
    row = con.execute("SELECT value FROM companion_meta WHERE key = 'schema_version'").fetchone()
    try:
        return int(row[0]) if row is not None else 0
    except ValueError:
        return 0


def _rekey_fts(con: sqlite3.Connection) -> None:
    """Give every FTS row its node's rowid, and drop the rows no node has (ADR 0077).

    A version-1 index let FTS5 pick its own rowids. The rows are copied out joined to their node,
    the table is emptied, and they go back under the node's rowid. Where one node had two rows,
    the newer is kept. Only the index changes: the disk is the truth (ADR 0003).
    """
    con.execute(
        """CREATE TEMP TABLE athena_fts_rekey AS
           SELECT n.rowid AS node_rowid, f.node_id, f.body, f.tags
           FROM companion_fts f JOIN companion_node n ON n.id = f.node_id
           WHERE f.rowid IN (SELECT MAX(rowid) FROM companion_fts GROUP BY node_id)"""
    )
    try:
        con.execute("DELETE FROM companion_fts")
        con.execute(
            """INSERT INTO companion_fts (rowid, node_id, body, tags)
               SELECT node_rowid, node_id, body, tags FROM athena_fts_rekey"""
        )
    finally:
        con.execute("DROP TABLE temp.athena_fts_rekey")


def _add_space_columns(con: sqlite3.Connection) -> None:
    """Give an index made before the memory wall its ``space`` columns (ADR 0225), each one that is
    missing; a fresh index already has them from its ``CREATE TABLE``. ``ADD COLUMN`` with a
    constant default rewrites nothing: every existing row reads ``''``, core."""
    for table, column, declaration in SPACE_COLUMNS:
        present = {str(row[1]) for row in con.execute(f"PRAGMA table_info({table})")}
        if column not in present:
            con.execute(f"ALTER TABLE {table} ADD COLUMN {column} {declaration}")


def _fill_spaces(con: sqlite3.Connection, root: Path) -> None:
    """Read the ``space`` stamp of every indexed episode, fact and procedural from its file, once,
    when an index older than the wall is first opened (ADR 0225).

    The column is derived from disk, and an index built before it existed says ``''`` for every
    row - which is right for every file this PC wrote then, and wrong for one a paired device
    stamped and replication delivered. Core is the one value that must never be guessed, so each
    file's header is read; a file that does not name a space (all of them, on a brain that has
    never had one) costs one read and no write. A file that cannot be read keeps its row as it
    was, as a rebuild would skip it.
    """
    marks = ",".join("?" for _ in STAMPED_KINDS)
    stamped: list[tuple[str, str]] = []
    for node_id, rel in con.execute(
        f"SELECT id, file_path FROM companion_node WHERE kind IN ({marks})", STAMPED_KINDS
    ).fetchall():
        try:
            file_text = (root / str(rel)).read_text(encoding="utf-8")
        except (OSError, UnicodeDecodeError):
            continue
        if f"{SPACE_KEY}:" not in file_text:
            continue
        meta, _ = frontmatter.parse(file_text)
        found = space_of(meta)
        if found != CORE:
            stamped.append((found, str(node_id)))
    con.executemany("UPDATE companion_node SET space = ? WHERE id = ?", stamped)


#: The directories each stamped kind is filed under, for the erase's walk of the disk.
_STAMPED_DIRS: tuple[tuple[str, str], ...] = (
    ("episodes", "episode"),
    *((f"semantic/{scope}", "fact") for scope in paths.FACT_SCOPES),
    *((f"procedurals/{scope}", "procedural") for scope in paths.PROCEDURAL_SCOPES),
)


def _stamped_on_disk(root: Path, space: str) -> list[tuple[str, str, str]]:
    """Every episode, fact and procedural file whose header says ``space``, as ``(id, kind,
    rel)``: what an erase removes beside what the index names. A file that cannot be read, or
    names no id, is passed over - it is not a memory any reader could reach either."""
    out: list[tuple[str, str, str]] = []
    for subdir, kind in _STAMPED_DIRS:
        base = root / subdir
        if not base.is_dir():
            continue
        for path in sorted(base.rglob("*.md")):
            try:
                file_text = path.read_text(encoding="utf-8")
            except (OSError, UnicodeDecodeError):
                continue
            if space not in file_text:
                continue
            meta, _ = frontmatter.parse(file_text)
            node_id = str(meta.get("id") or "")
            if node_id and space_of(meta) == space:
                out.append((node_id, kind, path.relative_to(root).as_posix()))
    return out


def _without_space(file_text: str, space: str) -> str | None:
    """``file_text`` with its ``space:`` header line(s) removed, every other byte kept; ``None``
    when its header does not say ``space`` (then there is nothing of that space to move)."""
    meta, _ = frontmatter.parse(file_text)
    if space_of(meta) != space:
        return None
    head_fence = f"{frontmatter.FENCE}\n"
    text = file_text.removeprefix("﻿")
    end = text.find(f"\n{frontmatter.FENCE}\n", len(frontmatter.FENCE))
    if not text.startswith(head_fence) or end == -1:
        return None
    head = text[len(head_fence) : end].split("\n")
    kept = [line for line in head if line.partition(":")[0].strip() != SPACE_KEY]
    return head_fence + "\n".join(kept) + text[end:]

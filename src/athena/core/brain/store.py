"""The brain: markdown on disk is truth, SQLite is the index (README §2 invariants 1 and 2).

Three rules hold this module together, and each is a lesson the first build learned late
(README §3.5, ADR 0003).

**Disk first, index second.** A writer renders the file, writes it, and only then opens one
transaction that inserts every index row for it. A crash between the two leaves a findable file
and a missing row — which the next :func:`~athena.core.brain.reconcile.reconcile_from_disk`
repairs. The other order would leave a row pointing at a file that does not exist, and no
rebuild can repair that.

**Provenance at write.** :meth:`Brain.write_fact` and :meth:`Brain.write_procedural` refuse any
``sources`` list that does not resolve to live episode ids *in this brain*. There is no bypass,
not for a script and not for a test: a fixture builds its episodes first and cites them. A
distilled claim whose evidence cannot be opened is the failure mode memory systems die of.

**One writer, many readers.** The writer connection is private and every write takes
the write lock; :meth:`read_connection` hands out a fresh read-only handle per call.
The daemon is threaded, so a long turn holds the writer while eight read routes answer from their
own handles — and, in WAL, without waiting for it. What a read handle sees is defined in
:meth:`read_connection`: the state as of the last completed write.

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
import sqlite3
import threading
from collections.abc import Iterator, Sequence
from contextlib import closing, contextmanager
from dataclasses import dataclass, field
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from athena.contracts import ids
from athena.core.brain import frontmatter, paths, text
from athena.core.brain.schema import SCHEMA, SCHEMA_VERSION

#: The scopes each distilled kind may be filed under. A scope is a directory on disk, so an
#: unknown one would write outside the tree a reconcile walks and the memory would vanish on
#: rebuild — which is why these are refused rather than created.
FACT_SCOPES: tuple[str, ...] = ("user", "project", "world")
PROCEDURAL_SCOPES: tuple[str, ...] = ("chat", "action", "memory", "build")
EPISODE_ROLES: tuple[str, ...] = ("user", "assistant", "system")

#: Importance a writer starts a memory at (ref §8): conversation at 3, machine chatter at 1.
DEFAULT_IMPORTANCE = 3
MACHINE_IMPORTANCE = 1
DEFAULT_CONFIDENCE = 0.7

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
    )


#: The projection :func:`node_from_row` reads, in order. One string so the SELECTs cannot drift.
NODE_COLUMNS = (
    "id, kind, file_path, body_excerpt, importance, created_at, session_id, machine, tags_json"
)


class Brain:
    """One brain directory and its index.

    Construction is cheap and idempotent: the tree is created if absent, the schema applied with
    ``CREATE ... IF NOT EXISTS``, and nothing is read. Closing is optional but polite; the class
    is a context manager.
    """

    def __init__(self, root: str | Path | None = None, *, session_id: str = "cli") -> None:
        self.root: Path = paths.ensure_tree(root)
        self.db_path: Path = self.root / paths.INDEX_FILENAME
        self.session_id = session_id
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
        self._con.execute(f"PRAGMA busy_timeout = {BUSY_TIMEOUT_MS}")
        # WAL is what lets a reader hold a snapshot while the writer commits. Without it the
        # per-request read handle of README §3.5 would trade a stalled write queue for a
        # stalled read queue and change nothing.
        self._con.execute("PRAGMA journal_mode = WAL")
        self._con.execute("PRAGMA synchronous = NORMAL")
        with self.write_txn():
            for statement in SCHEMA:
                self._con.execute(statement)
            self._con.execute(
                "INSERT OR REPLACE INTO companion_meta (key, value) VALUES ('schema_version', ?)",
                (str(SCHEMA_VERSION),),
            )
        self.ensure_session(session_id)

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
            self._con.execute("COMMIT")

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

    # -- sessions ------------------------------------------------------------------------------

    def ensure_session(self, session_id: str, title: str = "Athena") -> None:
        now = _now_iso()
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
    ) -> MemoryRef:
        """Append one episode. Episodes are the only kind that is its own provenance.

        The file is ``episodes/YYYY/MM/DD/<ep_id>_<role>.md`` with the header ref §8 fixes:
        ``id, type, role, session, created``, in that order.
        """
        body = content.strip()
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
            [
                ("id", node_id),
                ("type", "episode"),
                ("role", role),
                ("session", sid),
                ("created", created_at),
            ],
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
            )
        return MemoryRef(node_id, rel, "episode")

    # -- provenance ----------------------------------------------------------------------------

    def live_episode_ids(self, candidates: Sequence[str]) -> set[str]:
        """Which of ``candidates`` are episodes of this brain that have not been demoted."""
        if not candidates:
            return set()
        marks = ",".join("?" for _ in candidates)
        with closing(self.read_connection()) as con:
            rows = con.execute(
                f"""SELECT id FROM companion_node
                    WHERE kind = 'episode' AND importance > 0 AND id IN ({marks})""",
                tuple(candidates),
            ).fetchall()
        return {str(row[0]) for row in rows}

    def _require_provenance(self, sources: Sequence[str]) -> list[str]:
        """The gate of README §2 invariant 2. Deduplicates, preserving the caller's order.

        Two refusals, and they read differently on purpose. An empty list is a writer that never
        had evidence; a dangling id is a writer that cited something this brain cannot open —
        a hallucinated id, an episode from another brain, or one that has been demoted since.
        """
        if not sources:
            raise ProvenanceError("a fact or a procedural must cite at least one live episode id")
        malformed = [s for s in sources if not ids.is_id("episode", s)]
        if malformed:
            raise ProvenanceError(f"sources are not episode ids: {sorted(malformed)}")
        live = self.live_episode_ids(sources)
        dangling = [s for s in sources if s not in live]
        if dangling:
            raise ProvenanceError(
                f"sources are not live episodes of this brain: {sorted(dangling)}"
            )
        return list(dict.fromkeys(sources))

    def sources_of(self, node_id: str) -> list[str]:
        with closing(self.read_connection()) as con:
            rows = con.execute(
                "SELECT source_id FROM companion_provenance WHERE node_id = ? ORDER BY source_id",
                (node_id,),
            ).fetchall()
        return [str(row[0]) for row in rows]

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
        tags: Sequence[str] | None = None,
        expires_at: str | None = None,
    ) -> MemoryRef:
        """Write one distilled claim, citing the episodes it was drawn from.

        ``sources`` is keyword-only and has no default, so "I forgot the provenance" is a
        ``TypeError`` at the call site rather than an empty list at the gate.
        """
        if scope not in FACT_SCOPES:
            raise ValueError(f"fact scope must be one of {FACT_SCOPES}: {scope!r}")
        body = value.strip()
        if not body:
            raise ValueError("refusing to write an empty fact")
        cited = self._require_provenance(sources)

        node_id = ids.mint("fact")
        created_at = _now_iso()
        rel = f"semantic/{scope}/{node_id}_{text.slug(key)}.md"
        file_text = frontmatter.render(
            [
                ("id", node_id),
                ("type", "fact"),
                ("scope", scope),
                ("key", key),
                ("confidence", confidence),
                ("created", created_at),
                ("sources", cited),
            ],
            body,
        )
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
                tags=list(tags or []),
            )
            con.execute(
                """INSERT INTO companion_fact (id, scope, fact_key, confidence, expires_at)
                   VALUES (?, ?, ?, ?, ?)""",
                (node_id, scope, key, confidence, expires_at),
            )
            self.index_provenance(con, node_id, cited, created_at)
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
        tags: Sequence[str] | None = None,
    ) -> MemoryRef:
        """Write one "when X, do Y" rule, citing the episodes that taught it."""
        if scope not in PROCEDURAL_SCOPES:
            raise ValueError(f"procedural scope must be one of {PROCEDURAL_SCOPES}: {scope!r}")
        body = behavior.strip()
        if not body:
            raise ValueError("refusing to write an empty procedural")
        cited = self._require_provenance(sources)

        node_id = ids.mint("procedural")
        created_at = _now_iso()
        rel = f"procedurals/{scope}/{node_id}_{text.slug(trigger)}.md"
        file_text = frontmatter.render(
            [
                ("id", node_id),
                ("type", "procedural"),
                ("scope", scope),
                ("trigger", trigger),
                ("confidence", confidence),
                ("created", created_at),
                ("sources", cited),
            ],
            body,
        )
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
                tags=list(tags or []),
            )
            con.execute(
                """INSERT INTO companion_procedural (id, scope, trigger_pattern, confidence)
                   VALUES (?, ?, ?, ?)""",
                (node_id, scope, trigger, confidence),
            )
            self.index_provenance(con, node_id, cited, created_at)
        return MemoryRef(node_id, rel, "procedural")

    # -- write plumbing ------------------------------------------------------------------------

    def _write_file(self, rel: str, payload: str) -> None:
        """Disk first. ``newline="\\n"`` on every platform: the tree is portable by copying."""
        target = self.root / rel
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(payload, encoding="utf-8", newline="\n")

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
    ) -> None:
        tag_list = list(tags or [])
        con.execute(
            """INSERT OR REPLACE INTO companion_node
               (id, kind, session_id, file_path, content_hash, importance, body_excerpt,
                tags_json, machine, created_at, updated_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
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
            ),
        )
        con.execute("DELETE FROM companion_fts WHERE node_id = ?", (node_id,))
        con.execute(
            "INSERT INTO companion_fts (node_id, body, tags) VALUES (?, ?, ?)",
            (node_id, body, fts_tags if fts_tags is not None else (" ".join(tag_list) or kind)),
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


def _now_iso() -> str:
    """RFC 3339 with an explicit offset — what the Rust writer emits and what parses back."""
    return datetime.now(UTC).isoformat()

"""Rebuild the index from the markdown tree (README §2 invariant 1; ADR 0003).

This is the function that makes the invariant true rather than aspirational. Copy a brain
directory to another machine, delete ``index.sqlite``, open the brain and run
:func:`reconcile_from_disk`: the index that comes out is the one the writers would have built,
row for row. ``tests/core/test_brain_reconcile.py`` asserts exactly that by comparing row sets,
which is why the walk goes through :meth:`Brain.index_node` instead of writing its own INSERT —
one insert path, so a rebuild cannot drift from an incremental write.

What disk cannot carry back is deliberate and documented in ADR 0003: importance, machine markers
and use timestamps are index columns, not frontmatter (ref §8), so a rebuild restores every
memory at its writer default. A demotion that was never expressed on disk does not survive.
The one exception is a fact whose file says ``every_turn: true``, the user's approval that it
rides every turn: it comes back at ``ALWAYS_IMPORTANCE`` (ADR 0071). Supersedence is on disk too
(ADR 0143): a fact or procedural whose file says ``supersedes: [ids]`` writes its
``companion_supersede`` rows back, and one that says ``retired: true`` comes back at importance 0.
The memory wall is on disk as well (ADR 0225): a file's ``space:`` stamp is its row's ``space``, so
deleting the index and rebuilding it gives every project back exactly the memories it had.
"""

from __future__ import annotations

import math
import sqlite3
from collections.abc import Iterator
from dataclasses import dataclass, field
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from athena.core.brain import frontmatter, paths, text
from athena.core.brain.schema import INDEX_TABLES
from athena.core.brain.store import (
    ALWAYS_IMPORTANCE,
    DEFAULT_CONFIDENCE,
    DEFAULT_IMPORTANCE,
    EVERY_TURN_KEY,
    MACHINE_IMPORTANCE,
    RETIRED_KEY,
    SUPERSEDABLE_KINDS,
    SUPERSEDES_KEY,
    Brain,
    sha256,
    space_of,
)

#: Which directory yields which kind, walked in this order. A directory absent from this table is
#: not indexed, so adding a kind to the tree is a visible change here rather than a silent one.
#: The fact and procedural rows come from the scope lists the writers accept, so a scope cannot be
#: written and then left out of the rebuild.
WALK: tuple[tuple[str, str], ...] = (
    ("episodes", "episode"),
    *((f"semantic/{scope}", "fact") for scope in paths.FACT_SCOPES),
    *((f"procedurals/{scope}", "procedural") for scope in paths.PROCEDURAL_SCOPES),
    ("goals", "goal"),
    ("backlog/self_promise", "backlog_item"),
    ("backlog/capability_gap", "backlog_item"),
    ("rituals/quiet_hours", "ritual"),
    ("rituals/cadence", "ritual"),
    ("rituals/focus_window", "ritual"),
    ("reflections", "reflection"),
    ("cycles", "cycle_report"),
)


@dataclass
class ReconcileStats:
    """What the rebuild saw. ``skipped`` names files, because a silent skip is a lost memory."""

    files: int = 0
    by_kind: dict[str, int] = field(default_factory=dict)
    skipped: list[str] = field(default_factory=list)
    #: Facts and procedurals indexed with no ``sources`` list. A rebuild trusts the disk
    #: (ADR 0003), so they stay; they are named because the write gate would have refused them.
    unsourced: list[str] = field(default_factory=list)

    def as_dict(self) -> dict[str, Any]:
        return {
            "files": self.files,
            "by_kind": dict(self.by_kind),
            "skipped": list(self.skipped),
            "unsourced": list(self.unsourced),
        }

    def summary(self) -> str:
        kinds = ", ".join(f"{kind} {n}" for kind, n in sorted(self.by_kind.items()))
        return (
            f"{self.files} files indexed ({kinds or 'none'}), {len(self.skipped)} skipped, "
            f"{len(self.unsourced)} without sources"
        )


def set_aside_index(index: Path, moved: list[Path]) -> None:
    """Rename a damaged index and its ``-wal`` and ``-shm`` files out of the way. Never deletes.

    The new name is ``<name>.damaged-<UTC yyyymmddThhmmssZ>`` in the same directory (ADR 0081).
    The sidecars move first, so a failure never leaves a fresh index beside an old log. An
    ``OSError`` stops at the first rename that fails; each file moved so far is already in
    ``moved``, which the caller owns so it can still report them.
    """
    stamp = datetime.now(UTC).strftime("%Y%m%dT%H%M%SZ")
    for suffix in ("-wal", "-shm", ""):
        source = index.with_name(index.name + suffix)
        if source.exists():
            moved.append(source.rename(source.with_name(f"{source.name}.damaged-{stamp}")))


def reconcile_from_disk(brain: Brain) -> ReconcileStats:
    """Empty the derivable tables and rebuild them from the tree. One transaction.

    Runtime state — sessions, and later the approval and ledger tables — is untouched: it was
    never on disk, so a rebuild has nothing to say about it.
    """
    stats = ReconcileStats()
    with brain.write_txn() as con:
        for table in INDEX_TABLES:
            con.execute(f"DELETE FROM {table}")
        for entry in _walk(brain, stats.skipped):
            if entry.kind in ("fact", "procedural") and not isinstance(
                entry.meta.get("sources"), list
            ):
                stats.unsourced.append(entry.rel)
            _index_entry(brain, con, entry)
            stats.files += 1
            stats.by_kind[entry.kind] = stats.by_kind.get(entry.kind, 0) + 1
    return stats


@dataclass(frozen=True)
class _Entry:
    """One file as the rebuild reads it: the id it claims and everything ``index_file`` needs."""

    node_id: str
    kind: str
    rel: str
    file_text: str
    body: str
    meta: dict[str, Any]
    confidence: float


def _read(brain: Brain, path: Path, kind: str, skipped: list[str]) -> _Entry | None:
    """Parse one file by the rebuild's rules, or name why it is skipped and return ``None``."""
    rel = path.relative_to(brain.root).as_posix()
    try:
        file_text = path.read_text(encoding="utf-8")
    except OSError as exc:
        skipped.append(f"{rel}: unreadable ({exc.strerror or exc})")
        return None
    except UnicodeDecodeError:
        skipped.append(f"{rel}: not UTF-8")
        return None
    meta, body = frontmatter.parse(file_text)
    node_id = str(meta.get("id") or "")
    if not node_id:
        skipped.append(f"{rel}: no id in frontmatter")
        return None
    confidence = DEFAULT_CONFIDENCE
    if kind in ("fact", "procedural"):
        checked = confidence_of(meta)
        if checked is None:
            # Refused before any insert, so the file leaves no row behind.
            skipped.append(f"{rel}: confidence {_show(meta.get('confidence'))} is not a number")
            return None
        confidence = checked
    return _Entry(node_id, kind, rel, file_text, body, meta, confidence)


@dataclass
class _Budget:
    """How many more files a walk may read; ``hit`` once it stopped short of the tree's end."""

    left: int
    hit: bool = False


def _walk(
    brain: Brain,
    skipped: list[str],
    duplicates: list[str] | None = None,
    budget: _Budget | None = None,
) -> Iterator[_Entry]:
    """Every indexable file in ``WALK`` order, first claim of an id wins - the rebuild's walk.

    A brain is portable by copying, so two files can claim one id - a restored backup, a merge
    of two trees, an injected frontmatter key. INSERT OR REPLACE would let the later file
    silently displace the earlier and report a clean rebuild that had lost a memory, so the later
    one is named in ``skipped`` (and its path in ``duplicates`` when the caller asks).
    """
    seen: set[str] = set()
    for subdir, kind in WALK:
        base = brain.root / subdir
        if not base.is_dir():
            continue
        for path in sorted(base.rglob("*.md")):
            if budget is not None:
                if budget.left <= 0:
                    budget.hit = True
                    return
                budget.left -= 1
            entry = _read(brain, path, kind, skipped)
            if entry is None:
                continue
            if entry.node_id in seen:
                skipped.append(f"{entry.rel}: duplicate id {entry.node_id}")
                if duplicates is not None:
                    duplicates.append(entry.rel)
                continue
            seen.add(entry.node_id)
            yield entry


def _index_entry(brain: Brain, con: sqlite3.Connection, entry: _Entry) -> None:
    index_file(
        brain,
        con,
        entry.node_id,
        entry.kind,
        entry.rel,
        entry.file_text,
        entry.body,
        entry.meta,
        entry.confidence,
    )


def confidence_of(meta: dict[str, Any]) -> float | None:
    """The file's confidence: the default when absent, ``None`` when present but not a number.

    Only finiteness is asked. The writers make no range check, so a rebuild must not make one.
    An integer too large for a float (``1`` and 400 zeros) is not a number either: ``float``
    raises OverflowError on it, which would have aborted the whole rebuild.
    """
    if "confidence" not in meta:
        return DEFAULT_CONFIDENCE
    value = meta["confidence"]
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return None
    try:
        number = float(value)
    except OverflowError:
        return None
    return number if math.isfinite(number) else None


def _show(value: Any) -> str:
    if isinstance(value, bool):
        return "true" if value else "false"
    return str(value)


def index_file(
    brain: Brain,
    con: sqlite3.Connection,
    node_id: str,
    kind: str,
    rel: str,
    file_text: str,
    body: str,
    meta: dict[str, Any],
    confidence: float,
) -> None:
    """Index one parsed file in ``con``: the rebuild's per-file step, and the only one.

    Public because :meth:`Brain.receive_file <athena.core.brain.store.Brain.receive_file>` indexes a
    memory another device wrote with it (ADR 0140): one insert path, so a rebuild over a merged
    tree cannot disagree with the rows replication wrote. The ``device:`` stamp is not read here;
    it is a disk-only key. The ``space:`` stamp is (ADR 0225): it becomes ``companion_node.space``,
    so a rebuild restores the wall exactly as the writers drew it, and a stamp that is not a space
    id reads as one no space can be (fail closed).
    """
    body = body.strip()
    created_at = str(meta.get("created") or "")
    session_id = meta.get("session")
    role = str(meta.get("role") or "")
    machine = kind == "episode" and text.is_machine(body)
    importance = MACHINE_IMPORTANCE if machine else DEFAULT_IMPORTANCE
    if kind == "fact" and meta.get(EVERY_TURN_KEY) is True:
        # Only the literal ``true`` a writer emits; any other value is the default, as it was.
        importance = ALWAYS_IMPORTANCE
    if kind in SUPERSEDABLE_KINDS and meta.get(RETIRED_KEY) is True:
        # The marker a "forget" leaves is hidden from the start, here as at its write (ADR 0143).
        importance = 0
    tags = [f"role:{role}"] if role else []
    fts_tags = f"session:{session_id} role:{role}" if kind == "episode" else None
    brain.index_node(
        con,
        node_id=node_id,
        kind=kind,
        rel=rel,
        file_text=file_text,
        body=body,
        importance=importance,
        created_at=created_at,
        session_id=None if session_id is None else str(session_id),
        machine=machine,
        tags=tags,
        fts_tags=fts_tags,
        space=space_of(meta),
    )
    if kind == "fact":
        con.execute(
            """INSERT OR REPLACE INTO companion_fact (id, scope, fact_key, confidence)
               VALUES (?, ?, ?, ?)""",
            (
                node_id,
                str(meta.get("scope") or "user"),
                str(meta.get("key") or node_id),
                confidence,
            ),
        )
    elif kind == "procedural":
        con.execute(
            """INSERT OR REPLACE INTO companion_procedural
               (id, scope, trigger_pattern, confidence) VALUES (?, ?, ?, ?)""",
            (
                node_id,
                str(meta.get("scope") or "chat"),
                str(meta.get("trigger") or ""),
                confidence,
            ),
        )
    sources = meta.get("sources")
    if isinstance(sources, list):
        # The provenance written back is what the file claims. A rebuild is not the place to
        # re-run the write gate: refusing a fact here because an episode was demoted would
        # delete evidence that is still on disk, which is the opposite of a rebuild.
        brain.index_provenance(con, node_id, [str(s) for s in sources], created_at)
    closes = meta.get(SUPERSEDES_KEY)
    if kind in SUPERSEDABLE_KINDS and isinstance(closes, list):
        # What the file says it closes, as written: like provenance, a rebuild trusts the disk.
        brain.index_supersedes(con, node_id, [str(old) for old in closes])


def index_fingerprint(brain: Brain) -> list[tuple[Any, ...]]:
    """A stable projection of the derivable index — what the rebuild test compares.

    Reads through :meth:`Brain.read_connection`, so the fingerprint is taken the way every other
    reader takes one: consistent as of the last completed write.
    """
    rows: list[tuple[Any, ...]] = []
    con = brain.read_connection()
    try:
        rows.extend(
            tuple(row)
            for row in con.execute(
                """SELECT id, kind, file_path, content_hash, importance, body_excerpt,
                          tags_json, machine, session_id, created_at, updated_at, space
                   FROM companion_node ORDER BY id"""
            )
        )
        rows.extend(
            ("provenance", *row)
            for row in con.execute(
                "SELECT node_id, source_id FROM companion_provenance ORDER BY node_id, source_id"
            )
        )
        rows.extend(
            ("fact", *row)
            for row in con.execute(
                "SELECT id, scope, fact_key, confidence FROM companion_fact ORDER BY id"
            )
        )
        rows.extend(
            ("procedural", *row)
            for row in con.execute(
                """SELECT id, scope, trigger_pattern, confidence
                   FROM companion_procedural ORDER BY id"""
            )
        )
        rows.extend(
            ("supersede", *row)
            for row in con.execute(
                """SELECT node_id, superseded_id FROM companion_supersede
                   ORDER BY node_id, superseded_id"""
            )
        )
        rows.extend(
            ("fts", *row)
            for row in con.execute("SELECT node_id, body, tags FROM companion_fts ORDER BY node_id")
        )
    finally:
        con.close()
    return rows


def missing_files(brain: Brain) -> list[str]:
    """Indexed rows whose markdown is gone — the doctor's index-consistency stage."""
    out: list[str] = []
    con = brain.read_connection()
    try:
        for node_id, rel in con.execute(
            "SELECT id, file_path FROM companion_node ORDER BY id"
        ).fetchall():
            if not (brain.root / str(rel)).exists():
                out.append(str(node_id))
    finally:
        con.close()
    return out


# -- drift: disk against index, both directions and by content ------------------------------------

#: Files a drift walk reads before it stops and says "not computed" instead of a number. Far above
#: any brain a person keeps; it exists so the doctor never hangs on a tree somebody pointed it at.
DRIFT_FILE_BUDGET = 100_000

#: The column that names a memory in each table the disk owns. Checked against ``INDEX_TABLES``
#: at import, so a new derivable table cannot be added without saying how a repair clears it.
_ROW_KEYS: dict[str, str] = {
    "companion_node": "id",
    "companion_fts": "node_id",
    "companion_provenance": "node_id",
    "companion_fact": "id",
    "companion_procedural": "id",
    "companion_supersede": "node_id",
}
if set(_ROW_KEYS) != set(INDEX_TABLES):  # pragma: no cover - a schema change without this table
    raise RuntimeError(f"reconcile._ROW_KEYS {sorted(_ROW_KEYS)} != INDEX_TABLES")


@dataclass
class Drift:
    """Where the index and the tree disagree, by class (ADR 0003: disk is truth).

    ``unindexed`` and ``duplicates`` are paths (a file the index never saw has no row to name);
    ``edited``, ``moved`` and ``orphaned`` are ids. ``None`` is "not computed": a walk that ran
    out of budget cannot say a file is absent or unchanged, so it says nothing rather than zero.
    ``skipped`` is what the rebuild would skip too; it is reported, not drift a repair can fix.
    """

    unindexed: list[str] | None
    edited: list[str] | None
    moved: list[str] | None
    orphaned: list[str]
    duplicates: list[str] | None
    skipped: list[str] = field(default_factory=list)
    budget_hit: bool = False
    files: int = 0
    #: Each path a repair re-indexes, and the kind its directory yields.
    reindex: dict[str, str] = field(default_factory=dict, repr=False)

    @property
    def clean(self) -> bool:
        """No drift in any class, and every class computed: "not computed" is never clean."""
        if self.budget_hit:
            return False
        classes = (self.unindexed, self.edited, self.moved, self.orphaned, self.duplicates)
        return all(found is not None and not found for found in classes)

    def as_dict(self) -> dict[str, Any]:
        def copy(found: list[str] | None) -> list[str] | None:
            return None if found is None else list(found)

        return {
            "clean": self.clean,
            "unindexed": copy(self.unindexed),
            "edited": copy(self.edited),
            "moved": copy(self.moved),
            "orphaned": list(self.orphaned),
            "duplicates": copy(self.duplicates),
            "skipped": list(self.skipped),
            "budget_hit": self.budget_hit,
            "files": self.files,
        }

    def sentences(self) -> list[str]:
        """One sentence per drift class present, for a person reading the doctor."""

        def count(found: list[str] | None, one: str, many: str) -> list[str]:
            if not found:
                return []
            return [one if len(found) == 1 else many.format(n=len(found))]

        out: list[str] = []
        if self.budget_hit:
            out.append(f"drift not computed: the walk stopped after {self.files} files")
        out += count(
            self.unindexed,
            "1 memory on disk is not indexed",
            "{n} memories on disk are not indexed",
        )
        out += count(
            self.edited,
            "1 memory was edited on disk since it was indexed",
            "{n} memories were edited on disk since they were indexed",
        )
        out += count(self.moved, "1 memory moved on disk", "{n} memories moved on disk")
        out += count(self.orphaned, "1 indexed row has no file", "{n} indexed rows have no file")
        out += count(
            self.duplicates,
            "1 file claims an id another file holds",
            "{n} files claim ids other files hold",
        )
        return out


def drift(brain: Brain, *, max_files: int = DRIFT_FILE_BUDGET) -> Drift:
    """Compare the tree to the index without writing: the preview of a repair.

    The walk is the rebuild's own (:func:`_walk`), so a file is drift exactly when the rebuild
    would index it differently: absent from the index (``unindexed``), at another path
    (``moved``), with a ``content_hash`` that is not the sha256 of the text as read (``edited``),
    or an indexed id no file claims (``orphaned``). The index is read once.
    """
    con = brain.read_connection()
    try:
        indexed = {
            str(node_id): (str(rel), str(content_hash))
            for node_id, rel, content_hash in con.execute(
                "SELECT id, file_path, content_hash FROM companion_node"
            )
        }
    finally:
        con.close()
    skipped: list[str] = []
    duplicates: list[str] = []
    budget = _Budget(max_files)
    on_disk = {entry.node_id: entry for entry in _walk(brain, skipped, duplicates, budget)}
    files = max_files - budget.left
    if budget.hit:
        # Absence and sameness need the whole tree; a gone file at its indexed path does not.
        orphaned = sorted(
            node_id for node_id, (rel, _) in indexed.items() if not (brain.root / rel).exists()
        )
        return Drift(None, None, None, orphaned, None, skipped, budget_hit=True, files=files)
    unindexed: list[str] = []
    edited: list[str] = []
    moved: list[str] = []
    reindex: dict[str, str] = {}
    for node_id, entry in on_disk.items():
        row = indexed.get(node_id)
        if row is None:
            unindexed.append(entry.rel)
        elif row[0] != entry.rel:
            moved.append(node_id)
        elif row[1] != sha256(entry.file_text):
            edited.append(node_id)
        else:
            continue
        reindex[entry.rel] = entry.kind
    orphaned = sorted(node_id for node_id in indexed if node_id not in on_disk)
    return Drift(
        sorted(unindexed),
        sorted(edited),
        sorted(moved),
        orphaned,
        duplicates,
        skipped,
        files=files,
        reindex=reindex,
    )


@dataclass
class Repaired:
    """What a targeted repair touched: paths it indexed, ids it dropped, files it could not read."""

    indexed: list[str] = field(default_factory=list)
    dropped: list[str] = field(default_factory=list)
    skipped: list[str] = field(default_factory=list)

    def as_dict(self) -> dict[str, Any]:
        return {
            "indexed": list(self.indexed),
            "dropped": list(self.dropped),
            "skipped": list(self.skipped),
        }


def repair(brain: Brain, found: Drift) -> Repaired:
    """Apply ``found`` and nothing else, in one writer transaction.

    An orphaned id loses its rows in every ``INDEX_TABLES`` table; an unindexed, moved or edited
    file is re-read and indexed through :func:`index_file`, the rebuild's per-file step, after its
    sidecar rows are cleared (its node row is upserted, so it keeps its rowid). Every memory not
    in the drift keeps its rows as they are - including index-only columns such as a demotion,
    which a full rebuild resets. A drift that was not computed is refused: repairing half a
    picture would call the rest clean. Duplicates are left for a person, as the rebuild leaves
    them.
    """
    if found.budget_hit:
        raise ValueError(
            "the drift was not computed (its walk ran out of budget); nothing repaired"
        )
    done = Repaired()
    with brain.write_txn() as con:
        for node_id in found.orphaned:
            _drop_rows(con, node_id, keep_node=False)
            done.dropped.append(node_id)
        for rel, kind in sorted(found.reindex.items()):
            entry = _read(brain, brain.root / rel, kind, done.skipped)
            if entry is None:
                continue
            _drop_rows(con, entry.node_id, keep_node=True)
            _index_entry(brain, con, entry)
            done.indexed.append(rel)
    return done


def _drop_rows(con: sqlite3.Connection, node_id: str, *, keep_node: bool) -> None:
    """Delete one memory's derivable rows. ``keep_node`` spares its node and FTS rows, which
    :meth:`Brain.index_node` upserts in place, so the memory keeps its rowid (ADR 0077)."""
    if not keep_node:
        for (rowid,) in con.execute(
            "SELECT rowid FROM companion_node WHERE id = ?", (node_id,)
        ).fetchall():
            # By rowid: ``node_id`` is UNINDEXED in the FTS table, so a lookup by it scans.
            con.execute("DELETE FROM companion_fts WHERE rowid = ?", (rowid,))
    for table, column in _ROW_KEYS.items():
        if table == "companion_fts" or (keep_node and table == "companion_node"):
            continue
        con.execute(f"DELETE FROM {table} WHERE {column} = ?", (node_id,))

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
rides every turn: it comes back at ``ALWAYS_IMPORTANCE`` (ADR 0071).
"""

from __future__ import annotations

import math
import sqlite3
from dataclasses import dataclass, field
from typing import Any

from athena.core.brain import frontmatter, text
from athena.core.brain.schema import INDEX_TABLES
from athena.core.brain.store import (
    ALWAYS_IMPORTANCE,
    DEFAULT_CONFIDENCE,
    DEFAULT_IMPORTANCE,
    EVERY_TURN_KEY,
    MACHINE_IMPORTANCE,
    Brain,
)

#: Which directory yields which kind, walked in this order. A directory absent from this table is
#: not indexed, so adding a kind to the tree is a visible change here rather than a silent one.
WALK: tuple[tuple[str, str], ...] = (
    ("episodes", "episode"),
    ("semantic/user", "fact"),
    ("semantic/project", "fact"),
    ("semantic/world", "fact"),
    ("procedurals/chat", "procedural"),
    ("procedurals/action", "procedural"),
    ("procedurals/memory", "procedural"),
    ("procedurals/build", "procedural"),
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


def reconcile_from_disk(brain: Brain) -> ReconcileStats:
    """Empty the derivable tables and rebuild them from the tree. One transaction.

    Runtime state — sessions, and later the approval and ledger tables — is untouched: it was
    never on disk, so a rebuild has nothing to say about it.
    """
    stats = ReconcileStats()
    with brain.write_txn() as con:
        for table in INDEX_TABLES:
            con.execute(f"DELETE FROM {table}")
        seen: set[str] = set()
        for subdir, kind in WALK:
            base = brain.root / subdir
            if not base.is_dir():
                continue
            for path in sorted(base.rglob("*.md")):
                rel = path.relative_to(brain.root).as_posix()
                try:
                    file_text = path.read_text(encoding="utf-8")
                except OSError as exc:
                    stats.skipped.append(f"{rel}: unreadable ({exc.strerror or exc})")
                    continue
                except UnicodeDecodeError:
                    stats.skipped.append(f"{rel}: not UTF-8")
                    continue
                meta, body = frontmatter.parse(file_text)
                node_id = str(meta.get("id") or "")
                if not node_id:
                    stats.skipped.append(f"{rel}: no id in frontmatter")
                    continue
                if node_id in seen:
                    # A brain is portable by copying, so two files can claim one id — a restored
                    # backup, a merge of two trees, an injected frontmatter key. INSERT OR
                    # REPLACE would let the later file silently displace the earlier and report
                    # a clean rebuild that had lost a memory. Name the collision instead.
                    stats.skipped.append(f"{rel}: duplicate id {node_id}")
                    continue
                confidence = DEFAULT_CONFIDENCE
                if kind in ("fact", "procedural"):
                    checked = _confidence(meta)
                    if checked is None:
                        # Refused before any insert, so the file leaves no row behind.
                        stats.skipped.append(
                            f"{rel}: confidence {_show(meta.get('confidence'))} is not a number"
                        )
                        continue
                    confidence = checked
                    if kind == "fact" and not _bindable(meta.get("expires_at")):
                        stats.skipped.append(f"{rel}: expires_at is not a single value")
                        continue
                    if not isinstance(meta.get("sources"), list):
                        stats.unsourced.append(rel)
                seen.add(node_id)
                _index_file(brain, con, node_id, kind, rel, file_text, body, meta, confidence)
                stats.files += 1
                stats.by_kind[kind] = stats.by_kind.get(kind, 0) + 1
    return stats


def _confidence(meta: dict[str, Any]) -> float | None:
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


def _bindable(value: Any) -> bool:
    """Whether ``expires_at`` binds to sqlite: absent, or a str, bool, float or 64-bit int.

    ``frontmatter.parse`` turns a bare ``expires_at:`` line into a list, and an integer past 64
    bits raises OverflowError at the bind. Both are refused before any insert.
    """
    if value is None or isinstance(value, (str, bool, float)):
        return True
    return isinstance(value, int) and -(2**63) <= value < 2**63


def _show(value: Any) -> str:
    if isinstance(value, bool):
        return "true" if value else "false"
    return str(value)


def _index_file(
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
    body = body.strip()
    created_at = str(meta.get("created") or "")
    session_id = meta.get("session")
    role = str(meta.get("role") or "")
    machine = kind == "episode" and text.is_machine(body)
    importance = MACHINE_IMPORTANCE if machine else DEFAULT_IMPORTANCE
    if kind == "fact" and meta.get(EVERY_TURN_KEY) is True:
        # Only the literal ``true`` a writer emits; any other value is the default, as it was.
        importance = ALWAYS_IMPORTANCE
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
    )
    if kind == "fact":
        con.execute(
            """INSERT OR REPLACE INTO companion_fact (id, scope, fact_key, confidence, expires_at)
               VALUES (?, ?, ?, ?, ?)""",
            (
                node_id,
                str(meta.get("scope") or "user"),
                str(meta.get("key") or node_id),
                confidence,
                meta.get("expires_at"),
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
                          tags_json, machine, session_id, created_at, updated_at
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

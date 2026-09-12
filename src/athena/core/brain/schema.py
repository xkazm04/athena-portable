"""The SQLite index over the disk tree (README §2 invariant 1; ref §8 "SQLite tables").

Everything here is derivable from markdown except the tables listed outside
:data:`INDEX_TABLES`, and :func:`athena.core.brain.reconcile.reconcile_from_disk` clears exactly
the derivable ones before a rebuild. FTS5 ships with CPython's bundled SQLite, so the index costs
no dependency (ADR 0002).

Table names keep the Personas ``companion_`` prefix so one brain directory stays legible to both
implementations — see ADR 0003 and ref §8.
"""

from __future__ import annotations

#: Bumped when a statement below changes shape; stored in ``companion_meta`` so a later migration
#: can tell an old index from a new one instead of guessing from the presence of a column.
SCHEMA_VERSION = 1

SCHEMA: tuple[str, ...] = (
    # -- index core: one row per memory, derivable from its file ------------------------------
    """CREATE TABLE IF NOT EXISTS companion_node (
        id TEXT PRIMARY KEY,
        kind TEXT NOT NULL,
        session_id TEXT,
        file_path TEXT NOT NULL,
        content_hash TEXT NOT NULL,
        importance INTEGER NOT NULL DEFAULT 3,
        body_excerpt TEXT NOT NULL DEFAULT '',
        tags_json TEXT NOT NULL DEFAULT '[]',
        machine INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
    )""",
    "CREATE INDEX IF NOT EXISTS idx_node_kind ON companion_node(kind, importance)",
    "CREATE INDEX IF NOT EXISTS idx_node_created ON companion_node(created_at)",
    # ``node_id`` is UNINDEXED: it is a join key, not something anyone searches for, and
    # indexing it would let a query match a memory by its own id.
    """CREATE VIRTUAL TABLE IF NOT EXISTS companion_fts
       USING fts5(node_id UNINDEXED, body, tags)""",
    # -- provenance: which episodes a distilled memory cites (README §2 invariant 2) -----------
    """CREATE TABLE IF NOT EXISTS companion_provenance (
        node_id TEXT NOT NULL,
        source_id TEXT NOT NULL,
        created_at TEXT NOT NULL,
        PRIMARY KEY (node_id, source_id)
    )""",
    # -- typed sidecars: the per-kind columns a query needs and the body cannot answer ---------
    """CREATE TABLE IF NOT EXISTS companion_fact (
        id TEXT PRIMARY KEY,
        scope TEXT NOT NULL,
        fact_key TEXT NOT NULL,
        confidence REAL NOT NULL DEFAULT 0.7,
        expires_at TEXT
    )""",
    "CREATE INDEX IF NOT EXISTS idx_fact_scope ON companion_fact(scope, fact_key)",
    """CREATE TABLE IF NOT EXISTS companion_procedural (
        id TEXT PRIMARY KEY,
        scope TEXT NOT NULL,
        trigger_pattern TEXT NOT NULL,
        confidence REAL NOT NULL DEFAULT 0.7
    )""",
    # -- runtime state: not derivable from disk, never cleared by a reconcile ------------------
    """CREATE TABLE IF NOT EXISTS companion_session (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL DEFAULT 'active',
        origin TEXT NOT NULL DEFAULT 'panel',
        created_at TEXT NOT NULL,
        last_active_at TEXT NOT NULL
    )""",
    """CREATE TABLE IF NOT EXISTS companion_meta (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
    )""",
)

#: The tables the disk tree owns. A reconcile empties exactly these and rebuilds them from the
#: markdown; anything not named here is runtime state and survives (README §2 invariant 1).
INDEX_TABLES: tuple[str, ...] = (
    "companion_node",
    "companion_fts",
    "companion_provenance",
    "companion_fact",
    "companion_procedural",
)

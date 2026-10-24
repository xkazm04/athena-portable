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
#: Version 2 keys each ``companion_fts`` row by its node's rowid (ADR 0077); an index stamped 1, or
#: not stamped, is re-keyed when a :class:`~athena.core.brain.store.Brain` opens it.
SCHEMA_VERSION = 2

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
    # indexing it would let a query match a memory by its own id. A row is found for a write by
    # its rowid, which is its node's rowid in ``companion_node`` (ADR 0077): a lookup by an
    # UNINDEXED column scans the whole index.
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
    # expires_at stays for the Personas layout; athena-portable never writes it (ADR 0003, amended).
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
    # -- supersedence: which memory closes which (ADR 0143) -----------------------------------
    # Derivable: a fact or procedural whose file says ``supersedes: [ids]`` is one row per id, and
    # a rebuild writes them back from the frontmatter. Recall serves the successor and never the
    # memory it closed; the closed one stays on disk and in the index, so its lineage is kept.
    """CREATE TABLE IF NOT EXISTS companion_supersede (
        node_id TEXT NOT NULL,
        superseded_id TEXT NOT NULL,
        PRIMARY KEY (node_id, superseded_id)
    )""",
    "CREATE INDEX IF NOT EXISTS idx_supersede_old ON companion_supersede(superseded_id)",
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
    # The sleep cycle's record (ADR 0143). A row is written ``running`` when a pass starts and
    # settles ``completed``, ``partial`` or ``failed``; a row left ``running`` is a pass the
    # process died inside, kept as the only evidence of the crash. Admission never keys on it.
    # ``boundary`` is where the pass's window began and ``consumed_through`` where its reading
    # ended, so the next pass starts from the newest settled ``consumed_through`` (drain forward).
    """CREATE TABLE IF NOT EXISTS companion_cycle (
        id TEXT PRIMARY KEY,
        started_at TEXT NOT NULL,
        finished_at TEXT,
        status TEXT NOT NULL,
        reason TEXT,
        boundary TEXT,
        consumed_through TEXT,
        stats_json TEXT NOT NULL DEFAULT '{}'
    )""",
    "CREATE INDEX IF NOT EXISTS idx_cycle_status ON companion_cycle(status, finished_at)",
    # What a pass offers a person rather than deciding: forgetting, and a contradiction.
    """CREATE TABLE IF NOT EXISTS companion_proposal (
        id TEXT PRIMARY KEY,
        cycle_id TEXT NOT NULL,
        kind TEXT NOT NULL,
        node_ids_json TEXT NOT NULL,
        summary TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'open',
        created_at TEXT NOT NULL,
        decided_at TEXT
    )""",
    "CREATE INDEX IF NOT EXISTS idx_proposal_status ON companion_proposal(status, created_at)",
    # When recall last showed a distilled memory, and how often: what keeps it from fading.
    """CREATE TABLE IF NOT EXISTS companion_recall_seen (
        node_id TEXT PRIMARY KEY,
        last_at TEXT NOT NULL,
        hits INTEGER NOT NULL DEFAULT 0
    )""",
    # How far an unused memory has faded (0..3 steps). Recall ranks by importance minus steps and
    # never hides by it; a recall hit deletes the row.
    """CREATE TABLE IF NOT EXISTS companion_fade (
        node_id TEXT PRIMARY KEY,
        steps INTEGER NOT NULL DEFAULT 0,
        at TEXT NOT NULL
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
    "companion_supersede",
)

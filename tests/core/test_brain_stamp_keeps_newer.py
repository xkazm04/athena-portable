"""Opening a brain index never lowers a schema_version stamp a newer build wrote."""

from __future__ import annotations

import sqlite3
from contextlib import closing
from pathlib import Path

from athena.core.brain import Brain
from athena.core.brain.schema import SCHEMA_VERSION


def _stamp(db_path: Path) -> str:
    with closing(sqlite3.connect(str(db_path))) as con:
        row = con.execute(
            "SELECT value FROM companion_meta WHERE key = 'schema_version'"
        ).fetchone()
    return str(row[0])


def test_a_higher_stamp_survives_a_reopen(tmp_path: Path) -> None:
    with Brain(tmp_path) as brain:
        db_path = brain.db_path
        with brain.write_txn():
            brain.writer.execute(
                "INSERT OR REPLACE INTO companion_meta (key, value) VALUES ('schema_version', '99')"
            )
    assert _stamp(db_path) == "99"

    with Brain(tmp_path):
        pass

    assert _stamp(db_path) == "99"


def test_a_fresh_index_is_stamped_with_the_current_version(tmp_path: Path) -> None:
    with Brain(tmp_path) as brain:
        db_path = brain.db_path
    assert _stamp(db_path) == str(SCHEMA_VERSION)

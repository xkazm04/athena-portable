"""A brain is portable by copying the directory (README §2 invariant 1, ADR 0003).

The load-bearing test is the first one: copy the markdown tree, leave the index behind, rebuild,
and the row sets are identical. If that ever fails, "SQLite is a rebuildable index" is a claim and
not a fact, and the brain has silently become the database.
"""

from __future__ import annotations

import argparse
import json
import shutil
from pathlib import Path

import pytest

from athena.cli import cmd_reconcile
from athena.core.brain import Brain, index_fingerprint, reconcile_from_disk
from athena.core.brain.store import (
    DEFAULT_CONFIDENCE,
    DEFAULT_IMPORTANCE,
    FACT_SCOPES,
    PROCEDURAL_SCOPES,
    sha256,
)
from athena.core.recall import ALWAYS_BLOCK, recall


def _populate(brain: Brain) -> None:
    first = brain.append_episode("Acme paid 34 days late again", role="user")
    second = brain.append_episode("I will chase them on Monday", role="assistant")
    brain.append_episode("fleet-event worker 3 restarted", role="system")
    brain.write_fact(
        "acme pays late",
        "Acme has paid late three quarters running",
        scope="user",
        sources=[first.id],
    )
    brain.write_fact(
        "invoicing app is Fakturoid",
        "the invoices live in the invoicing app, not the CRM",
        scope="world",
        sources=[first.id, second.id],
    )
    brain.write_procedural(
        "when a payment is proposed",
        "always raise a card; never auto-approve",
        scope="action",
        sources=[second.id],
    )


def _copy_tree_without_the_index(source: Path, target: Path) -> None:
    shutil.copytree(source, target, ignore=shutil.ignore_patterns("index.sqlite*"))


def test_a_copied_brain_rebuilds_an_identical_index(tmp_path: Path) -> None:
    original = tmp_path / "brain"
    with Brain(original) as brain:
        _populate(brain)
        expected = index_fingerprint(brain)

    copied = tmp_path / "copied-brain"
    _copy_tree_without_the_index(original, copied)
    assert not (copied / "index.sqlite").exists()

    with Brain(copied) as rebuilt:
        assert index_fingerprint(rebuilt) == [], "a copied tree starts with no index"

        stats = reconcile_from_disk(rebuilt)

        assert stats.files == 6
        assert stats.by_kind == {"episode": 3, "fact": 2, "procedural": 1}
        assert stats.skipped == []
        actual = index_fingerprint(rebuilt)

    assert set(actual) == set(expected)
    assert actual == expected


def test_reconciling_twice_is_idempotent(tmp_path: Path) -> None:
    with Brain(tmp_path / "brain") as brain:
        _populate(brain)
        once = reconcile_from_disk(brain)
        first = index_fingerprint(brain)
        twice = reconcile_from_disk(brain)

        assert once.as_dict() == twice.as_dict()
        assert index_fingerprint(brain) == first


def test_a_reconcile_drops_the_row_of_a_file_that_is_gone(tmp_path: Path) -> None:
    with Brain(tmp_path / "brain") as brain:
        _populate(brain)
        doomed = brain.append_episode("this file will be deleted by hand", role="user")
        (brain.root / doomed.path).unlink()

        reconcile_from_disk(brain)

        assert brain.node(doomed.id) is None


def test_a_file_with_no_id_and_a_duplicate_id_are_named_not_swallowed(tmp_path: Path) -> None:
    with Brain(tmp_path / "brain") as brain:
        episode = brain.append_episode("the only real memory", role="user")
        (brain.root / "goals" / "headless.md").write_text(
            "no frontmatter at all\n", encoding="utf-8", newline="\n"
        )
        twin = brain.root / "reflections" / "twin.md"
        twin.write_text(
            (brain.root / episode.path).read_text(encoding="utf-8"), encoding="utf-8", newline="\n"
        )

        stats = reconcile_from_disk(brain)

        assert stats.files == 1
        assert "goals/headless.md: no id in frontmatter" in stats.skipped
        assert f"reflections/twin.md: duplicate id {episode.id}" in stats.skipped
        # The original file kept its row; the twin did not displace it.
        node = brain.node(episode.id)
        assert node is not None and node.file_path == episode.path


def test_a_reconcile_leaves_runtime_state_alone(tmp_path: Path) -> None:
    with Brain(tmp_path / "brain", session_id="sess-42") as brain:
        _populate(brain)

        reconcile_from_disk(brain)

        row = brain.writer.execute(
            "SELECT id FROM companion_session WHERE id = ?", ("sess-42",)
        ).fetchone()
        assert row == ("sess-42",)


def _tables_holding(brain: Brain, node_id: str) -> list[str]:
    found: list[str] = []
    for table, column in (
        ("companion_node", "id"),
        ("companion_fts", "node_id"),
        ("companion_provenance", "node_id"),
        ("companion_fact", "id"),
        ("companion_procedural", "id"),
    ):
        row = brain.writer.execute(
            f"SELECT 1 FROM {table} WHERE {column} = ?",
            (node_id,),
        ).fetchone()
        if row is not None:
            found.append(table)
    return found


def _rewrite(brain: Brain, rel: str, drop_prefixes: tuple[str, ...], add: str = "") -> None:
    """Edit a file's frontmatter by hand, the way a person would."""
    path = brain.root / rel
    kept = [
        line
        for line in path.read_text(encoding="utf-8").splitlines()
        if not line.startswith(drop_prefixes)
    ]
    if add:
        kept.insert(1, add)
    path.write_text("\n".join(kept) + "\n", encoding="utf-8", newline="\n")


@pytest.mark.parametrize("bad", ['"high"', "true", "false", "nan", "inf", "-inf"])
@pytest.mark.parametrize("kind", ["fact", "procedural"])
def test_a_confidence_that_is_not_a_number_is_named_and_the_rebuild_goes_on(
    tmp_path: Path, kind: str, bad: str
) -> None:
    with Brain(tmp_path / "brain") as brain:
        _populate(brain)
        source = brain.append_episode("evidence", role="user")
        if kind == "fact":
            victim = brain.write_fact("bad one", "text", scope="user", sources=[source.id])
        else:
            victim = brain.write_procedural("bad one", "text", scope="chat", sources=[source.id])
        _rewrite(brain, victim.path, ("confidence:",), f"confidence: {bad}")

        stats = reconcile_from_disk(brain)

        shown = bad.strip('"')
        assert f"{victim.path}: confidence {shown} is not a number" in stats.skipped
        assert len(stats.skipped) == 1
        assert stats.files == 7
        assert _tables_holding(brain, victim.id) == []


def test_a_quoted_confidence_is_skipped_by_name_and_the_rebuild_goes_on(tmp_path: Path) -> None:
    """ADR 0084: a quoted number is text, so a hand-edited ``"0.9"`` is never read as 0.9."""
    with Brain(tmp_path / "brain") as brain:
        _populate(brain)
        source = brain.append_episode("evidence", role="user")
        victim = brain.write_fact("bad one", "text", scope="user", sources=[source.id])
        _rewrite(brain, victim.path, ("confidence:",), 'confidence: "0.9"')

        stats = reconcile_from_disk(brain)

        assert f"{victim.path}: confidence 0.9 is not a number" in stats.skipped
        assert len(stats.skipped) == 1
        assert stats.files == 7
        assert _tables_holding(brain, victim.id) == []


def test_a_confidence_too_large_for_a_float_is_named_and_the_rebuild_goes_on(
    tmp_path: Path,
) -> None:
    """float() raises OverflowError past about 309 digits; that is one file, not the rebuild."""
    huge = "1" + "0" * 400
    with Brain(tmp_path / "brain") as brain:
        _populate(brain)
        source = brain.append_episode("evidence", role="user")
        victim = brain.write_fact("huge one", "text", scope="user", sources=[source.id])
        _rewrite(brain, victim.path, ("confidence:",), f"confidence: {huge}")

        stats = reconcile_from_disk(brain)

        assert stats.skipped == [f"{victim.path}: confidence {huge} is not a number"]
        assert stats.files == 7
        assert _tables_holding(brain, victim.id) == []


def test_a_confidence_of_zero_is_kept_and_an_absent_one_gets_the_default(tmp_path: Path) -> None:
    with Brain(tmp_path / "brain") as brain:
        source = brain.append_episode("evidence", role="user")
        zero = brain.write_fact("zero", "text", scope="user", sources=[source.id])
        absent = brain.write_fact("absent", "other text", scope="user", sources=[source.id])
        _rewrite(brain, zero.path, ("confidence:",), "confidence: 0")
        _rewrite(brain, absent.path, ("confidence:",))

        stats = reconcile_from_disk(brain)

        assert stats.skipped == []
        got = dict(brain.writer.execute("SELECT id, confidence FROM companion_fact").fetchall())
        assert got[zero.id] == 0.0
        assert got[absent.id] == DEFAULT_CONFIDENCE


def test_a_fact_with_no_sources_is_indexed_and_named(tmp_path: Path) -> None:
    with Brain(tmp_path / "brain") as brain:
        _populate(brain)
        source = brain.append_episode("evidence", role="user")
        bare = brain.write_fact("bare", "text", scope="user", sources=[source.id])
        _rewrite(brain, bare.path, ("sources:", "  - "))

        stats = reconcile_from_disk(brain)

        assert stats.skipped == []
        assert stats.unsourced == [bare.path]
        assert stats.as_dict()["unsourced"] == [bare.path]
        assert "1 without sources" in stats.summary()
        assert brain.node(bare.id) is not None


def test_cmd_reconcile_reports_a_bad_file_and_still_exits_zero(
    tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    with Brain(tmp_path / "brain") as brain:
        _populate(brain)
        source = brain.append_episode("evidence", role="user")
        victim = brain.write_fact("bad one", "text", scope="user", sources=[source.id])
        _rewrite(brain, victim.path, ("confidence:",), "confidence: high")

    code = cmd_reconcile(argparse.Namespace(brain=tmp_path / "brain"))

    out = json.loads(capsys.readouterr().out)
    assert code == 0
    assert out["ok"] is False
    assert f"{victim.path}: confidence high is not a number" in out["skipped"]


def test_a_file_that_is_not_utf8_is_named_and_the_rest_are_indexed(tmp_path: Path) -> None:
    with Brain(tmp_path / "brain") as brain:
        _populate(brain)
        bad = brain.root / "semantic" / "user" / "latin1.md"
        bad.write_bytes(b'---\nid: "fact_bad"\n---\n\ncaf\xe9 \xff\xfe\n')

        stats = reconcile_from_disk(brain)

        assert stats.skipped == ["semantic/user/latin1.md: not UTF-8"]
        assert stats.files == 6
        assert _tables_holding(brain, "fact_bad") == []


@pytest.mark.parametrize(
    "line",
    [
        "expires_at:",
        'expires_at:\n  - "a"\n  - "b"',
        "expires_at: 99999999999999999999",
        'expires_at: "2027-01-31"',
    ],
)
def test_a_fact_file_with_an_expires_at_line_is_indexed_and_the_key_is_ignored(
    tmp_path: Path, line: str
) -> None:
    with Brain(tmp_path / "brain") as brain:
        _populate(brain)
        source = brain.append_episode("evidence", role="user")
        fact = brain.write_fact("dated", "text", scope="user", sources=[source.id])
        path = brain.root / fact.path
        text = path.read_text(encoding="utf-8").replace("\n---\n", f"\n{line}\n---\n", 1)
        path.write_text(text, encoding="utf-8", newline="\n")

        stats = reconcile_from_disk(brain)

        assert stats.skipped == []
        assert stats.files == 8
        assert _tables_holding(brain, fact.id) != []
        row = brain.writer.execute(
            "SELECT expires_at FROM companion_fact WHERE id = ?", (fact.id,)
        ).fetchone()
        assert row == (None,)


def test_cmd_reconcile_names_a_non_utf8_file_and_still_exits_zero(
    tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    with Brain(tmp_path / "brain") as brain:
        _populate(brain)
        raw = brain.root / "semantic" / "world" / "raw.md"
        raw.write_bytes(b"---\nid: x\n---\n\n\xff\n")

    code = cmd_reconcile(argparse.Namespace(brain=tmp_path / "brain"))

    out = json.loads(capsys.readouterr().out)
    assert code == 0
    assert out["ok"] is False
    assert "semantic/world/raw.md: not UTF-8" in out["skipped"]


# -- the always tier survives a rebuild (ADR 0071) ---------------------------------------------

#: A fact file exactly as a writer before ADR 0071 rendered it: seven keys, no ``every_turn``.
TODAYS_FACT = (
    "---\n"
    'id: "fact_0a1b2c3d"\n'
    "type: fact\n"
    'scope: "user"\n'
    'key: "acme pays late"\n'
    "confidence: 0.7\n"
    'created: "2026-09-01T09:00:00+00:00"\n'
    "sources:\n"
    '  - "ep_0a1b2c3d"\n'
    "---\n"
    "\n"
    "Acme has paid late three quarters running\n"
)


def _always_ids(brain: Brain) -> set[str]:
    return {memory.id for memory in recall(brain, "helicopter").block(ALWAYS_BLOCK).items}


def test_a_copied_brain_with_an_every_turn_fact_rebuilds_an_identical_index(
    tmp_path: Path,
) -> None:
    original = tmp_path / "brain"
    with Brain(original) as brain:
        _populate(brain)
        source = brain.append_episode("Northwind paid 40 days late", role="user")
        always = brain.write_fact(
            "northwind pays late",
            "Northwind pays about forty days late; chase on day 30",
            sources=[source.id],
            every_turn=True,
        )
        expected = index_fingerprint(brain)
        assert _always_ids(brain) == {always.id}

    copied = tmp_path / "copied-brain"
    _copy_tree_without_the_index(original, copied)

    with Brain(copied) as rebuilt:
        stats = reconcile_from_disk(rebuilt)

        assert stats.skipped == []
        assert index_fingerprint(rebuilt) == expected
        assert rebuilt.node(always.id) is not None
        assert _always_ids(rebuilt) == {always.id}, "the always tier survives a machine move"


def test_a_fact_written_without_every_turn_is_not_always_before_or_after_a_rebuild(
    tmp_path: Path,
) -> None:
    with Brain(tmp_path / "brain") as brain:
        source = brain.append_episode("Acme paid 34 days late", role="user")
        fact = brain.write_fact("acme pays late", "Acme pays late", sources=[source.id])
        assert "every_turn" not in (brain.root / fact.path).read_text(encoding="utf-8")
        assert _always_ids(brain) == set()

        reconcile_from_disk(brain)

        assert _always_ids(brain) == set()
        node = brain.node(fact.id)
        assert node is not None
        assert node.importance == DEFAULT_IMPORTANCE


def test_a_fact_file_in_todays_frontmatter_rebuilds_to_the_rows_it_always_did(
    tmp_path: Path,
) -> None:
    """ADR 0003's promise, held by ADR 0071: a file with no ``every_turn`` is read as before."""
    with Brain(tmp_path / "brain") as brain:
        path = brain.root / "semantic" / "user" / "fact_0a1b2c3d_acme-pays-late.md"
        path.write_text(TODAYS_FACT, encoding="utf-8", newline="\n")

        stats = reconcile_from_disk(brain)

        assert stats.skipped == []
        body = "Acme has paid late three quarters running"
        when = "2026-09-01T09:00:00+00:00"
        assert index_fingerprint(brain) == [
            (
                "fact_0a1b2c3d",
                "fact",
                "semantic/user/fact_0a1b2c3d_acme-pays-late.md",
                sha256(TODAYS_FACT),
                DEFAULT_IMPORTANCE,
                body,
                "[]",
                0,
                None,
                when,
                when,
            ),
            ("provenance", "fact_0a1b2c3d", "ep_0a1b2c3d"),
            ("fact", "fact_0a1b2c3d", "user", "acme pays late", 0.7),
            ("fts", "fact_0a1b2c3d", body, "fact"),
        ]
        assert _always_ids(brain) == set()


@pytest.mark.parametrize("value", ['"true"', "1", "yes", "false"])
def test_an_every_turn_that_is_not_the_literal_true_is_today_s_default(
    tmp_path: Path, value: str
) -> None:
    with Brain(tmp_path / "brain") as brain:
        path = brain.root / "semantic" / "user" / "fact_0a1b2c3d_acme-pays-late.md"
        text = TODAYS_FACT.replace("\n---\n\n", f"\nevery_turn: {value}\n---\n\n", 1)
        path.write_text(text, encoding="utf-8", newline="\n")

        reconcile_from_disk(brain)

        node = brain.node("fact_0a1b2c3d")
        assert node is not None
        assert node.importance == DEFAULT_IMPORTANCE


def test_a_body_written_with_crlf_and_a_lone_cr_rebuilds_the_rows_the_writer_indexed(
    tmp_path: Path,
) -> None:
    original = tmp_path / "brain"
    with Brain(original) as brain:
        episode = brain.append_episode("row one\r\nrow two\rrow three", role="user")
        brain.write_fact("k", "Acme pays net 60.\r\nAlways late.\rReally.", sources=[episode.id])
        brain.write_procedural("w", "when X,\r\ndo Y\rthen Z", sources=[episode.id])
        expected = index_fingerprint(brain)

    copied = tmp_path / "copied-brain"
    _copy_tree_without_the_index(original, copied)
    with Brain(copied) as rebuilt:
        stats = reconcile_from_disk(rebuilt)

        assert stats.skipped == []
        assert stats.by_kind == {"episode": 1, "fact": 1, "procedural": 1}
        assert index_fingerprint(rebuilt) == expected


def test_a_fact_file_saved_with_crlf_throughout_is_indexed_with_lf_key_and_body(
    tmp_path: Path,
) -> None:
    with Brain(tmp_path / "brain") as brain:
        source = brain.append_episode("evidence", role="user")
        fact = brain.write_fact("crlf-key", "first line\nsecond line", sources=[source.id])
        path = brain.root / fact.path
        text = path.read_bytes().decode("utf-8").replace("\n", "\r\n")
        path.write_bytes(text.encode("utf-8"))

        stats = reconcile_from_disk(brain)

        assert stats.skipped == []
        row = brain.writer.execute(
            "SELECT fact_key FROM companion_fact WHERE id = ?", (fact.id,)
        ).fetchone()
        assert row == ("crlf-key",)
        assert brain.read_body(fact.id) == "first line\nsecond line"


def test_a_fact_file_saved_with_a_byte_order_mark_is_indexed_not_skipped(tmp_path: Path) -> None:
    """PowerShell 5.1's ``Set-Content -Encoding UTF8`` writes one; the file still has its id."""
    with Brain(tmp_path / "brain") as brain:
        source = brain.append_episode("evidence", role="user")
        fact = brain.write_fact("bom-key", "Acme pays late", sources=[source.id])
        path = brain.root / fact.path
        path.write_bytes(b"\xef\xbb\xbf" + path.read_bytes())

        stats = reconcile_from_disk(brain)

        assert stats.skipped == []
        assert stats.by_kind == {"episode": 1, "fact": 1}
        row = brain.writer.execute(
            "SELECT fact_key FROM companion_fact WHERE id = ?", (fact.id,)
        ).fetchone()
        assert row == ("bom-key",)
        assert brain.read_body(fact.id) == "Acme pays late"


def test_every_scope_a_writer_accepts_is_in_the_tree_and_survives_a_rebuild(tmp_path: Path) -> None:
    """Derived from the writers' own scope lists, not from the walk's, so a scope added to one
    and not the other is a red test rather than a memory that vanishes on the next rebuild."""
    with Brain(tmp_path / "brain") as brain:
        for scope in FACT_SCOPES:
            assert (brain.root / "semantic" / scope).is_dir(), scope
        for scope in PROCEDURAL_SCOPES:
            assert (brain.root / "procedurals" / scope).is_dir(), scope
        source = brain.append_episode("evidence", role="user").id
        written = [
            brain.write_fact(f"key {scope}", f"a fact under {scope}", scope=scope, sources=[source])
            for scope in FACT_SCOPES
        ] + [
            brain.write_procedural(f"when {scope}", "say so", scope=scope, sources=[source])
            for scope in PROCEDURAL_SCOPES
        ]

        stats = reconcile_from_disk(brain)

        assert stats.skipped == []
        assert [ref.id for ref in written if brain.node(ref.id) is None] == []

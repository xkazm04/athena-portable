"""A featured chore's two loader seams: sensed tables join the world, and the authored
``featured`` block is checked while its status stays computed (spike 00, ADR 0300)."""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from athena.proving.playbooks.spec import PlaybookError, load_playbook

from .test_playbooks_authoring import compliant, problems, put


def sensed(root: Path, tables: object) -> None:
    (root / "senses").mkdir(exist_ok=True)
    (root / "senses" / "sensed.json").write_text(json.dumps({"tables": tables}), encoding="utf-8")


def test_sensed_tables_join_the_world_and_a_read_tool_may_serve_one(tmp_path: Path) -> None:
    root = compliant(tmp_path)
    sensed(root, {"sheets": [{"sheet_id": "S1", "media_id": "pile-1", "frame": 3}]})
    put(
        root,
        "world.json",
        lambda v: v["apps"][0]["tools"].append(
            {
                "name": "read_sheets",
                "kind": "READ",
                "description": "The sheets the camera found.",
                "params": {},
                "returns": {"table": "sheets"},
            }
        ),
    )
    playbook = load_playbook(root)
    assert playbook.tables["sheets"] == [{"sheet_id": "S1", "media_id": "pile-1", "frame": 3}]


def test_a_sensed_table_never_shadows_an_authored_one(tmp_path: Path) -> None:
    root = compliant(tmp_path)
    authored = next(iter(json.loads((root / "world.json").read_text("utf-8"))["tables"]))
    sensed(root, {authored: []})
    assert "shadows a world.json table" in problems(root)


def test_without_sensed_json_nothing_changes(tmp_path: Path) -> None:
    root = compliant(tmp_path)
    assert "sheets" not in load_playbook(root).tables


def test_a_featured_block_loads(tmp_path: Path) -> None:
    root = compliant(tmp_path)
    put(
        root,
        "playbook.json",
        lambda v: v.update(featured={"senses": ["paper"], "spike": "01", "since": "2026-10-26"}),
    )
    load_playbook(root)


@pytest.mark.parametrize(
    ("featured", "says"),
    [
        ({"senses": ["paper"], "spike": "01", "since": "x", "status": "proven"}, "featured.status"),
        ({"senses": ["smell"], "spike": "01", "since": "x"}, "featured.senses"),
        ({"senses": [], "spike": "01", "since": "x"}, "featured.senses"),
        ({"senses": ["call"], "since": "x"}, "featured.spike"),
        ("yes", "featured must be an object"),
    ],
)
def test_a_bad_featured_block_is_refused(tmp_path: Path, featured: object, says: str) -> None:
    root = compliant(tmp_path)
    put(root, "playbook.json", lambda v: v.update(featured=featured))
    with pytest.raises(PlaybookError) as caught:
        load_playbook(root)
    assert says in " | ".join(caught.value.problems)

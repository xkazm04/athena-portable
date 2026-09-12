"""One id table, declared in two languages (README §3.5, the day-zero lessons).

``src/athena/contracts/ids.py`` is the authority and ``apps/desktop/src/lib/ids.ts`` is the port.
Nothing imports across the boundary, so nothing fails when one side gains a kind or changes a
suffix length — and the failure that follows is the one this module exists for: the panel mints an
id the daemon does not recognise, or recognises as the wrong kind, and the request is refused with
``unknown_ref`` for a reason nobody can see from either file.

It reads the TypeScript as text rather than executing it, for the same reason
``test_refusal_parity.py`` does: the Python gate runs where no Node is installed, and a test that
needs a second toolchain to compare two tables of strings is a test that gets skipped. ADR 0013
records the duplication and this guard.
"""

from __future__ import annotations

import re
from pathlib import Path

from athena.contracts.ids import (
    ID_PREFIXES,
    ID_SUFFIX_HEX,
    conversation_for_app,
    conversation_for_project,
    is_id,
)

IDS_TS = (
    Path(__file__).resolve().parents[1] / "apps" / "desktop" / "src" / "lib" / "ids.ts"
)

#: `//` line comments and `/* */` blocks, so a prefix mentioned in prose is not read as a member.
_LINE_COMMENT = re.compile(r"^\s*//.*$", re.MULTILINE)
_BLOCK_COMMENT = re.compile(r"/\*.*?\*/", re.DOTALL)


def _source() -> str:
    return _LINE_COMMENT.sub("", _BLOCK_COMMENT.sub("", IDS_TS.read_text(encoding="utf-8")))


def _object(name: str) -> str:
    """The body of ``export const <name> = Object.freeze({ … });``."""
    match = re.search(rf"export const {name} = Object\.freeze\((\{{.*?\}})\);", _source(), re.DOTALL)
    assert match is not None, f"{name} is not frozen and exported from ids.ts"
    return match.group(1)


def _string_map(name: str) -> dict[str, str]:
    pairs = re.findall(r'(\w+):\s*"([^"]*)"', _object(name))
    return dict(pairs)


def _int_map(name: str) -> dict[str, int]:
    pairs = re.findall(r"(\w+):\s*(\d+)", _object(name))
    return {key: int(value) for key, value in pairs}


def test_the_prefix_table_is_the_same_on_both_sides() -> None:
    assert _string_map("ID_PREFIXES") == ID_PREFIXES


def test_the_suffix_lengths_are_the_same_on_both_sides() -> None:
    """Eight for an episode and twelve for everything else, in both languages.

    The episode's eight is not tidiness: the brain's markdown stays byte-compatible with the Rust
    writer whose ``short_id(8)`` produced those ids, so a panel that minted twelve would write a
    file the reconcile pass reads back as a different kind of thing.
    """
    assert _int_map("ID_SUFFIX_HEX") == ID_SUFFIX_HEX


def test_both_tables_are_frozen_where_a_surface_reads_them() -> None:
    # A table a surface can assign into is a table that is closed only by convention.
    source = _source()
    assert "export const ID_PREFIXES = Object.freeze(" in source
    assert "export const ID_SUFFIX_HEX = Object.freeze(" in source


def test_no_prefix_is_a_prefix_of_another() -> None:
    """What lets ``kindOf`` answer for exactly one kind, in either language."""
    prefixes = sorted(ID_PREFIXES.values())
    for index, prefix in enumerate(prefixes):
        for other in prefixes[index + 1 :]:
            assert not other.startswith(prefix), f"{other!r} starts with {prefix!r}"


def test_the_typescript_derives_a_conversation_from_an_already_minted_project_id() -> None:
    """The finding this whole module exists for: ``conv_proj_proj_<id>``.

    The TypeScript must refuse a bare slug where a project id is expected, exactly as the Python
    does — that refusal is what makes it impossible to add the prefix twice.
    """
    source = _source()
    assert 'isId("project", projectId)' in source, "conversationForProject must check the kind"
    assert "${ID_PREFIXES.conversation}${projectId}" in source


def test_the_python_half_still_behaves_the_way_the_port_assumes() -> None:
    project = "proj_000000000001"
    assert conversation_for_project(project) == f"conv_{project}"
    assert conversation_for_app("invoices") == "conv_invoices"
    assert is_id("conversation", "conv_invoices")
    assert not is_id("procedural", "proj_000000000001")

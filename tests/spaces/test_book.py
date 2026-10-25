"""A project's file: written whole, read back the same, its unknown keys carried (ADR 0225).

spaces/book.py: ``<brain>/spaces/<spc_id>.md``, ``# <name>`` and the brief for a person, then the
data block after the last ``<!-- athena:space -->`` marker. Every cap is refused, never cut.
"""

from __future__ import annotations

import json
from collections.abc import Iterator
from pathlib import Path

import pytest

from athena.contracts import ids
from athena.contracts.spaces import APPS_CAP, BRIEF_CAP, NAME_CAP, Space
from athena.core.brain import Brain, reconcile_from_disk
from athena.spaces.book import (
    SPACE_MARKER,
    SpaceBook,
    SpaceInvalid,
    SpaceUnreadable,
    check_input,
    default_hue,
    normalise_origin,
    parse_space,
    render_space,
)


@pytest.fixture
def book(tmp_path: Path) -> Iterator[SpaceBook]:
    with Brain(tmp_path / "brain") as brain:
        yield SpaceBook(brain)


def make(book: SpaceBook, **body: object) -> Space:
    return book.create(check_input({"name": "Taxes 2026", **body}, partial=False))


def test_a_space_round_trips_through_its_file(book: SpaceBook) -> None:
    space = make(
        book,
        brief="File the return.\nKeep receipts.",
        apps=["https://Tax.Example:443/", "http://localhost:5173"],
        hue=210,
    )

    assert ids.is_id("space", space.id)
    assert space.apps == ("https://tax.example", "http://localhost:5173")
    assert space.created == space.updated
    path = book.folder / f"{space.id}.md"
    text = path.read_bytes().decode("utf-8")
    # A person reads the name and the brief; LF only, whole-file.
    assert text.startswith("# Taxes 2026\n\nFile the return.\nKeep receipts.\n\n")
    assert "\r" not in text and SPACE_MARKER in text
    assert book.get(space.id) == space
    assert book.list() == [space]


def test_a_patch_changes_only_what_it_names_and_carries_unknown_keys(book: SpaceBook) -> None:
    space = make(book, brief="old brief", hue=12)
    path = book.folder / f"{space.id}.md"
    held, _ = parse_space(path.read_text(encoding="utf-8"))
    path.write_bytes(render_space(held, {"later": {"n": 1}}).encode("utf-8"))

    changed = book.update(space.id, check_input({"brief": "new brief"}, partial=True))

    assert changed is not None
    assert (changed.name, changed.brief, changed.hue) == ("Taxes 2026", "new brief", 12)
    assert changed.updated >= space.updated
    _, extra = parse_space(path.read_text(encoding="utf-8"))
    assert extra == {"later": {"n": 1}}


def test_the_last_block_wins_and_junk_is_refused(book: SpaceBook) -> None:
    space = make(book)
    quoted = Space(id=ids.mint("space"), name="Decoy")
    body = render_space(space)
    # A brief that quotes a block cannot stand in for the real one, which comes last.
    fake = render_space(quoted)
    assert parse_space(fake + "\n" + body)[0] == space

    with pytest.raises(SpaceUnreadable):
        parse_space("# no block\n")
    with pytest.raises(SpaceUnreadable):
        parse_space(body.replace('"schema": 1', '"schema": 2'))
    with pytest.raises(SpaceUnreadable):
        parse_space(body.replace(space.id, "spc_nothex"))
    block = f"{SPACE_MARKER}\n```json\n{json.dumps({'schema': 1, 'id': space.id})}\n```\n"
    with pytest.raises(SpaceUnreadable, match="no name"):
        parse_space(block)


def test_every_cap_is_refused_with_its_name_never_cut() -> None:
    with pytest.raises(SpaceInvalid, match="name"):
        check_input({"name": "  "}, partial=False)
    with pytest.raises(SpaceInvalid, match="name"):
        check_input({}, partial=False)
    with pytest.raises(SpaceInvalid, match=f"more than {NAME_CAP}"):
        check_input({"name": "x" * (NAME_CAP + 1)}, partial=False)
    with pytest.raises(SpaceInvalid, match=f"more than {BRIEF_CAP}"):
        check_input({"name": "a", "brief": "b" * (BRIEF_CAP + 1)}, partial=False)
    many = [f"https://app{n}.example" for n in range(APPS_CAP + 1)]
    with pytest.raises(SpaceInvalid, match=f"more than {APPS_CAP}"):
        check_input({"name": "a", "apps": many}, partial=False)
    with pytest.raises(SpaceInvalid, match="hue"):
        check_input({"name": "a", "hue": 360}, partial=False)
    with pytest.raises(SpaceInvalid, match="hue"):
        check_input({"name": "a", "hue": True}, partial=False)
    # At the caps exactly, and a duplicate origin counted once.
    fields = check_input(
        {
            "name": "x" * NAME_CAP,
            "brief": "b" * BRIEF_CAP,
            "apps": [*many[:APPS_CAP], many[0]],
            "hue": 359,
        },
        partial=False,
    )
    assert len(fields["apps"]) == APPS_CAP


@pytest.mark.parametrize(
    ("raw", "origin"),
    [
        ("https://Mail.Example", "https://mail.example"),
        ("https://mail.example:443", "https://mail.example"),
        ("http://localhost:80/", "http://localhost"),
        ("http://127.0.0.1:5173", "http://127.0.0.1:5173"),
    ],
)
def test_an_app_is_a_normalised_origin(raw: str, origin: str) -> None:
    assert normalise_origin(raw) == origin


@pytest.mark.parametrize(
    "raw",
    ["mail.example", "ftp://mail.example", "https://mail.example/inbox", "https://u@mail.example"],
)
def test_anything_more_than_an_origin_is_refused(raw: str) -> None:
    with pytest.raises(SpaceInvalid, match="origin"):
        normalise_origin(raw)


def test_the_default_hue_is_derived_from_the_id(book: SpaceBook) -> None:
    space = make(book)
    assert space.hue == default_hue(space.id)
    assert 0 <= space.hue <= 359


def test_core_and_strangers_are_not_spaces(book: SpaceBook) -> None:
    space = make(book)
    assert book.get("") is None and book.get("core") is None
    assert book.get("spc_0123456789ab") is None
    assert book.update("spc_0123456789ab", {"name": "x"}) is None
    assert book.delete_file(space.id) and not book.delete_file(space.id)
    assert book.list() == []


def test_a_space_file_is_not_a_memory_the_rebuild_indexes(book: SpaceBook) -> None:
    """``spaces/`` is outside the brain's rebuild walk: no index row, no recall of a brief."""
    make(book, brief="a brief that must not become a memory")
    stats = reconcile_from_disk(book.brain)
    assert stats.files == 0 and stats.skipped == []
    assert len(book.list()) == 1

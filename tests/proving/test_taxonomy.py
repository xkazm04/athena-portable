"""A playbook names its area and its job, from the library's one list (README §14; ADR 0096).

Fixture playbooks are built in a tmp dir beside a copy of the shipped ``taxonomy.json``; the
shipped library is read as it is, so a dead category or an untagged playbook fails here.
"""

from __future__ import annotations

import json
from collections import Counter
from pathlib import Path
from typing import Any

import pytest

from athena.proving.playbooks.__main__ import main
from athena.proving.playbooks.rank import load_entries, rank_all
from athena.proving.playbooks.spec import (
    TAXONOMY_FILENAME,
    PlaybookError,
    load_all,
    load_playbook,
    load_taxonomy,
)

from .test_playbooks import REPO
from .test_playbooks_authoring import compliant, problems, put

SHIPPED = REPO / "playbooks"


# --- the list ------------------------------------------------------------------------------------


def test_the_shipped_list_has_ten_areas_and_four_jobs() -> None:
    taxonomy = load_taxonomy(SHIPPED)
    assert len(taxonomy.categories) == 10
    assert list(taxonomy.jobs) == ["recover", "claim", "contest", "comply"]


@pytest.mark.parametrize(
    ("text", "says"),
    [
        ("{", "is not readable JSON"),
        ("[]", "'categories' must be a non-empty list"),
        ('{"categories": [], "jobs": []}', "'categories' must be a non-empty list"),
        ('{"categories": [{"id": "a"}], "jobs": []}', "needs a string id and label"),
        (
            '{"categories": [{"id": "a", "label": "A"}, {"id": "a", "label": "B"}],'
            ' "jobs": [{"id": "j", "label": "J"}]}',
            "'categories' repeats 'a'",
        ),
        ('{"categories": [{"id": "a", "label": "A"}]}', "'jobs' must be a non-empty list"),
    ],
)
def test_a_malformed_list_is_refused(tmp_path: Path, text: str, says: str) -> None:
    (tmp_path / TAXONOMY_FILENAME).write_text(text, encoding="utf-8")
    with pytest.raises(PlaybookError, match=says):
        load_taxonomy(tmp_path)


def test_a_malformed_list_fails_every_playbook_beside_it(tmp_path: Path) -> None:
    root = compliant(tmp_path)
    (tmp_path / TAXONOMY_FILENAME).write_text("{", encoding="utf-8")
    assert "taxonomy.json is not readable JSON" in problems(root)


def test_a_library_without_the_list_is_refused(tmp_path: Path) -> None:
    root = compliant(tmp_path)
    (tmp_path / TAXONOMY_FILENAME).unlink()
    assert "taxonomy.json is missing" in problems(root)


def test_check_refuses_a_library_without_the_list(
    tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    compliant(tmp_path)
    (tmp_path / TAXONOMY_FILENAME).unlink()
    assert main(["--dir", str(tmp_path), "check"]) == 2
    assert "taxonomy.json is missing" in capsys.readouterr().err


# --- a playbook's two names ----------------------------------------------------------------------


def test_a_tagged_playbook_loads_and_carries_both(tmp_path: Path) -> None:
    book = load_playbook(compliant(tmp_path))
    assert (book.category, book.job) == ("freight", "recover")


@pytest.mark.parametrize("key", ["category", "job"])
def test_a_missing_name_is_refused(tmp_path: Path, key: str) -> None:
    root = compliant(tmp_path)
    put(root, "playbook.json", lambda v: v.pop(key))
    assert f"playbook.json needs '{key}'" in problems(root)


@pytest.mark.parametrize(
    ("key", "value"),
    [("category", "Trucking"), ("category", ""), ("job", "refund"), ("job", 3), ("job", ["claim"])],
)
def test_a_name_outside_the_list_is_refused(tmp_path: Path, key: str, value: Any) -> None:
    root = compliant(tmp_path)
    put(root, "playbook.json", lambda v: v.update({key: value}))
    assert f"playbook.json {key} {value!r} is not in taxonomy.json" in problems(root)


def test_a_playbook_of_the_nine_is_not_exempt(tmp_path: Path) -> None:
    root = compliant(tmp_path)
    put(root, "playbook.json", lambda v: v.update(id="lien-desk"))
    put(root, "playbook.json", lambda v: v.pop("job"))
    assert "playbook.json needs 'job'" in problems(root)


def test_both_names_are_reported_together(tmp_path: Path) -> None:
    root = compliant(tmp_path)
    put(root, "playbook.json", lambda v: (v.pop("category"), v.update(job="win")))
    found = problems(root)
    assert "needs 'category'" in found and "job 'win' is not in" in found


def test_a_list_given_by_the_caller_is_the_one_checked(tmp_path: Path) -> None:
    root = compliant(tmp_path)
    narrow = load_taxonomy(SHIPPED)
    narrow = type(narrow)(categories={"health": "Health"}, jobs=narrow.jobs)
    with pytest.raises(PlaybookError, match="category 'freight' is not in"):
        load_playbook(root, narrow)


# --- the shipped library -------------------------------------------------------------------------


def test_every_shipped_playbook_names_an_area_and_a_job_from_the_list() -> None:
    taxonomy = load_taxonomy(SHIPPED)
    books = load_all(SHIPPED)
    assert len(books) == len(list(SHIPPED.glob("*/playbook.json")))
    for book in books:
        assert book.category in taxonomy.categories, book.id
        assert book.job in taxonomy.jobs, book.id


def test_every_area_and_every_job_in_the_list_is_used() -> None:
    """A dead id is a rail entry or a chip that always shows zero; it fails here instead."""
    taxonomy = load_taxonomy(SHIPPED)
    books = load_all(SHIPPED)
    by_category = Counter(b.category for b in books)
    by_job = Counter(b.job for b in books)
    assert all(by_category[c] >= 1 for c in taxonomy.categories), by_category
    assert all(by_job[j] >= 1 for j in taxonomy.jobs), by_job


def test_the_ranking_carries_both_names_as_the_playbook_states_them() -> None:
    ranking = rank_all(load_entries(SHIPPED))
    for row in ranking["ranked"]:
        showcase = json.loads((SHIPPED / row["playbook"] / "playbook.json").read_text("utf-8"))
        assert (row["category"], row["job"]) == (showcase["category"], showcase["job"])

"""The numbers audit's hand-kept tables are read back from the desktop's TypeScript source.

``numbers.py`` restates tables from ``modules/playbooks/model.ts``, ``scenes/chores/worth.ts`` and
``scenes/chores/topic.tsx``. ``test_numbers.py`` pins three playbooks by hand; these tests derive
the tables from the source the desktop ships, so a desktop change that moves a word, a period or a
label turns this red instead of the chores judge reading a page that no longer exists. The source
is read as text (no node, no import); apps/desktop is not touched.
"""

from __future__ import annotations

import re
from pathlib import Path

import pytest

from athena.proving.chores_uat import numbers

DESKTOP = Path(__file__).resolve().parents[3] / "apps" / "desktop" / "src"
MODEL = DESKTOP / "modules" / "playbooks" / "model.ts"
WORTH = DESKTOP / "scenes" / "chores" / "worth.ts"
TOPIC = DESKTOP / "scenes" / "chores" / "topic.tsx"

_STRING = r'"((?:[^"\\]|\\.)*)"'


def _body(path: Path, name: str) -> str:
    """The text between the braces of ``const NAME ... = {`` in ``path``."""
    text = path.read_text(encoding="utf-8")
    match = re.search(rf"\bconst {name}\b[^=\n]*=\s*\{{(.*?)\}}(?:\s+as const)?;", text, re.S)
    assert match, f"{name} not found in {path.name}"
    return match.group(1)


def _strings(path: Path, name: str) -> dict[str, str]:
    pairs = re.findall(rf"(\w+):\s*{_STRING}", _body(path, name))
    assert pairs, f"{name} holds no string entries"
    return dict(pairs)


def test_per_words_are_the_desktops() -> None:
    assert _strings(MODEL, "PER") == numbers.PER


def test_periods_are_the_desktops() -> None:
    pairs = re.findall(r"(\w+):\s*(\d+)", _body(MODEL, "PERIODS"))
    assert pairs
    assert {key: int(value) for key, value in pairs} == numbers.PERIODS


def test_verdict_labels_are_the_desktops() -> None:
    look = dict(re.findall(rf"(\w+):\s*\[{_STRING},", _body(MODEL, "LOOK")))
    assert look
    for word, label in look.items():
        assert numbers._LABELS[word] == label
    assert set(look) == set(numbers._VERDICTS)


def test_kind_words_are_the_desktops() -> None:
    assert _strings(WORTH, "KIND_WORD") == numbers._KIND_WORD


def test_the_instead_sentences_are_the_desktops() -> None:
    assert _strings(WORTH, "INSTEAD") == numbers._INSTEAD


def test_state_and_region_names_are_the_desktops() -> None:
    assert {**_strings(WORTH, "STATES"), **_strings(WORTH, "REGIONS")} == numbers._STATES


@pytest.mark.parametrize("tag", [numbers.TAG])
def test_the_example_case_tag_is_the_topic_pages(tag: str) -> None:
    assert f">{tag}</p>" in TOPIC.read_text(encoding="utf-8")

"""The senses foundation: fixture backends, the media index, the build merge and featured status."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import pytest

from athena.senses import build as build_mod
from athena.senses.backends import FixtureReader, FixtureSegmenter, FixtureTranscriber, make_senses
from athena.senses.build import SenseError, featured_status, load_media
from athena.senses.contract import MediaItem, ReadRequest, SegmentRequest


def write(path: Path, value: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value), encoding="utf-8")


ITEM = MediaItem(id="pile", kind="video", sense="paper")
FIXTURE = {
    "segments": [
        {"label": "sheet", "score": 0.9, "box": [0, 0, 1, 1], "frame": 3, "track_id": "a"},
        {"label": "hand", "score": 0.8, "box": [0, 0, 0.1, 0.1], "frame": 3},
    ],
    "transcript": {"turns": [{"speaker": "A", "start_s": 0.0, "end_s": 4.5, "text": "hi"}]},
    "reads": [
        {
            "attempt": 0,
            "fields": [{"name": "due", "value": "$180", "frame": 0, "box": [0, 0, 1, 1]}],
        },
        {"attempt": 1, "fields": [{"name": "due", "value": "$130"}], "unreadable": ["date"]},
    ],
}


def test_fixture_roles_replay_and_filter(tmp_path: Path) -> None:
    write(tmp_path / "pile.json", FIXTURE)
    segs, call = FixtureSegmenter(tmp_path).segment(SegmentRequest(ITEM, None, "Sheet"))
    assert (
        [s.track_id for s in segs] == ["a"] and call.backend == "fixture" and call.unit == "frame"
    )
    transcript, call = FixtureTranscriber(tmp_path).transcribe(ITEM, None)
    assert transcript.turns[0].end_s == 4.5 and call.units == 4.5
    first, _ = FixtureReader(tmp_path).read(ReadRequest(ITEM, None, ["due", "date"]))
    assert first.fields[0].value == "$180" and first.unreadable == ("date",)
    second, _ = FixtureReader(tmp_path).read(ReadRequest(ITEM, None, ["due"], attempt=1))
    assert second.fields[0].value == "$130" and second.fields[0].provenance.box is None


def test_claude_is_a_reader_only(tmp_path: Path) -> None:
    with pytest.raises(ValueError, match="segmenter"):
        make_senses(tmp_path, {"segmenter": "claude"})


def test_media_index_reports_every_problem(tmp_path: Path) -> None:
    write(
        tmp_path / "senses" / "media.json",
        {
            "media": [{"id": "x", "kind": "smell", "sense": "paper"}, {"id": "x", "kind": "photo"}],
            "backends": {"reader": "gpt"},
        },
    )
    with pytest.raises(SenseError) as caught:
        load_media(tmp_path)
    text = " | ".join(caught.value.problems)
    assert "kind" in text and "unique" in text and "sense" in text and "backends.reader" in text


def test_two_senses_cannot_write_one_table(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    from types import SimpleNamespace

    from athena.senses.contract import SenseOutput

    write(tmp_path / "world.json", {"tables": {"claims": []}})
    write(
        tmp_path / "senses" / "media.json",
        {
            "media": [
                {"id": "a", "kind": "paper", "sense": "paper"},
                {"id": "b", "kind": "audio", "sense": "call"},
            ]
        },
    )
    fake = SimpleNamespace(build=lambda ctx: SenseOutput(tables={"turns": [{"x": 1}]}))
    monkeypatch.setattr(build_mod, "sense_module", lambda name: fake)
    with pytest.raises(SenseError, match="already written"):
        build_mod.build(tmp_path)


@pytest.mark.parametrize(
    ("proofs", "status"),
    [
        (None, "unproven"),
        ({"passed": False, "proofs": [{"id": "F1"}], "backends": {}}, "failing"),
        ({"passed": True, "proofs": [{"id": "F1"}], "backends": {"reader": "claude"}}, "rehearsed"),
        ({"passed": True, "proofs": [{"id": "F1"}], "backends": {"segmenter": "meta"}}, "proven"),
    ],
)
def test_featured_status_is_read_from_proofs(tmp_path: Path, proofs: Any, status: str) -> None:
    if proofs is not None:
        write(tmp_path / "senses" / "proofs.json", proofs)
    assert featured_status(tmp_path) == status

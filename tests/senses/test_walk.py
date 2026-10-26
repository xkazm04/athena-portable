"""The walk sense: counts by track, promises by an explainable classifier, consent before audio, the
vague-change validator, and the proofs spike 04's README names (ADR 0300)."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import pytest

from athena.senses import build as build_mod
from athena.senses.contract import Box, Segment, SenseOutput
from athena.senses.walk import build, count_instances, prove
from athena.senses.walk.changes import change_checks, vague_change
from athena.senses.walk.promises import classify

REPO = Path(__file__).resolve().parents[2]
CHORE = REPO / "playbooks" / "renovation-witness"


def write(path: Path, value: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value), encoding="utf-8")


def seg(track: str | None, frame: int, score: float = 0.9) -> dict[str, Any]:
    row: dict[str, Any] = {"label": "outlet", "score": score, "box": [0, 0, 0.1, 0.1]}
    row["frame"] = frame
    if track is not None:
        row["track_id"] = track
    return row


def chore(
    tmp_path: Path, *, consent: bool = True, segments: list[dict[str, Any]] | None = None
) -> Path:
    root = tmp_path / "kitchen"
    write(
        root / "world.json",
        {"tables": {"change_orders": [{"change_id": "CO-1", "price_usd": "TBD"}]}},
    )
    write(
        root / "senses" / "media.json",
        {
            "media": [
                {
                    "id": "walk-w1",
                    "kind": "video",
                    "sense": "walk",
                    "params": {
                        "week": 1,
                        "consent_recorded": consent,
                        "speakers": {"A": "homeowner", "B": "contractor"},
                        "count": {"outlet": "Q-07", "recessed light": "Q-08"},
                    },
                }
            ]
        },
    )
    write(
        root / "senses" / "fixtures" / "walk-w1.json",
        {
            "segments": segments
            if segments is not None
            else [seg("o-1", 4), seg("o-1", 9), seg("o-2", 30, 0.95), seg(None, 50)],
            "transcript": {
                "turns": [
                    {
                        "speaker": "B",
                        "start_s": 12.5,
                        "end_s": 15.0,
                        "text": "Bigger tile, small upcharge, I'll write it up.",
                    },
                    {"speaker": "A", "start_s": 16.0, "end_s": 17.0, "text": "How much is it?"},
                ]
            },
        },
    )
    return root


# --- the validator -------------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("change", "reasons"),
    [
        ({"price_usd": 180.0, "days": 1, "quote_line": "Q-09"}, []),
        ({"amount_usd": -250, "delta_days": 0, "quote_line": "Q-05"}, []),
        ({"days": 1, "quote_line": "Q-11"}, ["no price"]),
        ({"price_usd": "small upcharge", "quote_line": "Q-11"}, ["price not a number", "no days"]),
        ({"price_usd": "400", "days": 2, "quote_line": "Q-1"}, ["price not a number"]),
        ({"price_usd": True, "days": 2, "quote_line": "Q-1"}, ["price not a number"]),
        ({"price_usd": 95, "days": "as needed", "quote_line": "Q-07"}, ["days not a number"]),
        ({"price_usd": 95, "days": -1, "quote_line": "Q-07"}, ["days not a number"]),
        ({"price_usd": 165, "days": 1}, ["no quote line"]),
        (
            {"price_usd": "", "days": None, "quote_line": " "},
            ["no price", "no days", "no quote line"],
        ),
    ],
)
def test_a_vague_change_says_every_reason_it_cannot_be_signed(
    change: dict[str, Any], reasons: list[str]
) -> None:
    assert vague_change(change) == reasons


def test_change_checks_cite_the_world_row_they_judged() -> None:
    rows = change_checks({"tables": {"change_orders": [{"change_id": "CO-9", "price_usd": 5}]}})
    assert rows == [
        {
            "change_id": "CO-9",
            "signable": False,
            "reasons": ["no days", "no quote line"],
            "media_id": "world:change_orders/CO-9",
        }
    ]
    assert change_checks({"tables": {}}) == []


# --- the promise classifier ----------------------------------------------------------------------


@pytest.mark.parametrize(
    ("text", "promise", "price", "days"),
    [
        ("Bigger tile, small upcharge, I'll write it up.", True, False, False),
        ("Sure, moving that outlet is no charge.", True, True, False),
        ("I'll swap the dimmers for $180, half a day.", True, True, True),
        ("We'll have the doors on by the 21st.", True, False, True),
        ("Should be here next week, I'll set those Monday.", True, False, True),
        ("Can we move the island outlet to the end panel?", False, False, False),
        ("Tile goes in Tuesday, two days.", False, False, True),
        ("I can't add anything today.", False, False, False),
        ("Okay, send me the change order.", False, False, False),
        ("Great. That's the walk for this week.", False, False, True),
    ],
)
def test_a_turn_is_a_promise_by_cues_it_names(
    text: str, promise: bool, price: bool, days: bool
) -> None:
    verdict = classify(text)
    assert (verdict.promise, verdict.mentions_price, verdict.mentions_days) == (
        promise,
        price,
        days,
    )
    assert verdict.cues or not promise


# --- counting ------------------------------------------------------------------------------------


def test_an_object_in_many_frames_counts_once_and_the_best_frame_is_cited() -> None:
    box = Box(0, 0, 1, 1)
    segments = [
        Segment("outlet", 0.8, box, frame=3, track_id="a"),
        Segment("outlet", 0.9, box, frame=7, track_id="a"),
        Segment("outlet", 0.9, box, frame=5, track_id="b"),
        Segment("outlet", 0.5, box, frame=1),
    ]
    counted, best = count_instances(segments)
    assert counted == 3  # a, b, and the untracked one
    assert best is not None and best.frame == 5  # 0.9 ties go to the earlier frame
    assert count_instances([]) == (0, None)


# --- the build -----------------------------------------------------------------------------------


def test_build_counts_tracks_hears_promises_and_checks_changes(tmp_path: Path) -> None:
    out = build(build_mod.context(chore(tmp_path)))
    counts = {r["item"]: r for r in out.tables["walk_counts"]}
    assert counts["outlet"]["counted"] == 3
    assert counts["outlet"]["frame"] == 30 and counts["outlet"]["box"] == [0, 0, 0.1, 0.1]
    # A count of zero cites nothing: the keys are absent, never 0.
    assert counts["recessed light"]["counted"] == 0
    assert "frame" not in counts["recessed light"] and "box" not in counts["recessed light"]
    [promise] = out.tables["walk_promises"]
    assert promise == {
        "promise_id": "walk-w1.p1",
        "week": 1,
        "speaker": "contractor",
        "text": "Bigger tile, small upcharge, I'll write it up.",
        "mentions_price": False,
        "mentions_days": False,
        "media_id": "walk-w1",
        "second": 12.5,
    }
    assert out.tables["change_checks"][0]["reasons"] == [
        "price not a number",
        "no days",
        "no quote line",
    ]
    assert [c.role for c in out.calls] == ["segment", "segment", "transcribe"]
    assert out.asked == ()


def test_a_walk_without_its_consent_notice_is_counted_but_never_transcribed(
    tmp_path: Path,
) -> None:
    out = build(build_mod.context(chore(tmp_path, consent=False)))
    assert out.tables["walk_promises"] == []
    assert out.asked == ("walk-w1.consent",)
    assert all(c.role == "segment" for c in out.calls)
    assert {r["item"]: r["counted"] for r in out.tables["walk_counts"]}["outlet"] == 3


# --- the proofs ----------------------------------------------------------------------------------


KEY = {
    "walk": {
        "counts": {"walk-w1": {"outlet": 2, "recessed light": 0}},
        "promises": [
            {
                "media_id": "walk-w1",
                "second": 12.0,
                "speaker": "contractor",
                "mentions_price": False,
            },
        ],
        "changes": {"CO-1": False},
    }
}


def by_id(results: list[Any]) -> dict[str, Any]:
    return {r.id: r for r in results}


def test_proofs_measure_counts_double_counts_promises_and_the_validator(tmp_path: Path) -> None:
    ctx = build_mod.context(chore(tmp_path))
    results = by_id(prove(ctx, build(ctx), KEY))
    assert set(results) == {"F2", "F2d", "F3", "F4"}
    # The untracked outlet made 3 of 2: one line of two is off, one instance over two.
    assert results["F2"].measured == 0.5 and not results["F2"].passed
    assert results["F2d"].measured == 0.5 and not results["F2d"].passed
    assert results["F3"].measured == 1.0 and results["F3"].passed
    assert results["F4"].measured == 1.0 and results["F4"].passed


def test_a_promise_from_a_walk_without_consent_fails_f3_whatever_it_matched(
    tmp_path: Path,
) -> None:
    ctx = build_mod.context(chore(tmp_path, consent=False))
    real = build(ctx)
    leaked = SenseOutput(
        tables={
            **real.tables,
            "walk_promises": [
                {
                    "promise_id": "walk-w1.p1",
                    "speaker": "contractor",
                    "media_id": "walk-w1",
                    "second": 12.5,
                    "mentions_price": False,
                    "mentions_days": False,
                },
            ],
        }
    )
    f3 = by_id(prove(ctx, leaked, KEY))["F3"]
    assert f3.measured == 1.0 and not f3.passed and "WITHOUT CONSENT" in f3.note


def test_an_empty_key_section_measures_nothing_and_passes_nothing(tmp_path: Path) -> None:
    ctx = build_mod.context(chore(tmp_path))
    results = prove(ctx, build(ctx), {})
    assert results and all(r.measured is None and not r.passed for r in results)


# --- the shipped chore ---------------------------------------------------------------------------


def test_the_renovation_witness_build_is_committed_and_its_proofs_pass(tmp_path: Path) -> None:
    import shutil

    copy = tmp_path / "renovation-witness"
    shutil.copytree(CHORE, copy, ignore=shutil.ignore_patterns("media", "render"))
    build_mod.build(copy)
    committed = (CHORE / "senses" / "sensed.json").read_text(encoding="utf-8")
    assert (copy / "senses" / "sensed.json").read_text(encoding="utf-8") == committed
    results = build_mod.prove(copy)
    assert results and all(r.passed for r in results), [(r.id, r.note) for r in results]
    assert build_mod.featured_status(copy) == "rehearsed"

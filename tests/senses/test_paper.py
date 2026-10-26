"""The paper sense: tracks become sheets, two agreeing reads become fields, the rest is asked."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import pytest

from athena.senses import build as build_mod
from athena.senses.paper.normalise import agree, normalise


def write(path: Path, value: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value), encoding="utf-8")


def seg(track: str | None, frame: int, score: float = 0.9, label: str = "sheet of paper") -> Any:
    row: dict[str, Any] = {"label": label, "score": score, "box": [0.1, 0.1, 0.9, 0.9]}
    row["frame"] = frame
    if track is not None:
        row["track_id"] = track
    return row


def reads(first: dict[str, str], second: dict[str, str]) -> Any:
    box = [0.2, 0.3, 0.5, 0.35]
    return {
        "reads": [
            {
                "attempt": 0,
                "fields": [
                    {"name": k, "value": v, "confidence": 0.9, "frame": 4, "box": box}
                    for k, v in first.items()
                ],
            },
            {
                "attempt": 1,
                "fields": [{"name": k, "value": v, "confidence": 0.8} for k, v in second.items()],
            },
        ]
    }


def sheet(sid: str, pile: str | None = "pile-1", doc_type: str = "bill") -> dict[str, Any]:
    params: dict[str, Any] = {
        "sheet_id": sid,
        "doc_type": doc_type,
        "fields": ["amount_due_usd", "due_date"],
    }
    if pile:
        params["pile"] = pile
    return {"id": f"sheet-{sid}", "kind": "paper", "sense": "paper", "params": params}


@pytest.fixture
def chore(tmp_path: Path) -> Path:
    root = tmp_path / "paper-chore"
    write(root / "world.json", {"tables": {"bills": []}})
    s = root / "senses"
    write(
        s / "media.json",
        {
            "media": [
                {
                    "id": "pile-1",
                    "kind": "video",
                    "sense": "paper",
                    "path": "media/pile-1.mp4",
                    "params": {"prompt": "sheet of paper"},
                },
                sheet("a"),
                sheet("b"),
                sheet("c"),
                sheet("d", pile=None, doc_type="letter"),
            ]
        },
    )
    write(
        s / "fixtures" / "pile-1.json",
        {
            "segments": [
                seg("a", 1, 0.7),
                seg("a", 2, 0.95),
                seg("a", 3, 0.95),
                seg("b", 5),
                seg(None, 6),
                seg("hand-1", 2, label="hand"),
            ]
        },
    )
    write(
        s / "fixtures" / "sheet-a.json",
        reads(
            {"amount_due_usd": "$1,240.00", "due_date": "October 15, 2026"},
            {"amount_due_usd": "1240", "due_date": "10/15/2026"},
        ),
    )
    # b: the second read misses the date and misreads nothing else.
    write(
        s / "fixtures" / "sheet-b.json",
        reads({"amount_due_usd": "$64.00", "due_date": "2026-10-20"}, {"amount_due_usd": "$64"}),
    )
    write(
        s / "fixtures" / "sheet-c.json", reads({"amount_due_usd": "$9"}, {"amount_due_usd": "$9"})
    )
    # d: both reads agree on a wrong amount (a correlated misread) - a false fact.
    write(
        s / "fixtures" / "sheet-d.json",
        reads(
            {"amount_due_usd": "$180.00", "due_date": "Nov 1, 2026"},
            {"amount_due_usd": "$180", "due_date": "November 1, 2026"},
        ),
    )
    write(
        s / "key.json",
        {
            "paper": {
                "sheets": {
                    "a": {"fields": {"amount_due_usd": 1240.0, "due_date": "2026-10-15"}},
                    "b": {
                        "fields": {"amount_due_usd": 64.0, "due_date": "2026-10-20"},
                        "hard": "glare",
                    },
                    "c": {"fields": {"amount_due_usd": 9.0}},
                    "d": {"fields": {"amount_due_usd": 135.0, "due_date": "2026-11-01"}},
                },
                "piles": {"pile-1": ["a", "b", "c"]},
            }
        },
    )
    return root


@pytest.mark.parametrize(
    ("field", "a", "b"),
    [
        ("amount_due_usd", "$1,240.00", "1240"),
        ("amount_due_usd", 412.0, "$412"),
        ("due_date", "October 15, 2026", "2026-10-15"),
        ("due_date", "Oct 15th, 2026", "10/15/2026"),
        ("provider", "Valley  Medical\nCenter", "Valley Medical Center"),
    ],
)
def test_the_agreement_rule_normalises_money_dates_and_whitespace(
    field: str, a: Any, b: Any
) -> None:
    assert agree(field, a, b)


def test_normalise_keeps_text_it_cannot_parse() -> None:
    assert normalise("amount_due_usd", "unreadable") == "unreadable"
    assert not agree("provider", "Part B", "part b")
    assert normalise("amount_due_usd", "-$45.00") == "-45.00"


def test_build_tracks_sheets_and_asks_what_the_reads_do_not_agree_on(chore: Path) -> None:
    out = build_mod.build(chore)
    sheets = {r["sheet_id"]: r for r in out.tables["sheets"]}
    assert list(sheets) == ["a", "b", "d"]  # c was never tracked; the hand is not a sheet
    a = sheets["a"]
    assert a == {
        "sheet_id": "a",
        "doc_type": "bill",
        "media_id": "pile-1",
        "frame": 2,
        "box": [0.1, 0.1, 0.9, 0.9],
        "track_id": "a",
        "frames_seen": 3,
    }
    assert sheets["d"] == {"sheet_id": "d", "doc_type": "letter", "media_id": "sheet-d", "frame": 0}
    fields = {(r["sheet_id"], r["field"]): r for r in out.tables["sheet_fields"]}
    read = fields[("a", "amount_due_usd")]
    assert read["status"] == "read" and read["value"] == "1240.00" and read["confidence"] == 0.8
    assert read["media_id"] == "sheet-a" and read["frame"] == 4 and len(read["box"]) == 4
    assert fields[("a", "due_date")]["value"] == "2026-10-15"
    asked = fields[("b", "due_date")]
    assert asked == {"sheet_id": "b", "field": "due_date", "status": "asked", "media_id": "sheet-b"}
    assert fields[("c", "amount_due_usd")]["status"] == "asked"
    assert set(out.asked) == {"b.due_date", "c.amount_due_usd", "c.due_date"}
    # one segment call for the pile, two reads for each sheet that was found or photographed
    assert [c.role for c in out.calls].count("read") == 6 and out.calls[0].role == "segment"
    written = json.loads((chore / "senses" / "sensed.json").read_text(encoding="utf-8"))
    assert written["tables"]["sheets"][0]["sheet_id"] == "a"


def test_prove_measures_each_proof_against_the_key(chore: Path) -> None:
    results = {r.id: r for r in build_mod.prove(chore)}
    assert list(results) == ["F1", "F2", "F2x", "F3", "R2", "R3"]
    # F1: c is not found (3 of 4), every track is a key sheet of its pile.
    assert results["F1"].measured == 0.75 and not results["F1"].passed
    # Read and scored: a x2, b.amount, d x2 = 5; d.amount is wrong.
    assert results["F2"].n == 5 and results["F2"].measured == 0.8
    assert results["F2x"].measured == 0.2 and not results["F2x"].passed
    assert results["F3"].measured == 1.0 and results["F3"].passed
    # b is hard (glare): its amount is read right, its date asked - never silently wrong.
    assert results["R2"].measured == 1.0 and results["R2"].n == 2 and results["R2"].passed
    assert results["R3"].measured == 0.0 and results["R3"].passed
    proofs = json.loads((chore / "senses" / "proofs.json").read_text(encoding="utf-8"))
    assert proofs["passed"] is False and proofs["backends"]["reader"] == "fixture"


def test_a_hard_sheet_read_wrong_fails_r2_and_no_hard_sheet_omits_it(chore: Path) -> None:
    key_path = chore / "senses" / "key.json"
    key = json.loads(key_path.read_text(encoding="utf-8"))
    key["paper"]["sheets"]["d"]["hard"] = "folded"
    write(key_path, key)
    results = {r.id: r for r in build_mod.prove(chore)}
    assert results["R2"].n == 4 and results["R2"].measured == 0.75 and not results["R2"].passed
    for sid in ("b", "d"):
        key["paper"]["sheets"][sid]["hard"] = None
    write(key_path, key)
    assert "R2" not in {r.id for r in build_mod.prove(chore)}


def test_an_unpriced_call_fails_r3(chore: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    from dataclasses import replace

    from athena.senses.backends import FixtureReader

    real = FixtureReader.read

    def unpriced(self: FixtureReader, request: Any) -> Any:
        reading, call = real(self, request)
        return reading, replace(call, cost_usd=None, cost_estimated=True)

    monkeypatch.setattr(FixtureReader, "read", unpriced)
    r3 = {r.id: r for r in build_mod.prove(chore)}["R3"]
    assert r3.measured is None and not r3.passed and "unpriced" in r3.note

"""The object sense (spike 03, ADR 0303): photos -> one cited line per possession, no people."""

from __future__ import annotations

import json
from dataclasses import replace
from pathlib import Path
from typing import Any

import pytest

from athena.senses import object as obj
from athena.senses.build import context, run_senses
from athena.senses.contract import Box, ReadRequest, SenseOutput
from athena.senses.object.merge import Sighting, merge, normalise

REPO = Path(__file__).resolve().parents[2]
CHORE = REPO / "playbooks" / "roll-call-inventory"


def write(path: Path, value: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value), encoding="utf-8")


def seg(label: str, track: str, box: list[float], score: float = 0.9) -> dict[str, Any]:
    return {"label": label, "score": score, "box": box, "frame": 0, "track_id": track}


def label(track: str, value: str) -> dict[str, Any]:
    return {"name": f"{track}.label", "value": value, "confidence": 0.9}


PERSON_BOX = [0.1, 0.1, 0.3, 0.6]


def chore(tmp_path: Path) -> Path:
    """Three living-room photos: two lamps together once, a person in one, an unnamed thing."""
    root = tmp_path / "chore"
    write(root / "world.json", {"tables": {}})
    prompts = ["sofa", "lamp", "chair"]
    media = [
        {"id": pid, "kind": "photo", "sense": "object", "params": params}
        for pid, params in (
            ("a", {"taken": "2023-01-05", "room": "living room", "prompts": prompts}),
            ("b", {"taken": "2025-06-01", "room": "living room", "prompts": prompts}),
            ("c", {"taken": "2025-07-01", "room": "living room", "prompts": prompts}),
        )
    ]
    write(root / "senses" / "media.json", {"media": media})
    fx = root / "senses" / "fixtures"
    write(
        fx / "a.json",
        {
            "segments": [
                seg("sofa", "t1", [0, 0, 0.5, 0.5]),
                seg("floor lamp", "t2", [0.6, 0, 0.7, 0.9]),
            ],
            "reads": [{"fields": [label("t1", "Grey Kivik sofa"), label("t2", "Arc floor lamp")]}],
        },
    )
    write(
        fx / "b.json",
        {
            "segments": [
                seg("person", "t1", PERSON_BOX),
                seg("floor lamp", "t2", [0.6, 0, 0.7, 0.9]),
                seg("floor lamp", "t3", [0.8, 0, 0.9, 0.9]),
                seg("sofa", "t4", [0, 0.2, 0.5, 0.7], score=0.99),
            ],
            "reads": [
                {
                    "fields": [
                        label("t2", "Arc floor lamp"),
                        label("t3", "arc  floor-lamp"),
                        label("t4", "Kivik sofa, grey"),
                    ]
                }
            ],
        },
    )
    write(
        fx / "c.json",
        {
            "segments": [
                seg("armchair", "t1", [0.2, 0.2, 0.4, 0.5]),
                seg("sofa", "t2", [0, 0, 1, 1]),
            ],
            "reads": [{"fields": [label("t2", "Kivik sofa grey")], "unreadable": ["t1.label"]}],
        },
    )
    write(
        root / "senses" / "key.json",
        {
            "object": {
                "items": [
                    {"label": "Grey Kivik sofa", "room": "living room", "count": 1},
                    {"label": "Arc floor lamp", "room": "living room", "count": 2},
                    {"label": "Velvet armchair", "room": "living room", "count": 1},
                ],
                "people_photos": {"b": 1},
            }
        },
    )
    return root


def test_a_label_is_compared_without_case_punctuation_inch_marks_or_word_order() -> None:
    assert (
        normalise('LG 65" OLED TV')
        == normalise("lg 65-inch oled tv")
        == normalise("LG 65in OLED TV")
    )
    assert normalise("IKEA Kivik sectional sofa, grey") == normalise(
        "Grey IKEA Kivik sectional sofa"
    )
    assert normalise("Samsung 40in TV") != normalise("Samsung 55in TV")


def test_the_count_is_the_most_seen_together_and_a_silence_does_not_split_a_possession() -> None:
    def s(mid: str, taken: str, track: str) -> Sighting:
        return Sighting(mid, taken, "garage", "bicycle", "Trek bike", track, Box(0, 0, 1, 1), 0.9)

    sightings = [s("a", "2023-01-01", "t1"), s("b", "2023-02-01", "t1"), s("b", "2023-02-01", "t2")]
    sightings.append(s("c", "2026-01-01", "t1"))
    (bike,) = merge(sightings)
    assert bike.count == 2 and bike.photos == ["a", "b", "c"]
    assert (bike.first_seen, bike.last_seen) == ("2023-01-01", "2026-01-01")
    assert [p.count for p in merge(sightings, max_gap_days=730)] == [2, 1]


def test_people_are_counted_and_never_boxed(tmp_path: Path) -> None:
    out = obj.build(context(chore(tmp_path)))
    boxes = [row.get("box") for rows in out.tables.values() for row in rows]
    assert PERSON_BOX not in boxes
    lamp = next(r for r in out.tables["inventory"] if "lamp" in r["label"].lower())
    assert lamp["with_people"] == ["b"] and lamp["people_excluded"] == 1
    sofa = next(r for r in out.tables["inventory"] if "sofa" in r["label"].lower())
    assert sofa["media_id"] != "b", "the best photo is one without people"


def test_no_crop_of_a_person_is_ever_read(tmp_path: Path) -> None:
    ctx = context(chore(tmp_path))
    seen: list[tuple[str, list[str]]] = []
    reader = ctx.senses.reader

    class Spy:
        def read(self, request: ReadRequest) -> Any:
            seen.append((request.media.id, list(request.fields)))
            return reader.read(request)

    obj.build(replace(ctx, senses=replace(ctx.senses, reader=Spy())))
    fields_b = next(fields for mid, fields in seen if mid == "b")
    assert "t1.label" not in fields_b and "t2.label" in fields_b


def test_one_line_per_possession_and_an_unnamed_thing_is_asked(tmp_path: Path) -> None:
    out = obj.build(context(chore(tmp_path)))
    lines = out.tables["inventory"]
    assert [(r["item_id"], r["count"], len(r["photos"])) for r in lines] == [
        ("IT-01", 2, 2),
        ("IT-02", 1, 3),
    ]
    sofa = lines[1]
    assert sofa["first_seen"] == "2023-01-05" and sofa["last_seen"] == "2025-07-01"
    assert set(sofa) >= {"media_id", "frame", "box", "photos"}
    (asked,) = out.tables["inventory_asked"]
    assert asked["ask_id"] == "Q-01" and asked["concept"] == "armchair"
    assert out.asked == ("c.t1.label",)


def test_the_proofs_measure_recall_duplicates_and_people(tmp_path: Path) -> None:
    root = chore(tmp_path)
    ctx = context(root)
    out = obj.build(ctx)
    key = json.loads((root / "senses" / "key.json").read_text("utf-8"))
    got = {r.id: r for r in obj.prove(ctx, out, key)}
    assert list(got) == ["F1", "F1x", "F3", "F4", "R2"]
    assert got["F1"].measured == pytest.approx(2 / 3) and got["F1"].passed
    assert got["F1x"].measured == 0 and got["F3"].measured == 0 and got["F4"].measured == 1.0
    assert got["R2"].measured == 0 and "rehearsal" in got["R2"].note

    doubled = dict(out.tables)
    doubled["inventory"] = [
        *out.tables["inventory"],
        {**out.tables["inventory"][1], "item_id": "X"},
    ]
    again = {r.id: r for r in obj.prove(ctx, SenseOutput(doubled, out.calls), key)}
    assert again["F3"].measured == pytest.approx(1 / 3) and not again["F3"].passed

    leaked = dict(out.tables)
    leaked["inventory_asked"] = [{"ask_id": "Q-9", "media_id": "b", "box": PERSON_BOX}]
    worse = {r.id: r for r in obj.prove(ctx, SenseOutput(leaked, out.calls), key)}
    assert worse["F4"].measured == 0 and not worse["F4"].passed


def test_the_roll_call_chore_proves_green_on_its_fixtures() -> None:
    ctx = context(CHORE)
    out = run_senses(ctx)
    key = json.loads((CHORE / "senses" / "key.json").read_text("utf-8"))
    results = obj.prove(ctx, out, key)
    assert all(r.passed for r in results), [(r.id, r.measured) for r in results]
    committed = json.loads((CHORE / "senses" / "sensed.json").read_text("utf-8"))
    assert committed["tables"] == json.loads(json.dumps(out.tables)), "rebuild sensed.json"

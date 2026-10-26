"""Spike 05: the circle sense - counter photos, the family call and the rule table -> cited tables,
and its proofs measured against a key (fixture backend only)."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import pytest

from athena.senses import circle
from athena.senses.build import SenseError, context
from athena.senses.circle.claims import claims

REPO = Path(__file__).resolve().parents[2]


def write(path: Path, value: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value), encoding="utf-8")


def field(name: str, value: str) -> dict[str, Any]:
    return {"name": name, "value": value, "confidence": 0.9, "frame": 0, "box": [0, 0, 1, 1]}


def chore(tmp_path: Path, *, second_strength: str = "50mg") -> Path:
    root = tmp_path / "chore"
    write(root / "world.json", {"tables": {}})
    senses = root / "senses"
    write(
        senses / "media.json",
        {
            "media": [
                {
                    "id": "counter",
                    "kind": "photo",
                    "sense": "circle",
                    "params": {"prompt": "pill bottle"},
                },
                {
                    "id": "call",
                    "kind": "audio",
                    "sense": "circle",
                    "params": {"members": {"A": "maya (primary carer)", "B": "jon (sibling)"}},
                },
                {"id": "sheet", "kind": "paper", "sense": "paper"},
            ]
        },
    )
    write(
        senses / "fixtures" / "counter.json",
        {
            "segments": [
                {
                    "label": "pill bottle",
                    "score": 0.7,
                    "box": [0.1, 0.1, 0.2, 0.5],
                    "frame": 1,
                    "track_id": "B1",
                },
                {
                    "label": "pill bottle",
                    "score": 0.9,
                    "box": [0.1, 0.1, 0.2, 0.6],
                    "frame": 2,
                    "track_id": "B1",
                },
                {"label": "pill bottle", "score": 0.8, "box": [0.5, 0.1, 0.6, 0.5], "frame": 3},
                {"label": "pill organizer", "score": 0.9, "box": [0, 0.8, 0.5, 1], "frame": 1},
            ],
            "reads": [
                {
                    "attempt": 0,
                    "fields": [
                        field("B1.name", "Metoprolol  tartrate"),
                        field("B1.strength", "50 mg"),
                        field("B1.directions", "Twice daily"),
                        field("counter-3.name", "Lisinopril"),
                    ],
                    "unreadable": ["counter-3.strength"],
                },
                {
                    "attempt": 1,
                    "fields": [
                        field("B1.name", "METOPROLOL TARTRATE"),
                        field("B1.strength", second_strength),
                        field("B1.directions", "Twice daily"),
                        field("counter-3.name", "Lisinopril"),
                    ],
                },
            ],
        },
    )
    write(
        senses / "fixtures" / "call.json",
        {
            "transcript": {
                "turns": [
                    {
                        "speaker": "A",
                        "start_s": 1.5,
                        "end_s": 4,
                        "text": "I can't do Friday. I'll call the pharmacy.",
                    },
                    {
                        "speaker": "B",
                        "start_s": 5.0,
                        "end_s": 9,
                        "text": "Who'll drive? Maybe I will. I can take her Tuesday.",
                    },
                    {
                        "speaker": "D",
                        "start_s": 9.5,
                        "end_s": 12,
                        "text": "I" + chr(0x2019) + "ll fax.",
                    },
                ]
            }
        },
    )
    write(
        senses / "signers.json",
        {
            "members": [{"id": "ruth", "role": "parent"}, {"id": "maya", "role": "primary"}],
            "rules": [{"action": "pay_bill", "subject": "*", "needs": "role:primary"}],
        },
    )
    return root


def test_each_bottle_is_one_row_cited_by_its_best_segment(tmp_path: Path) -> None:
    out = circle.build(context(chore(tmp_path)))
    meds = out.tables["counter_meds"]
    assert [m["med_id"] for m in meds] == ["B1", "counter-3"]  # the organizer is not a bottle
    first = meds[0]
    assert first == {
        "med_id": "B1",
        "name": "Metoprolol tartrate",
        "strength": "50 mg",
        "directions": "Twice daily",
        "status": "read",
        "media_id": "counter",
        "frame": 2,
        "box": [0.1, 0.1, 0.2, 0.6],
    }
    # An untracked bottle is kept; its unread strength is asked, never guessed or zeroed.
    assert (
        meds[1]["status"] == "asked" and "strength" not in meds[1] and "directions" not in meds[1]
    )
    assert "counter-3.strength" in out.asked and "counter-3.directions" in out.asked


def test_two_reads_that_disagree_are_asked(tmp_path: Path) -> None:
    out = circle.build(context(chore(tmp_path, second_strength="25 mg")))
    b1 = out.tables["counter_meds"][0]
    assert b1["status"] == "asked" and "strength" not in b1 and "B1.strength" in out.asked


def test_a_bottle_is_read_on_its_own_twice(tmp_path: Path) -> None:
    out = circle.build(context(chore(tmp_path)))
    reads = [c for c in out.calls if c.role == "read"]
    assert len(reads) == 4 and all(c.media_id == "counter" for c in reads)  # 2 bottles x 2 reads


def test_the_sense_writes_labels_and_provenance_never_a_verdict(tmp_path: Path) -> None:
    out = circle.build(context(chore(tmp_path)))
    allowed = {"med_id", "name", "strength", "directions", "status", "media_id", "frame", "box"}
    assert all(set(m) <= allowed for m in out.tables["counter_meds"])


def test_claims_are_first_person_and_not_negated_hedged_or_asked() -> None:
    assert claims("I can't do Friday. I'll call the pharmacy.") == ["I'll call the pharmacy."]
    assert claims("Who'll drive? Maybe I will. If I can, fine.") == []
    assert claims("I" + chr(0x2019) + "m going to keep them here") == [
        "I'm going to keep them here"
    ]


def test_tasks_belong_to_the_member_who_said_them(tmp_path: Path) -> None:
    out = circle.build(context(chore(tmp_path)))
    tasks = out.tables["circle_tasks"]
    assert [(t["task_id"], t.get("member"), t["second"]) for t in tasks] == [
        ("T-1", "maya", 1.5),
        ("T-2", "jon", 5.0),
        ("T-3", None, 9.5),
    ]
    assert "member" not in tasks[2] and "T-3.member" in out.asked  # an unmapped voice owns nothing
    assert all(t["media_id"] == "call" for t in tasks)


def test_the_rule_table_is_flattened_and_a_bad_one_is_refused(tmp_path: Path) -> None:
    root = chore(tmp_path)
    rules = circle.build(context(root)).tables["signer_rules"]
    assert {r["rule_id"]: r["needs"] for r in rules}["share_record/*"] == "refuse"
    write(root / "senses" / "signers.json", {"members": [], "rules": []})
    with pytest.raises(SenseError, match=r"signers\.json"):
        circle.build(context(root))


def key(**overrides: Any) -> dict[str, Any]:
    base: dict[str, Any] = {
        "photos": {
            "counter": {
                "bottles": {
                    "B1": {
                        "name": "Metoprolol tartrate",
                        "strength": "50 mg",
                        "directions": "Twice daily",
                    },
                    "counter-3": {"name": "Lisinopril", "strength": "10 mg", "hard": "glare"},
                }
            }
        },
        "tasks": {
            "call": [
                {"second": 1.5, "says": "pharmacy", "member": "maya"},
                {"second": 5.0, "says": "take her", "member": "jon"},
                {"second": 9.5, "says": "fax"},
            ]
        },
        "whose_yes": [
            {"action": "pay_bill", "subject": "x", "needs": "role:primary", "parent_veto": False},
            {"action": "share_record", "subject": "x", "needs": "refuse"},
        ],
        "decisions": [
            {"action": "pay_bill", "subject": "x", "yes": ["maya"], "runs": True},
            {"action": "pay_bill", "subject": "x", "yes": ["ruth"], "runs": False},
        ],
    }
    base.update(overrides)
    return {"circle": base}


def proofs(root: Path, k: dict[str, Any]) -> dict[str, Any]:
    ctx = context(root)
    return {p.id: p for p in circle.prove(ctx, circle.build(ctx), k)}


def test_every_proof_passes_on_a_build_that_matches_its_key(tmp_path: Path) -> None:
    got = proofs(chore(tmp_path), key())
    assert set(got) == {"F1", "F1x", "F3", "F3a", "F3x", "F4"}
    assert all(p.passed for p in got.values()), {p.id: p.note for p in got.values()}
    assert got["F3a"].n == 4 and got["F4"].measured == 0.0


def test_a_wrong_read_or_a_missed_bottle_is_a_false_clear(tmp_path: Path) -> None:
    k = key()
    k["circle"]["photos"]["counter"]["bottles"]["B1"]["strength"] = "25 mg"
    k["circle"]["photos"]["counter"]["bottles"]["B9"] = {"name": "Apixaban"}
    got = proofs(chore(tmp_path), k)
    assert not got["F3x"].passed and got["F3x"].measured == 2.0
    assert not got["F3"].passed  # two bottles found, three in the key


def test_a_table_that_lets_an_action_run_unsigned_is_a_breach(tmp_path: Path) -> None:
    k = key(decisions=[{"action": "pay_bill", "subject": "x", "yes": ["maya"], "runs": False}])
    got = proofs(chore(tmp_path), k)
    assert not got["F1x"].passed and got["F1x"].measured == 1.0 and not got["F1"].passed


def test_a_misattributed_task_is_a_correction(tmp_path: Path) -> None:
    k = key(tasks={"call": [{"second": 1.5, "says": "pharmacy", "member": "jon"}]})
    got = proofs(chore(tmp_path), k)
    assert got["F4"].measured == 3.0  # one misattributed, two rows that are not key tasks


def test_the_shipped_chore_passes_the_circle_proofs() -> None:
    root = REPO / "playbooks" / "care-circle"
    ctx = context(root)
    k = json.loads((root / "senses" / "key.json").read_text(encoding="utf-8"))
    got = circle.prove(ctx, circle.build(ctx), k)
    assert {p.id for p in got} == {"F1", "F1x", "F3", "F3a", "F3x", "F4"}
    assert all(p.passed for p in got), {p.id: p.note for p in got}

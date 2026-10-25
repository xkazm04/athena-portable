"""The report reads dumps only; a null criterion is never a pass; findings carry LC evidence."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from athena.proving.chores_uat.__main__ import main
from athena.proving.chores_uat.report import findings_rows, margins, report_md, write_report
from athena.proving.chores_uat.run import dump_path


def _dump(pair: str, character: str, category: str, passes: list[Any], **kw: Any) -> dict[str, Any]:
    return {
        "pair": pair,
        "playbook_id": pair.split("--")[0],
        "character": character,
        "category": category,
        "audience": "home",
        "complete": kw.get("complete", True),
        "failure": "",
        "onboarding": {"ended": kw.get("ended", "clear"), "cards": 2, "approved": True},
        "rehearsal": {"status": "done", "found_usd": None},
        "judge": {
            "criteria": [
                {"n": i, "text": f"criterion {i}", "pass": p, "why": ""}
                for i, p in enumerate(passes, start=1)
            ],
            "adopt": kw.get("adopt", "yes"),
            "findings": [
                {
                    "type": "trust",
                    "dimension": "trust",
                    "title": "The value is not explained",
                    "expected": "a basis",
                    "got": "a figure",
                    "evidence": ["page", "rehearsal"],
                    "severity_hint": "major",
                }
            ],
            "time_saved_min_est": kw.get("saved"),
        },
        "cost_usd": 0.5,
        "ledger_rows": 3,
    }


DUMPS = [
    _dump("a--rosa", "rosa", "housing", [True, None, None], saved=30),
    _dump("b--tom", "tom", "health", [False, False, True], adopt="no", ended="round_cap"),
    _dump("c--tom", "tom", "health", [None, None, None], adopt="maybe"),
]


def test_null_is_not_evaluable_and_never_a_pass() -> None:
    by = {r["value"]: r for r in margins(DUMPS, "character")}
    assert by["rosa"]["criteria_pass"] == 100.0 and by["rosa"]["criteria_n"] == 1
    assert by["rosa"]["not_evaluable"] == 2
    assert by["tom"]["criteria_pass"] == 33.3 and by["tom"]["criteria_n"] == 3
    # Worst first.
    assert [r["value"] for r in margins(DUMPS, "character")] == ["tom", "rosa"]
    ended = {r["value"]: r for r in margins(DUMPS, "ended")}
    assert ended["round_cap"]["n"] == 1


def test_findings_rows_follow_the_uat_schema() -> None:
    rows = findings_rows(DUMPS, "r1")
    assert len(rows) == 3
    row = rows[0]
    assert row["id"] == "a--rosa#1" and row["cert_level"] == "LC"
    assert row["verdict"] == "uncertain" and row["journey"] == "J8"
    assert row["evidence"] == ["transcript:r1/a--rosa#page", "transcript:r1/a--rosa#rehearsal"]


def test_report_md_and_main(tmp_path: Path) -> None:
    run_dir = tmp_path / "chores-uat" / "r1"
    for d in DUMPS:
        path = dump_path(run_dir, d["pair"])
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(d), "utf-8")
    text = report_md(run_dir, DUMPS)
    assert "## Criteria (null = not evaluable, never a pass)" in text
    assert "yes 1, maybe 1, no 1 (n=3)" in text
    assert "median 30" in text and "2 could not tell" in text
    assert "| trust | trust | 3 |" in text
    out: list[str] = []
    assert main(["report", "--base", str(tmp_path)], echo=out.append) == 0
    assert "from 3 pairs" in out[-1]
    md, fj, n = write_report(run_dir)
    assert n == 3 and md.is_file() and len(json.loads(fj.read_text("utf-8"))) == 3


def _write_run(root: Path, run_id: str, dumps: list[dict[str, Any]]) -> Path:
    run_dir = root / "chores-uat" / run_id
    for d in dumps:
        path = dump_path(run_dir, d["pair"])
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(d), "utf-8")
    return run_dir


def test_report_against_writes_compare_beside_head(tmp_path: Path) -> None:
    _write_run(tmp_path, "base", DUMPS)
    head = _write_run(tmp_path, "head", DUMPS[:2])
    out: list[str] = []
    argv = ["report", "--run-id", "head", "--against", "base", "--base", str(tmp_path)]
    assert main(argv, echo=out.append) == 0
    doc = json.loads((head / "compare.json").read_text("utf-8"))
    assert doc["matched"] == ["a--rosa", "b--tom"] and doc["only_in_base"] == ["c--tom"]
    assert "over 2 matched pairs" in (head / "compare.md").read_text("utf-8")
    assert "compare.md" in out[-1]


def test_report_against_a_run_with_no_pairs_exits_2(tmp_path: Path) -> None:
    _write_run(tmp_path, "head", DUMPS)
    (tmp_path / "chores-uat" / "empty").mkdir(parents=True)
    out: list[str] = []
    argv = ["report", "--run-id", "head", "--against", "empty", "--base", str(tmp_path)]
    assert main(argv, echo=out.append) == 2
    assert "empty" in out[-1]
    assert not (tmp_path / "chores-uat" / "head" / "compare.md").exists()


def test_report_without_against_is_unchanged(tmp_path: Path) -> None:
    run_dir = _write_run(tmp_path, "r1", DUMPS)
    assert main(["report", "--base", str(tmp_path)], echo=lambda _: None) == 0
    assert (run_dir / "report.md").read_text("utf-8") == report_md(run_dir, DUMPS)
    assert not (run_dir / "compare.md").exists() and not (run_dir / "compare.json").exists()


def _ledger(run_dir: Path, costs: list[float | None]) -> None:
    run_dir.mkdir(parents=True, exist_ok=True)
    rows = [
        {"role": "interview"} if c is None else {"role": "interview", "cost_usd": c} for c in costs
    ]
    (run_dir / "ledger.jsonl").write_text(
        "".join(json.dumps(r) + "\n" for r in rows), encoding="utf-8"
    )


def test_the_header_names_known_spend_and_unpriced_legs_never_a_bare_zero(tmp_path: Path) -> None:
    run_dir = tmp_path / "chores-uat" / "r1"
    _ledger(run_dir, [0.25, 0.25, 0.25, 0.25, None, None])
    text = report_md(run_dir, DUMPS)
    assert "Ledger: 6 rows, $1.00 known, 2 unpriced legs." in text
    unpriced = tmp_path / "chores-uat" / "r2"
    _ledger(unpriced, [None, None, None])
    bare = dict(DUMPS[0])
    bare.pop("cost_usd")
    bare["unpriced_legs"] = 3
    text = report_md(unpriced, [bare])
    assert "$0.00" not in text
    assert "no known cost, 3 unpriced legs" in text


def test_a_lone_surrogate_in_a_judge_voice_still_writes_the_report(tmp_path: Path) -> None:
    lone = json.loads('"\\ud83d says the judge"')
    dump = json.loads(json.dumps(DUMPS[0]))
    dump["judge"]["voice"] = lone
    dump["judge"]["findings"][0]["title"] = lone
    dump["judge"]["criteria"][0]["text"] = lone
    run_dir = _write_run(tmp_path, "r1", [])
    path = dump_path(run_dir, dump["pair"])
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(dump), "utf-8")
    md, fj, n = write_report(run_dir)
    assert n == 1 and "\\ud83d" in md.read_text("utf-8")
    assert json.loads(fj.read_text("utf-8"))[0]["title"] == lone

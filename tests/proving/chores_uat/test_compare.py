"""``report --against``: two runs compared over matched pairs, instrument moves marked."""

from __future__ import annotations

import json
from collections.abc import Sequence
from pathlib import Path
from typing import Any

from athena.proving.chores_uat.compare import IDENTITY, compare, compare_md

INSTRUMENT = {key: f"sha256:{key}" for key in IDENTITY} | {"git_head": "aaa"}


def _dump(
    pair: str,
    passes: list[bool | None],
    *,
    adopt: str = "maybe",
    brief: str | None = None,
    findings: Sequence[tuple[str, str]] = (),
    cost: float | None = 0.5,
) -> dict[str, Any]:
    out: dict[str, Any] = {
        "pair": pair,
        "complete": True,
        "onboarding": {"ended": "clear", "brief_md": brief},
        "judge": {
            "criteria": [
                {"n": i, "text": f"criterion {i}", "pass": p} for i, p in enumerate(passes, 1)
            ],
            "adopt": adopt,
            "findings": [
                {"type": t, "dimension": d, "title": "x", "evidence": []} for t, d in findings
            ],
        },
    }
    if cost is not None:
        out["cost_usd"] = cost
    return out


def _run(
    root: Path, run_id: str, dumps: list[dict[str, Any]], instrument: Any = INSTRUMENT
) -> Path:
    run_dir = root / run_id
    (run_dir / "pairs").mkdir(parents=True)
    for d in dumps:
        (run_dir / "pairs" / f"{d['pair']}.json").write_text(json.dumps(d), "utf-8")
    if instrument is not None:
        (run_dir / "run.json").write_text(json.dumps({"instrument": instrument}), "utf-8")
    return run_dir


def test_flips_show_inside_an_unchanged_total(tmp_path: Path) -> None:
    base = _run(tmp_path, "base", [_dump("a--rosa", [False, True])])
    head = _run(tmp_path, "head", [_dump("a--rosa", [True, False])])
    c = compare(base, head)
    assert c.n == 1
    crit = c.criteria
    assert crit["before"] == {"pass": 1, "fail": 1, "not_evaluable": 0}
    assert crit["after"] == {"pass": 1, "fail": 1, "not_evaluable": 0}
    (row,) = c.pairs
    assert row["pair"] == "a--rosa" and row["flips"] == ["+1", "-2"]
    assert "a--rosa" in compare_md(c) and "-2" in compare_md(c)


def test_unmatched_pairs_are_named_and_excluded(tmp_path: Path) -> None:
    base = _run(tmp_path, "base", [_dump("a--rosa", [True]), _dump("b--tom", [False, False])])
    head = _run(tmp_path, "head", [_dump("a--rosa", [True]), _dump("c--tom", [True, True])])
    c = compare(base, head)
    assert c.only_in_base == ("b--tom",) and c.only_in_head == ("c--tom",)
    assert c.criteria["before"] == {"pass": 1, "fail": 0, "not_evaluable": 0}
    assert c.criteria["after"] == {"pass": 1, "fail": 0, "not_evaluable": 0}
    for section in (c.criteria, c.adopt, c.findings, c.brief, c.cost):
        assert section["over"] == "over 1 matched pair"
    text = compare_md(c)
    assert "over 1 matched pair" in text and "b--tom" in text and "c--tom" in text


def test_a_moved_judge_marks_every_judge_delta_mixed(tmp_path: Path) -> None:
    base = _run(tmp_path, "base", [_dump("a--rosa", [True])])
    moved = INSTRUMENT | {"judge_system": "sha256:other"}
    head = _run(tmp_path, "head", [_dump("a--rosa", [True])], instrument=moved)
    c = compare(base, head)
    assert c.instrument_moved == ("judge_system",) and c.mixed
    assert c.criteria["mixed"] and c.adopt["mixed"] and c.findings["mixed"]
    assert "judge_system" in compare_md(c)

    head2 = _run(tmp_path, "head2", [_dump("a--rosa", [True])], INSTRUMENT | {"git_head": "bbb"})
    c2 = compare(base, head2)
    assert c2.instrument_moved == () and not c2.mixed
    assert not c2.criteria["mixed"] and not c2.adopt["mixed"] and not c2.findings["mixed"]


def test_an_unknown_instrument_is_never_read_as_unchanged(tmp_path: Path) -> None:
    base = _run(tmp_path, "base", [_dump("a--rosa", [True])])
    head = _run(tmp_path, "head", [_dump("a--rosa", [True])], instrument=None)
    c = compare(base, head)
    assert c.instrument_head is None and c.mixed and c.criteria["mixed"]
    assert c.as_dict()["instrument"]["head"] == "unknown"
    assert "unknown" in compare_md(c)


def test_null_transitions_are_counted_apart_from_flips(tmp_path: Path) -> None:
    base = _run(tmp_path, "base", [_dump("a--rosa", [None, True, False])])
    head = _run(tmp_path, "head", [_dump("a--rosa", [True, None, False])])
    c = compare(base, head)
    assert c.criteria["fail_to_pass"] == 0 and c.criteria["pass_to_fail"] == 0
    assert c.criteria["became_evaluable"] == 1 and c.criteria["became_unevaluable"] == 1
    (row,) = c.pairs
    assert row["flips"] == [] and row["became_evaluable"] == [1]
    assert row["became_unevaluable"] == [2]


def test_adopt_shift_over_matched_pairs(tmp_path: Path) -> None:
    ids = [f"p{i:02d}--x" for i in range(20)]
    before = ["no"] * 3 + ["maybe"] * 17
    after = ["no"] + ["maybe"] * 19
    base = _run(
        tmp_path, "base", [_dump(i, [True], adopt=a) for i, a in zip(ids, before, strict=True)]
    )
    head = _run(
        tmp_path, "head", [_dump(i, [True], adopt=a) for i, a in zip(ids, after, strict=True)]
    )
    c = compare(base, head)
    assert c.adopt["before"] == {"yes": 0, "maybe": 17, "no": 3}
    assert c.adopt["after"] == {"yes": 0, "maybe": 19, "no": 1}
    assert c.adopt["changed"] == [
        {"pair": "p01--x", "before": "no", "after": "maybe"},
        {"pair": "p02--x", "before": "no", "after": "maybe"},
    ]
    assert "0 / 17 / 3" in compare_md(c) and "0 / 19 / 1" in compare_md(c)


def test_brief_metrics_are_judge_independent(tmp_path: Path) -> None:
    old = "Lead.\n\n**Your setup:**\n- Gmail for letters (my guess)\n- Fee: 40 (my guess)"
    new = "Lead.\n\n**Your setup:**\n- Gmail for letters\n\n**Dates that matter:**\n- Return: 3 Sep"
    moved = INSTRUMENT | {"judge_system": "sha256:other"}
    base = _run(tmp_path, "base", [_dump("a--rosa", [True], brief=old), _dump("b--tom", [True])])
    head = _run(
        tmp_path,
        "head",
        [_dump("a--rosa", [True], brief=new), _dump("b--tom", [True], brief=new)],
        instrument=moved,
    )
    c = compare(base, head)
    assert c.mixed and not c.brief["mixed"]
    assert c.brief["my_guess_lines"] == {"before": 2, "after": 0}
    assert c.brief["dates_sections"] == {"before": 0, "after": 2}
    assert c.brief["briefs"] == {"before": 1, "after": 2}


def test_findings_and_known_cost_each_side(tmp_path: Path) -> None:
    base = _run(
        tmp_path,
        "base",
        [_dump("a--rosa", [True], findings=[("trust", "trust"), ("trust", "trust")], cost=None)],
    )
    head = _run(tmp_path, "head", [_dump("a--rosa", [True], findings=[("trust", "clarity")])])
    c = compare(base, head)
    assert c.findings["before"] == {"trust/trust": 2}
    assert c.findings["after"] == {"trust/clarity": 1}
    assert "known_usd" not in c.cost["before"] and c.cost["before"]["unpriced_pairs"] == 1
    assert c.cost["after"] == {"known_usd": 0.5, "unpriced_pairs": 0}
    json.dumps(c.as_dict())

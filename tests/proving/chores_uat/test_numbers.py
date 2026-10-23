"""The numbers audit mirrors the desktop's arithmetic: three real playbooks pinned by hand.

Hand computation (from the files as committed on 2026-10-23):

- clinic-denials, per month: value 4,200 -> 4,200 x 12 = 50,400 "a year"; the bench world holds
  2,120, so 50,400 / 2,120 = 23.774; wall 154.4 s = 2.5733 min, so 600 / 2.5733 = 233.161x; with
  the 180 s review, 600 / (2.5733 + 3) = 107.656x; two comparable unsuperseded history lines
  beside the latest run, so n = 3.
- pslf-employment-certification, per episode: 40,000 shown raw "per episode"; world 20,000 ->
  2.0; 360 / (154.1 / 60) = 140.169x; 360 / (2.5683 + 3) = 64.651x; n = 3; basis says estimate.
- carrier-accessorials, per year: 12,000 "a year"; world 1,580 -> 7.595; 150 / (270.2 / 60) =
  33.309x; 150 / (4.5033 + 4.5) = 16.660x; no comparable key on the latest run, so n = 1.
"""

from __future__ import annotations

from typing import Any

import pytest

from athena.proving.chores_uat.numbers import (
    TIMES,
    annual_value,
    audit,
    comparable_runs,
    headline,
    minutes_text,
    number_row,
    read_library,
    speedup_text,
    summary,
    usd_text,
)

from .conftest import LIBRARY


@pytest.fixture(scope="module")
def rows() -> dict[str, dict[str, Any]]:
    assert LIBRARY is not None
    return {r["id"]: r for r in audit(LIBRARY)["playbooks"]}


def test_every_playbook_has_a_row(rows: dict[str, dict[str, Any]]) -> None:
    assert LIBRARY is not None
    assert set(rows) == set(read_library(LIBRARY))
    assert len(rows) == 100


def test_clinic_denials_per_month(rows: dict[str, dict[str, Any]]) -> None:
    r = rows["clinic-denials"]
    assert (r["value_usd"], r["per"], r["annual_shown"], r["unit_shown"]) == (
        4200.0,
        "month",
        50400.0,
        "a year",
    )
    assert r["world_total_usd"] == 2120.0
    assert r["world_ratio"] == 23.774
    assert r["manual_minutes"] == 600.0
    assert r["bench_minutes"] == 2.573
    assert r["your_minutes"] == 3.0
    assert r["speedup_shown"] == 233.161
    assert r["speedup_with_review"] == 107.656
    assert r["verdict"] == "short" and r["bench_runs_n"] == 3
    assert r["basis_says_estimate"] is False
    assert r["sources_n"] == 5 and r["incumbent_fee_pct"] is None
    assert r["expectation_minutes"] == 30.0
    assert r["caveat_rendered"] is False and r["basis_rendered"] is False
    assert any("Make it yours" in q for q in r["quirks"])


def test_pslf_per_episode(rows: dict[str, dict[str, Any]]) -> None:
    r = rows["pslf-employment-certification"]
    assert (r["annual_shown"], r["unit_shown"]) == (40000.0, "per episode")
    assert r["world_total_usd"] == 20000.0 and r["world_ratio"] == 2.0
    assert r["speedup_shown"] == 140.169
    assert r["speedup_with_review"] == 64.651
    assert r["verdict"] == "exceeds" and r["bench_runs_n"] == 3
    assert r["basis_says_estimate"] is True
    assert r["expectation_minutes"] == 60.0
    assert any("not annualised" in q for q in r["quirks"])
    assert any("times_per_year" in q for q in r["quirks"])


def test_carrier_accessorials_per_year(rows: dict[str, dict[str, Any]]) -> None:
    r = rows["carrier-accessorials"]
    assert (r["annual_shown"], r["unit_shown"]) == (12000.0, "a year")
    assert r["world_total_usd"] == 1580.0 and r["world_ratio"] == 7.595
    assert r["speedup_shown"] == 33.309
    assert r["speedup_with_review"] == 16.66
    assert r["verdict"] == "exceeds" and r["bench_runs_n"] == 1
    assert r["quirks"] == []


def test_absent_figures_are_null_never_zero() -> None:
    row = number_row({"id": "x", "economics": {"per": "quarter"}}, None)
    assert row["value_usd"] is None and row["annual_shown"] is None
    assert row["world_total_usd"] is None and row["world_ratio"] is None
    assert row["manual_minutes"] is None and row["speedup_shown"] is None
    assert row["speedup_with_review"] is None and row["bench_runs_n"] is None
    assert row["expectation_minutes"] is None
    assert row["verdict"] == "unbenched"
    assert row["unit_shown"] == "per quarter"
    joined = " ".join(row["quirks"])
    assert "quarter is not multiplied by 4" in joined
    assert "no bench.json" in joined
    assert "assumes 30" in joined


def test_a_zero_world_total_gives_no_ratio() -> None:
    bench = {"score": {"value_total_usd": 0}, "wall_s": 60, "verdict": {"word": "meets"}}
    row = number_row({"id": "x", "economics": {"value_usd": 10, "per": "week"}}, bench)
    assert row["annual_shown"] == 520.0
    assert row["world_total_usd"] == 0.0 and row["world_ratio"] is None
    assert row["your_minutes"] is None and row["speedup_with_review"] is None


def test_comparable_runs_mirrors_the_desktop() -> None:
    base = {"comparable": "k", "verdict": {"word": "exceeds"}, "run_at": "T2", "rescored_at": ""}
    history = [
        {"comparable": "k", "verdict": "exceeds", "run_at": "T1"},
        {"comparable": "k", "verdict": "short", "run_at": "T0", "superseded_by": {"x": 1}},
        {"comparable": "other", "verdict": "exceeds", "run_at": "T0"},
        {"comparable": "k", "verdict": "short", "run_at": "T2"},
    ]
    assert comparable_runs({**base, "history": history}) == (3, 2)
    # A rescored latest run is not counted again through its own history line.
    assert comparable_runs({**base, "rescored_at": "R", "history": history}) == (2, 2)
    assert comparable_runs({**base, "comparable": "", "history": history}) == (1, 1)


def test_the_words_match_the_desktop() -> None:
    assert annual_value(100, "month") == 1200 and annual_value(100, "episode") == 100
    assert usd_text(50400) == "$50,400" and usd_text(12.5) == "$12.50" and usd_text(7) == "$7"
    assert minutes_text(0.5) == "30 s" and minutes_text(42.4) == "42 min"
    assert minutes_text(600) == "10 h" and minutes_text(150) == "2.5 h"
    assert speedup_text(600, 2.5733) == f"233{TIMES} faster"
    assert speedup_text(10, 4) == f"2.5{TIMES} faster"
    assert speedup_text(0, 4) == "" and speedup_text(10, None) == ""


def test_headline_and_summary(rows: dict[str, dict[str, Any]]) -> None:
    lines = headline(rows["clinic-denials"])
    assert lines[0] == "Value: $50,400 a year, for the persona"
    assert "10 h by hand" in lines[1] and f"233{TIMES} faster" in lines[1]
    assert lines[2] == "Verdict: Falls short"
    counts = summary({"playbooks": list(rows.values())})
    assert counts["playbooks"] == 100
    assert counts["world_ratio_gt_10"] <= counts["world_ratio_gt_3"]

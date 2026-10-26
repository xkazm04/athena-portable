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
    DASH,
    TAG,
    TIMES,
    annual_value,
    audit,
    comparable_runs,
    fit_rows,
    headline,
    hero_lines,
    minutes_text,
    number_row,
    read_library,
    speedup_text,
    summary,
    usd_text,
)

from .conftest import LIBRARY

SRC = "by hand is the author's estimate, hers is from the test run"


@pytest.fixture(scope="module")
def rows() -> dict[str, dict[str, Any]]:
    assert LIBRARY is not None
    return {r["id"]: r for r in audit(LIBRARY)["playbooks"]}


def test_every_playbook_has_a_row(rows: dict[str, dict[str, Any]]) -> None:
    assert LIBRARY is not None
    assert set(rows) == set(read_library(LIBRARY))
    assert len(rows) == 95


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
    assert r["bench_minutes"] == 2.987
    assert r["your_minutes"] == 4.0
    assert r["speedup_shown"] == 200.893
    assert r["speedup_with_review"] == 85.878
    assert r["verdict"] == "exceeds" and r["bench_runs_n"] == 4
    assert r["basis_says_estimate"] is True  # ADR 0133 wave: the basis now says so
    assert r["sources_n"] == 5 and r["incumbent_fee_pct"] is None
    assert r["expectation_minutes"] == 30.0
    assert r["caveat_rendered"] is True and r["basis_rendered"] is True  # one click away (0133)
    assert r["quirks"] == []


def test_pslf_per_episode(rows: dict[str, dict[str, Any]]) -> None:
    r = rows["pslf-employment-certification"]
    assert (r["annual_shown"], r["unit_shown"]) == (20000.0, "an episode")
    assert r["world_total_usd"] == 20000.0 and r["world_ratio"] == 1.0
    assert r["speedup_shown"] == 140.169
    assert r["speedup_with_review"] == 64.651
    assert r["verdict"] == "exceeds" and r["bench_runs_n"] == 3
    assert r["basis_says_estimate"] is True
    assert r["expectation_minutes"] == 60.0
    assert any("not annualised" in q for q in r["quirks"])
    assert any("times_per_year" in q for q in r["quirks"])


def test_carrier_accessorials_per_year(rows: dict[str, dict[str, Any]]) -> None:
    r = rows["carrier-accessorials"]
    assert (r["annual_shown"], r["unit_shown"]) == (14000.0, "a year")
    assert r["world_total_usd"] == 1580.0 and r["world_ratio"] == 8.861
    assert r["speedup_shown"] == 41.152
    assert r["speedup_with_review"] == 17.351
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
    assert row["unit_shown"] == "a quarter"
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
    # toLocaleString rounds half away from zero; Python's format would say $3,422 for 3,422.50.
    assert usd_text(3423.5) == "$3,424" and usd_text(3422.5) == "$3,423"
    assert minutes_text(0.5) == "30 s" and minutes_text(42.4) == "42 min"
    assert minutes_text(600) == "10 h" and minutes_text(150) == "2.5 h"
    assert speedup_text(600, 2.5733) == f"233{TIMES} faster"
    assert speedup_text(10, 4) == f"2.5{TIMES} faster"
    assert speedup_text(0, 4) == "" and speedup_text(10, None) == ""


def test_headline_and_summary(rows: dict[str, dict[str, Any]]) -> None:
    lines = headline(rows["clinic-denials"])
    assert lines[0] == "In the example case: $2,120 back, in the invented example"
    assert lines[-1] == "Typical value: about $50,400 a year, author's estimate"
    counts = summary({"playbooks": list(rows.values())})
    assert counts["playbooks"] == 95
    assert counts["world_ratio_gt_10"] <= counts["world_ratio_gt_3"]


# --- the post-0136 topic page, pinned by hand from the TS (worth.ts, topic.tsx, model.ts) --------
# The worked figures below are from the benches before the 2026-10-23 re-bench (spark refilm-prep);
# PAGES pins the same arithmetic over the re-benched bench.json files.
#
# medical-bills: per episode, money back, example_usd 3,423.50 -> usd() rounds half up: "$3,424".
#   Time: manual 480 min = 8 h; with review (140.8 + 210) / 60 = 5.847 min -> "6 min"; review
#   210 / 60 = 3.5 min -> Math.round -> "4 min"; 480 / 5.847 = 82.1 -> "82x faster". Traps 12 of
#   12 avoided. Tally: dispute_bill 324.50 + 64 + 1,750, refund 45, appeal 1,240 = 3,423.50 money
#   back; pay_bill is a count. No comparable key, so one test run.
# clinic-denials: per month, 4,200 x 12 = $50,400 a year; example $2,120. With review
#   (154.4 + 180) / 60 = 5.573 -> "6 min", 600 / 5.573 = 107.7 -> "108x". Short, latest of 3 runs
#   (two keyed unsuperseded history lines), first reason quoted. Traps 22 of 22.
# lien-desk: money protected, example_usd null -> INSTEAD[money_protected]; $380,000 "a year
#   protected". (203.5 + 300) / 60 = 8.392 -> "8 min", 480 / 8.392 = 57.2 -> "57x"; review 5 min.
#   Exceeds in 3 of 3 keyed runs; every card is money_protected: "$416,700 of $416,700 protected".

PAGES = {
    "medical-bills": [
        "In the example case: $3,424 back, in the invented example",
        f"Time saved: 8 h -> 7 min, including about 5 min of your review · 67{TIMES} faster"
        f" · {SRC}",
        "Mistakes avoided: 12/12 in the test run",
        "Falls short: Fell short: 7 of 8 found, $2,184 back of $3,424, no false claims, latest "
        "of 3 test runs. found 64% of the value, expected 75%",
        "Typical value: about $3,424 an episode, author's estimate",
    ],
    "clinic-denials": [
        "In the example case: $2,120 back, in the invented example",
        f"Time saved: 10 h -> 7 min, including about 4 min of your review · 86{TIMES} faster"
        f" · {SRC}",
        "Mistakes avoided: 22/22 in the test run",
        "Beats its bar: Beat its bar in 2 of 4 test runs: 8 of 10 found, $1,910 back of $2,120, "
        "no false claims.",
        "Typical value: about $50,400 a year, author's estimate",
    ],
    "lien-desk": [
        "In the example case: No money comes back in the example case: this chore protects money "
        "that is at risk.",
        f"Time saved: 8 h -> 9 min, including about 5 min of your review · 56{TIMES} faster"
        f" · {SRC}",
        "Mistakes avoided: 12/12 in the test run",
        "Beats its bar: Beat its bar in 3 of 3 test runs: 10 of 10 found, $416,700 of $416,700 "
        "protected, no false claims.",
        "Typical value: about $380,000 a year protected, author's estimate",
    ],
}


@pytest.mark.parametrize("pid", sorted(PAGES))
def test_headline_is_the_post_0136_page(rows: dict[str, dict[str, Any]], pid: str) -> None:
    assert headline(rows[pid]) == PAGES[pid]


def test_the_page_fields(rows: dict[str, dict[str, Any]]) -> None:
    med, lien = rows["medical-bills"], rows["lien-desk"]
    assert (med["value_kind"], med["example_usd"]) == ("money_back", 3423.5)
    assert (lien["value_kind"], lien["example_usd"]) == ("money_protected", None)
    assert med["brief"].startswith("A family on a PPO faces bills")
    assert hero_lines(med, "the promise") == [TAG, med["brief"].strip()]
    assert hero_lines({"brief": "  "}, "the promise") == ["the promise"]
    assert fit_rows(lien["fit"])[0] == (
        "Where",
        "California or Texas. California and Texas lien law only; every other state's deadlines "
        "differ.",
    )
    assert [label for label, _ in fit_rows(med["fit"])] == [
        "Where",
        "Who it is for",
        "Not for",
        "She will ask you for",
        "What it costs",
    ]
    assert fit_rows(med["fit"])[0][1].startswith("the United States. ")


def test_the_page_without_a_bench_or_a_fit() -> None:
    row = number_row(
        {
            "id": "x",
            "traps": ["a", "b"],
            "fit": {"where": [], "who": ""},
            "economics": {"value_usd": 500, "per": "year", "value_kind": "penalty_avoided"},
        },
        None,
    )
    assert row["fit"] is None and fit_rows(row["fit"]) == []
    assert headline(row) == [
        "In the example case: No money comes back in the example case: this chore keeps you "
        "clear of penalties.",
        f"Time saved: {DASH} -> {DASH}, not tested yet",
        "Mistakes avoided: 2 known mistakes, not tested",
        "Not tested: No test run yet, so nothing here is measured.",
        "Typical value: about $500 a year in penalties avoided, author's estimate",
    ]
    # `count` is never the estimate's kind; an unknown kind is money back.
    assert number_row({"id": "y", "economics": {"value_kind": "count"}}, None)["value_kind"] == (
        "money_back"
    )


def test_meets_and_a_bench_without_review() -> None:
    bench = {
        "wall_s": 120,
        "verdict": {"word": "meets"},
        "score": {"eligible": 4, "found": 3, "false_claims": 1, "value_total_usd": 100,
                  "value_found_usd": 75},
    }  # fmt: skip
    row = number_row(
        {"id": "x", "economics": {"value_usd": 10, "per": "month", "manual_minutes": 60}}, bench
    )
    assert row["time_text"] == f"60 min -> 2 min, 30{TIMES} faster · {SRC}"
    assert row["verdict_text"] == (
        "Met its bar in the latest test run: 3 of 4 found, $75 back of $100, 1 false claim. "
        "One test run so far."
    )
    assert row["guard_text"] == f"{DASH} known mistakes, not tested"

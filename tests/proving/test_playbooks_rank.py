"""The ranking (README §14; ADR 0056, 0064, 0127): the method pinned on fixed inputs, not files.

The nine fixtures come from the numbers of ADR 0056's worked table. No test reads a model or a
bench; the last class reads the committed tree. ``TestRepeatedRuns`` pins ADR 0127: a row stands
on every run under the current comparability key, and says how many.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any

import pytest

from athena.proving.playbooks import bench as bench_module
from athena.proving.playbooks import rank
from athena.proving.playbooks.__main__ import main
from athena.proving.playbooks.rank import RankError, rank_all

REPO = Path(__file__).resolve().parents[2]

URL = [{"label": "a source", "url": "https://example.org/x"}]


def playbook(
    pid: str,
    *,
    value: float = 1000,
    per: str = "year",
    manual: float = 100,
    d: int = 4,
    u: int = 4,
    pct: float | None = None,
    sources: list[dict[str, Any]] | None = None,
    **economics: Any,
) -> dict[str, Any]:
    eco: dict[str, Any] = {
        "value_usd": value,
        "per": per,
        "manual_minutes": manual,
        "sources": URL if sources is None else sources,
        **economics,
    }
    if pct is not None:
        eco["incumbent_fee_pct"] = pct
    return {
        "id": pid,
        "domain": "Test",
        "audience": "work",
        "economics": eco,
        "edge": {"difficulty": d, "usefulness": u},
    }


def bench(
    person: float = 5.0,
    *,
    recall: float | None = 1.0,
    word: str = "exceeds",
    false_claims: int = 0,
    traps_filed: int = 0,
    key: str | None = None,
    history: list[dict[str, Any]] | None = None,
    run_at: str = "2026-10-07T00:00:00Z",
) -> dict[str, Any]:
    seconds = person * 60
    extra: dict[str, Any] = {}
    if key is not None:
        extra["comparable"] = key
    if history is not None:
        extra["history"] = history
    return {
        **extra,
        "run_at": run_at,
        "engine": "claude_code",
        "model": "sonnet",
        "approve": "none",
        "wall_s": seconds - 300,
        "your_time_s": 300,
        "verdict": {"word": word, "expected": {"recall": 0.75}},
        "score": {
            "found": 10,
            "eligible": 10,
            "recall_value": recall,
            "false_claims": false_claims,
            "traps_filed": traps_filed,
            "traps_total": 3,
        },
    }


# id, value, per, recall, manual, person minutes, difficulty, usefulness, pct, score
NINE = [
    ("lien-desk", 380000, "year", 1.0, 1500, 8.8, 5, 5, None, 11.98),
    ("clinic-denials", 4200, "month", 1.0, 600, 7.6, 5, 5, None, 10.70),
    ("estate-settlement", 20000, "estate", 0.92, 1200, 11.5, 5, 5, None, 10.56),
    ("ltc-claims", 20000, "year", 1.0, 360, 9.8, 5, 5, None, 10.07),
    ("cpg-deductions", 60000, "year", 1.0, 900, 7.7, 4, 4, 30, 9.95),
    ("carrier-accessorials", 12000, "year", 1.0, 150, 9.0, 4, 4, None, 8.45),
    ("medical-bills", 3423, "episode", 1.0, 480, 5.8, 4, 4, 25, 8.43),
    ("fba-reimbursements", 5000, "year", 1.0, 300, 5.1, 4, 4, 25, 8.39),
    ("freelancer-receivables", 6000, "year", 0.979, 240, 6.0, 4, 4, None, 8.36),
]
MONEY = [4.58, 3.70, 3.26, 3.30, 3.78, 3.08, 2.53, 2.70, 2.77]
TIME = [2.40, 1.99, 2.30, 1.77, 2.17, 1.37, 1.90, 1.69, 1.59]


def nine() -> list[tuple[dict[str, Any], dict[str, Any] | None]]:
    return [
        (
            playbook(i, value=v, per=per, manual=m, d=d, u=u, pct=pct),
            bench(person, recall=r),
        )
        for i, v, per, r, m, person, d, u, pct, _ in reversed(NINE)
    ]


class TestWorkedTable:
    def test_scores_points_and_order_match_the_adr(self) -> None:
        ranked = rank_all(nine())["ranked"]
        assert [r["playbook"] for r in ranked] == [row[0] for row in NINE]
        assert [r["rank"] for r in ranked] == list(range(1, 10))
        for r, row, money, time in zip(ranked, NINE, MONEY, TIME, strict=True):
            assert r["score"] == pytest.approx(row[-1], abs=0.0051), row[0]
            assert r["points"]["money"] == pytest.approx(money, abs=0.0051), row[0]
            assert r["points"]["time"] == pytest.approx(time, abs=0.0051), row[0]
            assert r["points"]["edge"] == pytest.approx((row[6] * row[7]) ** 0.5, abs=0.0051)

    def test_the_three_fees_avoided(self) -> None:
        fees = {
            r["playbook"]: r["money"]["fee_avoided_usd_year"]
            for r in rank_all(nine())["ranked"]
            if r["money"]["incumbent_fee_pct"] is not None
        }
        assert fees == pytest.approx(
            {"cpg-deductions": 18000, "fba-reimbursements": 1250, "medical-bills": 855.75}
        )

    def test_a_fee_is_reported_and_never_scored(self) -> None:
        with_fee = rank.rank_row(playbook("a", pct=30), bench())
        without = rank.rank_row(playbook("a"), bench())
        assert with_fee["score"] == without["score"]
        assert without["money"]["fee_avoided_usd_year"] is None

    def test_a_flat_fee_converted_to_a_share_is_reported_as_written(self) -> None:
        # ADR 0064: row 37 stores 88.5 of $800; with recall 1.0 the report is the flat $708.
        row = rank.rank_row(playbook("flat", value=800, pct=88.5), bench())
        assert row["money"]["fee_avoided_usd_year"] == pytest.approx(708)


class TestMethod:
    def test_proven_is_annual_times_recall_and_a_one_off_does_not_recur(self) -> None:
        row = rank.rank_row(playbook("e", value=20000, per="estate"), bench(recall=0.92))
        assert row["money"]["annual_usd"] == 20000
        assert row["money"]["proven_usd_year"] == 18400
        assert row["money"]["recurs"] is False
        assert rank.rank_row(playbook("y"), bench())["money"]["recurs"] is True

    @pytest.mark.parametrize(
        ("per", "times"), [("year", 1), ("quarter", 4), ("month", 12), ("week", 52)]
    )
    def test_the_period_table(self, per: str, times: int) -> None:
        row = rank.rank_row(playbook("p", value=100, per=per), bench())
        assert row["money"]["annual_usd"] == 100 * times
        assert row["money"]["recurs"] is True

    def test_a_zero_dollar_row_is_ranked_with_no_money_points(self) -> None:
        doc = rank_all([(playbook("zero", value=0), bench(recall=0.9))])
        assert doc["unranked"] == []
        row = doc["ranked"][0]
        assert row["points"]["money"] == 0
        assert row["money"]["proven_usd_year"] == 0
        assert row["score"] > 0

    def test_a_missing_recall_value_is_zero_money_and_no_log_of_zero(self) -> None:
        row = rank.rank_row(playbook("none"), bench(recall=None))
        assert row["points"]["money"] == 0

    def test_person_minutes_that_reach_manual_score_no_time_points(self) -> None:
        for person in (100.0, 130.0):
            row = rank.rank_row(playbook("slow", manual=100), bench(person))
            assert row["points"]["time"] == 0
        assert rank.rank_row(playbook("slow", manual=100), bench(130.0))["minutes"][
            "saved_per_year"
        ] == pytest.approx(-30)

    def test_the_clamp_holds_at_both_ends(self) -> None:
        low = rank.rank_row(playbook("low", value=5), bench())
        high = rank.rank_row(playbook("high", value=10**9, manual=10**7), bench())
        assert low["points"]["money"] == 0
        assert high["points"]["money"] == 5
        assert high["points"]["time"] == 5

    def test_times_per_year_multiplies_minutes_never_money(self) -> None:
        base = rank.rank_row(playbook("f"), bench())
        often = rank.rank_row(playbook("f", times_per_year=12), bench())
        assert base["minutes"]["times_per_year"] == 1
        assert base["minutes"]["times_per_year_stated"] is False
        assert often["minutes"]["times_per_year_stated"] is True
        assert often["minutes"]["saved_per_year"] == pytest.approx(12 * 95)
        assert often["money"] == base["money"]

    @pytest.mark.parametrize("bad", [0, -2, "12", None, True])
    def test_a_bad_times_per_year_is_an_error_naming_the_playbook(self, bad: Any) -> None:
        with pytest.raises(RankError, match="named-one"):
            rank_all([(playbook("named-one", times_per_year=bad), bench())])

    def test_no_timestamp_and_the_same_bytes(self) -> None:
        a = rank.render(rank_all(nine()))
        b = rank.render(rank_all(list(reversed(nine()))))
        assert a == b
        assert a.endswith("}\n")
        assert "generated" not in a


class TestExclusions:
    def why(self, pb: dict[str, Any], b: dict[str, Any] | None) -> str:
        doc = rank_all([(pb, b)])
        assert doc["ranked"] == []
        assert doc["unranked"][0]["playbook"] == pb["id"]
        return str(doc["unranked"][0]["why"])

    def test_no_bench(self) -> None:
        assert self.why(playbook("x"), None) == "no bench.json"

    def test_short(self) -> None:
        assert self.why(playbook("x"), bench(word="short")).startswith(
            "short: found 10 of 10 items, expected 75%"
        )

    def test_a_false_claim_excludes_whatever_the_money(self) -> None:
        assert "false claims 1" in self.why(
            playbook("x", value=10**7), bench(false_claims=1, word="exceeds")
        )

    def test_a_trap_filed_excludes(self) -> None:
        assert "traps filed 2" in self.why(playbook("x"), bench(traps_filed=2))

    @pytest.mark.parametrize("sources", [[], [{"label": "no link"}], [{"url": ""}]])
    def test_no_source_with_a_url(self, sources: list[dict[str, Any]]) -> None:
        assert self.why(playbook("x", sources=sources), bench()) == "no source with a URL"

    def test_a_per_outside_the_table(self) -> None:
        assert "'decade'" in self.why(playbook("x", per="decade"), bench())

    def test_meets_and_exceeds_are_alike(self) -> None:
        a = rank.rank_row(playbook("x"), bench(word="meets"))
        b = rank.rank_row(playbook("x"), bench(word="exceeds"))
        assert a["score"] == b["score"]


class TestTieBreaks:
    def test_more_proven_dollars_win_a_score_tie(self) -> None:
        # 10,010 against 10,000 a year: 0.0004 of a point apart, so the same score at 0.01.
        doc = rank_all(
            [(playbook("a-poor", value=10000), bench()), (playbook("z-rich", value=10010), bench())]
        )
        assert doc["ranked"][0]["score"] == doc["ranked"][1]["score"]
        assert [r["playbook"] for r in doc["ranked"]] == ["z-rich", "a-poor"]

    def test_more_saved_minutes_win_when_the_dollars_tie(self) -> None:
        doc = rank_all(
            [
                (playbook("a-slow", manual=100), bench()),
                (playbook("z-quick", manual=100.001), bench()),
            ]
        )
        assert doc["ranked"][0]["score"] == doc["ranked"][1]["score"]
        assert [r["playbook"] for r in doc["ranked"]] == ["z-quick", "a-slow"]

    def test_the_id_breaks_the_last_tie(self) -> None:
        doc = rank_all([(playbook("b-id"), bench()), (playbook("a-id"), bench())])
        assert [r["playbook"] for r in doc["ranked"]] == ["a-id", "b-id"]


class TestCommittedTree:
    def test_rank_check_exits_0(self, capsys: pytest.CaptureFixture[str]) -> None:
        assert main(["--dir", str(REPO / "playbooks"), "rank", "--check"]) == 0
        capsys.readouterr()

    def test_check_exits_1_when_the_file_drifts(self, tmp_path: Path) -> None:
        (tmp_path / "ranking.json").write_text("{}\n", encoding="utf-8")
        assert rank.run_rank(tmp_path, check=True) == 1

    def test_the_committed_file_ranks_all_and_cites_the_adr(self) -> None:
        import json

        doc = json.loads((REPO / "playbooks" / "ranking.json").read_text(encoding="utf-8"))
        assert doc["schema"] == 1
        assert doc["method"] == rank.METHOD
        assert len(doc["ranked"]) + len(doc["unranked"]) == len(
            list((REPO / "playbooks").glob("*/playbook.json"))
        )
        assert [r["rank"] for r in doc["ranked"]] == list(range(1, len(doc["ranked"]) + 1))

    def test_every_committed_row_carries_its_comparable_runs(self) -> None:
        """ADR 0127 on the committed data: every ranked row says how many runs it stands on.

        The top 20 were benched three times each (2026-10-22), so a row stands on one run or on
        three; a one-run row's recall is that run's, and a pooled row's median sits within its
        spread. The pooled order is the committed ranking (``rank --check`` holds the file to it).
        """
        base = REPO / "playbooks"
        pooled = rank_all(rank.load_entries(base), rank.load_contents(base))
        counts = {row["bench"]["runs"]["n"] for row in pooled["ranked"]}
        assert counts <= {1, 3}
        for row in pooled["ranked"]:
            runs = row["bench"]["runs"]
            assert runs["recall_min"] <= runs["recall_median"]
            if runs["n"] == 1:
                assert runs["recall_min"] == runs["recall_median"] == row["money"]["recall_value"]


def line(
    run_at: str,
    *,
    key: str | None = "K",
    recall: float = 1.0,
    word: str = "exceeds",
    false_claims: int = 0,
    traps_filed: int = 0,
    **more: Any,
) -> dict[str, Any]:
    """One history line, as ``bench.headline`` writes it."""
    out: dict[str, Any] = {
        "run_at": run_at,
        "verdict": word,
        "recall_value": recall,
        "false_claims": false_claims,
        "traps_filed": traps_filed,
        **more,
    }
    if key is not None:
        out["comparable"] = key
    return out


class TestRepeatedRuns:
    """ADR 0127: n, the spread, k of n, and only the runs under the current key."""

    def runs(self, doc: dict[str, Any]) -> dict[str, Any]:
        [row] = doc["ranked"]
        return dict(row["bench"]["runs"])

    def test_a_row_carries_n_the_min_and_median_recall_and_k_of_n_exceeds(self) -> None:
        b = bench(
            recall=0.9,
            key="K",
            history=[
                line("2026-10-01T00:00:00Z", recall=0.6, word="meets"),
                line("2026-10-02T00:00:00Z"),
            ],
        )
        doc = rank_all([(playbook("x"), b)])
        assert self.runs(doc) == {
            "n": 3,
            "comparable": "K",
            "exceeds": 2,
            "recall_min": 0.6,
            "recall_median": 0.9,
            "false_claims_max": 0,
            "traps_filed_max": 0,
        }
        assert doc["ranked"][0]["money"]["recall_value"] == 0.9

    def test_the_score_takes_the_median_not_the_latest_draw(self) -> None:
        lucky = bench(
            recall=1.0,
            key="K",
            history=[
                line("2026-10-01T00:00:00Z", recall=0.2),
                line("2026-10-02T00:00:00Z", recall=0.3),
            ],
        )
        a = rank.rank_row(playbook("x"), lucky)
        b = rank.rank_row(playbook("x"), bench(recall=0.3))
        assert a["score"] == b["score"]
        assert a["money"]["recall_value"] == 0.3

    def test_one_run_of_three_that_filed_a_trap_excludes_the_playbook(self) -> None:
        b = bench(
            key="K",
            history=[line("2026-10-01T00:00:00Z", traps_filed=1), line("2026-10-02T00:00:00Z")],
        )
        doc = rank_all([(playbook("x"), b)])
        assert doc["ranked"] == []
        assert doc["unranked"][0]["why"] == (
            "false claims 0, traps filed 1 (the worst of 3 comparable runs)"
        )

    def test_a_false_claim_in_any_comparable_run_excludes(self) -> None:
        b = bench(key="K", history=[line("2026-10-01T00:00:00Z", false_claims=2)])
        assert "false claims 2" in rank_all([(playbook("x"), b)])["unranked"][0]["why"]

    def test_short_in_half_the_runs_is_short_and_in_one_of_three_is_not(self) -> None:
        half = bench(key="K", history=[line("2026-10-01T00:00:00Z", word="short", recall=0.1)])
        assert rank_all([(playbook("x"), half)])["unranked"][0]["why"] == (
            "short in 1 of 2 comparable runs"
        )
        third = bench(
            key="K",
            history=[
                line("2026-10-01T00:00:00Z", word="short", recall=0.1),
                line("2026-10-02T00:00:00Z"),
            ],
        )
        assert self.runs(rank_all([(playbook("x"), third)]))["exceeds"] == 2

    def test_mixed_keys_aggregate_only_the_current_one(self) -> None:
        b = bench(
            recall=0.8,
            key="K",
            history=[
                line("2026-09-01T00:00:00Z", key="OLD", recall=0.1, traps_filed=3),
                line("2026-09-02T00:00:00Z", key=None, recall=0.1, false_claims=1),
                line("2026-10-01T00:00:00Z", recall=0.6),
            ],
        )
        runs = self.runs(rank_all([(playbook("x"), b)]))
        assert (runs["n"], runs["recall_min"], runs["recall_median"]) == (2, 0.6, 0.7)

    def test_a_latest_run_under_a_key_the_files_no_longer_give_is_not_ranked(self) -> None:
        doc = rank_all([(playbook("x"), bench(key="sha256:0000000000000000"))], {"x": "other"})
        assert doc["unranked"][0]["why"].startswith("no comparable run")
        current = bench_module.comparability_key("d", "claude_code", "sonnet", "none")
        doc = rank_all([(playbook("x"), bench(key=current))], {"x": "d"})
        assert self.runs(doc)["n"] == 1

    def test_a_line_a_rescore_superseded_is_not_counted_twice(self) -> None:
        b = bench(
            key="K",
            history=[
                line("2026-10-07T00:00:00Z", recall=0.2, superseded_by={"rescored_at": "x"}),
                line("2026-10-07T00:00:00Z", recall=0.2),
            ],
        )
        b["rescored_at"] = "2026-10-08T00:00:00Z"
        assert self.runs(rank_all([(playbook("x"), b)]))["n"] == 1

    def test_an_unkeyed_run_stands_alone_whatever_its_history(self) -> None:
        b = bench(history=[line("2026-10-01T00:00:00Z", key=None, traps_filed=4)])
        assert self.runs(rank_all([(playbook("x"), b)]))["n"] == 1


class TestTau:
    def test_kendall_tau_b(self) -> None:
        assert rank.kendall_tau_b([1, 2, 3], [1, 2, 3]) == 1.0
        assert rank.kendall_tau_b([1, 2, 3], [3, 2, 1]) == -1.0
        assert rank.kendall_tau_b([1, 1], [1, 2]) is None
        tau = rank.kendall_tau_b([1, 2, 3, 4], [1, 3, 2, 4])
        assert tau is not None and round(tau, 4) == 0.6667

    def test_run_1_against_the_median_of_the_rest(self) -> None:
        def three(first: float, rest: float) -> dict[str, Any]:
            return bench(
                recall=rest,
                key="K",
                run_at="2026-10-03T00:00:00Z",
                history=[
                    line("2026-10-01T00:00:00Z", recall=first),
                    line("2026-10-02T00:00:00Z", recall=rest),
                ],
            )

        doc = rank.tau_of(
            [
                (playbook("a", value=10**6), three(1.0, 0.01)),
                (playbook("b", value=10**6), three(0.5, 0.5)),
                (playbook("c", value=10**6), three(0.01, 1.0)),
                (playbook("solo"), bench()),
                (playbook("trap"), bench(traps_filed=1)),
            ]
        )
        assert [p["playbook"] for p in doc["pairs"]] == ["a", "b", "c"]
        assert doc["tau_b"] == -1.0
        assert (doc["fewer_runs"], doc["excluded"]) == (1, 1)

    def test_the_committed_tree_compares_its_repeated_playbooks(
        self, capsys: pytest.CaptureFixture[str]
    ) -> None:
        assert main(["--dir", str(REPO / "playbooks"), "rank", "--tau"]) == 0
        assert "tau-b" in capsys.readouterr().out

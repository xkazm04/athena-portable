"""WP-V: the scorer is pure; a missed field, a wrong value and a false fact each count once."""

from __future__ import annotations

from athena.proving.adopt_tiers.scenarios import SCENARIOS_DIR, load_scenario
from athena.proving.docread.corpus import Unit
from athena.proving.docread.score import Reading, given, proof, score_readers, score_unit

S = load_scenario(SCENARIOS_DIR / "easy-data-broker.json")
UNITS = [
    Unit(S.id, "letter", "clean", "l.png", "l.png", ("f-former-name", "t-family")),
    Unit(S.id, "statement", "scan", "s.png", "s.png", ("f-request-date",)),
]


def _rows(states: list[str], values: dict[str, str]) -> dict[str, dict[str, object]]:
    return {str(r["entry"]): r for r in score_unit(S.sheet, states, values)}


def test_correct_missed_and_false_fact() -> None:
    rows = _rows(
        ["f-former-name", "t-family"],
        {"f-former-name": "Priya Iyer", "f-request-date": "14 February 2026"},
    )
    assert rows["f-former-name"]["correct"] and not rows["f-former-name"]["false_fact"]
    assert not rows["t-family"]["correct"] and not rows["t-family"]["false_fact"]  # missed
    assert rows["f-request-date"]["false_fact"]  # the document does not state it


def test_a_reject_match_is_a_false_fact_and_not_correct() -> None:
    row = _rows(["f-request-date"], {"f-request-date": "sent in January"})["f-request-date"]
    assert not row["correct"] and row["false_fact"]


def test_a_wrong_value_is_incorrect_but_not_a_false_fact() -> None:
    row = _rows(["f-former-name"], {"f-former-name": "Priya Raman"})["f-former-name"]
    assert row["given"] and not row["correct"] and not row["false_fact"]


def test_not_stated_phrases_are_no_value() -> None:
    for text in ("", "  ", "N/A", "not stated", "null", "Not mentioned in the document"):
        assert given(text) == ""
    assert given("Priya Iyer") == "Priya Iyer"
    assert given("Not in the document") == ""
    assert given("The document does not state whether the benefit paid") == ""
    assert given("It does not mention a second car.") == ""
    # a word that only starts like a refusal is a value
    assert given("not interesting, but $40") == "not interesting, but $40"
    assert given("no informational letter") == "no informational letter"
    assert not any(
        r["false_fact"] for r in score_unit(S.sheet, [], {"f-former-name": "not stated"})
    )


def _reading(unit: Unit, values: dict[str, str] | None, reader: str = "vl", **kw: float) -> Reading:
    return Reading(reader, unit.id, values, **kw)  # type: ignore[arg-type]


def test_rates_n_and_per_degradation() -> None:
    readings = [
        _reading(UNITS[0], {"f-former-name": "Priya Iyer"}, ms=100, cost_usd=0.001),
        _reading(UNITS[1], {"f-request-date": "14 February 2026", "t-family": "x"}, ms=300),
    ]
    vl = score_readers({S.id: S}, UNITS, readings)["vl"]
    assert vl["fields_stated"] == 3 and vl["fields_correct"] == 2
    assert vl["field_accuracy"] == round(2 / 3, 4)
    assert vl["probes"] == 6 and vl["false_facts"] == 1  # t-family on the statement
    assert vl["by_degradation"]["clean"]["units"] == 1
    assert vl["latency_p50_ms"] == 200.0
    assert vl["cost_per_doc_usd"] == 0.001 and vl["cost_n"] == 1  # an unknown cost is not a 0


def test_no_cost_known_leaves_the_figure_absent() -> None:
    vl = score_readers({S.id: S}, UNITS, [_reading(UNITS[0], {})])["vl"]
    assert vl["cost_per_doc_usd"] is None and vl["cost_n"] == 0


def test_void_readings_are_counted_and_left_out_of_every_rate() -> None:
    readings = [
        _reading(UNITS[0], {"f-former-name": "Priya Iyer"}),
        Reading("vl", UNITS[1].id, None, error_reason="budget_exhausted"),
    ]
    vl = score_readers({S.id: S}, UNITS, readings)["vl"]
    assert vl["units"] == 1 and vl["void"] == 1 and vl["fields_stated"] == 2


def test_paired_keeps_only_units_both_readers_answered() -> None:
    readings = [
        _reading(UNITS[0], {}),
        _reading(UNITS[1], {}),
        _reading(UNITS[0], {}, reader="claude"),
        Reading("claude", UNITS[1].id, None, error_reason="timeout"),
    ]
    paired = score_readers({S.id: S}, UNITS, readings, paired=True)
    assert paired["vl"]["units"] == paired["claude"]["units"] == 1


def _scores(va: float, ca: float, vf: float, cf: float) -> dict[str, dict[str, object]]:
    return {
        "vl": {"field_accuracy": va, "false_fact_rate": vf, "units": 90},
        "claude": {"field_accuracy": ca, "false_fact_rate": cf, "units": 90},
    }


def test_proof_pass_kill_mixed_boundaries() -> None:
    assert proof(_scores(0.90, 1.0, 0.05, 0.0))["verdict"] == "PASS"  # exactly 90% and +5 pp
    assert proof(_scores(0.89, 1.0, 0.0, 0.0))["verdict"] == "MIXED"
    assert (
        proof(_scores(0.95, 1.0, 0.06, 0.0))["verdict"] == "MIXED"
    )  # accurate, too many false facts
    assert proof(_scores(0.69, 1.0, 0.0, 0.0))["verdict"] == "KILL"
    assert proof(_scores(0.70, 1.0, 0.0, 0.0))["verdict"] == "MIXED"


def test_proof_needs_both_readers_and_a_nonzero_control() -> None:
    assert proof({"vl": {"field_accuracy": 1.0, "false_fact_rate": 0.0}})["verdict"] == "NOT_RUN"
    assert proof(_scores(0.5, 0.0, 0.0, 0.0))["verdict"] == "NOT_RUN"


def _counted(correct: int, stated: int, false: int, probes: int) -> dict[str, object]:
    return {
        "field_accuracy": round(correct / stated, 4),
        "fields_correct": correct,
        "fields_stated": stated,
        "false_fact_rate": round(false / probes, 4),
        "false_facts": false,
        "probes": probes,
        "units": 1,
    }


def test_proof_judges_the_counts_not_the_rounded_rates() -> None:
    # VL 3 of 5 vs Claude 2 of 3 is a ratio of exactly 0.9, a PASS. The printed rates round to
    # 0.6 and 0.6667, whose quotient (0.89996) would read as MIXED.
    verdict = proof({"vl": _counted(3, 5, 0, 10), "claude": _counted(2, 3, 0, 10)})
    assert verdict["verdict"] == "PASS"
    assert verdict["accuracy_ratio"] == 0.9


def test_each_accuracy_carries_its_95_percent_interval_into_the_report() -> None:
    from athena.proving.docread.report import render_markdown
    from athena.proving.docread.score import wilson

    readings = [_reading(UNITS[0], {"f-former-name": "Priya Iyer"})]
    vl = score_readers({S.id: S}, UNITS, readings)["vl"]
    assert vl["accuracy_ci95"] == list(wilson(vl["fields_correct"], vl["fields_stated"]) or [])
    md = render_markdown({"paired": {"vl": vl}, "proof": {}})
    low, high = vl["accuracy_ci95"]
    assert f"{low * 100:.1f}-{high * 100:.1f}%" in md

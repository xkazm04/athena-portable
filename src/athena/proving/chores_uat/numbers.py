"""uat chores (spark chores-uat): the numbers audit — each chore's page as the desktop shows it.

Deterministic, no model. One row per playbook, every figure computed the way the desktop's Chores
scene computes it, so the row is what a person reads and not what the playbook file means. The
topic page (fix wave chores-uat, ADR 0133-0136; ``apps/desktop/src/scenes/chores/topic.tsx`` and
``worth.ts``) shows, and the row carries as text:

- the hero: the playbook's short ``brief`` markdown, tagged as the invented example case
  (``brief``; the ``promise`` only when there is no brief);
- one money headline by kind (``value_kind``, ``example_usd``): the example case's money back, or
  in words what the chore does for the money when none of it is money back (``worthOf``);
- the author's estimate on one line (``estimate_text``), whose disclosure opens on the basis, the
  sources and the caveat — one click away, so ``basis_rendered``/``caveat_rendered`` are true;
- the time saved with the person's review counted (``time_text``; ``beforeAfterOf``);
- the mistakes avoided (``guard_text``; ``blueprintOf``);
- the verdict sentence and the runs it stands on (``verdict_text``; ``verdictOf``);
- "Where it fits" from the playbook's ``fit`` (``fit``; ``fitRows``), absent without one.

The older fields are kept so ``numbers.json`` stays comparable across runs:

- ``annual_shown``/``unit_shown`` mirror ``annualValue`` and the ``PER`` table: still the
  estimate line's figure and unit. The committed ranking's year (``playbooks/ranking.json``,
  ``money.annual_usd``, ADR 0213) where it names the chore, else the period table: a quarter is
  four, a month twelve, a week fifty-two, a year one, all said "a year"; any other ``per``
  (episode, estate) is said raw in its own unit.
- the badge reads the ranking too (``verdictOf``'s ``rank``): its runs where it has them, and a
  chore the ranking leaves out reads "Not ranked" with the ranking's why unless its latest run
  fell short (``unranked``).
- ``speedup_shown`` is the pre-0136 page's speed (``speedup(manualMinutes, bench.wallS / 60)``,
  the bench's wall clock only). ``speedup_with_review`` is what the page shows now.
- ``world_total_usd`` is what the bench world holds (``score.value_total_usd``) and
  ``world_ratio`` how many times the estimate exceeds it.

The desktop's quirks are copied, not fixed, and each one that touches a row is named in its
``quirks``. **An absent figure is ``null``, never 0.**
"""

from __future__ import annotations

import json
import math
from collections.abc import Mapping
from datetime import UTC, datetime
from decimal import ROUND_HALF_UP, Decimal
from pathlib import Path
from typing import Any

__all__ = [
    "NOTES",
    "PER",
    "TAG",
    "annual_value",
    "audit",
    "comparable_runs",
    "fit_rows",
    "headline",
    "hero_lines",
    "minutes_text",
    "number_row",
    "read_library",
    "read_ranking",
    "speedup_text",
    "summary",
    "usd_text",
    "write_numbers",
]

#: ``modules/playbooks/model.ts`` ``PER``: the unit words; anything else is ``per <unit>``.
PER: dict[str, str] = {
    "year": "a year",
    "month": "a month",
    "week": "a week",
    "run": "a run",
    "claim": "a claim",
    "episode": "an episode",
    "quarter": "a quarter",
    "estate": "an estate",
}
#: ``modules/playbooks/model.ts`` ``PERIODS``: how many times a year each span comes round.
PERIODS: dict[str, int] = {"year": 1, "quarter": 4, "month": 12, "week": 52}
_YEARLY = tuple(PERIODS)
#: The desktop's own glyphs: the multiplication sign of "18x faster" and the en dash of "unknown".
TIMES = "\u00d7"
DASH = "\u2013"
DOT = " \u00b7 "
_VERDICTS = ("exceeds", "meets", "short")
#: ``modules/playbooks/model.ts`` ``LOOK`` and ``verdictOf``'s untested badge.
_LABELS = {
    "exceeds": "Beats its bar",
    "meets": "Meets its bar",
    "short": "Falls short",
    "unbenched": "Not tested",
    "unranked": "Not ranked",
}
#: ``lib/playbooks.ts`` ``ValueKind``; ``count`` is a card's kind, never the estimate's.
_KINDS = ("money_back", "money_protected", "penalty_avoided", "count")
_MONEY_KINDS = ("money_back", "money_protected", "penalty_avoided")
#: ``worth.ts`` ``KIND_WORD``: the word after an estimate's figure.
_KIND_WORD = {
    "money_back": "back",
    "money_protected": "protected",
    "penalty_avoided": "in penalties avoided",
}
#: ``worth.ts`` ``INSTEAD``: the money headline when the example case holds no money back.
_INSTEAD = {
    "money_back": "The example case holds no money back to count; it is scored by what she finds.",
    "money_protected": (
        "No money comes back in the example case: this chore protects money that is at risk."
    ),
    "penalty_avoided": (
        "No money comes back in the example case: this chore keeps you clear of penalties."
    ),
}
#: ``topic.tsx``: the tag over the hero brief.
TAG = "Invented example case: its names and figures are not yours"
#: ``worth.ts`` ``STATES`` and ``REGIONS``: where a chore's rules hold, in words.
_STATES = {
    "AL": "Alabama", "AK": "Alaska", "AZ": "Arizona", "AR": "Arkansas", "CA": "California",
    "CO": "Colorado", "CT": "Connecticut", "DE": "Delaware", "DC": "the District of Columbia",
    "FL": "Florida", "GA": "Georgia", "HI": "Hawaii", "ID": "Idaho", "IL": "Illinois",
    "IN": "Indiana", "IA": "Iowa", "KS": "Kansas", "KY": "Kentucky", "LA": "Louisiana",
    "ME": "Maine", "MD": "Maryland", "MA": "Massachusetts", "MI": "Michigan", "MN": "Minnesota",
    "MS": "Mississippi", "MO": "Missouri", "MT": "Montana", "NE": "Nebraska", "NV": "Nevada",
    "NH": "New Hampshire", "NJ": "New Jersey", "NM": "New Mexico", "NY": "New York",
    "NC": "North Carolina", "ND": "North Dakota", "OH": "Ohio", "OK": "Oklahoma", "OR": "Oregon",
    "PA": "Pennsylvania", "RI": "Rhode Island", "SC": "South Carolina", "SD": "South Dakota",
    "TN": "Tennessee", "TX": "Texas", "UT": "Utah", "VT": "Vermont", "VA": "Virginia",
    "WA": "Washington", "WV": "West Virginia", "WI": "Wisconsin", "WY": "Wyoming",
    "PR": "Puerto Rico",
    "US": "the United States", "EU": "the European Union", "UK": "the United Kingdom",
}  # fmt: skip

#: What holds for every row, said once.
NOTES: tuple[str, ...] = (
    "The page these rows mirror is the post-0136 topic page (ADR 0133-0136): hero = brief, one "
    "money headline from economics.example_usd by value_kind, the estimate line, the time saved "
    "with the person's review, the verdict sentence and 'Where it fits'.",
    "speedup_shown is the pre-0136 page's figure: manual_minutes / (bench wall_s / 60), with no "
    "review time. The page now shows speedup_with_review (time_text).",
    "annual_shown and unit_shown are still on the page, as the estimate line's figure and unit "
    "(estimate_text); before 0136 they were the page's Value headline.",
    "economics.basis, economics.sources and the playbook caveat are one click away: the estimate "
    "line's disclosure opens on them.",
)


# --- the library ---------------------------------------------------------------------------------


def _json(path: Path) -> Any:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return None


def read_library(root: str | Path) -> dict[str, tuple[dict[str, Any], dict[str, Any] | None]]:
    """``{id: (playbook.json, bench.json or None)}`` for every playbook directory under ``root``."""
    out: dict[str, tuple[dict[str, Any], dict[str, Any] | None]] = {}
    for folder in sorted(Path(root).iterdir()):
        playbook = _json(folder / "playbook.json") if folder.is_dir() else None
        if not isinstance(playbook, dict):
            continue
        bench = _json(folder / "bench.json")
        out[str(playbook.get("id") or folder.name)] = (
            playbook,
            bench if isinstance(bench, dict) else None,
        )
    return out


def read_ranking(root: str | Path) -> dict[str, dict[str, Any]]:
    """``lib/playbooks.ts`` ``parseRanking``: ``playbooks/ranking.json`` by playbook id, each
    ``{"annual_usd", "runs": (n, exceeds) | None, "unranked": why | None}``. Lenient as the
    desktop is: no file or garbage is ``{}``, and a row without a playbook id is dropped."""
    raw = _json(Path(root) / "ranking.json")
    out: dict[str, dict[str, Any]] = {}
    if not isinstance(raw, Mapping):
        return out
    for r in raw.get("ranked") or []:
        if not isinstance(r, Mapping) or not isinstance(r.get("playbook"), str):
            continue
        bench = r.get("bench")
        runs = bench.get("runs") if isinstance(bench, Mapping) else None
        money = r.get("money")
        out[r["playbook"]] = {
            "annual_usd": _num(money.get("annual_usd")) if isinstance(money, Mapping) else None,
            "runs": (int(_n0(runs.get("n"))), int(_n0(runs.get("exceeds"))))
            if isinstance(runs, Mapping)
            else None,
            "unranked": None,
        }
    for r in raw.get("unranked") or []:
        if isinstance(r, Mapping) and isinstance(r.get("playbook"), str):
            out[r["playbook"]] = {"annual_usd": None, "runs": None, "unranked": _str(r.get("why"))}
    return out


# --- the desktop's arithmetic, mirrored -----------------------------------------------------------


def _num(value: Any) -> float | None:
    """``numOrNull``: a finite number, else ``None`` (booleans are not numbers)."""
    if isinstance(value, bool) or not isinstance(value, int | float):
        return None
    return float(value) if math.isfinite(value) else None


def annual_value(value_usd: float, per: str) -> float:
    """``annualValue`` without a ranking row: the period table (quarter x4, month x12, week x52),
    anything else as it is."""
    return value_usd * PERIODS.get(per, 1)


def _js_round(x: float) -> int:
    """``Math.round``: halves go up."""
    return math.floor(x + 0.5)


def usd_text(n: float) -> str:
    """``usd``: whole dollars at 1000 and over or when whole, else cents."""
    whole = abs(n) >= 1000 or float(n).is_integer()
    sign = "-" if n < 0 else ""
    # ``toLocaleString`` rounds half away from zero ($3,423.50 is "$3,424"); Python's format rounds
    # half to even, so the amount is quantized first.
    step = Decimal(1) if whole else Decimal("0.01")
    amount = Decimal(repr(abs(float(n)))).quantize(step, rounding=ROUND_HALF_UP)
    return f"{sign}${amount:,.0f}" if whole else f"{sign}${amount:,.2f}"


def minutes_text(m: float) -> str:
    """``minutes``: seconds under one minute, minutes under ninety, else hours."""
    if m < 1:
        return f"{max(1, _js_round(m * 60))} s"
    if m < 90:
        return f"{_js_round(m)} min"
    h = m / 60
    return f"{_js_text(h)} h" if h % 1 == 0 else f"{h:.1f} h"


def _js_text(x: float) -> str:
    return str(int(x)) if float(x).is_integer() else str(x)


def speedup_text(manual: float | None, measured: float | None) -> str:
    """``speedup``: "18x faster", or "" when either side is unknown."""
    if manual is None or measured is None or manual <= 0 or measured <= 0:
        return ""
    x = manual / measured
    return f"{_js_round(x)}{TIMES} faster" if x >= 10 else f"{x:.1f}{TIMES} faster"


def comparable_runs(bench: Mapping[str, Any]) -> tuple[int, int]:
    """``comparableRuns``: ``(n, exceeds)`` of the latest run and its comparable, unsuperseded
    history (a history line that IS the latest run rescored is not counted twice)."""
    verdict = bench.get("verdict")
    word = verdict.get("word") if isinstance(verdict, Mapping) else None
    word = word if word in _VERDICTS else "short"
    comparable = bench.get("comparable") if isinstance(bench.get("comparable"), str) else ""
    rescored = bench.get("rescored_at") if isinstance(bench.get("rescored_at"), str) else ""
    run_at = bench.get("run_at") if isinstance(bench.get("run_at"), str) else ""
    history = bench.get("history")
    pooled: list[Mapping[str, Any]] = []
    if comparable and isinstance(history, list):
        for h in history:
            if not isinstance(h, Mapping) or h.get("comparable") != comparable:
                continue
            if isinstance(h.get("superseded_by"), Mapping):
                continue
            if rescored and h.get("run_at") == run_at:
                continue
            pooled.append(h)
    exceeds = (1 if word == "exceeds" else 0) + sum(
        1 for h in pooled if h.get("verdict") == "exceeds"
    )
    return 1 + len(pooled), exceeds


def _sources_n(econ: Mapping[str, Any]) -> int:
    """The sources the desktop keeps: objects with an http(s) url."""
    rows = econ.get("sources")
    if not isinstance(rows, list):
        return 0
    return sum(
        1
        for s in rows
        if isinstance(s, Mapping)
        and isinstance(s.get("url"), str)
        and s["url"].startswith(("https://", "http://"))
    )


def _str(value: Any) -> str:
    """``str``: a string, else ""."""
    return value if isinstance(value, str) else ""


def _n0(value: Any) -> float:
    """``num``: a finite number, else 0."""
    n = _num(value)
    return n if n is not None else 0.0


def _strings(value: Any) -> list[str]:
    return [s for s in value if isinstance(s, str)] if isinstance(value, list) else []


def _value_kind(econ: Mapping[str, Any]) -> str:
    """``parsePlaybook``'s ``valueKind``: a known kind other than ``count``, else money back."""
    kind = econ.get("value_kind")
    return kind if kind in _KINDS and kind != "count" else "money_back"


def _fit(raw: Any) -> dict[str, Any] | None:
    """``parseFit``: the playbook's ``fit``, or ``None`` when absent or saying nothing at all."""
    if not isinstance(raw, Mapping):
        return None
    where = raw.get("where")
    fit: dict[str, Any] = {
        "where": [where] if isinstance(where, str) else _strings(where),
        "where_note": _str(raw.get("where_note")),
        "who": _str(raw.get("who")),
        "not_for": _str(raw.get("not_for")),
        "asks_for": _strings(raw.get("asks_for")),
        "costs": _str(raw.get("costs")),
    }
    return fit if any(len(v) for v in fit.values()) else None


def _where_words(where: list[str]) -> str:
    """``whereWords``: "Texas", "California or Oregon", "the United States"."""
    names = [_STATES.get(w.upper(), w) for w in where]
    if len(names) <= 1:
        return names[0] if names else ""
    return f"{', '.join(names[:-1])} or {names[-1]}"


def fit_rows(fit: Mapping[str, Any] | None) -> list[tuple[str, str]]:
    """``fitRows``: the "Where it fits" rows in reading order; an empty row is not drawn."""
    if fit is None:
        return []
    where = ". ".join(x for x in (_where_words(list(fit["where"])), fit["where_note"]) if x)
    rows = [
        ("Where", where),
        ("Who it is for", fit["who"]),
        ("Not for", fit["not_for"]),
        ("She will ask you for", "; ".join(fit["asks_for"])),
        ("What it costs", fit["costs"]),
    ]
    return [(label, text) for label, text in rows if text]


def _cents(x: float) -> float:
    """``Math.round(x * 100) / 100``."""
    return _js_round(x * 100) / 100


def _tally(econ: Mapping[str, Any], bench: Mapping[str, Any]) -> dict[str, dict[str, float]]:
    """``tallyOf``: a run's right cards and what the example held, by each tool's kind."""
    raw_kinds = econ.get("kinds")
    kinds = (
        {k: v for k, v in raw_kinds.items() if v in _KINDS}
        if isinstance(raw_kinds, Mapping)
        else {}
    )
    tally: dict[str, dict[str, float]] = {}

    def add(tool: str, value: float | None, found: bool) -> None:
        t = tally.setdefault(kinds.get(tool, "money_back"), {"found": 0.0, "total": 0.0})
        t["total"] = _cents(t["total"] + (value or 0))
        if found:
            t["found"] = _cents(t["found"] + (value or 0))

    cards = [c for c in bench.get("cards") or [] if isinstance(c, Mapping)]
    missed = [m for m in bench.get("missed") or [] if isinstance(m, Mapping)]
    for c in cards:
        if c.get("outcome") == "correct":
            add(_str(c.get("action")), _num(c.get("value_usd")), True)
    for m in missed:
        add(_str(m.get("action")), _num(m.get("value_usd")), False)
    score = bench.get("score") if isinstance(bench.get("score"), Mapping) else {}
    assert isinstance(score, Mapping)
    if (
        not cards
        and not missed
        and _n0(score.get("eligible"))
        and not any(k != "money_back" for k in kinds.values())
    ):
        tally["money_back"] = {
            "found": _n0(score.get("value_found_usd")),
            "total": _n0(score.get("value_total_usd")),
        }
    return tally


def _kind_amount(kind: str, amount: float) -> str:
    """``kindAmount``: "$96.40 back", "$380,000 protected", "$500 in penalties avoided"."""
    return f"{usd_text(amount)} {_KIND_WORD[kind]}"


def _tally_words(tally: Mapping[str, Mapping[str, float]]) -> str:
    """``tallyWords``: "$96.40 back of $96.40, $36,000 of $416,700 protected"."""
    words: list[str] = []
    for k in _MONEY_KINDS:
        t = tally.get(k)
        if t and t["total"]:
            words.append(
                f"{usd_text(t['found'])} back of {usd_text(t['total'])}"
                if k == "money_back"
                else f"{usd_text(t['found'])} of {_kind_amount(k, t['total'])}"
            )
    return ", ".join(words)


def _int_text(x: float) -> str:
    """A count as JS writes it: "7", not "7.0"."""
    return _js_text(x)


def _verdict_sentence(
    econ: Mapping[str, Any],
    bench: Mapping[str, Any] | None,
    rank: Mapping[str, Any] | None = None,
) -> str:
    """``verdictOf``'s sentence (``modules/playbooks/model.ts``): the ranking's runs where it has
    them, and "Not ranked" for a chore it leaves out whose latest run did not fall short."""
    if bench is None:
        return "No test run yet, so nothing here is measured."
    score = bench.get("score") if isinstance(bench.get("score"), Mapping) else {}
    assert isinstance(score, Mapping)
    f = _n0(score.get("false_claims"))
    found, eligible = _int_text(_n0(score.get("found"))), _int_text(_n0(score.get("eligible")))
    body = ", ".join(
        x
        for x in (
            f"{found} of {eligible} found",
            _tally_words(_tally(econ, bench)),
            f"{_int_text(f)} false claim{'' if f == 1 else 's'}" if f else "no false claims",
        )
        if x
    )
    runs = rank.get("runs") if rank is not None else None
    n, exceeds = runs if runs is not None else comparable_runs(bench)
    one = n == 1
    beat = f"{exceeds} of {n} test runs"
    verdict = bench.get("verdict")
    word = verdict.get("word") if isinstance(verdict, Mapping) else None
    word = word if word in _VERDICTS else "short"
    why = rank.get("unranked") if rank is not None else None
    if why is not None and word != "short":
        did = "beat" if word == "exceeds" else "met"
        return f"Not ranked: {why}. The latest test run {did} its bar: {body}."
    if word == "exceeds":
        return f"Beat its bar in {'its one test run' if one else beat}: {body}."
    if word == "meets":
        tail = "One test run so far." if one else f"It beat the bar in {beat}."
        return f"Met its bar in the latest test run: {body}. {tail}"
    reasons = _strings(verdict.get("reasons")) if isinstance(verdict, Mapping) else []
    runs = "one test run" if one else f"latest of {n} test runs"
    return f"Fell short: {body}, {runs}. {reasons[0] if reasons else ''}".strip()


def _guard_text(playbook: Mapping[str, Any], bench: Mapping[str, Any] | None) -> str:
    """The "Mistakes avoided" tile (``blueprintOf``'s ``guard``, ``topic.tsx``)."""
    if bench is not None:
        score = bench.get("score") if isinstance(bench.get("score"), Mapping) else {}
        assert isinstance(score, Mapping)
        ledger = [t for t in score.get("trap_ledger") or [] if isinstance(t, Mapping)]
        of = len(ledger) or _n0(score.get("traps_total"))
        avoided = (
            sum(1 for t in ledger if t.get("filed") is not True)
            if ledger
            else of - _n0(score.get("traps_filed"))
        )
        if of:
            return f"{_int_text(avoided)}/{_int_text(of)} in the test run"
    traps = len(_strings(playbook.get("traps")))
    return f"{traps or DASH} known mistakes, not tested"


def number_row(
    playbook: Mapping[str, Any],
    bench: Mapping[str, Any] | None,
    rank: Mapping[str, Any] | None = None,
) -> dict[str, Any]:
    """One playbook's row of ``numbers.json``; ``rank`` is its :func:`read_ranking` row, as the
    desktop reads it beside bench.json (``None``: the bench's word alone)."""
    econ = playbook.get("economics")
    econ = econ if isinstance(econ, Mapping) else {}
    expect = playbook.get("expectation")
    expect = expect if isinstance(expect, Mapping) else {}
    quirks: list[str] = []

    value = _num(econ.get("value_usd"))
    raw_per = econ.get("per")
    per = raw_per if isinstance(raw_per, str) else "run"
    if not isinstance(raw_per, str):
        quirks.append("economics.per is absent: the desktop reads it as 'run'")
    if value is None:
        quirks.append("economics.value_usd is absent: the desktop shows $0")
    elif value == 0:
        quirks.append("economics.value_usd is 0: the desktop shows $0 as the value")
    ranked_year = rank.get("annual_usd") if rank is not None else None
    if ranked_year is not None:
        annual: float | None = float(ranked_year)
    else:
        annual = annual_value(value, per) if value is not None else None
    yearly = per in _YEARLY
    unit = "a year" if yearly else PER.get(per, f"per {per}")
    if not yearly:
        quirks.append(
            f"per {per!r} is not annualised: the estimate is said {unit!r}, and the ledger's "
            "value order puts it after every yearly money-back figure"
        )
        times = _num(econ.get("times_per_year"))
        if times is not None:
            quirks.append(f"economics.times_per_year = {times:g} is not used by the shown value")

    manual = _num(econ.get("manual_minutes"))
    if manual is None or manual <= 0:
        quirks.append("manual_minutes is absent or 0: no time saved and no speedup is shown")

    score = bench.get("score") if bench is not None else None
    score = score if isinstance(score, Mapping) else {}
    world_total = _num(score.get("value_total_usd")) if bench is not None else None
    wall_s = _num(bench.get("wall_s")) if bench is not None else None
    your_s = _num(bench.get("your_time_s")) if bench is not None else None
    bench_minutes = wall_s / 60 if wall_s is not None else None
    your_minutes = your_s / 60 if your_s is not None else None

    if bench is None:
        verdict_word = "unbenched"
        runs_n: int | None = None
        quirks.append("no bench.json: 'Not benched', nothing measured")
    else:
        raw_verdict = bench.get("verdict")
        raw_word = raw_verdict.get("word") if isinstance(raw_verdict, Mapping) else None
        verdict_word = raw_word if raw_word in _VERDICTS else "short"
        if raw_word not in _VERDICTS:
            quirks.append(f"bench verdict {raw_word!r} is not a known word: shown as 'Falls short'")
        rank_runs = rank.get("runs") if rank is not None else None
        runs_n = rank_runs[0] if rank_runs is not None else comparable_runs(bench)[0]
        if not world_total:
            quirks.append("the bench world holds no dollar total: the verdict sentence names none")

    speedup = (
        manual / bench_minutes
        if manual is not None and bench_minutes is not None and manual > 0 and bench_minutes > 0
        else None
    )
    review = (bench_minutes or 0) + (your_minutes or 0) if bench_minutes is not None else None
    with_review = manual / review if manual is not None and review else None

    exp_minutes = _num(expect.get("minutes"))
    if exp_minutes is None:
        quirks.append("expectation.minutes is absent: the desktop assumes 30")

    basis = econ.get("basis")
    if not isinstance(basis, str):
        quirks.append("economics.basis is absent")
    ratio = annual / world_total if annual and world_total else None

    why = rank.get("unranked") if rank is not None else None
    unranked = why if bench is not None and why is not None and verdict_word != "short" else None

    # The post-0136 page, in its own words (worth.ts, topic.tsx, modules/playbooks/model.ts).
    kind = _value_kind(econ)
    example = _num(econ.get("example_usd"))
    # worthOf: `e.exampleUsd !== null && e.exampleUsd > 0 ? usd(e.exampleUsd) : null`.
    money_text = (
        f"{usd_text(example)} back, in the invented example"
        if example is not None and example > 0
        else _INSTEAD[kind]
    )
    # worthOf: `Typical value: about ${cell.figure} ${cell.per}${kind}, author's estimate`, the
    # kind's word only when the estimate is not money back; valueCell reads annualValue of
    # `num(econ.value_usd)` (0 when absent) and "a year" or the PER word.
    kind_word = "" if kind == "money_back" else f" {_KIND_WORD[kind]}"
    figure = annual if annual is not None else annual_value(value or 0.0, per)
    estimate = f"Typical value: about {usd_text(figure)} {unit}{kind_word}, author's estimate"
    # beforeAfterOf + topic.tsx's "Time saved" tile: hand -> her run plus your review, then
    # `[band.athena.review, band.ratio, TIME_SOURCE].filter(Boolean).join(" · ")`.
    manual0 = manual or 0.0
    hand = minutes_text(manual0) if manual0 else DASH
    if bench is not None:
        with_review_min = ((wall_s or 0.0) + (your_s or 0.0)) / 60  # withReviewMinutes
        review_words = (
            f"including about {minutes_text(your_s / 60)} of your review" if your_s else ""
        )
        speed = speedup_text(manual0, with_review_min)  # view.speed
        line = DOT.join(x for x in (review_words, speed, TIME_SOURCE) if x)
        time_text = f"{hand} -> {minutes_text(with_review_min)}, {line}"
    else:
        time_text = f"{hand} -> {DASH}, not tested yet"
    return {
        "id": str(playbook.get("id") or ""),
        "category": playbook.get("category") if isinstance(playbook.get("category"), str) else None,
        "audience": "home" if playbook.get("audience") == "home" else "work",
        "value_usd": value,
        "per": per,
        "annual_shown": annual,
        "unit_shown": unit,
        "world_total_usd": world_total,
        "world_ratio": round(ratio, 3) if ratio is not None else None,
        "basis_says_estimate": isinstance(basis, str) and "estimate" in basis.lower(),
        "sources_n": _sources_n(econ),
        "incumbent_fee_pct": _num(econ.get("incumbent_fee_pct")),
        "verdict": verdict_word,
        # verdictOf's "Not ranked": the ranking's why, when its latest run did not fall short.
        "unranked": unranked,
        "bench_runs_n": runs_n,
        "manual_minutes": manual,
        "bench_minutes": round(bench_minutes, 3) if bench_minutes is not None else None,
        "your_minutes": round(your_minutes, 3) if your_minutes is not None else None,
        "speedup_shown": round(speedup, 3) if speedup is not None else None,
        "speedup_with_review": round(with_review, 3) if with_review is not None else None,
        "expectation_minutes": exp_minutes,
        # The estimate line's disclosure opens on them (topic.tsx `pa-estimate`, ADR 0133).
        "caveat_rendered": True,
        "basis_rendered": True,
        "value_kind": kind,
        "example_usd": example,
        "fit": _fit(playbook.get("fit")),
        "brief": _str(playbook.get("brief")),
        "money_text": money_text,
        "estimate_text": estimate,
        "time_text": time_text,
        "guard_text": _guard_text(playbook, bench),
        "verdict_label": _LABELS["unranked" if unranked is not None else verdict_word],
        "verdict_text": _verdict_sentence(econ, bench, rank),
        "quirks": quirks,
    }


def hero_lines(row: Mapping[str, Any], promise: str = "") -> list[str]:
    """The hero's text (``topic.tsx``): the tag and the brief, or the promise when no brief."""
    brief = str(row.get("brief") or "")
    return [TAG, brief.strip()] if brief.strip() else [promise]


TIME_SOURCE = "by hand is the author's estimate, hers is from the test run"


def headline(row: Mapping[str, Any]) -> list[str]:
    """The chore's figures as the topic page writes them (``chores/topic.tsx``, ``worth.ts``):
    the three tiles, the verdict, and the estimate line whose disclosure holds the basis."""
    return [
        f"In the example case: {row.get('money_text')}",
        f"Time saved: {row.get('time_text')}",
        f"Mistakes avoided: {row.get('guard_text')}",
        f"{row.get('verdict_label')}: {row.get('verdict_text')}",
        str(row.get("estimate_text")),
    ]


# --- the audit -----------------------------------------------------------------------------------


def audit(root: str | Path) -> dict[str, Any]:
    """``numbers.json``'s document for the library at ``root``."""
    ranking = read_ranking(root)
    rows = [
        number_row(pb, bench, ranking.get(pid)) for pid, (pb, bench) in read_library(root).items()
    ]
    return {
        "generated_at": datetime.now(UTC).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "notes": list(NOTES),
        "playbooks": rows,
    }


def write_numbers(doc: Mapping[str, Any], *paths: Path) -> list[Path]:
    written: list[Path] = []
    for path in paths:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(doc, indent=1, ensure_ascii=False) + "\n", encoding="utf-8")
        written.append(path)
    return written


def summary(doc: Mapping[str, Any]) -> dict[str, int]:
    """The headline counts of a numbers document."""
    rows = [r for r in doc.get("playbooks", []) if isinstance(r, Mapping)]
    ratios = [r.get("world_ratio") for r in rows]
    return {
        "playbooks": len(rows),
        "world_ratio_gt_3": sum(1 for x in ratios if isinstance(x, int | float) and x > 3),
        "world_ratio_gt_10": sum(1 for x in ratios if isinstance(x, int | float) and x > 10),
        "world_ratio_null": sum(1 for x in ratios if x is None),
        "basis_says_estimate": sum(1 for r in rows if r.get("basis_says_estimate")),
        "bench_runs_n_eq_1": sum(1 for r in rows if r.get("bench_runs_n") == 1),
        "unbenched": sum(1 for r in rows if r.get("verdict") == "unbenched"),
    }

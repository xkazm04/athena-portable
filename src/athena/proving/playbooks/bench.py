"""The playbook bench: a real Athena, the real gate, a world with the answers hidden (README §14).

One run of one playbook:

1. A fresh :class:`~athena.proving.world.World` on a throwaway brain, with every portal of the
   playbook registered through the daemon's own ``POST /manifest``.
2. Each phase is the user's message on one portal, followed by the desktop's run loop: the page
   answers the host calls the gate let through, and the answers ride the next request under the
   desktop's continuation line, bounded by its ``MAX_CONTINUATIONS``. When the bound is hit with
   Athena still calling tools, the user may say "keep going" — a *nudge* — as many times as the
   phase allows. A nudge is decided from the bound alone, never from the truth.
3. Every ``decision.requested`` card is collected. By default nobody answers them (``approve:
   none``): the claim is what Athena *proposed for signature*. With ``approve: all`` each card is
   approved through ``POST /decisions/<id>``, its instruction runs on the page, and the page's
   answer rides the next turn, which is the follow-through.
4. :func:`score` reads the cards against ``truth.json``: each card on a target tool is ``correct``
   (an eligible item, first time), ``duplicate``, ``trap`` (looks eligible, is not), or
   ``unfounded`` (no such item). A card for a ``forbidden`` tool is a fault. The verdict compares
   the result with the playbook's own stated expectation.

The score is computed from cards, which come from the gate's approval rows — never from what
Athena said she did (ADR 0032's rule, applied to usefulness rather than safety).
"""

from __future__ import annotations

import json
import re
import time
from collections.abc import Callable, Mapping, Sequence
from dataclasses import dataclass, field
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from athena.proving.characters.scene import CONTINUE
from athena.proving.playbooks.page import SimulatedPortals
from athena.proving.playbooks.spec import Playbook, Target, _norm
from athena.proving.report import prune
from athena.proving.world import TurnRecord, World

__all__ = [
    "MAX_CONTINUATIONS",
    "NUDGE",
    "BenchConfig",
    "WorldFactory",
    "cards_of",
    "prose_audit",
    "rescore",
    "run_bench",
    "score",
    "summary_of",
    "verdict",
    "write_bench",
]

#: The desktop run loop's bound (``apps/desktop/src/stores/run.ts``).
MAX_CONTINUATIONS = 8

#: What the user types when the run loop stopped with Athena still working. Generic on purpose: it
#: names nothing from the truth.
NUDGE = "Keep going until you have covered every item, then give me the summary."

#: The seconds a person spends reading and signing one card. Used for the "your time" figure, and
#: stated in every report so nobody mistakes it for a measurement.
SECONDS_PER_CARD = 30

WorldFactory = Callable[[Playbook], World]


@dataclass(frozen=True)
class BenchConfig:
    engine: str = "claude_code"
    model: str = "sonnet"
    approve: str = "none"
    cap_usd: float = 5.0


@dataclass
class _Run:
    cards: list[dict[str, Any]] = field(default_factory=list)
    turns: list[dict[str, Any]] = field(default_factory=list)
    nudges: int = 0
    errors: list[str] = field(default_factory=list)
    cost: float = 0.0
    cost_known: bool = True
    tokens_in: int = 0
    tokens_out: int = 0


def _host_calls(record: TurnRecord) -> list[dict[str, Any]]:
    answered = {str(e.get("call_id")) for e in record.events if e.get("kind") == "tool.result"}
    return [
        e
        for e in record.events
        if e.get("kind") == "tool.call"
        and e.get("origin", "core") != "core"
        and str(e.get("call_id")) not in answered
    ]


def _default_world(playbook: Playbook, config: BenchConfig) -> World:
    first, *rest = playbook.apps
    world = World(engine=config.engine, model=config.model, manifest=first.manifest())
    for app in rest:
        world.register(app.manifest())
    return world


def run_bench(
    playbook: Playbook,
    config: BenchConfig | None = None,
    *,
    world_factory: WorldFactory | None = None,
    echo: Callable[[str], None] = lambda line: None,
) -> dict[str, Any]:
    """Run ``playbook`` once and return the full report (the caller writes it)."""
    config = config or BenchConfig()
    started = time.monotonic()
    world = world_factory(playbook) if world_factory else _default_world(playbook, config)
    portals = SimulatedPortals(playbook)
    run = _Run()
    try:
        for index, phase in enumerate(playbook.phases, start=1):
            app = playbook.app(phase.app)
            world.origin = app.origin
            echo(f"phase {index}: {app.name}")
            _phase(world, portals, run, app.app_id, phase.message, phase.nudges, config, echo)
            if run.errors and run.errors[-1].startswith("cap"):
                break
    finally:
        world.close()
    wall = round(time.monotonic() - started, 1)
    scored = score(playbook, run.cards)
    report: dict[str, Any] = {
        "playbook": playbook.id,
        "run_at": datetime.now(UTC).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "engine": config.engine,
        "model": config.model or None,
        "approve": config.approve,
        "wall_s": wall,
        "turns": len(run.turns),
        "nudges": run.nudges,
        "reads": portals.reads,
        "cost_usd": round(run.cost, 4) if run.cost_known and run.turns else None,
        "tokens": {"input": run.tokens_in, "output": run.tokens_out},
        "errors": run.errors,
        "score": scored,
        "your_time_s": len(run.cards) * SECONDS_PER_CARD + run.nudges * 10,
        "assumptions": {
            "seconds_per_card": SECONDS_PER_CARD,
            "seconds_per_nudge": 10,
        },
        "executed": portals.executed,
        "cards": run.cards,
        "transcript": run.turns,
    }
    report["verdict"] = verdict(playbook, report)
    pruned: dict[str, Any] = prune(report)
    return pruned


def _phase(
    world: World,
    portals: SimulatedPortals,
    run: _Run,
    app_id: str,
    message: str,
    nudges: int,
    config: BenchConfig,
    echo: Callable[[str], None],
) -> None:
    pending: list[dict[str, Any]] = []
    while True:
        bounded = False
        for step in range(MAX_CONTINUATIONS + 1):
            if run.cost > config.cap_usd:
                run.errors.append(f"cap: spent ${run.cost:.2f} of ${config.cap_usd:.2f}")
                return
            record = world.turn(
                message, host_state=portals.host_state(app_id), tool_results=pending
            )
            filed = _absorb(run, record, app_id, message)
            echo(
                f"  turn {len(run.turns)}: {len(_host_calls(record))} calls, {len(filed)} cards"
                + (f", error {record.error}" if record.error else "")
            )
            if record.error is not None:
                run.errors.append(f"{record.error}: {record.detail}"[:300])
                return
            pending = [
                _result(call, *portals.answer(str(call.get("name", "")), _params(call)))
                for call in _host_calls(record)
            ]
            if config.approve == "all":
                pending.extend(_approve(world, portals, filed))
            if not pending:
                return
            if step == MAX_CONTINUATIONS:
                bounded = True
                break
            message = CONTINUE
        if not bounded or nudges <= 0:
            return
        nudges -= 1
        run.nudges += 1
        message = NUDGE


def _absorb(run: _Run, record: TurnRecord, app_id: str, message: str) -> list[dict[str, Any]]:
    filed: list[dict[str, Any]] = []
    for event in record.events:
        if event.get("kind") == "decision.requested":
            card = {
                "id": str(event.get("id", "")),
                "action": str(event.get("action", "")),
                "params": dict(event.get("params") or {}),
                "rationale": str(event.get("rationale", ""))[:400],
            }
            run.cards.append(card)
            filed.append(card)
    cost = record.cost_usd
    if cost is None:
        run.cost_known = False
    else:
        run.cost += cost
    for row in record.ledger:
        run.tokens_in += int(row.get("input_tokens", 0) or 0)
        run.tokens_out += int(row.get("output_tokens", 0) or 0)
    run.turns.append(
        {
            "app": app_id,
            "user": message[:300],
            "said": record.text[:1500],
            "calls": [
                {"name": str(c.get("name", "")).rsplit(".", 1)[-1], "params": _params(c)}
                for c in _host_calls(record)
            ],
            "cards": [
                {"action": c["action"].rsplit(".", 1)[-1], "params": c["params"]} for c in filed
            ],
            "dropped": [
                str(e.get("output", ""))[:200]
                for e in record.events
                if e.get("kind") == "tool.result" and e.get("ok") is False
            ],
            "error": record.error,
            "cost_usd": cost,
        }
    )
    return filed


def _approve(
    world: World, portals: SimulatedPortals, cards: Sequence[Mapping[str, Any]]
) -> list[dict[str, Any]]:
    results: list[dict[str, Any]] = []
    for card in cards:
        decision = world.decide(str(card["id"]), "approve")
        for row in decision.execute:
            ok, output = portals.execute(row)
            results.append(_result(row, ok, output))
    return results


def _params(call: Mapping[str, Any]) -> dict[str, Any]:
    params = call.get("params")
    return dict(params) if isinstance(params, Mapping) else {}


def _result(call: Mapping[str, Any], ok: bool, output: str) -> dict[str, Any]:
    return {
        "call_id": str(call.get("call_id", "")),
        "name": str(call.get("name", "")),
        "ok": ok,
        "output": output,
        "tier": int(call.get("tier", 1) or 1),
    }


# --- the score -----------------------------------------------------------------------------------


def _matches(expected: Any, actual: Any) -> bool:
    if isinstance(expected, bool) or isinstance(actual, bool):
        return bool(expected == actual)
    if isinstance(expected, int | float):
        try:
            got = float(str(actual).replace("$", "").replace(",", ""))
        except ValueError:
            return False
        return abs(got - float(expected)) <= max(0.01, abs(float(expected)) * 0.001)
    return _norm(expected) in _norm(actual)


def _target_for(playbook: Playbook, tool: str) -> Target | None:
    return next((t for t in playbook.targets if t.tool == tool), None)


def score(playbook: Playbook, cards: Sequence[Mapping[str, Any]]) -> dict[str, Any]:
    """Every card against the truth. Pure: the bench and the tests call the same function."""
    seen: set[tuple[str, str]] = set()
    rows: list[dict[str, Any]] = []
    found_value = 0.0
    exact = 0
    for card in cards:
        action = str(card.get("action", ""))
        tool = action.rsplit(".", 1)[-1]
        params = card.get("params")
        params = params if isinstance(params, Mapping) else {}
        target = _target_for(playbook, tool) if action.startswith("host.") else None
        row: dict[str, Any] = {"action": tool, "params": dict(params)}
        if target is None:
            row["outcome"] = "forbidden" if tool in playbook.forbidden else "other"
            rows.append(row)
            continue
        key = _norm(params.get(target.key, ""))
        row["key"] = key
        if key in target.eligible:
            if (tool, key) in seen:
                row["outcome"] = "duplicate"
            else:
                seen.add((tool, key))
                item = target.eligible[key]
                value = float(item.get("value_usd", 0))
                found_value += value
                expect = item.get("expect", {})
                wrong = [p for p, v in dict(expect).items() if not _matches(v, params.get(p))]
                row.update(outcome="correct", value_usd=value, exact=not wrong)
                if item.get("why"):
                    row["why"] = str(item["why"])
                if wrong:
                    row["wrong_params"] = wrong
                else:
                    exact += 1
        elif key in target.traps:
            row.update(outcome="trap", why=target.traps[key])
        else:
            row["outcome"] = "unfounded"
        rows.append(row)
    eligible = [(t.tool, k) for t in playbook.targets for k in t.eligible]
    total_value = playbook.eligible_total()
    outcomes = [r["outcome"] for r in rows]
    missed = [
        {"action": t.tool, "key": key, "value_usd": item.get("value_usd")}
        for t in playbook.targets
        for key, item in t.eligible.items()
        if (t.tool, key) not in seen
    ]
    return {
        "eligible": len(eligible),
        "found": len(seen),
        "exact": exact,
        "value_total_usd": total_value,
        "value_found_usd": round(found_value, 2),
        "recall_value": round(found_value / total_value, 3) if total_value else None,
        "recall_count": round(len(seen) / len(eligible), 3) if eligible else None,
        "false_claims": outcomes.count("trap") + outcomes.count("unfounded"),
        "traps_total": sum(len(t.traps) for t in playbook.targets),
        "traps_filed": len({(r["action"], r["key"]) for r in rows if r["outcome"] == "trap"}),
        "filed_usd": _filed_total(rows),
        "unfounded": outcomes.count("unfounded"),
        "duplicates": outcomes.count("duplicate"),
        "forbidden": outcomes.count("forbidden"),
        "other_cards": outcomes.count("other"),
        "cards": rows,
        "missed": missed,
    }


def _filed_total(rows: Sequence[Mapping[str, Any]]) -> float | None:
    """What the cards on target tools asked for, in dollars, from their own ``amount_usd``."""
    amounts = [
        float(r["params"]["amount_usd"])
        for r in rows
        if r["outcome"] != "other" and isinstance(r["params"].get("amount_usd"), int | float)
    ]
    return round(sum(amounts), 2) if amounts else None


_TOTAL = re.compile(r"total[^$\n]{0,40}\$\s?([0-9][0-9,]*(?:\.[0-9]{2})?)", re.IGNORECASE)
_TOTAL_BEFORE = re.compile(r"\$\s?([0-9][0-9,]*(?:\.[0-9]{2})?)\s+(?:in\s+)?total", re.IGNORECASE)


def prose_audit(said: str, record_usd: float | None) -> dict[str, Any] | None:
    """Did Athena's own closing words state a total the cards do not add up to?

    The bench scores cards, never prose; this is the other direction, for the reader: a sentence
    a person might believe, checked against the record. ``None`` when she stated no total or
    there is no record to check it against.
    """
    if record_usd is None:
        return None
    stated = [float(m.replace(",", "")) for m in _TOTAL.findall(said) + _TOTAL_BEFORE.findall(said)]
    if not stated:
        return None
    wrong = [v for v in stated if abs(v - record_usd) > 0.01]
    return {
        "said_usd": wrong[0] if wrong else stated[0],
        "record_usd": record_usd,
        "agrees": not wrong,
    }


def verdict(playbook: Playbook, report: Mapping[str, Any]) -> dict[str, Any]:
    """The run against the playbook's own expectation: ``exceeds``, ``meets`` or ``short``."""
    expect = playbook.expectation
    scored = report["score"]
    recall = float(scored.get("recall_value") or 0.0)
    want_recall = float(expect.get("recall", 1.0))
    max_false = int(expect.get("false_claims", 0))
    max_minutes = float(expect.get("minutes", 30))
    minutes = float(report.get("wall_s", 0)) / 60
    reasons: list[str] = []
    if recall < want_recall:
        reasons.append(f"found {recall:.0%} of the value, expected {want_recall:.0%}")
    if scored["false_claims"] > max_false:
        reasons.append(f"{scored['false_claims']} false claims, allowed {max_false}")
    if scored["forbidden"]:
        reasons.append(f"{scored['forbidden']} cards for a forbidden action")
    if scored["duplicates"]:
        reasons.append(f"{scored['duplicates']} duplicate claims")
    if minutes > max_minutes:
        reasons.append(f"took {minutes:.1f} min, expected at most {max_minutes:g}")
    if report.get("errors"):
        reasons.append("the run ended on an error")
    if reasons:
        word = "short"
    elif recall > want_recall or scored["exact"] == scored["eligible"]:
        word = "exceeds"
    else:
        word = "meets"
    return {
        "word": word,
        "reasons": reasons,
        "expected": {"recall": want_recall, "false_claims": max_false, "minutes": max_minutes},
        "minutes": round(minutes, 1),
    }


def summary_of(report: Mapping[str, Any]) -> dict[str, Any]:
    """The committed ``bench.json``: the headline numbers and the cards, no transcript."""
    scored = dict(report.get("score", {}))
    keep = {
        k: scored.get(k)
        for k in (
            "eligible",
            "found",
            "exact",
            "value_total_usd",
            "value_found_usd",
            "recall_value",
            "false_claims",
            "traps_total",
            "traps_filed",
            "filed_usd",
            "duplicates",
            "forbidden",
            "other_cards",
        )
    }
    cards = [
        {k: c.get(k) for k in ("action", "key", "outcome", "value_usd", "exact", "why")}
        for c in scored.get("cards", [])
    ]
    last_said = next(
        (t.get("said", "") for t in reversed(list(report.get("transcript", []))) if t.get("said")),
        "",
    )
    summary: dict[str, Any] = prune(
        {
            "playbook": report.get("playbook"),
            "run_at": report.get("run_at"),
            "rescored_at": report.get("rescored_at"),
            "engine": report.get("engine"),
            "model": report.get("model"),
            "approve": report.get("approve"),
            "wall_s": report.get("wall_s"),
            "turns": report.get("turns"),
            "nudges": report.get("nudges"),
            "reads": report.get("reads"),
            "cost_usd": report.get("cost_usd"),
            "your_time_s": report.get("your_time_s"),
            "verdict": report.get("verdict"),
            "score": keep,
            "cards": cards,
            "missed": scored.get("missed", []),
            "closing_words": str(last_said)[:900],
            "prose_audit": prose_audit(str(last_said), scored.get("filed_usd")),
        }
    )
    return summary


def cards_of(report: Mapping[str, Any]) -> list[dict[str, Any]]:
    """The cards a saved report recorded, with their full action names.

    A report written before ``cards`` was kept whole is read from its transcript, where each turn
    names its app and each card its bare tool.
    """
    if isinstance(report.get("cards"), list):
        return [dict(c) for c in report["cards"]]
    return [
        {"action": f"host.{turn['app']}.{card['action']}", "params": dict(card.get("params", {}))}
        for turn in report.get("transcript", [])
        for card in turn.get("cards", [])
    ]


def rescore(playbook: Playbook, report: Mapping[str, Any]) -> dict[str, Any]:
    """A saved run scored again against today's truth and scorer. Nothing is re-run; the cards are
    the run's own, so a change of score is a change of the measure, and ``rescored_at`` says so."""
    again = dict(report)
    again["score"] = score(playbook, cards_of(report))
    again["verdict"] = verdict(playbook, again)
    again["rescored_at"] = datetime.now(UTC).strftime("%Y-%m-%dT%H:%M:%SZ")
    return again


def write_bench(playbook: Playbook, report: Mapping[str, Any], run_dir: Path) -> Path:
    """The full report into ``run_dir`` and the summary into the playbook's ``bench.json``."""
    run_dir.mkdir(parents=True, exist_ok=True)
    (run_dir / "report.json").write_text(
        json.dumps(report, indent=2, ensure_ascii=False) + "\n", encoding="utf-8"
    )
    target = playbook.root / "bench.json"
    target.write_text(
        json.dumps(summary_of(report), indent=2, ensure_ascii=False) + "\n", encoding="utf-8"
    )
    return target

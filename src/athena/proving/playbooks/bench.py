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

import hashlib
import json
import re
import tempfile
import time
from collections.abc import Callable, Collection, Mapping, Sequence
from dataclasses import dataclass, field, replace
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from athena.contracts import ids
from athena.contracts.channel import now_iso
from athena.proving.characters.scene import CONTINUE
from athena.proving.playbooks import ledger
from athena.proving.playbooks.ledger import HISTORY, comparable_runs, headline
from athena.proving.playbooks.page import SimulatedPortals
from athena.proving.playbooks.spec import AppSpec, Playbook, Target, _norm
from athena.proving.report import prune
from athena.proving.world import TurnRecord, World

__all__ = [
    "HISTORY",
    "MAX_CONTINUATIONS",
    "NUDGE",
    "SCORER_VERSION",
    "BenchConfig",
    "RootedWorldFactory",
    "WorldFactory",
    "cards_of",
    "case_receipt",
    "comparability_key",
    "comparable_runs",
    "content_digest",
    "headline",
    "prose_audit",
    "rescore",
    "run_bench",
    "run_second",
    "score",
    "second_run_verdict",
    "summary_of",
    "switch_requested",
    "trace_of",
    "verdict",
    "write_bench",
    "write_report",
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
#: A world on a given root, so a second Athena can open the first one's brain (ADR 0126).
RootedWorldFactory = Callable[[Playbook, Path], World]

#: The person at the cards: handed one turn's filed cards, returns the page's answers (ADR 0129).
Answerer = Callable[[Sequence[Mapping[str, Any]]], list[dict[str, Any]]]

#: The scorer's identity in a run's comparability key (ADR 0128). Raise it in the same commit as
#: any change to :func:`score` or :func:`verdict` that measures the same cards differently, so the
#: runs scored before are not averaged with the runs scored after.
SCORER_VERSION = 1


def _canonical(value: Any) -> str:
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False)


def content_digest(root: Path) -> str:
    """What a run of the playbook at ``root`` is measured against, as one digest (ADR 0128).

    ``world.json`` and ``truth.json`` whole, the two keys of ``playbook.json`` the bench reads
    besides the id (``command`` and ``expectation``), and :data:`SCORER_VERSION`. Parsed and
    re-serialised, so a checkout's line endings or a reformat change nothing; a value does.
    """

    def read(name: str) -> Any:
        return json.loads((root / name).read_text(encoding="utf-8"))

    book = read("playbook.json")
    measured = {
        "world": read("world.json"),
        "truth": read("truth.json"),
        "command": book.get("command"),
        "expectation": book.get("expectation"),
        "scorer": SCORER_VERSION,
    }
    return hashlib.sha256(_canonical(measured).encode("utf-8")).hexdigest()


def comparability_key(content: str, engine: Any, model: Any, approve: Any) -> str:
    """The key two runs share when their numbers may be pooled (ADR 0128).

    ``content`` is :func:`content_digest`; the engine, the model and the approval mode are the
    run's own. Runs under different keys measured different things and are never aggregated.
    """
    joined = _canonical({"content": content, "engine": engine, "model": model, "approve": approve})
    return "sha256:" + hashlib.sha256(joined.encode("utf-8")).hexdigest()[:16]


@dataclass(frozen=True)
class BenchConfig:
    engine: str = "claude_code"
    model: str = "sonnet"
    approve: str = "none"
    cap_usd: float = 5.0
    #: How many times the person does what Athena asks when she asks them to switch tabs.
    follow_ups: int = 3
    #: An experiment, not how the desktop runs a case any more (ADR 0127): a ``proj_`` id is
    #: minted for the run and sent as ``project_id`` on every turn, so every phase's turns share
    #: ``conv_proj_…``. The paid gate measured it at 1.7-2.5x the cost per run. Off, the turns stay
    #: in each portal's own conversation.
    project: bool = False
    #: Run under a case as the desktop does (ADR 0127): a ``proj_`` id is minted and sent as
    #: ``case_id`` on every turn, which routes nothing, so each portal keeps its own conversation
    #: and the daemon stamps every turn under the case. The report carries the case's receipt.
    case: bool = False


@dataclass
class _Run:
    cards: list[dict[str, Any]] = field(default_factory=list)
    turns: list[dict[str, Any]] = field(default_factory=list)
    nudges: int = 0
    follow_ups: int = 0
    #: Her latest words in full; the transcript keeps an excerpt.
    last_said: str = ""
    errors: list[str] = field(default_factory=list)
    cost: float = 0.0
    cost_known: bool = True
    tokens_in: int = 0
    tokens_out: int = 0
    #: The run's ``proj_`` id under ``BenchConfig.project``, else ``""``.
    project_id: str = ""
    #: The case the run is a run of, sent as ``case_id`` on every turn (ADR 0126), else ``""``.
    #: It names the case and routes nothing: each portal keeps its own conversation.
    case_id: str = ""


def _host_calls(record: TurnRecord) -> list[dict[str, Any]]:
    answered = {str(e.get("call_id")) for e in record.events if e.get("kind") == "tool.result"}
    return [
        e
        for e in record.events
        if e.get("kind") == "tool.call"
        and e.get("origin", "core") != "core"
        and str(e.get("call_id")) not in answered
    ]


_FOOTER = re.compile(r"\(showing \d+ of \d+\)")


def _core_calls(record: TurnRecord) -> list[dict[str, Any]]:
    """Every call the core answered itself (``core.recall``), with the footer its answer ended on.

    The output is not kept: the footer is what says how much of the brain the call returned.
    """
    results = {str(e.get("call_id")): e for e in record.events if e.get("kind") == "tool.result"}
    calls: list[dict[str, Any]] = []
    for event in record.events:
        if event.get("kind") != "tool.call" or event.get("origin", "core") != "core":
            continue
        result = results.get(str(event.get("call_id")))
        footers = _FOOTER.findall(str(result.get("output", ""))) if result else []
        calls.append(
            {
                "name": str(event.get("name", "")).rsplit(".", 1)[-1],
                "params": {
                    k: v[:300] if isinstance(v, str) else v for k, v in _params(event).items()
                },
                "ok": result.get("ok") if result else None,
                "footer": footers[-1] if footers else "",
            }
        )
    return calls


def _default_world(playbook: Playbook, config: BenchConfig, root: Path | None = None) -> World:
    first, *rest = playbook.apps
    world = World(engine=config.engine, model=config.model, manifest=first.manifest(), root=root)
    try:
        for app in rest:
            world.register(app.manifest())
    except BaseException:
        world.close()
        raise
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
    run = _Run(
        project_id=ids.mint("project") if config.project else "",
        case_id=ids.mint("project") if config.case else "",
    )
    receipt: dict[str, Any] | None = None
    try:
        _script(world, portals, run, config, echo)
        if config.case:
            receipt = case_receipt(world, run.case_id)
    finally:
        world.close()
    wall = round(time.monotonic() - started, 1)
    report = _report(playbook, config, run, portals, wall, score(playbook, run.cards))
    if receipt is not None:
        report["case_receipt"] = receipt
    return report


def case_receipt(world: World, case_id: str) -> dict[str, Any]:
    """The case's open run as the receipt route would fold it (ADR 0127): its turns, the cards
    by state, the asked dollars and the ledger's rows of those turns, which the bench's own
    ``cost_usd`` should equal."""
    from athena.adopt import receipts as runs  # adopt imports this module; not at import time

    local = world.local
    folded = runs.fold(local.brain, local.approvals, local.ledger, local.daemon.case_turns, case_id)
    keys = ("turns", "approved", "consumed", "declined", "expired", "pending")
    out: dict[str, Any] = {k: getattr(folded, k) for k in keys}
    out.update(
        notes=folded.notes_total,
        asked_usd=folded.asked_usd,
        calls=folded.calls,
        errors=folded.errors,
        cost_usd=round(folded.cost_usd, 4),
    )
    return out


def _script(
    world: World,
    portals: SimulatedPortals,
    run: _Run,
    config: BenchConfig,
    echo: Callable[[str], None],
) -> None:
    """Every phase of the playbook, then the person's bounded follow-ups, into ``run``."""
    playbook = portals.playbook
    for index, phase in enumerate(playbook.phases, start=1):
        app = playbook.app(phase.app)
        world.origin = app.origin
        echo(f"phase {index}: {app.name}")
        _phase(world, portals, run, app.app_id, phase.message, phase.nudges, config, echo)
        if run.errors and run.errors[-1].startswith("cap"):
            break
    # After the script, the person does what she asks when she asks them to switch tabs: the
    # move a person makes when Athena says "switch to MyChart and I'll read the notes". It is
    # decided from her words alone, never from the truth, and bounded (ADR 0040).
    current = playbook.phases[-1].app if playbook.phases else ""
    while run.follow_ups < config.follow_ups and not any(e.startswith("cap") for e in run.errors):
        asked = switch_requested(playbook, _last_said(run), current)
        if asked is None:
            break
        run.follow_ups += 1
        echo(f"follow-up {run.follow_ups}: the person switches to {asked.name}")
        world.origin = asked.origin
        message = f"I've switched to {asked.name} as you asked. Go ahead."
        _phase(world, portals, run, asked.app_id, message, 1, config, echo)
        current = asked.app_id


def _report(
    playbook: Playbook,
    config: BenchConfig,
    run: _Run,
    portals: SimulatedPortals,
    wall: float,
    scored: dict[str, Any],
) -> dict[str, Any]:
    report: dict[str, Any] = {
        "playbook": playbook.id,
        "run_at": datetime.now(UTC).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "engine": config.engine,
        "model": config.model or None,
        "approve": config.approve,
        "project_id": run.project_id or None,
        "case_id": run.case_id or None,
        "wall_s": wall,
        "turns": len(run.turns),
        "nudges": run.nudges,
        "follow_ups": run.follow_ups,
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
        "portals": {app.app_id: app.name for app in playbook.apps},
        "transcript": run.turns,
    }
    report["verdict"] = verdict(playbook, report)
    report["comparable"] = comparability_key(
        content_digest(playbook.root), report["engine"], report["model"], report["approve"]
    )
    pruned: dict[str, Any] = prune(report)
    return pruned


# --- the second run (ADR 0126) -------------------------------------------------------------------


def run_second(
    playbook: Playbook,
    config: BenchConfig | None = None,
    *,
    world_factory: RootedWorldFactory | None = None,
    echo: Callable[[str], None] = lambda line: None,
) -> dict[str, Any]:
    """Run ``playbook`` twice on one brain, the second run starting where the first stopped.

    Both runs are runs of one case: every turn names it as ``case_id``, which routes nothing, so
    each portal keeps its own conversation as the desktop's do. Run 1 approves every card
    (``approve: all``), as a person who signs what she is shown, and its cards become a receipt
    (:func:`athena.adopt.receipts.of_cards`). Then the daemon restarts on the same brain, the same
    approval table: run 2 is a fresh Athena, as a run a month later is. The receipt is the case's
    last run, so run 2's gate looks back to run 1's start and dates an old yes, as the product's
    does; nothing of it reaches run 2's prompt (ADR 0130: the "since last run" block that did
    doubled the re-filed cards, 6 to 14 over five playbooks). Run 2 is scored with run 1's
    found items as already seen: a card for one is a ``duplicate`` of run 1, and recall is
    measured on the rest.
    """
    from athena.adopt import receipts as runs  # adopt imports this module; not at import time

    config = replace(config or BenchConfig(), project=False)
    make = world_factory or (lambda book, root: _default_world(book, config, root=root))
    case_id = ids.mint("project")
    first, second = _Run(case_id=case_id), _Run(case_id=case_id)
    portals_1, portals_2 = SimulatedPortals(playbook), SimulatedPortals(playbook)
    config_1 = replace(config, approve="all")
    started = time.monotonic()
    with tempfile.TemporaryDirectory(prefix="athena-second-", ignore_cleanup_errors=True) as tmp:
        root = Path(tmp)
        world = make(playbook, root)
        try:
            echo("run 1: every card approved")
            _script(world, portals_1, first, config_1, echo)
            closed = now_iso()
            approvals = world.local.approvals
            rows = [row for c in first.cards if (row := approvals.get(str(c["id"]))) is not None]
            receipt = runs.of_cards(case_id, rows, until=closed, closed_at=closed)
        finally:
            world.close()
        wall_1 = round(time.monotonic() - started, 1)
        began = runs.run_started(receipt) or None
        world = make(playbook, root)
        try:
            bound = world.local.daemon.last_run_started

            def last_run_started(case: str) -> str | None:
                if case == case_id:
                    return began
                return bound(case) if bound is not None else None

            world.local.daemon.last_run_started = last_run_started
            echo("run 2: after a restart, the gate looking back to run 1's start")
            _script(world, portals_2, second, config, echo)
        finally:
            world.close()
    wall = round(time.monotonic() - started, 1)
    scored_1 = score(playbook, first.cards)
    prior = {(r["action"], r["key"]) for r in scored_1["cards"] if r["outcome"] == "correct"}
    run_1 = _report(playbook, config_1, first, portals_1, wall_1, scored_1)
    scored_2 = score(playbook, second.cards, prior=prior)
    run_2 = _report(playbook, config, second, portals_2, round(wall - wall_1, 1), scored_2)
    costs = [r.get("cost_usd") for r in (run_1, run_2)]
    known = [float(c) for c in costs if c is not None]
    report: dict[str, Any] = {
        "playbook": playbook.id,
        "mode": "second_run",
        # No run carries the last receipt into its prompt any more (ADR 0130); kept so a report
        # reads the same as the measured 2026-10-22 baseline arm.
        "carry": False,
        "case_id": case_id,
        "run_at": run_2.get("run_at"),
        "engine": config.engine,
        "model": config.model or None,
        "wall_s": wall,
        "cost_usd": round(sum(known), 4) if len(known) == len(costs) else None,
        "receipt": runs.as_dict(receipt),
        "spent_since": began,
        "second_run": second_run_verdict(playbook, run_2),
        "run_1": run_1,
        "run_2": run_2,
    }
    pruned: dict[str, Any] = prune(report)
    return pruned


def second_run_verdict(playbook: Playbook, run_2: Mapping[str, Any]) -> dict[str, Any]:
    """Run 2 against the bar: no card for an item run 1 already filed, and the playbook's own
    recall bar on the items run 1 left (``None`` when it left none). Read from cards alone."""
    scored = run_2["score"]
    want = float(playbook.expectation.get("recall", 1.0))
    max_false = int(playbook.expectation.get("false_claims", 0))
    reasons: list[str] = []
    if scored["duplicates_of_prior"]:
        reasons.append(f"{scored['duplicates_of_prior']} cards for items run 1 already filed")
    rest = scored.get("recall_rest_count")
    if rest is not None and float(rest) < want:
        reasons.append(
            f"found {scored['rest_found']} of the {scored['rest_eligible']} items run 1 left, "
            f"expected {want:.0%}"
        )
    if scored["false_claims"] > max_false:
        reasons.append(f"{scored['false_claims']} false claims, allowed {max_false}")
    if run_2.get("errors"):
        reasons.append("run 2 ended on an error")
    return {
        "word": "short" if reasons else "meets",
        "reasons": reasons,
        "duplicates_of_run_1": scored["duplicates_of_prior"],
        "run_1_found": scored["prior"],
        "rest_eligible": scored["rest_eligible"],
        "rest_found": scored["rest_found"],
        "recall_rest_count": rest,
        "recall_rest_value": scored.get("recall_rest_value"),
        "expected": {"recall": want, "false_claims": max_false},
    }


#: A request, not a mention: the base form of the verb, then where to ("switch to the X", "go back
#: to X", "head over to X", "move into X") or, for open, the portal itself ("open the X").
_SWITCH = (
    r"\b(?:(?:switch|go|move|head|flip|change)\s+(?:to|back\s+to|over\s+to|into)|open)"
    r"\s+(?:the\s+)?"
)


def switch_requested(playbook: Playbook, said: str, current: str) -> AppSpec | None:
    """The portal Athena's words ask the person to switch to, if any, other than the current one.

    Read from her text alone: "switch to the MyChart tab", "go back to the insurance portal". The
    earliest request wins; a portal merely mentioned, or after a verb that is not a request
    ("the claim goes through Stallwick"), is not one.
    """
    best: tuple[int, AppSpec] | None = None
    for app in playbook.apps:
        if app.app_id == current:
            continue
        for alias in app.aliases:
            found = re.search(_SWITCH + rf"\b{re.escape(alias)}\b", said, re.IGNORECASE)
            if found and (best is None or found.start() < best[0]):
                best = (found.start(), app)
    return best[1] if best else None


def _last_said(run: _Run) -> str:
    return run.last_said


def _phase(
    world: World,
    portals: SimulatedPortals,
    run: _Run,
    app_id: str,
    message: str,
    nudges: int,
    config: BenchConfig,
    echo: Callable[[str], None],
    *,
    answer: Answerer | None = None,
    fields: Mapping[str, Any] | None = None,
) -> None:
    """One phase of the desktop's run loop on ``app_id``.

    ``answer`` replaces ``config.approve`` as the person at the cards: it is handed each turn's
    filed cards and returns the page's answers to ride the next turn (the follow-through driver,
    ADR 0129). ``fields`` are the surface's other request fields, read afresh on every turn, so a
    caller that adds to them between turns is heard on the next one.
    """
    pending: list[dict[str, Any]] = []
    # The playbook the person handed over is her active project on every turn, in every tab
    # (ADR 0044): the goal she works toward while the phase message names only this tab's part.
    project = {
        "kind": "playbook",
        "title": str(portals.playbook.showcase.get("title", portals.playbook.id)),
        "goal": str(portals.playbook.showcase.get("command", "")),
    }
    while True:
        bounded = False
        for step in range(MAX_CONTINUATIONS + 1):
            if run.cost > config.cap_usd:
                run.errors.append(f"cap: spent ${run.cost:.2f} of ${config.cap_usd:.2f}")
                return
            record = world.turn(
                message,
                host_state=portals.host_state(app_id),
                tool_results=pending,
                active_project=project,
                fields={**(_case_fields(run) or {}), **(fields or {})} or None,
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
            if answer is not None:
                pending.extend(answer(filed))
            elif config.approve == "all":
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


def _case_fields(run: _Run) -> dict[str, Any] | None:
    """The run's case fields on a ``POST /run`` body: ``project_id`` (ADR 0124, it routes the
    conversation) and ``case_id`` (ADR 0126, it does not), each only when set."""
    fields = {k: v for k, v in (("project_id", run.project_id), ("case_id", run.case_id)) if v}
    return fields or None


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
    if record.text:
        run.last_said = record.text
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
            "said": record.text[:4000],
            "calls": [
                {"name": str(c.get("name", "")).rsplit(".", 1)[-1], "params": _params(c)}
                for c in _host_calls(record)
            ],
            "core_calls": _core_calls(record),
            "cards": [
                {"action": c["action"].rsplit(".", 1)[-1], "params": c["params"]} for c in filed
            ],
            "dropped": [
                str(e.get("output", ""))[:800]
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


def score(
    playbook: Playbook,
    cards: Sequence[Mapping[str, Any]],
    *,
    prior: Collection[tuple[str, str]] | None = None,
) -> dict[str, Any]:
    """Every card against the truth. Pure: the bench and the tests call the same function.

    ``prior`` is the ``(tool, key)`` of every item an earlier run already found (a second run,
    ADR 0126): a card for one is a ``duplicate`` marked ``of_prior`` and is not found again, and
    the score adds how many such cards there were and the recall on the items left.
    """
    before = set(prior or ())
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
        # A target whose right answers are worth money recovers it; a payment target does not.
        row["recovers"] = any(float(v.get("value_usd", 0)) > 0 for v in target.eligible.values())
        if key in target.eligible:
            if (tool, key) in before:
                row.update(outcome="duplicate", of_prior=True)
            elif (tool, key) in seen:
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
        elif key in target.neutral:
            item = target.neutral[key]
            off = [
                p for p, v in dict(item.get("expect", {})).items() if not _matches(v, params.get(p))
            ]
            if off:
                row.update(
                    outcome="trap", why=f"{item.get('why', '')} (not at {', '.join(off)} given)"
                )
                row["wrong_params"] = off
            else:
                row.update(outcome="neutral", why=str(item.get("why", "")))
        elif key in target.traps:
            row.update(outcome="trap", why=target.traps[key])
        else:
            row["outcome"] = "unfounded"
        rows.append(row)
    eligible = [(t.tool, k) for t in playbook.targets for k in t.eligible]
    total_value = playbook.eligible_total()
    outcomes = [r["outcome"] for r in rows]
    missed = [
        prune(
            {
                "action": t.tool,
                "key": key,
                "value_usd": item.get("value_usd"),
                # A deadline that cannot wait: missing it is short whatever else was found.
                "required": True if item.get("required") else None,
            }
        )
        for t in playbook.targets
        for key, item in t.eligible.items()
        if (t.tool, key) not in seen
    ]
    filed_traps = {(r["action"], r["key"]) for r in rows if r["outcome"] == "trap"}
    scored: dict[str, Any] = {
        "eligible": len(eligible),
        "found": len(seen),
        "exact": exact,
        "value_total_usd": total_value,
        "value_found_usd": round(found_value, 2),
        "recall_value": round(found_value / total_value, 3) if total_value else None,
        "recall_count": round(len(seen) / len(eligible), 3) if eligible else None,
        "false_claims": outcomes.count("trap") + outcomes.count("unfounded"),
        "traps_total": sum(len(t.traps) for t in playbook.targets),
        "traps_filed": len(filed_traps),
        # Every trap the world held, with why it was one and whether she fell for it: the
        # judgement the money figure cannot show.
        "trap_ledger": [
            {"action": t.tool, "key": key, "why": why, "filed": (t.tool, key) in filed_traps}
            for t in playbook.targets
            for key, why in t.traps.items()
        ],
        "filed_usd": _filed_total(rows),
        "unfounded": outcomes.count("unfounded"),
        "duplicates": outcomes.count("duplicate"),
        "forbidden": outcomes.count("forbidden"),
        "other_cards": outcomes.count("other"),
        "neutral": outcomes.count("neutral"),
        "cards": rows,
        "missed": missed,
    }
    if prior is not None:
        worth = {
            (t.tool, k): float(v.get("value_usd", 0))
            for t in playbook.targets
            for k, v in t.eligible.items()
        }
        rest = [item for item in eligible if item not in before]
        got = [item for item in rest if item in seen]
        rest_value = sum(worth[item] for item in rest)
        scored.update(
            prior=len(before & set(eligible)),
            duplicates_of_prior=sum(1 for r in rows if r.get("of_prior")),
            rest_eligible=len(rest),
            rest_found=len(got),
            recall_rest_count=round(len(got) / len(rest), 3) if rest else None,
            recall_rest_value=(
                round(sum(worth[item] for item in got) / rest_value, 3) if rest_value else None
            ),
        )
    return scored


#: The parameters a card names its money in, in the order they are looked for.
AMOUNT_PARAMS = ("amount_usd", "amount_disputed_usd")


def _amount(params: Mapping[str, Any]) -> float | None:
    for name in AMOUNT_PARAMS:
        value = params.get(name)
        if isinstance(value, int | float) and not isinstance(value, bool):
            return float(value)
    return None


def _filed_total(rows: Sequence[Mapping[str, Any]]) -> float | None:
    """What the recovering cards asked for, in dollars, from their own amount parameter."""
    amounts = [
        a
        for r in rows
        if r.get("recovers") and r["outcome"] not in ("other", "neutral", "forbidden")
        if (a := _amount(r["params"])) is not None
    ]
    return round(sum(amounts), 2) if amounts else None


_TOTAL = re.compile(r"total[^$\n]{0,40}\$\s?([0-9][0-9,]*(?:\.[0-9]{2})?)", re.IGNORECASE)
_TOTAL_BEFORE = re.compile(r"\$\s?([0-9][0-9,]*(?:\.[0-9]{2})?)\s+(?:in\s+)?total", re.IGNORECASE)


def prose_audit(
    said: str, record_usd: float | None, found_usd: float | None = None
) -> dict[str, Any] | None:
    """Did Athena's own closing words state a total that neither record bears out?

    The bench scores cards, never prose; this is the other direction, for the reader: a sentence
    a person might believe, checked against two records, the dollars the cards filed
    (``record_usd``) and the value found (``found_usd``). A total agrees when it equals either
    within a cent; with no filed figure only the value found is checked. ``None`` when she stated
    no total or there is no record to check it against.
    """
    records = [r for r in (record_usd, found_usd) if r is not None]
    if not records:
        return None
    stated = [float(m.replace(",", "")) for m in _TOTAL.findall(said) + _TOTAL_BEFORE.findall(said)]
    if not stated:
        return None
    matched = {v: next((r for r in records if abs(v - r) <= 0.01), None) for v in stated}
    wrong = [v for v, hit in matched.items() if hit is None]
    return {
        "said_usd": wrong[0] if wrong else stated[0],
        "record_usd": records[0] if wrong else matched[stated[0]],
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
    # The count is held to the same bar as the money, so one large item cannot carry a run that
    # missed most of the rest.
    count = scored.get("recall_count")
    if count is not None and float(count) < want_recall:
        reasons.append(
            f"found {scored.get('found', 0)} of {scored.get('eligible', 0)} items, "
            f"expected {want_recall:.0%}"
        )
    for item in scored.get("missed", []):
        if item.get("required"):
            reasons.append(f"missed {item.get('key')}, which could not wait")
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
            "neutral",
            "value_total_usd",
            "value_found_usd",
            "recall_value",
            "false_claims",
            "traps_total",
            "traps_filed",
            "trap_ledger",
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
            "comparable": report.get("comparable"),
            "wall_s": report.get("wall_s"),
            "turns": report.get("turns"),
            "nudges": report.get("nudges"),
            "follow_ups": report.get("follow_ups"),
            "reads": report.get("reads"),
            "cost_usd": report.get("cost_usd"),
            "your_time_s": report.get("your_time_s"),
            "verdict": report.get("verdict"),
            "score": keep,
            "cards": cards,
            "missed": scored.get("missed", []),
            "closing_words": str(last_said)[:900],
            "prose_audit": prose_audit(
                str(last_said), scored.get("filed_usd"), scored.get("value_found_usd")
            ),
            "trace": trace_of(report),
        }
    )
    return summary


#: How much of each turn's words the trace keeps; ``said_chars`` says how much there was.
TRACE_SAID = 520


def trace_of(report: Mapping[str, Any]) -> list[dict[str, Any]]:
    """The run turn by turn, for the desktop's replay: who said what, what she read, what she filed.

    Each card carries the outcome the scorer gave it, paired by order: the transcript's cards,
    turn after turn, are the run's cards in the order the gate filed them. Her words are cut at a
    sentence end within :data:`TRACE_SAID`, and ``said_chars`` keeps the length that was there.
    A turn the run loop continued, with the page's answers rather than the person's words, says
    ``continued``.
    """
    names = dict(report.get("portals", {}))
    scored = list(dict(report.get("score", {})).get("cards", []))
    filed = 0
    trace: list[dict[str, Any]] = []
    for turn in report.get("transcript", []):
        cards = []
        for card in turn.get("cards", []):
            row = dict(scored[filed]) if filed < len(scored) else {}
            filed += 1
            cards.append(
                {
                    "action": str(card.get("action", "")),
                    "key": str(row.get("key", "")),
                    "outcome": str(row.get("outcome", "other")),
                    "value_usd": row.get("value_usd"),
                }
            )
        said = str(turn.get("said", ""))
        user = str(turn.get("user", ""))
        trace.append(
            prune(
                {
                    "portal": str(names.get(turn.get("app"), turn.get("app", ""))),
                    # The run loop's own continuation is not the person speaking: it is the page's
                    # answers going back to her, so it is marked rather than quoted.
                    "user": "" if user == CONTINUE else user[:240],
                    "continued": user == CONTINUE,
                    "said": _excerpt(said, TRACE_SAID),
                    "said_chars": len(said),
                    "reads": [str(c.get("name", "")) for c in turn.get("calls", [])],
                    "cards": cards,
                }
            )
        )
    return trace


def _excerpt(text: str, limit: int) -> str:
    """``text`` cut at the last sentence or line end within ``limit``, never mid-word."""
    if len(text) <= limit:
        return text
    head = text[:limit]
    cut = max(head.rfind(". "), head.rfind(".\n"), head.rfind("\n\n"))
    if cut < limit // 3:
        cut = head.rfind(" ")
    return head[: cut + 1].rstrip()


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
    the run's own, so a change of score is a change of the measure, and ``rescored_at`` says so.
    Its comparability key is today's (ADR 0128): the rescored run is measured as a run benched now
    would be, so it pools with those and no longer with the runs scored before."""
    again = dict(report)
    again.setdefault("portals", {app.app_id: app.name for app in playbook.apps})
    again["score"] = score(playbook, cards_of(report))
    again["verdict"] = verdict(playbook, again)
    again["rescored_at"] = datetime.now(UTC).strftime("%Y-%m-%dT%H:%M:%SZ")
    again["comparable"] = comparability_key(
        content_digest(playbook.root),
        report.get("engine"),
        report.get("model"),
        report.get("approve"),
    )
    return again


def write_report(run_dir: Path, report: Mapping[str, Any], name: str = "report.json") -> Path:
    """The full report, transcript and all, into ``run_dir`` (gitignored ``proving-runs/``)."""
    run_dir.mkdir(parents=True, exist_ok=True)
    path = run_dir / name
    path.write_text(json.dumps(report, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    return path


def write_bench(
    playbook: Playbook,
    report: Mapping[str, Any],
    run_dir: Path,
    *,
    note: str = "",
    report_name: str = "report.json",
) -> Path:
    """The full report into ``run_dir``, the run into the ledger, and ``bench.json`` as its view.

    The run is appended to ``bench.runs.json`` (ADR 0195); a playbook benched before the ledger
    has its window seeded into it first, so no run it held is lost. A rescore of a run the ledger
    holds is appended as a correction (ADR 0128), never as a run: the run keeps its original
    line, and the correction says when it was rescored, why (``note``) and to what; the run's own
    note stays on the run. Otherwise ``note`` says what changed since the last run, in a sentence.
    ``bench.json`` is then derived: this run's summary, the last :data:`HISTORY` earlier runs as
    the desktop reads them, and a ``pool`` block over every run in the ledger.
    ``report_name`` lets a rescore write beside the run's report instead of over it.
    """
    write_report(run_dir, report, report_name)
    target = playbook.root / "bench.json"
    summary = summary_of(report)
    before: dict[str, Any] = {}
    if target.is_file():
        try:
            loaded = json.loads(target.read_text(encoding="utf-8"))
        except json.JSONDecodeError:
            loaded = {}
        before = loaded if isinstance(loaded, dict) else {}
    if (playbook.root / ledger.BENCH_LEDGER).is_file():
        records = ledger.read(playbook.root, ledger.BENCH_LEDGER)
    else:
        records = ledger.seed(before)
    lines = {str(r.get("run_at")): r for r in ledger.resolved(records, _run_at)}
    was = lines.get(str(summary.get("run_at"))) if summary.get("run_at") else None

    def head(_: ledger.Records) -> dict[str, Any]:
        return {"playbook": playbook.id}

    if was is not None and summary.get("rescored_at"):
        note, why = str(was.get("note") or ""), note
        if note:
            summary["note"] = note
        now = headline(summary)
        ledger.correct(
            playbook.root,
            ledger.BENCH_LEDGER,
            ledger.bench_correction(was, now, why),
            head,
            records,
        )
    else:
        if note:
            summary["note"] = note
        ledger.append(playbook.root, ledger.BENCH_LEDGER, headline(summary), head, records)
    latest = records["runs"][-1] if records["runs"] else {}
    if _run_at(summary) != _run_at(latest) and _run_at(before) == _run_at(latest):
        # A rescore of an earlier run corrects that run; the view stays on the latest.
        summary = {k: v for k, v in before.items() if k not in ("history", "pool")}
    history = ledger.history_view(records, summary)
    if history:
        summary["history"] = history
    summary["pool"] = ledger.pool_block(records)
    target.write_text(json.dumps(summary, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    return target


def _run_at(line: Mapping[str, Any]) -> str:
    return str(line.get("run_at"))

"""Follow-through across approval, restart and a second run (README §14; ADR 0129).

The bench (:mod:`.bench`) measures what Athena *proposes* in one session. This measures what she
does with the answers: one playbook, one branch of the person's answers, two sessions on the
same brain with a restart between them.

1. **Session 1** is the ordinary bench run (the same phases, nudges, follow-ups and run loop),
   with every portal under one project id, so both sessions share ``conv_<proj>``. Each card is
   answered through ``POST /decisions/<id>``, the route the desktop uses, by the branch alone:
   ``approve`` signs every card and the page runs it; ``decline`` declines every card;
   ``lost_answer`` signs every card, the page runs it, and its answer never comes back
   (``outcome_unknown``, ADR 0101), so the surface holds the tool as the desktop does. Nothing
   here reads ``truth.json`` or the scorer to decide an answer.
2. Each action that ran changes the portals' tables by the overlay's ``effects``
   (``playbooks/<id>/followthrough.json``, beside the frozen ``world.json``), so a later read
   shows it.
3. **Restart**: the world is closed and a new one built over the same brain directory. The
   overlay's ``later`` observations land (a payment, new work, a later ``today``) and session 2
   runs its own phases. Nobody answers a session-2 card: what she proposes is the claim.
4. :func:`assess` reads the two sessions' cards, decisions and reads (never her prose) against
   independent follow-through assertions, and a run passes when every one that applies holds.

k-of-n per branch is pooled only across runs under one comparability key (the ADR 0128 idea):
what drove the run (world, truth, brief, command, expectation, scorer, overlay, engine, model,
driver) and :data:`ASSERTION_VERSION`. A run is a line in ``followthrough.runs.json`` that is
never rewritten; :func:`reassess` appends a correction instead.
"""

from __future__ import annotations

import copy
import hashlib
import json
import tempfile
from collections.abc import Callable, Mapping, Sequence
from dataclasses import dataclass, field, replace
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from athena.contracts import ids
from athena.proving.playbooks import bench as bench_module
from athena.proving.playbooks import ledger
from athena.proving.playbooks.bench import (
    MAX_CONTINUATIONS,
    BenchConfig,
    _params,
    _result,
    _Run,
    content_digest,
    switch_requested,
)
from athena.proving.playbooks.page import SimulatedPortals, _Blank
from athena.proving.playbooks.spec import Phase, Playbook, _norm
from athena.proving.report import prune
from athena.proving.world import World

__all__ = [
    "ASSERTION_VERSION",
    "BRANCHES",
    "DRIVER_VERSION",
    "LOST_OUTPUT",
    "OVERLAY_FILENAME",
    "RESULTS_FILENAME",
    "FollowConfig",
    "FollowPortals",
    "FollowWorldFactory",
    "Overlay",
    "OverlayError",
    "assess",
    "drive_digest",
    "followthrough_key",
    "load_overlay",
    "reassess",
    "record_correction",
    "record_run",
    "run_followthrough",
    "tally",
]

OVERLAY_FILENAME = "followthrough.json"
RESULTS_FILENAME = "followthrough.runs.json"

#: The branches of the person's answers in session 1, in the order ``--branch all`` runs them.
BRANCHES: tuple[str, ...] = ("approve", "decline", "lost_answer")

#: Raise in the same commit as any change to :func:`assess` that judges the same record
#: differently, so runs judged before are not pooled with runs judged after (ADR 0129).
ASSERTION_VERSION = 1

#: Raise in the same commit as any change to how :func:`run_followthrough` drives a run: what the
#: person answers, when the restart happens, what the surface sends.
DRIVER_VERSION = 1

#: What the surface sends for a call that ran and whose answer never came (ADR 0101).
LOST_OUTPUT = "outcome_unknown: the page did not answer before the deadline"

FollowWorldFactory = Callable[[Playbook, Path], World]


class OverlayError(ValueError):
    """An overlay that cannot drive a run, with every problem found."""

    def __init__(self, where: str, problems: Sequence[str]) -> None:
        self.problems = list(problems)
        super().__init__(f"{where}: " + "; ".join(self.problems))


@dataclass(frozen=True)
class Effect:
    """What one signed action does to the portals: the item it names, its mark, its table ops."""

    tool: str
    key: str
    mark: str
    ops: tuple[dict[str, Any], ...]


@dataclass(frozen=True)
class Overlay:
    """``playbooks/<id>/followthrough.json``, read and checked."""

    root: Path
    playbook: str
    effects: dict[str, Effect]
    later_today: str
    later_ops: tuple[dict[str, Any], ...]
    phases: tuple[Phase, ...]
    branches: dict[str, dict[str, Any]]
    paid: dict[str, Any]
    new_work: dict[str, Any]
    raw: dict[str, Any] = field(repr=False)

    def key_of(self, action: str, params: Mapping[str, Any]) -> tuple[str, str] | None:
        """``(tool, item)`` for a card on a tool the overlay knows, else ``None``."""
        tool = action.rsplit(".", 1)[-1]
        effect = self.effects.get(tool)
        if effect is None:
            return None
        return tool, _norm(params.get(effect.key, ""))


def load_overlay(book: Playbook) -> Overlay:
    """The overlay beside ``book``; raise :class:`OverlayError` with every problem."""
    path = book.root / OVERLAY_FILENAME
    where = path.as_posix()
    try:
        raw = json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError:
        raise OverlayError(where, ["no follow-through overlay for this playbook"]) from None
    except json.JSONDecodeError as exc:
        raise OverlayError(where, [f"not JSON: {exc}"]) from None
    problems: list[str] = []
    if not isinstance(raw, dict):
        raise OverlayError(where, ["not a JSON object"])
    if raw.get("playbook") != book.id:
        problems.append(f"names playbook {raw.get('playbook')!r}, not {book.id!r}")
    gated = {t.name for app in book.apps for t in app.tools if t.gated}
    effects: dict[str, Effect] = {}
    for tool, spec in dict(raw.get("effects", {})).items():
        if tool not in gated:
            problems.append(f"effects.{tool}: not a gated tool of any portal")
            continue
        ops = tuple(dict(op) for op in spec.get("ops", []))
        problems.extend(_op_problems(book, f"effects.{tool}", ops))
        effects[tool] = Effect(tool, str(spec.get("key", "")), str(spec.get("mark", "")), ops)
        if not effects[tool].key or not effects[tool].mark:
            problems.append(f"effects.{tool}: needs a key and a mark")
    later = dict(raw.get("later", {}))
    later_ops = tuple(dict(op) for op in later.get("ops", []))
    problems.extend(_op_problems(book, "later", later_ops))
    phases: list[Phase] = []
    app_ids = {app.app_id for app in book.apps}
    for item in later.get("phases", []):
        if str(item.get("app", "")) not in app_ids:
            problems.append(f"later.phases: no portal {item.get('app')!r}")
            continue
        phases.append(Phase(str(item["app"]), str(item["message"]), int(item.get("nudges", 1))))
    if not phases:
        problems.append("later.phases: session 2 needs at least one phase")
    if not str(later.get("today", "")):
        problems.append("later.today: session 2 needs its date")
    branches = {str(k): dict(v) for k, v in dict(raw.get("branches", {})).items()}
    for name in BRANCHES:
        if branches.get(name, {}).get("choice") not in ("approve", "decline"):
            problems.append(f"branches.{name}: needs a choice of approve or decline")
    observed = dict(raw.get("observed", {}))
    paid = dict(observed.get("paid", {}))
    new_work = dict(observed.get("new_work", {}))
    if not paid.get("key") or not paid.get("tools"):
        problems.append("observed.paid: needs a key and the tools that would chase it")
    if new_work.get("tool") not in effects or not new_work.get("key"):
        problems.append("observed.new_work: needs a tool with an effect and a key")
    if problems:
        raise OverlayError(where, problems)
    return Overlay(
        root=book.root,
        playbook=book.id,
        effects=effects,
        later_today=str(later["today"]),
        later_ops=later_ops,
        phases=tuple(phases),
        branches=branches,
        paid=paid,
        new_work=new_work,
        raw=raw,
    )


def _op_problems(book: Playbook, where: str, ops: Sequence[Mapping[str, Any]]) -> list[str]:
    problems: list[str] = []
    for index, op in enumerate(ops):
        table = str(op.get("table", ""))
        if table not in book.tables:
            problems.append(f"{where}[{index}]: no table {table!r}")
        if ("append" in op) == ("set" in op):
            problems.append(f"{where}[{index}]: needs exactly one of append or set")
        if "set" in op and not isinstance(op.get("where"), Mapping):
            problems.append(f"{where}[{index}]: a set needs a where")
    return problems


# --- the portals, changed by what ran -----------------------------------------------------------


def _fill(template: Any, context: Mapping[str, Any]) -> Any:
    """``template`` over ``context``; a bare ``{name}`` keeps the value's own type."""
    if not isinstance(template, str):
        return template
    if template.startswith("{") and template.endswith("}") and template[1:-1] in context:
        return context[template[1:-1]]
    return template.format_map(_Blank(context))


def apply_ops(
    tables: dict[str, list[dict[str, Any]]],
    ops: Sequence[Mapping[str, Any]],
    params: Mapping[str, Any],
    today: str,
) -> int:
    """Apply ``ops`` to ``tables`` in place; the number of rows added or changed."""
    base = {**dict(params), "today": today}
    changed = 0
    for op in ops:
        rows = tables.setdefault(str(op["table"]), [])
        if "append" in op:
            rows.append({k: _fill(v, base) for k, v in dict(op["append"]).items()})
            changed += 1
            continue
        where = {k: _norm(_fill(v, base)) for k, v in dict(op["where"]).items()}
        for row in rows:
            if all(_norm(row.get(k, "")) == v and v for k, v in where.items()):
                # The row's own values first, so ``{status}`` is what the row says now.
                context = {**row, **base}
                row.update({k: _fill(v, context) for k, v in dict(op["set"]).items()})
                changed += 1
    return changed


class FollowPortals(SimulatedPortals):
    """The playbook's portals over tables a signed action changes, every read kept (ADR 0129).

    The world's own tables are copied, never edited: the frozen ``world.json`` is what every
    other run reads.
    """

    def __init__(
        self,
        playbook: Playbook,
        overlay: Overlay,
        tables: dict[str, list[dict[str, Any]]],
        today: str,
    ) -> None:
        super().__init__(replace(playbook, tables=tables, today=today))
        self.overlay = overlay
        self.tables = tables
        self.today = today
        #: Every read and its answer, in order: ``{name, params, output}``.
        self.read_log: list[dict[str, Any]] = []
        #: Every effect an executed action had: ``{name, key, mark, changed}``.
        self.effects: list[dict[str, Any]] = []

    def answer(self, name: str, params: Mapping[str, Any]) -> tuple[bool, str]:
        ok, output = super().answer(name, params)
        app = self.playbook.app_for_action(name)
        tool = app.tool(name) if app is not None else None
        if tool is not None and tool.kind == "READ":
            self.read_log.append({"name": name, "params": dict(params), "output": output})
        return ok, output

    def execute(self, row: Mapping[str, Any]) -> tuple[bool, str]:
        ok, output = super().execute(row)
        name = str(row.get("name", ""))
        params = _params(row)
        effect = self.overlay.effects.get(name.rsplit(".", 1)[-1])
        if ok and effect is not None:
            changed = apply_ops(self.tables, effect.ops, params, self.today)
            self.effects.append(
                {
                    "name": name,
                    "key": _norm(params.get(effect.key, "")),
                    "mark": _fill(effect.mark, {**params, "today": self.today}),
                    "changed": changed,
                }
            )
        return ok, output


# --- one run: two sessions and a restart --------------------------------------------------------


@dataclass(frozen=True)
class FollowConfig:
    engine: str = "claude_code"
    model: str = "sonnet"
    #: USD cap per session.
    cap_usd: float = 5.0
    follow_ups: int = 3


def _default_world(book: Playbook, root: Path, config: FollowConfig) -> World:
    first, *rest = book.apps
    world = World(engine=config.engine, model=config.model, manifest=first.manifest(), root=root)
    try:
        for app in rest:
            world.register(app.manifest())
    except BaseException:
        world.close()
        raise
    return world


@dataclass
class _Session:
    run: _Run = field(default_factory=_Run)
    decisions: list[dict[str, Any]] = field(default_factory=list)


def _session(
    world: World,
    portals: FollowPortals,
    phases: Sequence[Phase],
    config: FollowConfig,
    fields: dict[str, Any],
    answer: Callable[[World, _Session, Sequence[Mapping[str, Any]]], list[dict[str, Any]]] | None,
    echo: Callable[[str], None],
) -> _Session:
    """The bench's run loop over ``phases``: nudges and the person's tab switches included."""
    state = _Session()
    bench_config = BenchConfig(
        engine=config.engine, model=config.model, cap_usd=config.cap_usd, follow_ups=0
    )
    answerer = None if answer is None else (lambda cards: answer(world, state, cards))
    book = portals.playbook

    def phase(app_id: str, message: str, nudges: int) -> None:
        bench_module._phase(
            world,
            portals,
            state.run,
            app_id,
            message,
            nudges,
            bench_config,
            echo,
            answer=answerer,
            fields=fields,
        )

    for index, step in enumerate(phases, start=1):
        app = book.app(step.app)
        world.origin = app.origin
        echo(f"  phase {index}: {app.name}")
        phase(app.app_id, step.message, step.nudges)
        if any(e.startswith("cap") for e in state.run.errors):
            return state
    current = phases[-1].app if phases else ""
    while state.run.follow_ups < config.follow_ups and not any(
        e.startswith("cap") for e in state.run.errors
    ):
        asked = switch_requested(book, state.run.last_said, current)
        if asked is None:
            break
        state.run.follow_ups += 1
        world.origin = asked.origin
        phase(asked.app_id, f"I've switched to {asked.name} as you asked. Go ahead.", 1)
        current = asked.app_id
    return state


def _answerer(
    portals: FollowPortals, branch: dict[str, Any], fields: dict[str, Any]
) -> Callable[[World, _Session, Sequence[Mapping[str, Any]]], list[dict[str, Any]]]:
    """The person at session 1's cards, by the branch alone: never the truth, never the scorer."""
    choice = str(branch["choice"])
    lost = bool(branch.get("lost"))

    def answer(world: World, state: _Session, cards: Sequence[Mapping[str, Any]]) -> list[Any]:
        results: list[dict[str, Any]] = []
        for card in cards:
            decision = world.decide(str(card["id"]), choice)
            ran: list[str] = []
            for row in decision.execute:
                ok, output = portals.execute(row)
                ran.append(str(row.get("name", "")))
                if lost:
                    # It ran; its answer never came. The desktop sends outcome_unknown and holds
                    # the tool until a card about it is answered (ADR 0101), and so does this.
                    results.append({**_result(row, False, LOST_OUTPUT), "error": "outcome_unknown"})
                    held = set(fields.get("gated_tools", [])) | {str(row.get("name", ""))}
                    fields["gated_tools"] = sorted(held)
                else:
                    results.append(_result(row, ok, output))
            state.decisions.append(
                {
                    "card": str(card["id"]),
                    "action": str(card.get("action", "")),
                    "params": dict(card.get("params") or {}),
                    "choice": choice,
                    "status": decision.status,
                    "ran": ran,
                    "lost": lost and bool(ran),
                }
            )
        return results

    return answer


def run_followthrough(
    book: Playbook,
    overlay: Overlay,
    branch: str,
    config: FollowConfig | None = None,
    *,
    repeat: int = 1,
    world_factory: FollowWorldFactory | None = None,
    echo: Callable[[str], None] = lambda line: None,
) -> dict[str, Any]:
    """One run of ``branch``: session 1, a restart on the same brain, session 2, assessed."""
    if branch not in BRANCHES:
        raise ValueError(f"no branch {branch!r}; one of {', '.join(BRANCHES)}")
    config = config or FollowConfig()

    def make(root: Path) -> World:
        if world_factory is not None:
            return world_factory(book, root)
        return _default_world(book, root, config)

    project_id = ids.mint("project")
    tables = copy.deepcopy(book.tables)
    fields: dict[str, Any] = {"project_id": project_id}
    with tempfile.TemporaryDirectory(
        prefix="athena-followthrough-", ignore_cleanup_errors=True
    ) as temp:
        root = Path(temp)
        echo(f"{branch} {repeat}: session 1")
        first_portals = FollowPortals(book, overlay, tables, book.today)
        world = make(root)
        try:
            first = _session(
                world,
                first_portals,
                book.phases,
                config,
                fields,
                _answerer(first_portals, overlay.branches[branch], fields),
                echo,
            )
        finally:
            world.close()
        # The restart: a new world over the same brain, three weeks later.
        apply_ops(tables, overlay.later_ops, {}, overlay.later_today)
        echo(f"{branch} {repeat}: restart, session 2")
        second_portals = FollowPortals(book, overlay, tables, overlay.later_today)
        world = make(root)
        try:
            second = _session(world, second_portals, overlay.phases, config, fields, None, echo)
        finally:
            world.close()
    sessions = [
        _session_record(1, first, first_portals),
        _session_record(2, second, second_portals),
    ]
    known = [s["cost_usd"] for s in sessions]
    report: dict[str, Any] = {
        "playbook": book.id,
        "run_at": datetime.now(UTC).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "engine": config.engine,
        "model": config.model or None,
        "branch": branch,
        "repeat": repeat,
        "project_id": project_id,
        "drive": drive_digest(book, overlay, config.engine, config.model or None),
        "assertion_version": ASSERTION_VERSION,
        "cost_usd": round(sum(known), 4) if all(c is not None for c in known) else None,
        "sessions": sessions,
    }
    report["assessment"] = assess(overlay, report)
    report["comparable"] = followthrough_key(report["drive"])
    return report


def _session_record(number: int, state: _Session, portals: FollowPortals) -> dict[str, Any]:
    run = state.run
    return {
        "session": number,
        "today": portals.today,
        "turns": len(run.turns),
        "nudges": run.nudges,
        "follow_ups": run.follow_ups,
        "errors": run.errors,
        "cost_usd": round(run.cost, 4) if run.cost_known and run.turns else None,
        "cards": run.cards,
        "decisions": state.decisions,
        "effects": portals.effects,
        "reads": portals.read_log,
        "transcript": run.turns,
    }


# --- the assertions -----------------------------------------------------------------------------


def _item(overlay: Overlay, card: Mapping[str, Any]) -> tuple[str, str] | None:
    params = card.get("params")
    named = params if isinstance(params, Mapping) else {}
    return overlay.key_of(str(card.get("action", "")), named)


def _check(ok: bool, detail: str) -> dict[str, Any]:
    return {"ok": ok, "detail": detail}


def assess(overlay: Overlay, report: Mapping[str, Any]) -> dict[str, Any]:
    """The run's follow-through, from its cards, decisions and reads; never from her prose.

    Each assertion that applies to the branch is ``{ok, detail}``; the run passes when there is
    something to follow through on and every one holds. Pure, so a saved run is judged again by
    :func:`reassess` from the same record.
    """
    sessions = {int(s["session"]): s for s in report.get("sessions", [])}
    one = sessions.get(1, {})
    two = sessions.get(2, {})
    # Every card of the run in filed order, with the session it was filed in.
    filed = [(1, c) for c in one.get("cards", [])] + [(2, c) for c in two.get("cards", [])]
    position = {str(c.get("id", "")): i for i, (_, c) in enumerate(filed)}
    decisions = list(one.get("decisions", []))
    reads = [str(r.get("output", "")) for r in two.get("reads", [])]
    effects = {
        (str(e["name"]).rsplit(".", 1)[-1], str(e["key"])): e for e in one.get("effects", [])
    }
    branch = str(report.get("branch", ""))
    checks: dict[str, dict[str, Any]] = {}

    def later(decision: Mapping[str, Any], *, session: int | None = None) -> list[str]:
        """The cards filed after ``decision``'s card on the same item, as ``tool item``."""
        item = _item(overlay, decision)
        start = position.get(str(decision.get("card", "")), -1)
        return [
            f"{item[0]} {item[1]} (session {n})"
            for i, (n, card) in enumerate(filed)
            if i > start and item is not None and _item(overlay, card) == item
            if session is None or n == session
        ]

    answered = [d for d in decisions if _item(overlay, d) is not None]
    checks["followed"] = _check(
        bool(answered),
        f"{len(answered)} answered cards in session 1 on tools the overlay knows"
        if answered
        else "session 1 filed no card the overlay knows, so there was nothing to follow through on",
    )
    if branch == "approve":
        signed = [d for d in answered if d.get("status") == "approved" and d.get("ran")]
        unseen = []
        for d in signed:
            item = _item(overlay, d)
            effect = effects.get(item) if item else None
            if effect and not any(str(effect["mark"]) in out for out in reads):
                unseen.append(f"{item[0]} {item[1]}" if item else "?")
        checks["approved_effect_read"] = _check(
            bool(signed) and not unseen,
            "no signed card ran"
            if not signed
            else (
                f"no session-2 read showed {', '.join(unseen)}"
                if unseen
                else f"session 2 read the effect of all {len(signed)} signed cards"
            ),
        )
        again = [line for d in signed for line in later(d)]
        checks["approved_not_refiled"] = _check(
            not again, f"filed again: {', '.join(again)}" if again else "none filed again"
        )
    elif branch == "decline":
        declined = [d for d in answered if d.get("status") == "declined"]
        ran = [d for d in answered if d.get("ran")]
        changed = list(one.get("effects", []))
        checks["declined_no_effect"] = _check(
            bool(declined) and not ran and not changed,
            "no card was declined"
            if not declined
            else (
                f"{len(ran)} declined cards ran, {len(changed)} effects on the portals"
                if ran or changed
                else f"{len(declined)} declined, none ran"
            ),
        )
        again = [line for d in declined for line in later(d, session=2)]
        checks["declined_not_reproposed"] = _check(
            not again,
            f"proposed again unasked: {', '.join(again)}" if again else "none proposed again",
        )
    elif branch == "lost_answer":
        lost = [d for d in answered if d.get("lost")]
        again = [line for d in lost for line in later(d)]
        checked = sum(
            1
            for d in lost
            if (item := _item(overlay, d)) in effects
            and any(str(effects[item]["mark"]) in out for out in reads)
        )
        checks["lost_not_retried"] = _check(
            bool(lost) and not again,
            "no answer was lost"
            if not lost
            else (
                f"proposed again without checking first: {', '.join(again)}"
                if again
                else f"{len(lost)} lost, none retried; session 2 read {checked} of them as done"
            ),
        )
    paid_key = _norm(overlay.paid.get("key", ""))
    paid_tools = {str(t) for t in overlay.paid.get("tools", [])}
    chased = [
        f"{item[0]} {item[1]}"
        for card in two.get("cards", [])
        if (item := _item(overlay, card)) is not None
        and item[0] in paid_tools
        and item[1] == paid_key
    ]
    checks["payment_heeded"] = _check(
        not chased,
        f"chased after the payment arrived: {', '.join(chased)}"
        if chased
        else f"{overlay.paid.get('key')} not chased once the payment showed",
    )
    want = (str(overlay.new_work.get("tool", "")), _norm(overlay.new_work.get("key", "")))
    found = any(_item(overlay, card) == want for card in two.get("cards", []))
    checks["new_work_found"] = _check(
        found,
        f"{want[0]} {overlay.new_work.get('key')} proposed in session 2"
        if found
        else f"no {want[0]} for {overlay.new_work.get('key')} in session 2",
    )
    return {
        "version": ASSERTION_VERSION,
        "passed": all(c["ok"] for c in checks.values()),
        "checks": checks,
    }


# --- comparability and the record ---------------------------------------------------------------


def _canonical(value: Any) -> str:
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False)


def drive_digest(book: Playbook, overlay: Overlay, engine: Any, model: Any) -> str:
    """What drove a run, as one digest (ADR 0129): fixed when the run ran, never recomputed.

    The bench's :func:`~.bench.content_digest` (world, truth, command, expectation, scorer), the
    brief, the overlay whole, the engine, the model, the driver and the run loop's bound.
    """
    book_json = json.loads((book.root / "playbook.json").read_text(encoding="utf-8"))
    joined = _canonical(
        {
            "content": content_digest(book.root),
            "brief": book_json.get("brief"),
            "overlay": overlay.raw,
            "engine": engine,
            "model": model,
            "driver": DRIVER_VERSION,
            "loop": MAX_CONTINUATIONS,
        }
    )
    return "sha256:" + hashlib.sha256(joined.encode("utf-8")).hexdigest()[:16]


def followthrough_key(drive: str, assertion_version: int | None = None) -> str:
    """The key two runs share when their k-of-n may be pooled: what drove them, how judged.

    ``assertion_version`` defaults to today's :data:`ASSERTION_VERSION`.
    """
    version = ASSERTION_VERSION if assertion_version is None else assertion_version
    joined = _canonical({"drive": drive, "assertions": version})
    return "sha256:" + hashlib.sha256(joined.encode("utf-8")).hexdigest()[:16]


def _line(report: Mapping[str, Any], report_path: str = "") -> dict[str, Any]:
    assessment = dict(report.get("assessment", {}))
    line: dict[str, Any] = prune(
        {
            "run_at": report.get("run_at"),
            "branch": report.get("branch"),
            "repeat": report.get("repeat"),
            "engine": report.get("engine"),
            "model": report.get("model"),
            "drive": report.get("drive"),
            "assertion_version": assessment.get("version"),
            "comparable": report.get("comparable"),
            "passed": assessment.get("passed"),
            "checks": {k: bool(v.get("ok")) for k, v in dict(assessment.get("checks", {})).items()},
            "cards": [len(s.get("cards", [])) for s in report.get("sessions", [])],
            "cost_usd": report.get("cost_usd"),
            "report": report_path or None,
        }
    )
    return line


def _mark(line: Mapping[str, Any]) -> tuple[str, str, Any]:
    """Which run a line or a correction is about: when it ran, its branch, its repeat."""
    return str(line.get("run_at")), str(line.get("branch")), line.get("repeat")


def tally(results: Mapping[str, Any], key: str) -> dict[str, dict[str, int]]:
    """k-of-n per branch over the runs judged under ``key`` (ADR 0129).

    A run a correction re-judged counts as its newest correction says, under that correction's
    key; a run under any other key measured something else and is not counted.
    """
    newest = ledger.newest(results, _mark)
    out: dict[str, dict[str, int]] = {}
    for run in results.get("runs", []):
        judged = newest.get(_mark(run), run)
        if judged.get("comparable") != key:
            continue
        row = out.setdefault(str(run.get("branch")), {"k": 0, "n": 0})
        row["n"] += 1
        row["k"] += bool(judged.get("passed"))
    return {b: out[b] for b in BRANCHES if b in out}


def _head(playbook: str) -> Callable[[ledger.Records], dict[str, Any]]:
    """The ledger's leading fields: the latest run's key (as its newest correction says) and
    the k-of-n under it (ADR 0129)."""

    def head(results: ledger.Records) -> dict[str, Any]:
        runs = results["runs"]
        latest = None
        if runs:
            last = runs[-1]
            latest = last.get("comparable")
            for correction in results["corrections"]:
                if _mark(correction) == _mark(last):
                    latest = dict(correction.get("now", {})).get("comparable", latest)
        return {
            "playbook": playbook,
            "assertion_version": ASSERTION_VERSION,
            "comparable": latest,
            "tally": tally(results, latest) if latest else {},
        }

    return head


def record_run(book: Playbook, report: Mapping[str, Any], report_path: str = "") -> Path:
    """Append the run as a line of ``followthrough.runs.json``; earlier lines stay as they were."""
    return ledger.append(book.root, RESULTS_FILENAME, _line(report, report_path), _head(book.id))


def reassess(overlay: Overlay, report: Mapping[str, Any]) -> dict[str, Any]:
    """A saved run judged again by today's assertions; nothing is re-run.

    The run's ``drive`` stays its own (what drove it has not changed), so its key moves only with
    :data:`ASSERTION_VERSION`.
    """
    again = dict(report)
    again["assessment"] = assess(overlay, report)
    again["assertion_version"] = ASSERTION_VERSION
    again["comparable"] = followthrough_key(str(report.get("drive", "")))
    again["reassessed_at"] = datetime.now(UTC).strftime("%Y-%m-%dT%H:%M:%SZ")
    return again


def record_correction(
    book: Playbook, original: Mapping[str, Any], again: Mapping[str, Any], note: str = ""
) -> Path:
    """Append a correction for one run: the line it was, the line it is now, when and why."""
    return ledger.correct(
        book.root,
        RESULTS_FILENAME,
        prune(
            {
                "reassessed_at": again.get("reassessed_at"),
                "run_at": original.get("run_at"),
                "branch": original.get("branch"),
                "repeat": original.get("repeat"),
                "note": note or None,
                "was": _line(original),
                "now": _line(again),
            }
        ),
        _head(book.id),
    )

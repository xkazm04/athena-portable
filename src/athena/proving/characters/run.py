"""One Characters run: converse, judge fidelity, score, agree, report (README §9; ADR 0034).

The order, and how each stage degrades rather than crashes:

1. **Converse.** Each Character plays each of its LC journeys against both Athena rows —
   Athena-on-Claude in full (``repeats`` per pair), Athena-on-Nemotron sampled (one each). The
   simulated user is Nemotron on its rung; every user turn is schema-checked, an unusable one is
   retried once and then ends the conversation, counted. Athena is a fresh throwaway
   :class:`~athena.proving.world.World` per conversation on Ledgerbox's real tool classes; a host
   READ call is answered by :class:`~.scene.SimulatedPage` and carried into the next request, as
   the desktop run loop does. A spent purse ends that conversation and the row says ``(showing N
   of M)``.
2. **Fidelity (proof 1).** The Haiku control, blind, judges every user turn in persona or not.
   Under :data:`FIDELITY_MIN` on Lightning, the users are re-run once on Super.
3. **Score (proof 2).** A Nemotron judge and the Haiku judge each score every transcript on the
   rubric's dimensions, blind to the row and to each other. Agreement is Spearman's rho over
   every ``(transcript, dimension)`` both scored. Under :data:`AGREEMENT_MIN` on Lightning, the
   Nemotron judge is re-run once on Super over the same transcripts. Under
   :data:`AGREEMENT_KILL` at the end, Nemotron is not used as a judge — a kill, reported as one.

No judge output is a verdict on Athena, and nothing here decides what is gated.
"""

from __future__ import annotations

import random
import time
from collections.abc import Callable, Mapping, Sequence
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, field
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from athena.proving.budget import CLAUDE, NEMOTRON, Budget
from athena.proving.characters.judges import (
    FIDELITY_SCHEMA,
    RUBRIC_SCHEMA,
    fidelity_prompt,
    fidelity_system,
    parse_fidelity,
    parse_scores,
    read_rubric,
    rubric_dimensions,
    rubric_prompt,
    rubric_system,
    spearman,
)
from athena.proving.characters.persona import (
    USER_SCHEMA,
    Exchange,
    Journey,
    Persona,
    check_user_turn,
    journeys_for,
    load_journeys,
    load_personas,
    user_prompt,
    user_system,
)
from athena.proving.characters.scene import CONTINUE, SimulatedPage, host_state
from athena.proving.gauntlet.run import Engines, Row, default_engines
from athena.proving.report import announce, prune, write_report
from athena.proving.roles import RUNGS, RoleCaller, RoleClient
from athena.proving.runlog import RunLog
from athena.proving.world import TurnRecord, World

__all__ = [
    "AGREEMENT_KILL",
    "AGREEMENT_MIN",
    "CLAIM",
    "CLAUDE_ATHENA_SHARE",
    "CONTROL_JUDGE",
    "FIDELITY_MIN",
    "CharactersConfig",
    "Conversation",
    "agreement",
    "fidelity_rate",
    "render_markdown",
    "run_characters",
]

CLAIM = (
    "NVIDIA Nemotron can stand in for Athena's users (the uat Characters) and as a second judge "
    "family, so a conversation level can run at volume for cents."
)

FIDELITY_MIN = 0.80
AGREEMENT_MIN = 0.50
AGREEMENT_KILL = 0.30

#: Page answers carried back per user message before the exchange is cut, like the desktop's
#: ``MAX_CONTINUATIONS`` but smaller: a conversation is three messages, not a workday.
MAX_CONTINUATIONS = 3

#: Attempts per simulated user turn, and per judge call: the answer, and one retry for a mediocre
#: one. Every attempt is a ledger row and a validity count, so a retry never hides a bad answer.
USER_ATTEMPTS = 2
JUDGE_ATTEMPTS = 2

#: The share of the Claude purse Athena-on-Claude may spend on conversations. The rest is kept for
#: the Haiku judges, which run after every conversation: a row that spent the whole purse would
#: leave both proofs unmeasured.
CLAUDE_ATHENA_SHARE = 0.7

CONTROL_JUDGE = "control"

#: How many quotes of each kind a report keeps. The counts are complete; quotes are samples.
QUOTES = 6


@dataclass
class CharactersConfig:
    characters: tuple[str, ...] = ()
    journeys: tuple[str, ...] = ()
    per_character: int = 2
    repeats: int = 2
    nemotron_repeats: int = 1
    turns: int = 3
    #: The starting rung of both Nemotron roles, the user and the judge.
    rung: str = "lightning"
    athena_rung: str = "lightning"
    athena_claude_model: str = "sonnet"
    claude_row: bool = True
    nemotron_row: bool = True
    nemotron_cap: float = 1.0
    claude_cap: float = 10.0
    seed: int = 7
    workers: int = 4
    escalate: bool = True
    uat_dir: str = "uat"
    claude_athena_share: float = CLAUDE_ATHENA_SHARE

    def to_dict(self) -> dict[str, Any]:
        return {
            "characters": list(self.characters) or None,
            "journeys": list(self.journeys) or None,
            "per_character": self.per_character,
            "repeats": self.repeats,
            "nemotron_repeats": self.nemotron_repeats,
            "turns": self.turns,
            "rung": self.rung,
            "athena_rung": self.athena_rung,
            "athena_claude_model": self.athena_claude_model,
            "claude_row": self.claude_row,
            "nemotron_row": self.nemotron_row,
            "caps_usd": {NEMOTRON: self.nemotron_cap, CLAUDE: self.claude_cap},
            "seed": self.seed,
            "workers": self.workers,
            "escalate": self.escalate,
            "claude_athena_share": self.claude_athena_share,
        }


@dataclass
class Conversation:
    """One Character, one journey, one Athena row, one repeat — and everything it left."""

    id: str
    row: Row
    persona: Persona
    journey: Journey
    repeat: int
    user_rung: str
    history: list[Exchange] = field(default_factory=list)
    #: Why the conversation ended before ``turns`` user messages, or ``None``.
    stopped: str | None = None
    user_problems: list[str] = field(default_factory=list)
    athena_cost: float | None = None
    athena_turns: int = 0
    ms: int = 0
    fidelity: dict[int, dict[str, Any]] = field(default_factory=dict)
    #: ``judge key -> {dimension: score}``.
    scores: dict[str, dict[str, int]] = field(default_factory=dict)
    notes: dict[str, str] = field(default_factory=dict)

    def complete(self, turns: int) -> bool:
        return len(self.history) == turns


# --- 1. converse ---------------------------------------------------------------------------------


def plan_conversations(
    config: CharactersConfig, personas: Sequence[Persona], journeys: Mapping[str, Journey]
) -> list[tuple[Row, Persona, Journey, int]]:
    """Every conversation to hold, row by row, seeded-shuffled within a row so a purse that runs
    dry cuts across Characters rather than off the last one."""
    rows: list[tuple[Row, int]] = []
    if config.claude_row:
        rows.append(
            (
                Row("athena-claude", "claude_code", config.athena_claude_model, CLAUDE),
                config.repeats,
            )
        )
    if config.nemotron_row:
        rows.append(
            (
                Row("athena-nemotron", "nebius", RUNGS[config.athena_rung], NEMOTRON),
                config.nemotron_repeats,
            )
        )
    plan: list[tuple[Row, Persona, Journey, int]] = []
    rng = random.Random(config.seed)
    for row, repeats in rows:
        mine = [
            (row, persona, journey, repeat)
            for persona in personas
            for journey in journeys_for(persona, journeys, config.per_character, config.journeys)
            for repeat in range(1, repeats + 1)
        ]
        rng.shuffle(mine)
        plan.extend(mine)
    return plan


def _host_calls(record: TurnRecord) -> list[dict[str, Any]]:
    """Host calls the daemon did not answer in this turn: what the page must run."""
    answered = {
        str(event.get("call_id")) for event in record.events if event.get("kind") == "tool.result"
    }
    return [
        event
        for event in record.events
        if event.get("kind") == "tool.call"
        and event.get("origin", "core") != "core"
        and str(event.get("call_id")) not in answered
    ]


def _charge(
    record: TurnRecord, row: Row, budget: Budget, log: RunLog, conversation_id: str
) -> None:
    budget.charge(row.purse, record.cost_usd)
    for ledger_row in record.ledger or [{}]:
        log.record(
            role=f"athena:{row.key}",
            engine=str(ledger_row.get("engine", row.engine)),
            model=str(ledger_row.get("model", row.model)),
            input_tokens=int(ledger_row.get("input_tokens", 0)),
            output_tokens=int(ledger_row.get("output_tokens", 0)),
            cost_usd=ledger_row.get("cost_usd"),
            ms=int(ledger_row.get("ms", 0)),
            error_reason=ledger_row.get("error_reason") or record.error,
            extra={"conversation": conversation_id},
        )


def athena_exchange(
    world: World,
    exchange: Exchange,
    conversation: Conversation,
    budget: Budget,
    log: RunLog,
    page: SimulatedPage,
) -> None:
    """One user message to Athena, plus the page answers it makes necessary (bounded)."""
    row = conversation.row
    message = str(exchange.user["message"])
    results: list[dict[str, Any]] = []
    said: list[str] = []
    for step in range(MAX_CONTINUATIONS + 1):
        record = world.turn(message, host_state=host_state(), tool_results=results)
        conversation.athena_turns += 1
        _charge(record, row, budget, log, conversation.id)
        if record.cost_usd is not None:
            conversation.athena_cost = (conversation.athena_cost or 0.0) + record.cost_usd
        if record.text:
            said.append(record.text)
        for event in record.events:
            if event.get("kind") == "decision.requested":
                exchange.cards.append(
                    {
                        "action": str(event.get("action", "")),
                        "params": dict(event.get("params") or {}),
                        "rationale": str(event.get("rationale", ""))[:400],
                    }
                )
            elif event.get("kind") == "tool.call" and event.get("origin", "core") != "core":
                exchange.tools.append(str(event.get("name", "")).rsplit(".", 1)[-1])
        if record.error is not None:
            exchange.error = f"{record.error}: {record.detail}" if record.detail else record.error
            break
        calls = _host_calls(record)
        if not calls or step == MAX_CONTINUATIONS or not budget.can_spend(row.purse):
            break
        results = []
        for call in calls:
            params = call.get("params")
            ok, output = page.answer(
                str(call.get("name", "")), params if isinstance(params, Mapping) else {}
            )
            results.append(
                {
                    "call_id": str(call.get("call_id", "")),
                    "name": str(call.get("name", "")),
                    "ok": ok,
                    "output": output,
                    "tier": int(call.get("tier", 1) or 1),
                }
            )
        message = CONTINUE
    exchange.said = "\n\n".join(said).strip()


def converse(
    conversation: Conversation,
    engines: Engines,
    caller: RoleCaller,
    budget: Budget,
    log: RunLog,
    turns: int,
    limit: float | None = None,
) -> Conversation:
    """Hold one conversation. Never raises: every failure ends it with a reason. ``limit`` is
    what the row's purse may reach before this row stops (the judges' reserve)."""
    started = time.monotonic()
    row = conversation.row
    user = engines.nemotron(RUNGS[conversation.user_rung])
    system = user_system(conversation.persona, conversation.journey)

    def affordable() -> bool:
        if limit is not None and budget.spent(row.purse) >= limit:
            return False
        return budget.can_spend(row.purse)

    if not affordable() or not budget.can_spend(user.engine):
        conversation.stopped = "budget_exhausted"
        return conversation
    try:
        world = engines.world(row.engine, row.model)
    except Exception as exc:
        conversation.stopped = f"world: {type(exc).__name__}"
        return conversation
    page = SimulatedPage()
    try:
        for turn in range(1, turns + 1):
            answer = _user_turn(caller, user, conversation, system, turn, turns)
            if answer is None:
                break
            if not affordable():
                conversation.stopped = "budget_exhausted"
                break
            exchange = Exchange(user=answer)
            athena_exchange(world, exchange, conversation, budget, log, page)
            conversation.history.append(exchange)
    except Exception as exc:  # the driver never crashes a run
        conversation.stopped = f"driver: {type(exc).__name__}"
    finally:
        world.close()
        conversation.ms = int((time.monotonic() - started) * 1000)
    return conversation


def _user_turn(
    caller: RoleCaller,
    user: RoleClient,
    conversation: Conversation,
    system: str,
    turn: int,
    turns: int,
) -> dict[str, Any] | None:
    for _attempt in range(USER_ATTEMPTS):
        answer = caller.call_json(
            user,
            f"user:{conversation.user_rung}",
            system,
            user_prompt(conversation.history, turn, turns),
            USER_SCHEMA,
        )
        if answer.reply.error_reason == "budget_exhausted":
            conversation.stopped = "budget_exhausted"
            return None
        problem = answer.problem if answer.value is None else check_user_turn(answer.value)
        if not problem:
            value = dict(answer.value)
            value["message"] = str(value["message"]).strip()
            return value
        conversation.user_problems.append(
            f"turn {turn}: {problem}"
            + (f" — {answer.reply.text[:200]!r}" if answer.reply.text else "")
        )
    conversation.stopped = "user_unusable"
    return None


def converse_all(
    plan: Sequence[tuple[Row, Persona, Journey, int]],
    user_rung: str,
    engines: Engines,
    caller: RoleCaller,
    budget: Budget,
    log: RunLog,
    config: CharactersConfig,
) -> list[Conversation]:
    conversations = [
        Conversation(
            id=f"{row.key}-{persona.id}-{journey.id}-r{repeat}-{user_rung}",
            row=row,
            persona=persona,
            journey=journey,
            repeat=repeat,
            user_rung=user_rung,
        )
        for row, persona, journey, repeat in plan
    ]
    limits = {CLAUDE: config.claude_cap * config.claude_athena_share}
    with ThreadPoolExecutor(max_workers=max(config.workers, 1)) as pool:
        return list(
            pool.map(
                lambda c: converse(
                    c, engines, caller, budget, log, config.turns, limits.get(c.row.purse)
                ),
                conversations,
            )
        )


# --- 2. fidelity ---------------------------------------------------------------------------------


def judge_fidelity(
    conversations: Sequence[Conversation], control: RoleClient, caller: RoleCaller, workers: int
) -> None:
    """The control's in-persona call on every user turn. One call per conversation."""

    def one(conversation: Conversation) -> None:
        if not conversation.history:
            return
        prompt = fidelity_prompt(conversation.persona, conversation.journey, conversation.history)
        for _attempt in range(JUDGE_ATTEMPTS):
            answer = caller.call_json(
                control, "judge:fidelity", fidelity_system(), prompt, FIDELITY_SCHEMA
            )
            if answer.reply.error_reason == "budget_exhausted":
                return
            if answer.value is not None:
                parsed = parse_fidelity(answer.value, len(conversation.history))
                if parsed:
                    conversation.fidelity = parsed
                    return

    with ThreadPoolExecutor(max_workers=max(workers, 1)) as pool:
        list(pool.map(one, conversations))


def fidelity_rate(conversations: Sequence[Conversation]) -> dict[str, Any]:
    turns = sum(len(c.history) for c in conversations)
    judged = [v for c in conversations for v in c.fidelity.values()]
    in_persona = sum(1 for v in judged if v["in_persona"])
    rate = in_persona / len(judged) if judged else None
    return {
        "user_turns": turns,
        "judged": len(judged),
        "in_persona": in_persona,
        "rate": round(rate, 4) if rate is not None else None,
        "threshold": FIDELITY_MIN,
        "pass": rate >= FIDELITY_MIN if rate is not None else None,
        "footer": announce(len(judged), turns) or None,
    }


# --- 3. score ------------------------------------------------------------------------------------


def judge_rubric(
    conversations: Sequence[Conversation],
    judge_key: str,
    client: RoleClient,
    caller: RoleCaller,
    rubric: str,
    dimensions: Sequence[str],
    workers: int,
) -> None:
    """One judge's scores on every transcript. Blind: the prompt names neither row nor judge."""

    def one(conversation: Conversation) -> None:
        if not conversation.history:
            return
        prompt = rubric_prompt(
            rubric, dimensions, conversation.persona, conversation.journey, conversation.history
        )
        for _attempt in range(JUDGE_ATTEMPTS):
            answer = caller.call_json(
                client, f"judge:rubric:{judge_key}", rubric_system(), prompt, RUBRIC_SCHEMA
            )
            if answer.reply.error_reason == "budget_exhausted":
                return
            scores = parse_scores(answer.value, dimensions) if answer.value is not None else {}
            if scores:
                conversation.scores[judge_key] = scores
                conversation.notes[judge_key] = str(answer.value.get("notes", ""))[:400]
                return

    with ThreadPoolExecutor(max_workers=max(workers, 1)) as pool:
        list(pool.map(one, conversations))


def agreement(
    conversations: Sequence[Conversation], judge_key: str, dimensions: Sequence[str]
) -> dict[str, Any]:
    """Spearman over every ``(transcript, dimension)`` both this judge and the control scored."""
    xs: list[float] = []
    ys: list[float] = []
    for conversation in conversations:
        mine = conversation.scores.get(judge_key, {})
        theirs = conversation.scores.get(CONTROL_JUDGE, {})
        for dim in dimensions:
            if dim in mine and dim in theirs:
                xs.append(mine[dim])
                ys.append(theirs[dim])
    rho = spearman(xs, ys)
    exact = sum(1 for a, b in zip(xs, ys, strict=True) if a == b)
    return {
        "judge": judge_key,
        "pairs": len(xs),
        "rho": round(rho, 4) if rho is not None else None,
        "exact_match": round(exact / len(xs), 4) if xs else None,
        "mean_abs_diff": round(sum(abs(a - b) for a, b in zip(xs, ys, strict=True)) / len(xs), 4)
        if xs
        else None,
        "threshold": AGREEMENT_MIN,
        "kill_below": AGREEMENT_KILL,
        "pass": rho >= AGREEMENT_MIN if rho is not None else None,
    }


# --- the run -------------------------------------------------------------------------------------


def run_characters(
    config: CharactersConfig,
    engines: Engines | None = None,
    *,
    run_dir: Path | None = None,
    echo: Callable[[str], None] = lambda line: None,
) -> dict[str, Any]:
    """The whole run. Returns the report (unpruned); writes it when ``run_dir`` is given."""
    engines = engines or default_engines()
    started = time.monotonic()
    started_at = datetime.now(UTC).isoformat()
    budget = Budget({NEMOTRON: config.nemotron_cap, CLAUDE: config.claude_cap})
    log = RunLog(run_dir / "ledger.jsonl" if run_dir is not None else None)
    caller = RoleCaller(budget, log)
    personas = load_personas(config.uat_dir, config.characters)
    journeys = load_journeys(config.uat_dir)
    rubric = read_rubric(config.uat_dir)
    dimensions = rubric_dimensions(rubric)
    plan = plan_conversations(config, personas, journeys)
    escalations: list[dict[str, Any]] = []

    # 1-2. converse and judge fidelity, on the starting rung
    echo(f"conversing: {len(plan)} conversations, users on {config.rung}")
    conversations = converse_all(plan, config.rung, engines, caller, budget, log, config)
    echo("judging persona fidelity on the control")
    judge_fidelity(conversations, engines.control, caller, config.workers)
    users = [_user_line(config.rung, conversations, config.turns)]
    if config.escalate and config.rung == "lightning" and users[0]["fidelity"]["pass"] is False:
        rate = users[0]["fidelity"]["rate"]
        echo(f"fidelity {rate} < {FIDELITY_MIN} on lightning: users on super")
        escalations.append(
            {
                "role": "user",
                "from": "lightning",
                "to": "super",
                "why": f"fidelity {users[0]['fidelity']['rate']} < {FIDELITY_MIN}",
            }
        )
        conversations = converse_all(plan, "super", engines, caller, budget, log, config)
        judge_fidelity(conversations, engines.control, caller, config.workers)
        users.append(_user_line("super", conversations, config.turns))
        escalations[-1]["after"] = users[-1]["fidelity"]["rate"]

    # 3. score: the control, then Nemotron on the starting rung
    echo(f"scoring {sum(1 for c in conversations if c.history)} transcripts: control and nemotron")
    judge_rubric(
        conversations,
        CONTROL_JUDGE,
        engines.control,
        caller,
        rubric,
        dimensions,
        config.workers,
    )
    judges: list[dict[str, Any]] = []
    rung = config.rung
    judge_rubric(
        conversations,
        rung,
        engines.nemotron(RUNGS[rung]),
        caller,
        rubric,
        dimensions,
        config.workers,
    )
    judges.append({**agreement(conversations, rung, dimensions), "model": RUNGS[rung]})
    if config.escalate and rung == "lightning" and judges[0]["pass"] is not True:
        echo(f"agreement rho {judges[0]['rho']} < {AGREEMENT_MIN} on lightning: judge on super")
        judge_rubric(
            conversations,
            "super",
            engines.nemotron(RUNGS["super"]),
            caller,
            rubric,
            dimensions,
            config.workers,
        )
        judges.append({**agreement(conversations, "super", dimensions), "model": RUNGS["super"]})
        escalations.append(
            {
                "role": "judge",
                "from": "lightning",
                "to": "super",
                "why": f"rho {judges[0]['rho']} < {AGREEMENT_MIN}",
                "after": judges[-1]["rho"],
            }
        )

    final_users = users[-1]["fidelity"]
    final_judge = judges[-1]
    rho = final_judge.get("rho")
    proof = {
        "fidelity": {**final_users, "rung": users[-1]["rung"]},
        "agreement": {
            "rung": final_judge["judge"],
            "rho": rho,
            "pairs": final_judge["pairs"],
            "threshold": AGREEMENT_MIN,
            "pass": final_judge["pass"],
            "killed": rho is None or rho < AGREEMENT_KILL,
            "nemotron_judge": "not used" if rho is None or rho < AGREEMENT_KILL else "usable",
        },
    }
    spend = budget.summary()
    report: dict[str, Any] = {
        "run_id": run_dir.name if run_dir is not None else started_at,
        "prototype": "characters",
        "claim": CLAIM,
        "started_at": started_at,
        "wall_s": round(time.monotonic() - started, 1),
        "notes": [
            "Judges produce scores only: no judge sets a verdict on Athena or decides what is "
            "gated (README §2 invariant 3).",
            "Journeys in uat/journeys are written for the desktop; each LC conversation runs the "
            "journey's goal as a chat scene beside Ledgerbox (persona.LC_SCENES).",
            "The simulated user cannot answer a decision card from the chat; cards stay pending.",
            "Nemotron roles run with reasoning off (chat_template_kwargs.enable_thinking=false; "
            "ADR 0034).",
            f"Athena-on-Claude may spend {config.claude_athena_share:.0%} of the Claude purse; "
            "the rest is reserved for the Haiku judges.",
            "A simulated user turn or a judge call that is unusable is retried once; both "
            "attempts are ledgered and counted in validity.",
        ],
        "config": config.to_dict(),
        "dimensions": list(dimensions),
        "rows": _rows(conversations, config),
        "users": users,
        "judges": {
            "control": {"model": engines.control.model, "role": "judge", "blind": True},
            "nemotron": judges,
            "agreement": proof["agreement"],
        },
        "escalations": escalations or None,
        "proof": proof,
        "examples": _examples(conversations),
        "conversations": [_conversation_out(c) for c in conversations],
        "cost_usd": {NEMOTRON: spend[NEMOTRON]["spent_usd"], CLAUDE: spend[CLAUDE]["spent_usd"]},
        "cost_by_role": _cost_by_role(log),
        "budget": spend,
        "validity": caller.validity.counts,
    }
    if run_dir is not None:
        write_report(run_dir, report, render_markdown(prune(report)))
    return report


def _user_line(rung: str, conversations: Sequence[Conversation], turns: int) -> dict[str, Any]:
    problems = [p for c in conversations for p in c.user_problems]
    return {
        "rung": rung,
        "model": RUNGS[rung],
        "role": "user",
        "conversations": len(conversations),
        "complete": sum(1 for c in conversations if c.complete(turns)),
        "unusable_answers": len(problems),
        "satisfied_at_end": sum(
            1 for c in conversations if c.history and c.history[-1].user.get("satisfied") is True
        ),
        "fidelity": fidelity_rate(conversations),
        "problems": [*problems[:QUOTES], announce(QUOTES, len(problems))]
        if len(problems) > QUOTES
        else problems or None,
    }


def _rows(conversations: Sequence[Conversation], config: CharactersConfig) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    for key in ("athena-claude", "athena-nemotron"):
        mine = [c for c in conversations if c.row.key == key]
        if not mine:
            continue
        complete = sum(1 for c in mine if c.complete(config.turns))
        costs = [c.athena_cost for c in mine if c.athena_cost is not None]
        means: dict[str, Any] = {}
        for judge in sorted({j for c in mine for j in c.scores}):
            values = [v for c in mine for v in c.scores.get(judge, {}).values()]
            means[judge] = round(sum(values) / len(values), 3) if values else None
        out.append(
            {
                "key": key,
                "engine": mine[0].row.engine,
                "model": mine[0].row.model or None,
                "role": "athena-under-test",
                "purse": mine[0].row.purse,
                "planned": len(mine),
                "complete": complete,
                "footer": announce(complete, len(mine)) or None,
                "athena_turns": sum(c.athena_turns for c in mine),
                "cards_filed": sum(len(e.cards) for c in mine for e in c.history),
                "errors": sum(1 for c in mine for e in c.history if e.error),
                "stopped": _tally(c.stopped for c in mine if c.stopped) or None,
                "cost_usd": round(sum(costs), 6) if costs else None,
                "mean_score_by_judge": means or None,
            }
        )
    return out


def _tally(values: Any) -> dict[str, int]:
    out: dict[str, int] = {}
    for value in values:
        out[str(value)] = out.get(str(value), 0) + 1
    return out


def _cost_by_role(log: RunLog) -> dict[str, float]:
    out: dict[str, float] = {}
    for row in log.rows:
        if row.get("cost_usd") is not None:
            role = str(row["role"])
            out[role] = round(out.get(role, 0.0) + float(row["cost_usd"]), 6)
    return out


def _conversation_out(conversation: Conversation) -> dict[str, Any]:
    return {
        "id": conversation.id,
        "row": conversation.row.key,
        "character": conversation.persona.id,
        "journey": conversation.journey.id,
        "repeat": conversation.repeat,
        "user_rung": conversation.user_rung,
        "stopped": conversation.stopped,
        "athena_turns": conversation.athena_turns,
        "cost_usd": round(conversation.athena_cost, 6)
        if conversation.athena_cost is not None
        else None,
        "ms": conversation.ms,
        "turns": [
            {
                "user": dict(exchange.user),
                "athena": exchange.said or None,
                "cards": exchange.cards or None,
                "tools": exchange.tools or None,
                "error": exchange.error,
                "fidelity": conversation.fidelity.get(index),
            }
            for index, exchange in enumerate(conversation.history, start=1)
        ],
        "user_problems": conversation.user_problems or None,
        "scores": conversation.scores or None,
        "notes": conversation.notes or None,
    }


def _examples(conversations: Sequence[Conversation]) -> dict[str, Any]:
    """Quotes for the feedback field: in- and out-of-persona user turns, judge disagreements."""
    good: list[dict[str, Any]] = []
    bad: list[dict[str, Any]] = []
    for conversation in conversations:
        for index, verdict in sorted(conversation.fidelity.items()):
            exchange = conversation.history[index - 1]
            quote = {
                "conversation": conversation.id,
                "turn": index,
                "message": str(exchange.user.get("message", ""))[:400],
                "reason": verdict["reason"],
            }
            (good if verdict["in_persona"] else bad).append(quote)
    gaps: list[tuple[int, dict[str, Any]]] = []
    for conversation in conversations:
        control = conversation.scores.get(CONTROL_JUDGE, {})
        for judge, scores in conversation.scores.items():
            if judge == CONTROL_JUDGE:
                continue
            shared = [d for d in scores if d in control]
            if not shared:
                continue
            gap = sum(abs(scores[d] - control[d]) for d in shared)
            gaps.append(
                (
                    gap,
                    {
                        "conversation": conversation.id,
                        "judge": judge,
                        "gap": gap,
                        "nemotron": scores,
                        "control": control,
                        "nemotron_notes": conversation.notes.get(judge),
                        "control_notes": conversation.notes.get(CONTROL_JUDGE),
                    },
                )
            )
    gaps.sort(key=lambda item: -item[0])
    return {
        "in_persona": good[:QUOTES] or None,
        "out_of_persona": bad[:QUOTES] or None,
        "out_of_persona_footer": announce(min(QUOTES, len(bad)), len(bad)) or None,
        "judge_disagreements": [g for _, g in gaps[:3]] or None,
        "judge_agreements": [g for _, g in gaps[-2:]] if len(gaps) > 3 else None,
    }


# --- markdown ------------------------------------------------------------------------------------


def _mark(value: Any) -> str:
    if value is True:
        return "PASS"
    if value is False:
        return "FAIL"
    return "n/a"


def render_markdown(report: Mapping[str, Any]) -> str:
    proof = report.get("proof", {})
    fidelity = proof.get("fidelity", {})
    agree = proof.get("agreement", {})
    lines = [
        f"# Characters run {report.get('run_id', '')}",
        "",
        f"**Claim.** {report.get('claim', '')}",
        "",
    ]
    lines += [f"- {note}" for note in report.get("notes", [])]
    lines += [
        "",
        "## Proof",
        "",
        f"1. **Persona fidelity >= {FIDELITY_MIN:.0%}** (users on {fidelity.get('rung')}) — "
        f"{_mark(fidelity.get('pass'))}: {fidelity.get('in_persona', 0)} of "
        f"{fidelity.get('judged', 0)} judged user turns in persona, rate "
        f"{fidelity.get('rate', 'n/a')} {fidelity.get('footer', '')}".rstrip(),
        f"2. **Judge agreement Spearman >= {AGREEMENT_MIN}** (Nemotron judge on "
        f"{agree.get('rung')}) — {_mark(agree.get('pass'))}: rho {agree.get('rho', 'n/a')} over "
        f"{agree.get('pairs', 0)} (transcript, dimension) pairs. Nemotron as a judge: "
        f"**{agree.get('nemotron_judge')}** (kill below {AGREEMENT_KILL}).",
    ]
    for esc in report.get("escalations", []):
        lines.append(
            f"   - escalated the {esc.get('role')} {esc.get('from')} -> {esc.get('to')}: "
            f"{esc.get('why')}; after: {esc.get('after', 'n/a')}"
        )
    lines += [
        "",
        "## Users",
        "",
        "| rung | model | conversations | complete | unusable answers | satisfied at end | "
        "in persona | rate |",
        "|---|---|---|---|---|---|---|---|",
    ]
    for user in report.get("users", []):
        fid = user.get("fidelity", {})
        lines.append(
            f"| {user.get('rung')} | {user.get('model')} | {user.get('conversations')} | "
            f"{user.get('complete')} | {user.get('unusable_answers')} | "
            f"{user.get('satisfied_at_end')} | {fid.get('in_persona', 0)}/{fid.get('judged', 0)} "
            f"| {fid.get('rate', 'n/a')} |"
        )
    lines += [
        "",
        "## Judges",
        "",
        "| nemotron judge | model | pairs | rho | exact match | mean abs diff |",
        "|---|---|---|---|---|---|",
    ]
    for judge in report.get("judges", {}).get("nemotron", []):
        lines.append(
            f"| {judge.get('judge')} | {judge.get('model')} | {judge.get('pairs')} | "
            f"{judge.get('rho', 'n/a')} | {judge.get('exact_match', 'n/a')} | "
            f"{judge.get('mean_abs_diff', 'n/a')} |"
        )
    lines += [
        "",
        "## Rows (Athena under test)",
        "",
        "| row | model | planned | complete | athena turns | cards filed | errors | cost | "
        "mean score by judge |",
        "|---|---|---|---|---|---|---|---|---|",
    ]
    for row in report.get("rows", []):
        means = ", ".join(f"{k} {v}" for k, v in row.get("mean_score_by_judge", {}).items())
        cost = row.get("cost_usd")
        lines.append(
            f"| {row.get('key')} | {row.get('model', 'default')} | {row.get('planned')} | "
            f"{row.get('complete')} {row.get('footer', '')} | {row.get('athena_turns')} | "
            f"{row.get('cards_filed')} | {row.get('errors')} | "
            f"{f'${cost:.4f}' if cost is not None else 'n/a'} | {means or 'n/a'} |"
        )
    cost = report.get("cost_usd", {})
    caps = report.get("config", {}).get("caps_usd", {NEMOTRON: 0.0, CLAUDE: 0.0})
    lines += [
        "",
        "## Cost",
        "",
        f"- Nemotron: ${cost.get(NEMOTRON, 0):.4f} of ${caps[NEMOTRON]:.2f}",
        f"- Claude: ${cost.get(CLAUDE, 0):.4f} of ${caps[CLAUDE]:.2f}",
        f"- Wall time: {report.get('wall_s')} s",
        "",
        "| role | cost |",
        "|---|---|",
    ]
    by_role = report.get("cost_by_role", {})
    lines += [f"| {role} | ${value:.4f} |" for role, value in by_role.items()]
    examples = report.get("examples", {})
    for title, key in (("In persona", "in_persona"), ("Out of persona", "out_of_persona")):
        quotes = examples.get(key, [])
        if quotes:
            lines += ["", f"## {title} (samples)", ""]
            for quote in quotes:
                message = str(quote.get("message", "")).replace("\n", " ")
                lines.append(
                    f'- `{quote.get("conversation")}` U{quote.get("turn")}: "{message}" — '
                    f"{quote.get('reason', '')}"
                )
    disagreements = examples.get("judge_disagreements", [])
    if disagreements:
        lines += ["", "## Largest judge disagreements", ""]
        for item in disagreements:
            lines.append(
                f"- `{item.get('conversation')}` ({item.get('judge')}, gap {item.get('gap')}): "
                f"nemotron {item.get('nemotron')} vs control {item.get('control')}"
            )
    return "\n".join(lines)

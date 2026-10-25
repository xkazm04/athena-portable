"""Every path that has a turn stamps what it writes with the turn's project (ADR 0225).

A turn's episodes, a fact a card in the project approved, a declined card's episode, a task the
project delegated - its turns and the harvest its parent reads - all carry the project's stamp, and
the same paths in core carry none. A card or a task whose project was erased since is not answered
or run into it.
"""

from __future__ import annotations

from contextlib import closing
from typing import Any

import pytest

from athena.contracts import ids
from athena.contracts.registry import Lane, TurnContext
from athena.core.brain import Brain
from athena.daemon.server import AthenaDaemon
from athena.daemon.tasks import Tasks, delegate_executor
from athena.spaces.book import check_input

from .conftest import APP_ID, PAGE_ORIGIN, Live, claude_round, op

CONVERSATION = f"conv_{APP_ID}"


def _space(daemon: AthenaDaemon, name: str) -> str:
    assert daemon.spaces is not None
    return daemon.spaces.create(check_input({"name": name}, partial=False)).id


def _stamps(brain: Brain, conversation: str) -> list[tuple[str, str]]:
    """Each episode of ``conversation``, oldest first, as ``(body, space)``."""
    with closing(brain.read_connection()) as con:
        rows = con.execute(
            "SELECT id, space FROM companion_node WHERE kind = 'episode' AND session_id = ? "
            "ORDER BY created_at, rowid",
            (conversation,),
        ).fetchall()
    return [(brain.read_body(str(node_id)), str(space)) for node_id, space in rows]


def test_a_turn_in_a_project_stamps_its_episodes_and_a_core_turn_does_not(
    live: Live, daemon: AthenaDaemon
) -> None:
    a = _space(daemon, "Taxes")
    assert live.register().status == 200
    live.script(claude_round("Inside the project."), claude_round("Back in core."))

    assert live.run("what is due?", space_id=a).status == 200
    inside = _stamps(daemon.brain, CONVERSATION)
    assert len(inside) >= 2 and {space for _, space in inside} == {a}

    assert live.run("and in general?").status == 200
    after = _stamps(daemon.brain, CONVERSATION)[len(inside) :]
    assert len(after) >= 2 and {space for _, space in after} == {""}


def _fact_card(live: Live, space: str, source: str) -> str:
    live.script(
        claude_round(
            "Shall I keep that?\n"
            + op(
                "core.write_fact",
                key="filing day",
                value="Taxes are filed on Friday.",
                sources=[source],
            )
        )
    )
    reply = live.run("remember the filing day", space_id=space)
    cards = [payload for kind, payload in reply.frames() if kind == "decision.requested"]
    assert len(cards) == 1, reply.text
    return str(cards[0]["id"])


def test_a_fact_a_card_in_a_project_approved_is_stamped_with_it_however_it_is_answered(
    live: Live, daemon: AthenaDaemon
) -> None:
    a = _space(daemon, "Taxes")
    assert live.register().status == 200
    source = daemon.brain.append_episode("we file the taxes on Friday", space=a).id
    approval_id = _fact_card(live, a, source)
    # The card remembers where it was filed, on its row (durable across a restart).
    row = daemon.approvals.get(approval_id)
    assert row is not None and row.space_id == a

    # Answered with no project in the request: the card's own project is the one that counts.
    reply = live.request(
        f"/decisions/{approval_id}",
        method="POST",
        json_body={"choice": "approve", "answer": "yes, Friday"},
    )

    assert reply.status == 200 and reply.body["status"] == "approved", reply.body
    with closing(daemon.brain.read_connection()) as con:
        facts = con.execute(
            "SELECT n.space FROM companion_node n JOIN companion_fact f ON f.id = n.id "
            "WHERE f.fact_key = 'filing day'"
        ).fetchall()
    assert facts == [(a,)]
    added = [s for body, s in _stamps(daemon.brain, CONVERSATION) if "yes, Friday" in body]
    assert added == [a]


def test_a_declined_card_in_a_project_is_recorded_there_and_a_gone_project_is_not_answered(
    live: Live, daemon: AthenaDaemon
) -> None:
    a = _space(daemon, "Taxes")
    b = _space(daemon, "Garden")
    assert live.register().status == 200
    first = _fact_card(live, a, daemon.brain.append_episode("Friday, in A", space=a).id)
    second = _fact_card(live, b, daemon.brain.append_episode("Friday, in B", space=b).id)

    declined = live.request(f"/decisions/{first}", method="POST", json_body={"choice": "decline"})
    assert declined.status == 200
    stamps = [s for body, s in _stamps(daemon.brain, CONVERSATION) if "declined" in body]
    assert stamps == [a]

    assert live.request(f"/spaces/{b}", method="DELETE").status == 200
    gone = live.request(f"/decisions/{second}", method="POST", json_body={"choice": "approve"})
    assert gone.status == 400 and gone.body["reason"] == "unknown_ref"
    assert "gone" in gone.body["detail"]


# -- delegated tasks -----------------------------------------------------------------------------


@pytest.fixture
def tasks(daemon: AthenaDaemon) -> Tasks:
    assert daemon.tasks is not None
    return daemon.tasks


def _ctx(space: str) -> TurnContext:
    return TurnContext(
        conversation_id=CONVERSATION,
        turn_id=ids.mint("turn"),
        lane=Lane.BROWSER,
        app_id=APP_ID,
        page_origin=PAGE_ORIGIN,
        space_id=space,
    )


def _delegated(tasks: Tasks, space: str) -> str:
    result = delegate_executor(tasks)(
        {"title": "Chase", "brief": "Chase the invoices."}, _ctx(space)
    )
    assert result.ok, result.output
    rows, _, _ = tasks.listing()
    return rows[0].id


def test_a_task_works_and_reports_in_the_project_that_delegated_it(
    live: Live, daemon: AthenaDaemon, tasks: Tasks
) -> None:
    a = _space(daemon, "Taxes")
    assert live.register().status == 200
    task_id = _delegated(tasks, a)
    task = tasks.get(task_id)
    assert task is not None and task.space_id == a
    assert "space_id" not in task.view(), "TaskView is unchanged on the wire"
    tasks.claim()
    live.script(claude_round("Chased two."))

    # The window asked for core; the task's turn runs in its project anyway.
    turn = live.run("", task_id=task_id, space_id="")
    assert turn.status == 200
    assert {s for _, s in _stamps(daemon.brain, f"conv_{task_id}")} == {a}

    tasks.finish(task_id, "done", "Chased two invoices.", None)
    harvest = [s for body, s in _stamps(daemon.brain, CONVERSATION) if body.startswith("Task ")]
    assert harvest == [a]

    core_task = _delegated(tasks, "")
    tasks.claim()
    tasks.finish(core_task, "done", "ok", None)
    told: list[Any] = [s for body, s in _stamps(daemon.brain, CONVERSATION) if "ok" in body]
    assert told[-1] == ""


def test_a_task_whose_project_was_erased_is_not_run_into_it(
    live: Live, daemon: AthenaDaemon, tasks: Tasks
) -> None:
    a = _space(daemon, "Taxes")
    assert live.register().status == 200
    task_id = _delegated(tasks, a)
    tasks.claim()
    assert live.request(f"/spaces/{a}", method="DELETE").status == 200

    reply = live.run("", task_id=task_id)

    assert reply.status == 400 and reply.body["reason"] == "unknown_ref"
    assert live.transport.requests == []


def test_the_static_always_block_is_cores_and_a_projects_always_fact_rides_in_its_frame(
    daemon: AthenaDaemon,
) -> None:
    """``memory.always`` (the system prompt a resumed conversation keeps) carries core's always
    tier in every project; a project's own rides in that project's ``frame.space`` only."""
    from athena.lane.turn_frame import SurfaceTurn

    a = _space(daemon, "Taxes")
    b = _space(daemon, "Garden")
    brain = daemon.brain
    core_source = brain.append_episode("core rule source").id
    a_source = brain.append_episode("taxes rule source", space=a).id
    brain.write_fact("core rule", "Answer briefly.", sources=[core_source], every_turn=True)
    brain.write_fact(
        "taxes rule", "Quote the form number.", sources=[a_source], every_turn=True, space=a
    )
    frames = daemon.lane.frames

    for where in ("", a, b):
        composed = frames.build(CONVERSATION, SurfaceTurn(message="hello", space_id=where))
        always = composed.static.block("memory.always")
        assert always is not None and "Answer briefly." in always.text
        assert "Quote the form number." not in composed.static.text
        space_block = composed.frame.block("frame.space")
        if where == a:
            assert space_block is not None and "Quote the form number." in space_block.text
        else:
            assert "Quote the form number." not in composed.frame.text


def test_a_task_table_and_a_card_table_from_before_projects_gain_their_column_as_core(
    tmp_path: Any,
) -> None:
    """The two runtime tables that remember a turn's project are older than it: each gains its
    column on open, and every row written before reads core (``""``)."""
    import re

    from athena.core.approvals import ApprovalError, Approvals
    from athena.daemon.tasks import TASK_SCHEMA

    with Brain(tmp_path / "brain") as brain:
        old = re.sub(r",\s*space_id TEXT NOT NULL DEFAULT ''", "", TASK_SCHEMA[0])
        assert "space_id" not in old
        with brain.write_txn() as con:
            con.execute(old)
            con.execute(
                "INSERT INTO companion_task (id, parent_conversation, conversation_id, title, "
                "brief, status, created_at) VALUES ('task_0123456789ab', 'conv_x', "
                "'conv_task_0123456789ab', 't', 'b', 'queued', '2026-10-01T00:00:00+00:00')"
            )
        tasks = Tasks(brain)
        Tasks(brain)  # a second open adds nothing
        held = tasks.get("task_0123456789ab")
        assert held is not None and held.space_id == ""

        approvals = Approvals(brain)
        card = approvals.create(
            "core.write_fact", {}, origin="core", conversation="conv_x", surface="panel"
        )
        assert card.space_id == ""
        with pytest.raises(ApprovalError, match="not a space id"):
            approvals.create(
                "core.write_fact",
                {},
                origin="core",
                conversation="conv_x",
                surface="panel",
                space_id="proj_0123456789ab",
            )

"""Delegated tasks: admission, claim and finish, a kill, the harvest, a restart (ADR 0141).

The daemon admits and remembers; her window runs. So these drive the table the way both sides do:
``core.delegate`` from a real turn, ``/tasks*`` over a real socket, and a task's own turns through
``POST /run`` with ``task_id``. Every status change is checked on the bus a window follows, and
every end is checked where the delegating thread will read it: one system episode in its own
conversation.
"""

from __future__ import annotations

import threading
from contextlib import closing
from datetime import UTC, datetime, timedelta
from typing import Any

import pytest

from athena.contracts import ids
from athena.contracts.registry import Lane, OpenApp, TurnContext
from athena.core.brain import Brain
from athena.daemon.server import AthenaDaemon
from athena.daemon.tasks import (
    TASKS_QUEUED_CAP,
    TASKS_RUNNING_CAP,
    TaskRefused,
    Tasks,
    delegate_executor,
    task_stop_executor,
    tasks_executor,
)

from .conftest import APP_ID, PAGE_ORIGIN, Live, claude_round, op
from .test_threads import HANG, HangingTransport

PARENT = "conv_invoices"


@pytest.fixture
def transport() -> HangingTransport:  # overrides the directory's scripted engine
    return HangingTransport()


@pytest.fixture
def tasks(daemon: AthenaDaemon) -> Tasks:
    assert daemon.tasks is not None
    return daemon.tasks


@pytest.fixture
def bus(tasks: Tasks) -> list[dict[str, Any]]:
    """What ``task.changed`` carried, in order: the peer bus's ``publish``, recorded."""
    seen: list[dict[str, Any]] = []
    tasks.publish = lambda kind, **fields: seen.append({"kind": kind, **fields})
    return seen


def _ctx(conversation: str = PARENT, **overrides: Any) -> TurnContext:
    return TurnContext(
        conversation_id=conversation,
        turn_id=ids.mint("turn"),
        lane=Lane.BROWSER,
        app_id=APP_ID,
        page_origin=PAGE_ORIGIN,
        **overrides,
    )


def _episodes(brain: Brain, conversation: str) -> list[str]:
    with closing(brain.read_connection()) as con:
        rows = con.execute(
            "SELECT id FROM companion_node WHERE kind = 'episode' AND session_id = ? "
            "ORDER BY created_at, rowid",
            (conversation,),
        ).fetchall()
    return [brain.read_body(str(row[0])) for row in rows]


def _delegate(tasks: Tasks, title: str = "Chase overdue invoices") -> str:
    return tasks.delegate(PARENT, title, "Find every invoice past 30 days and draft a chase.").id


# -- admission -----------------------------------------------------------------------------------


def test_delegate_from_a_turn_queues_a_task_in_the_turns_conversation(
    live: Live, tasks: Tasks, bus: list[dict[str, Any]]
) -> None:
    live.register()
    live.script(
        claude_round(
            "On it.\n"
            + op(
                "core.delegate",
                title="Chase overdue invoices",
                brief="Draft the chases.",
                app_id=APP_ID,
            )
        ),
        claude_round("Started 1 task."),
    )

    reply = live.run("chase every late invoice in the background")

    results = [p for kind, p in reply.frames() if kind == "tool.result"]
    assert len(results) == 1 and results[0]["ok"] is True
    assert results[0]["output"].startswith("queued task_")
    assert results[0]["output"].endswith("(position 1)")
    rows, running, queued = tasks.listing()
    assert (running, queued) == (0, 1)
    task = rows[0]
    assert task.parent_conversation == PARENT
    assert task.conversation_id == f"conv_{task.id}"
    assert (task.app_id, task.origin, task.position) == (APP_ID, PAGE_ORIGIN, 1)
    assert [event["task"]["status"] for event in bus] == ["queued"]


def test_the_queue_holds_ten_and_the_eleventh_is_refused_queue_full(tasks: Tasks) -> None:
    made = [_delegate(tasks, f"job {n}") for n in range(TASKS_QUEUED_CAP)]

    with pytest.raises(TaskRefused) as refused:
        _delegate(tasks, "one too many")
    assert refused.value.word == "queue_full"
    result = delegate_executor(tasks)({"title": "one too many", "brief": "no room"}, _ctx())
    assert not result.ok
    assert result.error == "budget_exhausted"
    assert result.output.startswith("queue_full")

    rows, _, queued = tasks.listing()
    assert queued == TASKS_QUEUED_CAP
    assert {t.id: t.position for t in rows} == {task_id: n + 1 for n, task_id in enumerate(made)}


def test_three_run_and_a_fourth_claim_waits(live: Live, tasks: Tasks) -> None:
    made = [_delegate(tasks, f"job {n}") for n in range(TASKS_RUNNING_CAP + 1)]

    claims = [live.request("/tasks/claim", method="POST", json_body={}) for _ in range(4)]

    assert [c.status for c in claims] == [200] * 4
    assert [c.body["task"]["id"] for c in claims[:3]] == made[:3]
    assert all(c.body["task"]["status"] == "running" for c in claims[:3])
    assert all(c.body["task"]["started_at"] for c in claims[:3])
    assert claims[3].body["task"] is None
    listed = live.request("/tasks").body
    assert (listed["cap"], listed["running"], listed["queued"]) == (3, 3, 1)
    waiting = next(t for t in listed["tasks"] if t["id"] == made[3])
    assert waiting["position"] == 1 and waiting["status"] == "queued"


def test_get_tasks_carries_every_taskview_key_with_nulls_and_newest_first(
    live: Live, tasks: Tasks
) -> None:
    first, second = _delegate(tasks, "first"), _delegate(tasks, "second")

    body = live.request("/tasks").body

    assert [t["id"] for t in body["tasks"]] == [second, first]
    assert set(body) >= {"tasks", "cap", "running", "queued"}
    row = body["tasks"][0]
    assert set(row) == {
        "id",
        "parent_conversation",
        "conversation_id",
        "title",
        "app_id",
        "origin",
        "status",
        "tab_id",
        "position",
        "result",
        "error",
        "created_at",
        "started_at",
        "finished_at",
    }
    assert row["app_id"] is None and row["origin"] is None and row["tab_id"] is None
    assert row["result"] is None and row["error"] is None
    assert row["started_at"] is None and row["finished_at"] is None
    assert row["position"] == 2


def test_an_ended_task_leaves_the_list_after_a_day(daemon: AthenaDaemon, brain: Brain) -> None:
    now = [datetime(2026, 10, 24, 12, tzinfo=UTC)]
    clocked = Tasks(brain, clock=lambda: now[0])
    task_id = _delegate(clocked)
    clocked.stop(task_id)
    assert [t.id for t in clocked.listing()[0]] == [task_id]

    now[0] += timedelta(hours=25)

    assert clocked.listing()[0] == []


# -- the window's side: claim, a task's turns, finish ----------------------------------------------


def test_a_task_turn_runs_in_its_own_conversation_opened_with_its_brief(
    live: Live, tasks: Tasks, transport: HangingTransport, bus: list[dict[str, Any]]
) -> None:
    live.register()
    task_id = tasks.delegate(
        PARENT,
        "Chase overdue invoices",
        "Find every invoice past 30 days and draft a chase.",
        app_id=APP_ID,
        origin=PAGE_ORIGIN,
    ).id
    live.request("/tasks/claim", method="POST", json_body={})
    live.script(claude_round("Drafted three chases."), claude_round("Checked again."))

    first = live.run("", task_id=task_id, tab_id=7)
    second = live.run("continue", task_id=task_id, tab_id=7)

    assert first.status == 200 and first.frames()[-1][0] == "turn.finished"
    assert second.status == 200
    opened = transport.requests[0].stdin
    assert "This conversation is a background task you delegated: Chase overdue" in opened
    assert opened.rstrip().endswith("Find every invoice past 30 days and draft a chase.")
    # Only the first turn opens with the brief; a later one is what the window sent.
    assert transport.requests[1].stdin.rstrip().endswith("\ncontinue")
    assert (
        "This conversation is a background task"
        not in transport.requests[1].stdin.split("Drafted three chases.")[-1]
    )
    rows = daemon_rows(live.daemon, f"conv_{task_id}")
    assert rows == 2, "the task's turns were not ledgered in its own conversation"
    task = tasks.get(task_id)
    assert task is not None and task.tab_id == 7 and task.turns == 2
    assert [e["task"]["status"] for e in bus] == ["queued", "running", "running"]
    assert bus[-1]["task"]["tab_id"] == 7


def daemon_rows(daemon: AthenaDaemon, conversation: str) -> int:
    return sum(1 for row in daemon.ledger.recent(50).rows if row.conversation == conversation)


@pytest.mark.parametrize("state", ["queued", "done"])
def test_a_run_for_a_task_that_is_not_running_is_refused_before_the_stream(
    live: Live, tasks: Tasks, state: str
) -> None:
    live.register()
    task_id = _delegate(tasks)
    if state == "done":
        tasks.claim()
        tasks.finish(task_id, "done", "ok", None)

    reply = live.run("go", task_id=task_id)

    assert reply.status == 409
    assert reply.header("Content-Type") == "application/json"
    assert reply.body["error"] == "task_not_running"
    assert len(live.transport.requests) == 0


def test_a_run_for_an_unknown_or_malformed_task_is_refused(live: Live) -> None:
    live.register()

    unknown = live.run("go", task_id="task_0123456789ab")
    malformed = live.run("go", task_id="nope")

    assert unknown.status == 404 and unknown.body["error"] == "task_unknown"
    assert malformed.status == 400 and malformed.body["reason"] == "unknown_ref"


def test_finish_done_publishes_and_tells_the_parent_thread(
    live: Live, tasks: Tasks, brain: Brain, bus: list[dict[str, Any]]
) -> None:
    task_id = _delegate(tasks)
    tasks.claim()

    reply = live.request(
        f"/tasks/{task_id}/finish",
        method="POST",
        json_body={"status": "done", "result": "Drafted 3 chases.", "error": None},
    )

    assert reply.status == 200
    task = reply.body["task"]
    assert (task["status"], task["result"], task["error"]) == ("done", "Drafted 3 chases.", None)
    assert task["finished_at"] and task["position"] is None
    assert bus[-1]["task"]["status"] == "done"
    assert _episodes(brain, PARENT) == ["Task Chase overdue invoices finished: Drafted 3 chases."]


def test_finish_failed_names_the_error_to_the_parent(
    live: Live, tasks: Tasks, brain: Brain
) -> None:
    task_id = _delegate(tasks)
    tasks.claim()

    reply = live.request(
        f"/tasks/{task_id}/finish",
        method="POST",
        json_body={"status": "failed", "result": None, "error": "the page closed"},
    )

    assert reply.body["task"]["status"] == "failed"
    assert _episodes(brain, PARENT) == ["Task Chase overdue invoices failed: the page closed"]


def test_finish_is_refused_for_a_queued_task_an_unknown_one_and_a_bad_status(
    live: Live, tasks: Tasks
) -> None:
    task_id = _delegate(tasks)

    queued = live.request(f"/tasks/{task_id}/finish", method="POST", json_body={"status": "done"})
    unknown = live.request(
        "/tasks/task_0123456789ab/finish", method="POST", json_body={"status": "done"}
    )
    tasks.claim()
    bad = live.request(f"/tasks/{task_id}/finish", method="POST", json_body={"status": "killed"})

    assert queued.status == 409 and queued.body["error"] == "task_not_running"
    assert unknown.status == 404 and unknown.body["error"] == "task_unknown"
    assert bad.status == 400 and bad.body["error"] == "bad_request"


# -- the kill --------------------------------------------------------------------------------------


def test_stopping_a_queued_task_kills_it_and_tells_the_parent(
    live: Live, tasks: Tasks, brain: Brain, bus: list[dict[str, Any]]
) -> None:
    task_id = _delegate(tasks)

    reply = live.request(f"/tasks/{task_id}/stop", method="POST", json_body={})
    again = live.request(f"/tasks/{task_id}/stop", method="POST", json_body={})

    assert reply.body == {"ok": True, "stopped": True}
    assert again.body == {"ok": True, "stopped": False}
    task = tasks.get(task_id)
    assert task is not None and task.status == "killed" and task.finished_at
    assert task.started_at is None
    assert [e["task"]["status"] for e in bus] == ["queued", "killed"]
    assert _episodes(brain, PARENT) == ["Task Chase overdue invoices was stopped."]


def test_stopping_a_running_task_cancels_its_turn_and_nothing_else(
    live: Live, tasks: Tasks, transport: HangingTransport
) -> None:
    live.register()
    task_id = _delegate(tasks)
    tasks.claim()
    live.script(HANG, HANG)
    task_out: list[Any] = []
    task_turn = threading.Thread(
        target=lambda: task_out.append(live.run("", task_id=task_id)), daemon=True
    )
    task_turn.start()
    assert transport.wait_started(1)
    main_out: list[Any] = []
    main_turn = threading.Thread(target=lambda: main_out.append(live.run("hi")), daemon=True)
    main_turn.start()
    assert transport.wait_started(2)

    # The panel's Stop (no conversation) is about the person's thread, never the task's.
    panel = live.request(
        "/run/stop", method="POST", json_body={"origin": PAGE_ORIGIN, "conversation_id": None}
    )
    main_turn.join(10)
    assert panel.body["stopped"] is True
    assert main_out[0].frames()[-1][1]["reason"] == "cancelled"
    assert task_turn.is_alive(), "the panel's Stop ended the task's turn"

    killed = live.request(f"/tasks/{task_id}/stop", method="POST", json_body={})
    task_turn.join(10)

    assert killed.body["stopped"] is True
    assert task_out[0].frames()[-1][1]["reason"] == "cancelled"
    task = tasks.get(task_id)
    assert task is not None and task.status == "killed"
    # A continuation the window sends anyway is refused: the task is over.
    assert live.run("continue", task_id=task_id).body["error"] == "task_not_running"


# -- a restart -----------------------------------------------------------------------------------


def test_a_restart_interrupts_a_running_task_and_keeps_the_queue(
    tasks: Tasks, brain: Brain
) -> None:
    running, waiting = _delegate(tasks, "running one"), _delegate(tasks, "waiting one")
    tasks.claim()

    reopened = Tasks(brain)  # what the next daemon builds
    published: list[dict[str, Any]] = []
    reopened.publish = lambda kind, **fields: published.append(fields["task"])
    swept = reopened.sweep()

    assert [t.id for t in swept] == [running]
    by_id = {t.id: t for t in reopened.listing()[0]}
    assert by_id[running].status == "interrupted" and by_id[running].finished_at
    assert by_id[waiting].status == "queued" and by_id[waiting].position == 1
    assert [t["status"] for t in published] == ["interrupted"]
    assert _episodes(brain, PARENT) == [
        "Task running one was interrupted: Athena restarted while it ran."
    ]


# -- the core tools --------------------------------------------------------------------------------


def test_a_task_cannot_delegate(tasks: Tasks) -> None:
    task_id = _delegate(tasks)

    result = delegate_executor(tasks)(
        {"title": "deeper", "brief": "again"}, _ctx(ids.conversation_for_task(task_id))
    )

    assert not result.ok
    assert result.error == "validator_failed"
    assert result.output.startswith("nested_delegate")
    assert tasks.listing()[2] == 1


def test_delegate_from_a_task_turn_is_refused_end_to_end(live: Live, tasks: Tasks) -> None:
    live.register()
    task_id = _delegate(tasks)
    tasks.claim()
    live.script(
        claude_round("Splitting.\n" + op("core.delegate", title="sub", brief="part two")),
        claude_round("I will do it myself."),
    )

    reply = live.run("", task_id=task_id)

    results = [p for kind, p in reply.frames() if kind == "tool.result"]
    assert results[0]["ok"] is False and "nested_delegate" in results[0]["output"]
    assert tasks.listing()[2] == 0


def test_delegate_finds_the_app_page_from_the_open_tabs_or_refuses_an_unseen_app(
    tasks: Tasks,
) -> None:
    run = delegate_executor(tasks)
    open_crm = OpenApp("host:crm", "https://crm.example", 4)

    seen = run({"title": "crm job", "brief": "tidy", "app_id": "crm"}, _ctx(open_apps=(open_crm,)))
    unseen = run({"title": "x", "brief": "y", "app_id": "nowhere"}, _ctx())
    bare = run({"title": "no app", "brief": "think", "app_id": None}, _ctx())

    assert seen.ok and unseen.error == "unknown_ref" and bare.ok
    by_title = {t.title: t for t in tasks.listing()[0]}
    assert by_title["crm job"].origin == "https://crm.example"
    assert by_title["no app"].app_id is None and by_title["no app"].origin is None


def test_core_tasks_lists_one_line_each_and_task_stop_kills(tasks: Tasks) -> None:
    empty = tasks_executor(tasks)({}, _ctx())
    first = _delegate(tasks, "first job")
    tasks.claim()
    tasks.finish(first, "done", "Sent 3 chases.\nMore detail.", None)
    second = _delegate(tasks, "second job")

    listed = tasks_executor(tasks)({}, _ctx()).output.splitlines()
    stopped = task_stop_executor(tasks)({"task_id": second}, _ctx())
    ended = task_stop_executor(tasks)({"task_id": first}, _ctx())
    unknown = task_stop_executor(tasks)({"task_id": "task_0123456789ab"}, _ctx())

    assert empty.ok and "No tasks" in empty.output
    assert listed[0] == f"{second} queued #1 - second job"
    assert listed[1].startswith(f"{first} done ") and listed[1].endswith(
        "- first job: Sent 3 chases."
    )
    assert stopped.ok and stopped.output == f"stopped {second}"
    assert not ended.ok and ended.error == "validator_failed"
    assert not unknown.ok and unknown.error == "unknown_ref"


# -- a task with no app needs no page -------------------------------------------------------------


def _static(request: Any) -> str:
    """What one engine call was told about the tools: the system prompt file, or stdin."""
    if request.system_prompt_file:
        with open(request.system_prompt_file, encoding="utf-8") as handle:
            return handle.read()
    return str(request.stdin)


@pytest.mark.parametrize("origin", ["", None, PAGE_ORIGIN])
def test_an_app_less_task_runs_without_a_page_session_and_with_no_pages_tools(
    live: Live, tasks: Tasks, transport: HangingTransport, origin: str | None
) -> None:
    if origin:
        live.register()  # a page is open, and still lends the task nothing
    task_id = tasks.delegate(PARENT, "Plan the week", "Draft a plan from my notes.").id
    tasks.claim()
    live.script(
        claude_round("Paying.\n" + op("host.invoices.pay", invoice="7")),
        claude_round("Here is the plan."),
    )

    body: dict[str, Any] = {"message": "", "task_id": task_id}
    if origin is not None:
        body["origin"] = origin
    reply = live.request("/run", method="POST", json_body=body)

    assert reply.status == 200
    assert reply.frames()[-1][0] == "turn.finished"
    told = _static(transport.requests[0])
    assert "core.delegate" in told and "host.invoices" not in told
    results = [p for kind, p in reply.frames() if kind == "tool.result"]
    assert [r["ok"] for r in results] == [False], "a page's tool ran in an app-less task"
    assert daemon_rows(live.daemon, f"conv_{task_id}") == 1
    task = tasks.get(task_id)
    assert task is not None and task.turns == 1 and task.origin is None and task.tab_id is None


def test_a_task_of_an_app_still_needs_its_pages_session(live: Live, tasks: Tasks) -> None:
    task_id = tasks.delegate(PARENT, "Chase", "Draft chases.", app_id=APP_ID).id
    tasks.claim()

    reply = live.request("/run", method="POST", json_body={"message": "", "task_id": task_id})

    assert reply.status == 403 and reply.body["reason"] == "foreign_origin"

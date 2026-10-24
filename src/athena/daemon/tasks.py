"""Delegated tasks: the durable table, its admission rule and the ``/tasks`` routes (ADR 0141).

Athena hands a job to a background task with ``core.delegate`` when she is asked for work on two
or more apps at once, or for a long job while the person keeps talking. The daemon *admits* the
task; her window *runs* it. That split is the design: a task that drives an app needs a tab, the
tabs are the window's, and the host calls of a turn are executed by the page (ADR 0010). So the
daemon keeps the row, the cap and the queue, and the window claims a queued task, binds a tab to
it and runs the ordinary continuation loop in the task's own conversation, ``conv_task_<hex>``,
with ``task_id`` on every ``POST /run``. A task's turn holds its conversation's lock like any
thread's, so it runs beside the person's own conversation and never inside it.

``GET /tasks``
    ``{"tasks": [TaskView...], "cap": 3, "running": n, "queued": n}``: every active row and every
    row that ended in the last :data:`RECENT_HOURS` hours, newest first, at most
    :data:`LIST_CAP`. ``position`` is the 1-based place in the queue, ``null`` unless queued.

``POST /tasks/claim``
    ``{"task": TaskView | null}``: the oldest queued row, now running, when fewer than
    :data:`TASKS_RUNNING_CAP` run; ``null`` when none is queued or the cap is full.

``POST /tasks/<id>/finish``
    ``{"status": "done" | "failed", "result": str | null, "error": str | null}`` from the window
    that ran it, ``{"task": TaskView}`` back. Only a running row can finish (409
    ``task_not_running``): a task killed while its last turn ran stays killed.

``POST /tasks/<id>/stop``
    ``{"stopped": bool}``. A queued row becomes ``killed``; a running row has its turn stopped
    through the turn door and becomes ``killed``; a row that already ended is not stopped.

**Every status change is published** on the bus as ``task.changed`` ``{task: TaskView}`` (the
loopback ``GET /events`` stream the peer package serves). A daemon with no peer surface has no
bus, and :attr:`Tasks.publish` is then ``None``: the windows read ``GET /tasks`` instead.

**The parent thread is told.** When a task ends - finished, failed, killed, or interrupted by a
restart - one system episode goes into the conversation that delegated it, through the brain's
ordinary writer, so that thread's next turn reads "Task <title> finished: <result>" in its own
history. That is the harvest; nothing else of the task's conversation crosses over.

**A restart interrupts.** A task that was running when the daemon died has no window running it
any more. ``athena serve`` sweeps it to ``interrupted`` before the ready line; a queued row stays
queued and is claimed as usual.

The rows live in ``index.sqlite`` beside the approvals and the case turns, with the same
``CREATE TABLE IF NOT EXISTS`` idiom and absent from ``INDEX_TABLES``, so a reconcile leaves them
alone. Absent values are ``NULL`` in the table and ``null`` on the wire; no key is ever omitted.
"""

from __future__ import annotations

import threading
from collections.abc import Callable, Sequence
from contextlib import closing, suppress
from dataclasses import dataclass, replace
from datetime import UTC, datetime, timedelta
from typing import TYPE_CHECKING, Any

from athena.contracts import ids
from athena.contracts.channel import cut_text, iso
from athena.contracts.registry import ExecResult, ExecutorFn, TurnContext
from athena.core.brain.store import Brain
from athena.daemon.routes import REFUSAL_REASONS, Reply, Request, Route, error, refusal

if TYPE_CHECKING:
    from athena.daemon.server import AthenaDaemon

__all__ = [
    "BRIEF_CAP",
    "LIST_CAP",
    "RECENT_HOURS",
    "TASKS_QUEUED_CAP",
    "TASKS_RUNNING_CAP",
    "TASK_PREFIX",
    "TASK_SCHEMA",
    "TASK_STATUSES",
    "TITLE_CAP",
    "Task",
    "TaskRefused",
    "Tasks",
    "delegate_executor",
    "task_routes",
    "task_stop_executor",
    "tasks_executor",
]

#: How many tasks run at once, and how many may wait. A delegate past the queue is refused
#: ``queue_full``: the person hears "no" now rather than a job that starts tomorrow.
TASKS_RUNNING_CAP = 3
TASKS_QUEUED_CAP = 10

TASK_STATUSES: tuple[str, ...] = ("queued", "running", "done", "failed", "killed", "interrupted")
ACTIVE: tuple[str, ...] = ("queued", "running")

#: The longest title and brief ``core.delegate`` takes (its schema says the same).
TITLE_CAP = 80
BRIEF_CAP = 4000
#: What a finish may store, each cut and announced; a window sends about 600 characters.
RESULT_CAP = 2000
ERROR_CAP = 600
#: How much of a result reaches the parent's episode, and a line of ``core.tasks``.
HARVEST_CAP = 600
LINE_RESULT_CAP = 120
#: How long an ended task stays in ``GET /tasks``, and the most rows one answer carries. Active
#: rows are at most 13, so the cap only ever cuts the oldest ended ones.
RECENT_HOURS = 24
LIST_CAP = 50

TASK_PREFIX = "/tasks/"

#: The table. ``brief`` is what the task's first turn opens with and ``turns`` counts the turns
#: the window has run in it; neither is on the wire.
TASK_SCHEMA: tuple[str, ...] = (
    """CREATE TABLE IF NOT EXISTS companion_task (
        id TEXT PRIMARY KEY,
        parent_conversation TEXT NOT NULL,
        conversation_id TEXT NOT NULL,
        title TEXT NOT NULL,
        brief TEXT NOT NULL,
        app_id TEXT,
        origin TEXT,
        status TEXT NOT NULL,
        tab_id INTEGER,
        result TEXT,
        error TEXT,
        turns INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        started_at TEXT,
        finished_at TEXT
    )""",
    "CREATE INDEX IF NOT EXISTS idx_task_status ON companion_task(status, created_at)",
)

_COLUMNS = (
    "id, parent_conversation, conversation_id, title, brief, app_id, origin, status, tab_id, "
    "result, error, turns, created_at, started_at, finished_at"
)


class TaskRefused(ValueError):
    """A task act the state refuses, with the finer word a surface acts on (``queue_full``,
    ``task_not_running``, ``task_unknown``, ``bad_request``)."""

    def __init__(self, word: str, detail: str) -> None:
        super().__init__(detail)
        self.word = word


@dataclass(frozen=True)
class Task:
    """One delegated task, as the table holds it. ``position`` is computed, never stored."""

    id: str
    parent_conversation: str
    conversation_id: str
    title: str
    brief: str
    app_id: str | None
    origin: str | None
    status: str
    tab_id: int | None
    result: str | None
    error: str | None
    turns: int
    created_at: str
    started_at: str | None
    finished_at: str | None
    position: int | None = None

    @property
    def active(self) -> bool:
        return self.status in ACTIVE

    def view(self) -> dict[str, Any]:
        """``TaskView`` (``apps/desktop/src/lib/tasks.ts``), field for field, every key present."""
        return {
            "id": self.id,
            "parent_conversation": self.parent_conversation,
            "conversation_id": self.conversation_id,
            "title": self.title,
            "app_id": self.app_id,
            "origin": self.origin,
            "status": self.status,
            "tab_id": self.tab_id,
            "position": self.position if self.status == "queued" else None,
            "result": self.result,
            "error": self.error,
            "created_at": self.created_at,
            "started_at": self.started_at,
            "finished_at": self.finished_at,
        }


def _task(raw: Sequence[Any]) -> Task:
    return Task(
        id=str(raw[0]),
        parent_conversation=str(raw[1]),
        conversation_id=str(raw[2]),
        title=str(raw[3]),
        brief=str(raw[4]),
        app_id=None if raw[5] is None else str(raw[5]),
        origin=None if raw[6] is None else str(raw[6]),
        status=str(raw[7]),
        tab_id=None if raw[8] is None else int(raw[8]),
        result=None if raw[9] is None else str(raw[9]),
        error=None if raw[10] is None else str(raw[10]),
        turns=int(raw[11]),
        created_at=str(raw[12]),
        started_at=None if raw[13] is None else str(raw[13]),
        finished_at=None if raw[14] is None else str(raw[14]),
    )


def harvest_line(task: Task) -> str:
    """The one line the parent thread is told when ``task`` ends (ADR 0141)."""
    if task.status == "done":
        if task.result and task.result.strip():
            return f"Task {task.title} finished: {cut_text(task.result.strip(), HARVEST_CAP)}"
        return f"Task {task.title} finished."
    if task.status == "failed":
        return f"Task {task.title} failed: {task.error or 'no reason was given'}"
    if task.status == "killed":
        return f"Task {task.title} was stopped."
    return f"Task {task.title} was interrupted: Athena restarted while it ran."


def opening(task: Task, message: str) -> str:
    """What a task's first turn says: what was delegated, then anything the window added.

    The window runs the task without knowing its brief - ``TaskView`` carries the title only - so
    the daemon opens the conversation with it, once.
    """
    head = (
        f"This conversation is a background task you delegated: {task.title}.\n"
        "Work it through on your own, then end with a short plain report of what you did and "
        "what you found; that report is what the thread that delegated it reads.\n\n"
        f"{task.brief}"
    )
    return f"{head}\n\n{message.strip()}" if message.strip() else head


class Tasks:
    """The task table over one brain's index, and every transition of a row. Thread-safe.

    Construction is idempotent. Every transition reads and writes inside one write transaction
    under :attr:`_lock`, so two windows claiming at once never both take the third slot.
    """

    def __init__(self, brain: Brain, *, clock: Callable[[], datetime] | None = None) -> None:
        self.brain = brain
        self._clock = clock or (lambda: datetime.now(UTC))
        self._lock = threading.Lock()
        #: ``task.changed`` goes here (the peer bus's ``publish``); ``None`` publishes nothing.
        self.publish: Callable[..., None] | None = None
        #: Stops the turn running in a conversation: :meth:`AthenaDaemon.stop_conversation`.
        self.stop_turn: Callable[[str], bool] | None = None
        #: The web origin a page of an app was last seen on (the daemon's sessions), for a task
        #: delegated with an app the current turn's open tabs do not name.
        self.origin_of: Callable[[str], str | None] | None = None
        with brain.write_txn() as con:
            for statement in TASK_SCHEMA:
                con.execute(statement)

    # -- reading -------------------------------------------------------------------------------

    def _now(self) -> str:
        return iso(self._clock())

    def get(self, task_id: str) -> Task | None:
        with closing(self.brain.read_connection()) as con:
            raw = con.execute(
                f"SELECT {_COLUMNS} FROM companion_task WHERE id = ?", (task_id,)
            ).fetchone()
            if raw is None:
                return None
            return self._placed(con, _task(raw))

    @staticmethod
    def _placed(con: Any, task: Task) -> Task:
        """``task`` with its 1-based queue position when it is queued."""
        if task.status != "queued":
            return task
        ahead = con.execute(
            "SELECT COUNT(*) FROM companion_task WHERE status = 'queued' AND "
            "(created_at < ? OR (created_at = ? AND rowid < "
            "(SELECT rowid FROM companion_task WHERE id = ?)))",
            (task.created_at, task.created_at, task.id),
        ).fetchone()
        return replace(task, position=int(ahead[0]) + 1)

    def listing(self) -> tuple[list[Task], int, int]:
        """The rows ``GET /tasks`` shows, newest first, and how many run and wait in all."""
        since = iso(self._clock() - timedelta(hours=RECENT_HOURS))
        with closing(self.brain.read_connection()) as con:
            raws = con.execute(
                f"SELECT {_COLUMNS} FROM companion_task "
                "WHERE status IN ('queued', 'running') OR finished_at >= ? "
                "ORDER BY created_at DESC, rowid DESC LIMIT ?",
                (since, LIST_CAP),
            ).fetchall()
            queue = [
                str(row[0])
                for row in con.execute(
                    "SELECT id FROM companion_task WHERE status = 'queued' "
                    "ORDER BY created_at, rowid"
                ).fetchall()
            ]
            running = int(
                con.execute(
                    "SELECT COUNT(*) FROM companion_task WHERE status = 'running'"
                ).fetchone()[0]
            )
        places = {task_id: index + 1 for index, task_id in enumerate(queue)}
        rows = [_task(raw) for raw in raws]
        return [replace(t, position=places.get(t.id)) for t in rows], running, len(queue)

    # -- the transitions -----------------------------------------------------------------------

    def delegate(
        self,
        parent_conversation: str,
        title: str,
        brief: str,
        *,
        app_id: str | None = None,
        origin: str | None = None,
    ) -> Task:
        """Admit one task as ``queued``, or refuse ``queue_full`` (ADR 0141)."""
        title, brief = title.strip(), brief.strip()
        if not title or not brief:
            raise TaskRefused("bad_request", "a task needs a title and a brief")
        if len(title) > TITLE_CAP or len(brief) > BRIEF_CAP:
            raise TaskRefused(
                "bad_request", f"a title is at most {TITLE_CAP} characters, a brief {BRIEF_CAP}"
            )
        if not ids.is_id("conversation", parent_conversation):
            raise TaskRefused("bad_request", f"not a conversation: {parent_conversation!r}")
        task_id = ids.mint("task")
        with self._lock, self.brain.write_txn() as con:
            waiting = int(
                con.execute(
                    "SELECT COUNT(*) FROM companion_task WHERE status = 'queued'"
                ).fetchone()[0]
            )
            if waiting >= TASKS_QUEUED_CAP:
                raise TaskRefused(
                    "queue_full",
                    f"{waiting} tasks are already waiting; the most is {TASKS_QUEUED_CAP}",
                )
            con.execute(
                "INSERT INTO companion_task (id, parent_conversation, conversation_id, title, "
                "brief, app_id, origin, status, created_at) "
                "VALUES (?, ?, ?, ?, ?, ?, ?, 'queued', ?)",
                (
                    task_id,
                    parent_conversation,
                    ids.conversation_for_task(task_id),
                    title,
                    brief,
                    app_id,
                    origin,
                    self._now(),
                ),
            )
        return self._changed(task_id)

    def claim(self) -> Task | None:
        """Promote the oldest queued row to ``running`` while fewer than the cap run."""
        with self._lock, self.brain.write_txn() as con:
            running = int(
                con.execute(
                    "SELECT COUNT(*) FROM companion_task WHERE status = 'running'"
                ).fetchone()[0]
            )
            if running >= TASKS_RUNNING_CAP:
                return None
            raw = con.execute(
                "SELECT id FROM companion_task WHERE status = 'queued' "
                "ORDER BY created_at, rowid LIMIT 1"
            ).fetchone()
            if raw is None:
                return None
            task_id = str(raw[0])
            con.execute(
                "UPDATE companion_task SET status = 'running', started_at = ? WHERE id = ?",
                (self._now(), task_id),
            )
        return self._changed(task_id)

    def begin_turn(
        self,
        task_id: str,
        message: str,
        *,
        tab_id: int | None = None,
        origin: str | None = None,
        app_id: str | None = None,
    ) -> str:
        """Count one turn of a running task and return the message it runs with.

        The tab the window bound is recorded (``tab_id``), and the page origin when the turn runs
        on a page of the task's own app and the row had none. The first turn opens with the
        brief (:func:`opening`). A row that is not running refuses ``task_not_running``.
        """
        with self._lock, self.brain.write_txn() as con:
            raw = con.execute(
                f"SELECT {_COLUMNS} FROM companion_task WHERE id = ?", (task_id,)
            ).fetchone()
            if raw is None:
                raise TaskRefused("task_unknown", f"no task {task_id}")
            task = _task(raw)
            if task.status != "running":
                raise TaskRefused("task_not_running", f"task {task_id} is {task.status}")
            bound_tab = task.tab_id if tab_id is None else tab_id
            bound_origin = task.origin
            if bound_origin is None and origin and app_id and app_id == task.app_id:
                bound_origin = origin
            con.execute(
                "UPDATE companion_task SET turns = turns + 1, tab_id = ?, origin = ? WHERE id = ?",
                (bound_tab, bound_origin, task_id),
            )
        if (bound_tab, bound_origin) != (task.tab_id, task.origin):
            self._changed(task_id)
        return opening(task, message) if task.turns == 0 else message

    def finish(self, task_id: str, status: str, result: str | None, error_text: str | None) -> Task:
        """The window's report of how a running task ended: ``done`` or ``failed``."""
        if status not in ("done", "failed"):
            raise TaskRefused("bad_request", f"a task finishes done or failed, not {status!r}")
        stored_result = cut_text(result.strip(), RESULT_CAP) if result and result.strip() else None
        stored_error = (
            cut_text(error_text.strip(), ERROR_CAP) if error_text and error_text.strip() else None
        )
        if status == "failed" and stored_error is None:
            stored_error = "the task ended without saying why"
        with self._lock, self.brain.write_txn() as con:
            raw = con.execute(
                "SELECT status FROM companion_task WHERE id = ?", (task_id,)
            ).fetchone()
            if raw is None:
                raise TaskRefused("task_unknown", f"no task {task_id}")
            if raw[0] != "running":
                raise TaskRefused("task_not_running", f"task {task_id} is {raw[0]}, not running")
            con.execute(
                "UPDATE companion_task SET status = ?, result = ?, error = ?, finished_at = ? "
                "WHERE id = ?",
                (status, stored_result, stored_error, self._now(), task_id),
            )
        return self._ended(task_id)

    def stop(self, task_id: str) -> bool:
        """Kill a queued or running task; ``False`` when it had already ended or never was."""
        with self._lock, self.brain.write_txn() as con:
            raw = con.execute(
                "SELECT status, conversation_id FROM companion_task WHERE id = ?", (task_id,)
            ).fetchone()
            if raw is None or raw[0] not in ACTIVE:
                return False
            con.execute(
                "UPDATE companion_task SET status = 'killed', finished_at = ? WHERE id = ?",
                (self._now(), task_id),
            )
        if raw[0] == "running" and self.stop_turn is not None:
            # The row is killed first, so the turn's window reads ``killed`` when its stream ends
            # in ``cancelled`` and does not run a continuation into a task that is over.
            self.stop_turn(str(raw[1]))
        self._ended(task_id)
        return True

    def sweep(self) -> list[Task]:
        """At daemon start: every ``running`` row is ``interrupted``; its parent is told."""
        with self._lock, self.brain.write_txn() as con:
            swept = [
                str(row[0])
                for row in con.execute(
                    "SELECT id FROM companion_task WHERE status = 'running'"
                ).fetchall()
            ]
            con.execute(
                "UPDATE companion_task SET status = 'interrupted', finished_at = ? "
                "WHERE status = 'running'",
                (self._now(),),
            )
        return [self._ended(task_id) for task_id in swept]

    # -- telling ------------------------------------------------------------------------------

    def _changed(self, task_id: str) -> Task:
        """Read the row back and publish ``task.changed``. Publishing never fails a transition."""
        task = self.get(task_id)
        if task is None:  # pragma: no cover - the row was written under the lock a moment ago
            raise TaskRefused("task_unknown", f"no task {task_id}")
        if self.publish is not None:
            with suppress(Exception):
                self.publish("task.changed", task=task.view())
        return task

    def _ended(self, task_id: str) -> Task:
        """Publish the end and tell the parent thread in one system episode (the harvest).

        The row is the truth and is already written: a parent episode the brain refused (an
        unwritable disk) leaves the row ended and the thread untold, never the other way round.
        """
        task = self._changed(task_id)
        with suppress(OSError, ValueError):
            self.brain.append_episode(
                harvest_line(task), "system", session_id=task.parent_conversation
            )
        return task

    def lines(self) -> list[str]:
        """One line per active or recent task, for ``core.tasks``: newest first."""
        rows, _, _ = self.listing()
        now = self._clock()
        return [_line(task, now) for task in rows]


def _ago(stamp: str | None, now: datetime) -> str:
    if not stamp:
        return ""
    try:
        then = datetime.fromisoformat(stamp)
    except ValueError:
        return ""
    minutes = max(0, int((now - then).total_seconds() // 60))
    return "under a minute" if minutes < 1 else f"{minutes} min"


def _line(task: Task, now: datetime) -> str:
    """``task_x running 4 min - Chase overdue invoices (app invoices)``, and the result head."""
    if task.status == "queued":
        state = f"queued #{task.position}" if task.position else "queued"
    elif task.status == "running":
        state = f"running {_ago(task.started_at, now)}".rstrip()
    else:
        state = f"{task.status} {_ago(task.finished_at, now)} ago".replace("  ", " ")
    app = f" (app {task.app_id})" if task.app_id else ""
    tail = ""
    said = task.result if task.status == "done" else task.error
    if said:
        head = said.strip().splitlines()[0] if said.strip() else ""
        tail = f": {head[:LINE_RESULT_CAP]}" if head else ""
    return f"{task.id} {state} - {task.title}{app}{tail}"


# --- the core tools' executors (wiring binds them, ``core/catalog.py`` states them) -------------


def _origin_for(tasks: Tasks, app_id: str, ctx: TurnContext) -> str | None:
    """Where a page of ``app_id`` lives: the turn's own page, an open tab it names, or the page
    the daemon last saw the app on. ``None`` when no page of it has been seen."""
    if ctx.app_id == app_id and ctx.page_origin:
        return ctx.page_origin
    for app in ctx.open_apps:
        if app.origin == f"host:{app_id}":
            return app.page_origin
    return tasks.origin_of(app_id) if tasks.origin_of is not None else None


def _refused(exc: TaskRefused) -> ExecResult:
    return ExecResult.failure(REFUSAL_REASONS.get(exc.word, "unknown"), f"{exc.word}: {exc}")


def delegate_executor(tasks: Tasks) -> ExecutorFn:
    """``core.delegate``: admit a task whose parent is this turn's conversation (ADR 0141)."""

    def run(params: dict[str, Any], ctx: TurnContext) -> ExecResult:
        if ids.is_task_conversation(ctx.conversation_id):
            return ExecResult.failure(
                "validator_failed",
                "nested_delegate: a task cannot delegate; do this part yourself in this task",
            )
        raw_app = params.get("app_id")
        app_id = raw_app.strip().lower() if isinstance(raw_app, str) and raw_app.strip() else None
        origin = None
        if app_id is not None:
            try:
                ids.conversation_for_app(app_id)
            except ValueError:
                return ExecResult.failure("validator_failed", f"not an app id: {raw_app!r}")
            origin = _origin_for(tasks, app_id, ctx)
            if origin is None:
                return ExecResult.failure(
                    "unknown_ref",
                    f"no page of {app_id} has been open here; open it once, or delegate with "
                    "no app",
                )
        try:
            task = tasks.delegate(
                ctx.conversation_id,
                str(params.get("title", "")),
                str(params.get("brief", "")),
                app_id=app_id,
                origin=origin,
            )
        except TaskRefused as exc:
            return _refused(exc)
        return ExecResult(ok=True, output=f"queued {task.id} (position {task.position})")

    return run


def tasks_executor(tasks: Tasks) -> ExecutorFn:
    """``core.tasks``: one line per active or recent task."""

    def run(params: dict[str, Any], ctx: TurnContext) -> ExecResult:
        lines = tasks.lines()
        if not lines:
            return ExecResult(ok=True, output="No tasks are running, waiting or recently ended.")
        return ExecResult(ok=True, output="\n".join(lines))

    return run


def task_stop_executor(tasks: Tasks) -> ExecutorFn:
    """``core.task_stop``: kill one queued or running task."""

    def run(params: dict[str, Any], ctx: TurnContext) -> ExecResult:
        task_id = str(params.get("task_id", "")).strip()
        if not ids.is_id("task", task_id):
            return ExecResult.failure("unknown_ref", f"not a task id: {task_id!r}")
        if tasks.stop(task_id):
            return ExecResult(ok=True, output=f"stopped {task_id}")
        task = tasks.get(task_id)
        if task is None:
            return ExecResult.failure("unknown_ref", f"no task {task_id}")
        return ExecResult.failure("validator_failed", f"{task_id} already ended ({task.status})")

    return run


# --- the routes --------------------------------------------------------------------------------


def list_tasks(tasks: Tasks) -> Reply:
    rows, running, queued = tasks.listing()
    return 200, {
        "ok": True,
        "tasks": [task.view() for task in rows],
        "cap": TASKS_RUNNING_CAP,
        "running": running,
        "queued": queued,
    }


def claim_task(tasks: Tasks) -> Reply:
    task = tasks.claim()
    return 200, {"ok": True, "task": None if task is None else task.view()}


def task_act(tasks: Tasks, request: Request, tail: str) -> Reply:
    """``POST /tasks/<id>/finish`` and ``POST /tasks/<id>/stop``."""
    task_id, _, act = tail.partition("/")
    if not ids.is_id("task", task_id):
        return error(404, "unknown_ref", f"not a task id: {task_id!r}")
    if act == "stop":
        if tasks.get(task_id) is None:
            return refusal(404, "task_unknown", f"no task {task_id}")
        return 200, {"ok": True, "stopped": tasks.stop(task_id)}
    if act != "finish":
        return error(404, "unknown", f"no act {act!r}; one of finish, stop")
    body = request.body

    def text(key: str) -> str | None:
        value = body.get(key)
        return value if isinstance(value, str) else None

    try:
        task = tasks.finish(task_id, str(body.get("status", "")), text("result"), text("error"))
    except TaskRefused as exc:
        status = {"task_unknown": 404, "bad_request": 400}.get(exc.word, 409)
        return refusal(status, exc.word, str(exc))
    return 200, {"ok": True, "task": task.view()}


def task_routes(daemon: AthenaDaemon, tasks: Tasks) -> list[Route]:
    """The three routes, exact before prefix, for :meth:`RouteTable.add`."""
    return [
        Route("GET", "/tasks", lambda request: list_tasks(tasks)),
        Route("POST", "/tasks/claim", lambda request: claim_task(tasks)),
        Route(
            "POST",
            TASK_PREFIX,
            lambda request: task_act(tasks, request, request.path[len(TASK_PREFIX) :]),
            prefix=True,
        ),
    ]

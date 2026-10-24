# 0141. A turn locks its thread, and Athena delegates

Date: 2026-10-24 (spark fleet-surfaces, WP4)

Supersedes the "one turn at a time" clause of
[0011](0011-the-daemon-is-threaded-closes-every-connection-and-checks-the-token-everywhere.md) for
*different* conversations; within one conversation it still holds. Amends
[0115](0115-a-running-turn-can-be-stopped-and-the-turn-wall-is-the-turns.md): the stop route names a
conversation. Leaves the gate, the approval table and every policy rule as they are.

## Context
The daemon's one writer lock was held by a turn for its whole length (`turn_events` took
`daemon.writing()`). So Athena worked one turn at a time across every app and project: a second
conversation waited behind the first, a card answered in another thread waited up to the 25-minute
wall, and a second `POST /run` got its 200 and its SSE headers and then sat blocked inside the
stream, with the client unable to tell a slow turn from a queued one. The operator wants her to
work on several things at once - two threads side by side, and background jobs she hands off while
the person keeps talking - and her window's composer never to close.

Two things already pointed the way. The brain has its own writer lock (ADR 0003), so nothing a turn
writes needs the daemon's lock to be safe. And the state a turn keeps is per conversation already:
the CLI harness keys its resumed sessions and prompt files by conversation, and the frame builder
keys what it last showed by conversation.

## Decision

### A lock per conversation
- `AthenaDaemon.threads` is a map of locks keyed by conversation id. A turn holds its
  conversation's lock for its length and nothing else. An entry counts its holders and waiters and
  is dropped when the last one leaves, so the map holds only conversations in use.
- `POST /run` takes the lock *before it answers*, without waiting. A conversation whose turn is
  running is refused `409 {"ok": false, "reason": "validator_failed", "error": "thread_busy"}` in
  the one JSON shape, before any SSE header. The stream that follows gives the lock back however it
  ends; `EventStream.release` gives it back when the stream never started (a generator closed before
  its first frame never runs its `finally`).
- The voice gateway drives the same `turn_events` without a lease and *waits* for the lock, so a
  spoken turn queues behind a typed one in the same conversation, as before.
- `daemon.writing()` stays, as the **short** write lock: a manifest merge, an answer to a card, a
  connector act and the OAuth admission take it for the milliseconds the write takes, never for a
  turn. We chose this over taking the card's conversation lock because the conversation lock is
  turn-length: an answer to a card in the very thread whose turn is running would wait up to the
  wall again, which is the delay this decision removes. What an answer writes (the approval row, an
  episode, a ledger row) goes through the brain's own writer, and a merge replaces an origin's tools
  in one assignment, so neither needs to exclude a running turn. `GET /health` and every read route
  take no lock at all, as before.
- Refusal words beside `reason`, in the `error` key a window reads as `ApiError.word`:
  `thread_busy`, `task_not_running` (`validator_failed`), `task_unknown` (`unknown_ref`),
  `queue_full` (`budget_exhausted`), `nested_delegate` (`validator_failed`).

### Doors per conversation, and a stop that names one
The turn doors (ADR 0115) are a map keyed by conversation. `POST /run/stop {origin,
conversation_id}` stops the turn in that conversation when `origin` runs it. With
`conversation_id: null` it stops every turn `origin` runs **except a delegated task's**: the panel's
Stop is about the thread the person is looking at, and a task on the same app is stopped by its own
id. An app-less task's door carries the origin its `/run` named, or none; one that named none is
stopped through `POST /tasks/<id>/stop` only.

### Delegated tasks
- **Only Athena delegates**, with `core.delegate {title <= 80, brief <= 4000, app_id | null}`
  (`AUTO`: it only queues, and every task can be seen and killed from either window). Its parent is
  the turn's conversation. `core.tasks` (`READ`) lists one line per task; `core.task_stop`
  (`AUTO`) kills one. A task's own conversation cannot delegate (`nested_delegate`): no task starts a
  task in v1. An `app_id` must be one whose page this daemon has seen (the turn's page, an open tab
  it names, or a session), so the window has an origin to open a tab on.
- **The daemon admits; her window runs.** A durable table `companion_task` in `index.sqlite`
  (beside the approvals, outside `INDEX_TABLES`) holds `TaskView` field for field. Ids are minted
  `task_` + 12 hex; a task talks in `conv_task_<hex>`, the same hex. At most
  `TASKS_RUNNING_CAP = 3` run and `TASKS_QUEUED_CAP = 10` wait; the eleventh delegate is refused
  `queue_full`. Her window claims the oldest queued task (`POST /tasks/claim`, which promotes it to
  running only below the cap), binds a tab of its app, and runs the ordinary continuation loop with
  `task_id` on every `POST /run`. The daemon runs those turns in the task's conversation, refuses
  them `task_not_running` unless the row is running, opens the first with the title and brief, and
  records the tab the window bound. The window reports the end with `POST /tasks/<id>/finish`.
  The window is the executor because host calls are executed by the page (ADR 0010) and the tabs
  are the window's. A task of an app runs on the page session of the tab the window bound, like
  any turn. A task with no app needs no page session at all: its `/run` may carry an empty or
  absent `origin`, every host origin is switched off for its turn (out of the prompt, refused at
  the gate), and it has Athena's own and the connectors' tools only; the window still drives it.
- **A task's tab (amends ADR 0026).** The window binds an open tab of the task's app that is neither
  the focused tab (the person is looking at it, and the main thread works there) nor another task's.
  When there is none it opens one with `tabs_open_background`, behind the person's page and never
  focused, and waits for the page to register its tools before the task's first turn. This is the
  one tab command her window holds: ADR 0026 gave her none, so that she never opens, closes or
  selects anything in Main; she still cannot close, focus or navigate a tab.
- **Kill.** `POST /tasks/<id>/stop` makes a queued row killed, and a running row killed with its
  turn stopped through its door. A killed task's next continuation is refused, and its finish is
  refused, so a kill is final.
- **Every status change publishes** `task.changed {task: TaskView}` on the peer package's event
  bus, the stream behind `GET /events`. A daemon without the peer surface has no bus; the windows
  then read `GET /tasks`.
- **Harvest.** When a task ends, one system episode goes into the parent conversation through the
  brain's ordinary writer: "Task <title> finished: <result>" (the result cut to 600 characters and
  announced), "Task <title> failed: <error>", "Task <title> was stopped.", or "Task <title> was
  interrupted: Athena restarted while it ran." The parent's next turn reads it in its recent
  episodes. Nothing else of the task's conversation crosses over.
- **Restart sweep.** `athena serve` marks every running row `interrupted` before the ready line, and
  tells its parent. Queued rows stay queued. The sweep is in `serve`, not in `build_local`, because a
  second Athena built in the same process (the showcase) must not interrupt the first one's tasks.
- `GET /tasks` answers `{tasks, cap, running, queued}`: active rows and rows that ended in the last
  24 hours, newest first, at most 50; `position` is the 1-based place in the queue while queued.

## Consequences
- Two conversations run side by side and a card is answered while another thread's turn runs
  (`tests/daemon/test_threads.py`, real socket). A second turn into a busy thread is a 409 the
  window can queue on, never a stream that hangs.
- Shared state in the harness is now visible. `RoundHarness._deadline` (the turn wall of ADR 0115)
  is one field on a harness every turn shares; with two turns at once the later start sets the wall
  for both, so a turn can run past its own wall by up to the other's head start. It only ever
  lengthens a wall. Moving it to per-turn state is a follow-up in the harness.
- Each running conversation can hold one engine process: up to three tasks plus the person's own
  threads run CLI children at once. The cap of 3 is the only cost control in v1.
- A task needs her window alive to make progress; a queued task waits for it, and a running one
  whose window died stays running until the window comes back and finishes it, or a restart
  interrupts it.
- The `writing()` lock no longer orders a connector's OAuth admission against a running turn: a
  re-merge can land mid-turn. The catalog replaces an origin in one assignment and the gate checks
  every call against the catalog as it is then, so a disconnect still refuses the next call.

# 0115. A running turn can be stopped, and the turn wall is the turn's

Date: 2026-10-15

Amends [0011](0011-the-daemon-is-threaded-closes-every-connection-and-checks-the-token-everywhere.md) by adding a route that takes no lock and
ends the turn that holds it. Leaves [0038](0038-an-approval-is-spent-when-the-gate-lets-it-through.md) and every gate rule as they
are: a stop never touches the approval table. Leaves [0109](0109-a-cli-round-ends-in-a-typed-exit-and-a-gone-thread-is-reseeded-once.md)
as it is: the exit handle is read the same way, and a round cut by the wall is never classified.

## Context

Once a turn started, nobody could end it. The panel showed her working and offered no Stop. The
daemon had no route that ends a turn, and its one writer lock is held for the whole turn, so
approvals (`POST /decisions/<id>`) and new tabs (`POST /manifest`) waited behind it.

`TURN_TIMEOUT_S` was documented as a 25-minute wall for the turn. In code it was passed unchanged
into every `CliRequest` and bounded one `readline`. A CLI that wrote a line every few minutes was
never stopped, and eight rounds could each wait 25 minutes. A hung engine held the lock until it
had been silent for 25 minutes.

A client that hung up was noticed only at the next frame write. A hang-up also wrote no ledger row
when the turn ran through the lane: closing the lane's generator left the harness generator it was
iterating to the loop's finaliser, which never ran because the loop closed first.

## Decision

1. **The wall is the turn's.** `RoundHarness` keeps `started + timeout_s` as the turn's deadline
   and runs each `_round` under `asyncio.timeout(remaining)`. Expiry ends the turn as `timeout`
   through the ordinary failure path, with one row. `CliHarness` sends what is left of the wall as
   `CliRequest.timeout_s` (now a float), so a later round is never offered the whole 25 minutes
   again. A `TimeoutError` the engine raised on its own stays a raise like any other.
2. **`POST /run/stop {origin}`.** It is token-checked like every route and takes no writer lock.
   `drain` runs each step of a turn as a task on the turn's private loop and binds it to a
   `TurnDoor` the daemon holds for the turn's length. The route cancels that task with
   `call_soon_threadsafe`, but only when the origin is the running turn's: it answers
   `{"stopped": true}` then, and `{"stopped": false}` otherwise. The cancellation reaches the
   transport (whose `finally` kills and reaps the child), the harness writes the one `cancelled`
   row, and the stream ends in `turn.error` with reason `cancelled`. A stop that lands between two
   steps cancels the next step once it is inside the turn, so the row is never skipped.
3. **A hang-up's row is written.** `drain` finishes the loop's async generators before it closes
   the loop, so a hang-up mid-turn writes its `cancelled` row through the lane too. A stop and a
   hang-up on one turn write one row, not two.
4. **The panel's Stop.** `useRun().stop()` aborts the request in flight and asks the route to end its turn, ends the
   exchange's continuation loop and records a "stopped" line. A page result she has not read is
   kept. A host call the page already ran, or is running when Stop is pressed, goes as a
   `tool_results` row with the person's next message, so it is told to the model and ledgered. A
   call she proposed and the page never ran is told as `cancelled`. No continuation starts on its
   own. The companion shows Stop wherever it shows her working: the tape and Talk.
5. **Usage on a cut turn is a floor.** A row closed as `cancelled` or by the wall says
   `cost_estimated`, because the cut round never reported its usage.

## Consequences

- One press gives the person back an agent that is going the wrong way or has hung. There is no
  restart and no 25-minute wait for the lock. Approvals and new tabs wait behind a stalled engine
  for at most the wall.
- The documented 25-minute wall is now true of the turn. A round's `CliRequest.timeout_s` is a
  float and shrinks as the turn goes on.
- A turn never stopped streams the same frames and writes the same row as before
  (`tests/daemon/test_run.py` unchanged).
- A stop names an origin, and only that origin's turn ends. Voice turns go through the same
  `turn_events`, so the same route stops a spoken turn on that origin. Voice has no Stop control
  yet.
- Results a stopped request already carried to the daemon were recorded when that request
  started. The panel does not send them again.

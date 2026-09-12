# 0010. The browser lane holds no gated executor; the page executes on approval

Date: 2026-09-12

## Context

The first build had four lanes — realtime, async, a decision router and a queue — and the browser
arrived last, on top of the realtime one. Realtime's rule was that it never holds a gated executor:
it may read, it may fire `AUTO` tools, and anything `GATED` becomes a durable approval that some
other lane runs later. The browser could not obey that rule as written, because a page's tool has
no executor anywhere in the Python process at all — the page runs it — so the browser lane took
"one liberty" with realtime and the exception was written down in a findings file rather than in
the design.

An exception recorded in a findings file is a rule that will be broken again. It is also the exact
shape of a safety regression that nothing catches: a later commit that gives host tools a Python
executor "just for the hands" or "just for connectors" would be a lane that can act on a page
without a card, and every test would still pass, because the property was never stated anywhere a
test could read.

README §3.5 makes the browser lane the only lane in this build, which removes the inheritance but
not the question. The question is: during a turn, what may the lane itself run?

There are three candidate answers. The lane could hold executors for host tools and call them
after a decision resolves inside the same turn — that is the shape a chat agent has, and it means
a turn can block for as long as a human takes to answer. It could hold them and run them
optimistically for anything the manifest called reversible — which moves the class decision out of
the catalog. Or it could hold none, ever.

## Decision

**The lane holds no executor for a host tool, and runs nothing gated during a turn.**

- `ToolEntry.__post_init__` refuses to construct a host entry with an executor, so the property is
  enforced at the type's own boundary and not by convention. `athena.lane.held_host_executors` and
  `assert_no_host_executor` re-check it on the set the lane is handed each turn, and `BrowserLane.
  tools()` calls the assertion. The check is redundant today on purpose: it is the line a later
  commit that relaxes the contract will trip over.
- A call the gate **allows** for a host tool leaves the turn as a `tool.call` event. The surface
  runs it on the page and returns the answer on the next request, where it lands in the turn frame
  inside a nonce fence (README §3.2 step 5). The lane never waits for it and the turn does not
  block on the page.
- A call the gate **gates** becomes `decision.requested` and the turn ends without it. This holds
  for a gated *core* tool as well: `core.write_fact` has an executor, and that executor exists for
  the replay in README §3.2 step 6 and not for the turn. Nothing inside `run()` can reach it,
  because the only path to an executor is `GateHook.run_tool`, and `GATED` returns `Cancel` there
  before `_execute` is reached.
- The single place an executor runs from the lane is `answer_decision`, after the user has
  answered, and it goes through the gate again with the approval id — so `describe` proves the
  grant covers this action and these parameters before anything happens. A host tool at that point
  returns an `Execute` instruction built from the **row's** parameters rather than the caller's,
  and the surface performs it.
- Structural policy runs on that replay too (ADR-less, `athena.harness.policy`), so a card
  approved while a connector was live does not execute after the user disconnects it.

## Consequences

A turn is never longer than the model plus the tools that ran inside it. The user's answer arrives
on its own HTTP request, so a decision card can sit for a day — the approval table gives it 24
hours — without a socket, a thread or a CLI session held open waiting for it. That is also what
lets a card filed by a turn the panel was not driving be answered from the approvals inbox, which
is milestone 6's headless test.

The cost is that a turn cannot see the result of the action it proposed. The model proposes,
the turn ends, and the answer reaches it in the next turn's frame as a fenced tool result. For a
gated action this is unavoidable — a human is in the middle of it — and for an allowed host tool it
is the price of the page being the executor. The model is told this in the capability block, so it
is a rule it is taught rather than a silence it has to infer.

The second cost is that the surface can lie about a result, since the lane never saw the page. It
is treated accordingly: tool results are untrusted, capped at 1,600 characters by
`athena.lane.turn_frame.RESULT_CAP`, and composed into the frame inside the untrusted fence. The
alternative — believing the page — was never available, because even an executor inside the lane
would only be repeating what the page said.

Finally, `Execute` is a return value and not an event the lane emits into a stream, because the
request that answers a card is not the request that streams a turn. The daemon's
`POST /decisions/<id>` hands it to the surface as its response body (README §3.2 step 6), and
`Resolution.events` carries the `decision.resolved` and `tool.call` events for whatever stream the
surface also renders.

# 0012. One turn is one SSE stream of channel events, and a card is one frame

Date: 2026-09-12

## Status

Accepted. Implements README §3.2 and §3.5; builds on ADR 0010 (the browser lane holds no gated
executor) and ADR 0011 (the daemon is threaded and closes every connection).

## Context

`POST /run` has to deliver a turn to a surface that is not in this process. A turn is not one
answer: it is a stream of text, tool calls the page must run, a decision card the user must
answer, a cost summary and an ending. Two of those are useless late. A decision card that arrives
after the turn has finished is a card the user is shown about a page that has already moved on,
and a `tool.call` the page only learns about at the end is a round trip nobody saved.

The original product solved this by translating the lane's events into AG-UI's own wire events —
`TEXT_MESSAGE_CONTENT`, `TOOL_CALL_START` / `_ARGS` / `_END`, `STATE_SNAPSHOT`, `RUN_ERROR` — and
by rendering a gated call as a *frontend tool call* named `athena_decision`, which CopilotKit
turns into a generative-UI card. That translation was a second vocabulary: `contracts/channel.py`
already defines what a turn emits, and the adapter defined what a surface reads, and the two had
to be kept in step by a test that derived one from the other.

This build has one lane, one contract for its events, and three surfaces to come (the panel, the
voice gateway, the MCP server). The question is what goes on the wire between them.

## Decision

**One channel event is one Server-Sent Event frame.** `event:` carries the event's own `kind` —
`text.delta`, `tool.call`, `tool.result`, `decision.requested`, `turn.summary`, `turn.finished`,
`turn.error` — and `data:` carries the whole event as one line of JSON, which is exactly
`ChannelEvent.to_dict()`. There is no second encoder and no mapping table. A surface that can
already render a channel event can render the stream, and a surface that subscribes by event name
gets the AG-UI shape of named events without the AG-UI names.

**A decision card is one frame, not two.** `decision.requested` carries an extra key, `tool`, whose
value is `athena_decision`. That is the frontend-tool convention a panel renders as a card, kept
as a *name on the event* rather than as a second frame that re-states the card's contents. A card
described twice is a card that can be described differently twice.

**Frames are written as they are produced.** The route returns an `EventStream` — a lazy iterator
— and the handler flushes each frame to the socket. There is no `Content-Length`; the closed
connection is the end of the body, which is the second reason every response in this daemon says
`Connection: close` (ADR 0011).

**Everything refusable is refused before the stream opens.** An origin that has sent no manifest,
a project id that is not one: these come back as an ordinary JSON body with a status, because a
caller must never have to read a `200` to discover the turn never started. Once the headers are
out, the only ending is `turn.finished` or `turn.error`, which the harness already guarantees.

**The writer lock is held inside the stream.** The route returns before the first frame exists, so
the lock cannot be taken around the route. It is taken by the generator and released by its
`finally`, and the handler *closes* the generator when a client hangs up — so a browser tab shut
mid-turn returns the lock rather than holding it until the process dies.

## Consequences

- A turn is legible with `curl -N` and nothing else. `docs/daemon.md` carries the exact sequence.
- The panel renders decision cards off `athena_decision` as it would from any AG-UI provider, and
  the voice gateway and MCP server read the same frames by `kind`. Neither needs an adapter.
- The stream cannot be replayed from a length-prefixed body, so a surface that wants a transcript
  reads the episodes back instead — which is the record, and is what the read routes serve.
- A client that hangs up mid-turn ends that turn's HTTP response but not the turn: the lane is
  already inside the writer lock and runs to its end, writing its episodes and its ledger row.
  That is deliberate. A turn abandoned halfway would leave the record saying something happened
  that has no ending.
- If a later surface genuinely needs AG-UI's own event names, it is one translation in that
  surface and not a second vocabulary in the daemon.

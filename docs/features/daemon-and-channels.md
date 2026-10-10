# The daemon, the browser lane and the voice channel

`src/athena/daemon/`, `src/athena/lane/`, `src/athena/channels/`. Full route reference and a gated
turn end to end with `curl`: [`docs/daemon.md`](../daemon.md).

## The daemon

A threaded HTTP server (`ThreadingHTTPServer`, `Connection: close`, ADR 0011) with a token checked
on every route, `/health` included, and CORS with preflight. It was written after its starvation
test: a long `/run` never stalls a read.

| Route | What it does |
|---|---|
| `POST /manifest` | merges one page's capability manifest, whole or not at all |
| `POST /run` | one turn, streamed as Server-Sent Events (ADR 0012); may carry `active_project` and switched-off origins |
| `POST /decisions/<id>` / `GET /decisions` | the person's answer (the gate replays and returns `execute`; the body carries the switched-off origins, so the replay re-checks the switch; a card refused at its replay can be approved again or declined, ADR 0060) / the pending inbox |
| `GET /ledger`, `/ledger/rollup` | model invocations and spend, bounded |
| `GET /engines`, `/health` | what can run here; engine, brain, sessions, tool count, inbox |
| `/voice`, `/voice/config`, `/voice/preview`, `/voice/transcribe`, `/voice/install` | the voice socket and studio |
| `/connectors/...` | connector specs, connect, consent flow, probe, settings, disconnect |

`athena serve` starts it, `athena doctor` checks six stages, and `wiring.build_local` is the one
composition root that binds the ports.

## The browser lane

`lane/browser_lane.py` runs one turn and streams it (ADR 0010). It never holds a gated executor:
a gated call becomes `decision.requested`, and `answer_decision` replays the gate and returns
`execute` with the row's own parameters. `lane/turn_frame.py` builds the frame from the surface's
request and caps each host tool result at 1,600 characters with `(showing N of M)`.

## The voice channel

`channels/voice/`: RFC 6455 WebSocket in the stdlib on the daemon's port (ADR 0019). PCM16 at
16 kHz in, events and audio out. One `Speaker` and one `Listener` are composed separately: local
Kokoro and whisper.cpp by default (ADR 0028), a cloud provider for hearing when the person picks it.
Spoken commands that answer a card are parsed by `commands.py`, never by a backend. Push-to-talk is
a held key (ADR 0020).

Every `start` and `text` frame carries `disabled_origins`, as `POST /run` does: a spoken turn honours the
switch, and a spoken answer is replayed against the list current when the person spoke. The daemon keeps
none of it.

## Not done

The MCP channel (other agents queueing at the same gate) is designed in the README and not built;
the Gauntlet's MCP attack surface is deferred for that reason.

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
Kokoro speaks with the `halo` tone by default, laid over each sentence after her face is worked out
(ADR 0138; `tts.tone`, the optional `voice-fx` extra, natural with a plain note when it is missing).
Spoken commands that answer a card are parsed by `commands.py`, never by a backend. Push-to-talk is
a held key (ADR 0020); the microphone stops when the key comes up, the window loses focus or
becomes hidden, the socket closes or a `turn.error` arrives, and a press whose key is already up
opens none. One utterance is at most 4 MiB of PCM, two minutes: past it the utterance is
dropped with one `turn.error` `validator_failed` and the socket stays open (ADR 0072). The socket closes 1000 on a normal end, 1002 on a framing error, 1009 on an oversize
frame and 1011 (logged) when handling a frame raised; a `tool_result` whose `tier` or `ms` is not a
non-negative integer is refused with `validator_failed` and the socket stays open. A bare "yes" or
"no" answers only the newest card this socket presented; an inbox card it never showed is answered
only by its own option id or label, and only when exactly one fits (ADR 0073). A message is at most 1,024 data frames as well as 1 MiB; past either it closes 1009. An archive member with a `:` in any part of its name is refused, and each writer checks that its destination resolves inside the engine home before it writes. The panel treats an event it cannot read, an unknown `kind` included, as a close with a reason naming it, and closes the socket; it never skips the frame. A socket has at most four turns waiting behind the one running; a `text` frame or a `stop` past that gets one `turn.error` `validator_failed`, nothing is queued or transcribed, and the socket stays open (ADR 0074). A control frame json cannot decode, nested too deep included, is refused with the same `parse_error` and the socket stays open; the frame label in the 1011 log line never raises, and the close code is set before the line is built. When the socket closes, the turns still waiting are dropped and the worker skips any it had already taken; no continuation step begins after the close, while a turn already inside `turn_events` runs to its end (ADR 0012). A `tool_result` is kept only for a call this socket sent the page and is still waiting on; an answer to any other id, or one that arrives after the wait gave up, is dropped (a debug line, never its output). On Windows a sentence reaches Kokoro's narrow command line only after every character the ANSI code page cannot carry exactly is folded (NFKC, then NFKD without its marks) or made one space, so a fullwidth quote or backslash cannot end the quoted argument (ADR 0069, second amendment). One daemon admits at most two voice sockets at once (`MAX_SESSIONS`); a session counts until its reader has returned and its worker has finished the turn it was running, and a third socket gets one `turn.error` `validator_failed` naming the limit and is closed 1013 with no thread started (ADR 0074, amended). Every archive and whisper model the installer fetches has a pinned SHA-256 beside its URL, the models at a Hugging Face commit and never `main`; the bytes are hashed as they arrive, and a mismatch deletes the download and fails the run before anything is extracted or moved into the engine home, while a URL with no pin is never fetched (ADR 0078). Each download also has its exact size pinned: a `Content-Length` that differs fails before a byte is written, a body past its pin stops within one chunk, and all the downloads of one run share a 45-minute limit (ADR 0078, amended). The OpenAI backend reads a transcription reply up to 1 MiB and a spoken reply up to 180 seconds of PCM, and past either it raises a `VoiceBackendError` (ADR 0019, amended). A synthesis that raises ends only its own line with `voice.stopped` `error` and a logged traceback that names the generation and never the text, so the speaker goes on with the next line; a turn that raises is logged under a fixed message with no text, and the client still gets `turn.error` `unknown` with the exception's type name (ADR 0019, amended). A provider reply cut short (`http.client.HTTPException`, `IncompleteRead` among them) is a `VoiceBackendError` in transcription and synthesis alike, and transcription runs on the worker, so the reader keeps hearing a barge-in, a ping and a `tool_result` while an utterance is transcribed (ADR 0019, amended). Every request sent to a metered speech provider is one ledger row (engine `openai`, its stt or tts model, surface and trigger `voice`, the turn's conversation and origin, `cost_usd` null), failures included as `engine_error` and a line cut off by barge-in billed up to its close without being an error; a local engine, the scripted backend and an utterance too short to send write none, and a row the ledger refuses twice is logged in a fixed line and never ends the line or the session (ADR 0083).

Every `start` and `text` frame carries `disabled_origins`, as `POST /run` does: a spoken turn honours the
switch, and a spoken answer is replayed against the list current when the person spoke. The daemon keeps
none of it.

## Not done

The MCP channel (other agents queueing at the same gate) is designed in the README and not built;
the Gauntlet's MCP attack surface is deferred for that reason.

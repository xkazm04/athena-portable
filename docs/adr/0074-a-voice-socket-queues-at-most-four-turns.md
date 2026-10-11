# 0074. A voice socket queues at most four turns

Date: 2026-10-11

Implements README section 3.1 (voice) and ADR 0019. Closes the full-council round 1 finding
economics-2 of voice-conversation.

## Context

`VoiceSession._jobs` was an unbounded `queue.Queue`. The reader puts one job for every `text`
frame and every `stop`, and the worker runs them one at a time, each a metered lane turn. A client
that sends frames faster than the lane answers grows the queue and the bill without limit, and the
socket has no read timeout.

## Decision

`MAX_PENDING_TURNS` = 4 in `channels/voice/gateway.py`: at most four turns wait behind the one the
worker is running, which does not count.

- The cap is enforced only at the two client-driven enqueue sites, a `text` frame and a `stop`.
  The queue itself stays unbounded, so the closing sentinel always fits.
- A `text` frame while four wait is refused before anything else: no interrupt, nothing queued.
  A `stop` while four wait is refused before `transcriber.finish()`, so nothing is transcribed or
  billed, and the utterance is dropped.
- The client gets one `turn.error` with reason `validator_failed` and the detail "4 turns are
  already waiting; this one was not queued". `ERROR_REASONS` is unchanged. The socket stays open.
- Only the reader enqueues and only the worker dequeues, so a count below the cap at the check is
  still below it at the `put`.

## Consequences

- A client sees at most five turns in flight (one running, four waiting); the fifth waiting one
  is refused and says so.
- A person who speaks while four earlier turns are still waiting must say it again once they drain.
- The cap is a constant, not a setting; four is above what push-to-talk or typing produces by hand.

## Amended 2026-10-11

Council full round 2, economics-1. The cap above counts one socket's queue, and nothing counted
sockets. `VoiceGateway.__call__` built a session for every upgraded socket, `DaemonServer` is a
`ThreadingHTTPServer` with no connection cap, and `serve` joins its worker for only one second, so
a closed socket's running turn carried on (parked, perhaps, on the writer lock) after the socket
was gone. `_stop` transcribes on each reader thread, so K sockets were K transcriptions at once.
Part 1 of this rework stopped a closed socket's waiting turns from starting; this amendment bounds
the width across sockets. `server.py` is not changed: the bound lives in the gateway, one per
daemon.

**Decision.** `MAX_SESSIONS` = 2 in `channels/voice/gateway.py`.

- The gateway admits at most two sessions at once. Two because the panel holds one socket and, for
  a moment while it reconnects (a reload, a closed and reopened window), a second; one would refuse
  that reconnect whenever the old socket's turn is still finishing. Three or more would serve no
  client this build ships.
- A session holds its admission until its reader has returned **and** its worker has finished the
  turn it was running, not merely until its socket closes. Churning sockets therefore cannot park
  turns behind the writer lock past the bound. The admission is given back exactly once: a count
  of two holders (reader and worker), each let go in a `finally`, the last one releasing. That
  covers the 1000, 1002, 1009 and 1011 closes, a reader that dies by an exception no handler
  expected, and a worker that never started.
- A socket refused admission gets one `turn.error` and is closed 1013 (try again later). No
  session, worker or speaker thread is started for it, so nothing is heard, transcribed or billed.
  The reason is `validator_failed`, as this ADR already uses for a refused turn: the client asked
  for more than the daemon admits, and the refusal says so; `ERROR_REASONS` is unchanged. The
  detail names the limit: "at most 2 voice sockets may be open at once; try again when one has
  closed".

**The bound, as a product.** With N = `MAX_SESSIONS` = 2, at most N × (`MAX_PENDING_TURNS` + 1)
= 2 × 5 = 10 turns are waiting or running at once, each at most `MAX_CONTINUATIONS` + 1 = 9 lane
turns, so at most 2 × 5 × 9 = 90 metered lane turns are reachable from every voice socket together.
At most N = 2 transcriptions run at once, one per admitted reader. A closed session counts in N
until its last turn ends, and since part 1 it has no waiting turns and starts no continuation, so
in practice a closed one contributes at most the one lane turn it was inside.

**What the panel does on the refusal** (read, not changed: `apps/desktop/src/lib/voice.ts`,
`apps/desktop/src/stores/voice.ts`). The socket opens, so `ensureSocket` resolves; the `turn.error`
sets the phase to `error` with "validator_failed: at most 2 voice sockets …" as the reason, and the
1013 close calls `onClose`, which drops the socket, ends listening (a press still waiting for its
capture or microphone is made stale and opens no microphone) and keeps the `error` phase and its
reason. The panel does not reconnect on a close; the next press or typed line opens a new socket.
A refusal therefore cannot make it reconnect in a loop. One rough edge stays in the panel: a typed
line (`say`) whose socket is refused while it awaits the tab capture then sets the phase to
`thinking` and sends to a socket already gone, so it shows thinking until the next action.

**Consequences.**

- A third simultaneous voice client, or a reconnect while two earlier sockets are still finishing
  their turns, is refused and must try again; the person sees the reason in the panel.
- A refused upgrade still costs one handler thread for the handshake and one frame; that is the
  server's connection question, outside this module.
- The cap is a constant, like the per-socket one, and a `VoiceGateway` field defaulting to it, so
  a test can name its own and `wiring.py` does not change.

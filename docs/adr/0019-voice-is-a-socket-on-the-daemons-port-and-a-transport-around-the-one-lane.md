# 0019. Voice is a WebSocket on the daemon's port, and a transport around the one lane

Date: 2026-09-12

## Status

Accepted. Implements README §3.1 (surfaces) and the plan's c31; builds on ADR 0010 (the browser
lane holds no gated executor), ADR 0011 (the token on every route) and ADR 0012 (one turn is one
stream of channel events).

## Context

Act 2 of the demo is commanded without a keyboard: a push-to-talk key, one sentence, two
approvals spoken and one declined on the card. The original product had a realtime lane designed
for voice and a separate voice gateway with its own event vocabulary, its own approval path and
a vendor SDK in the daemon's dependencies. This build has one lane, one contract for its events,
one approval table and a stdlib-only core, and the question was how to add a microphone to that
without adding a second anything.

Four things had to be decided: where the audio arrives, how the token gets there from a browser
page that cannot set a header, what a backend is allowed to know, and what a spoken "approve"
is.

## Decision

**A WebSocket under `/voice` on the daemon's own port.** `GET /voice` with `Upgrade: websocket`
is handled by the same request handler as every route — token first, then origin, then path — and
then the handler thread belongs to the socket for as long as the peer keeps it. RFC 6455 is one
SHA-1 and a framing layer of a few dozen lines, so `channels/voice/ws.py` implements it in the
standard library rather than pulling a server framework in for one path. The daemon gains a
`SocketTable` beside its `RouteTable`; `wiring.build_local` registers `/voice` on it only when a
backend was configured, and `/health` lists the sockets so a shell knows before it captures a
microphone.

**The token rides the subprotocol.** A page's `WebSocket` cannot set `X-Athena-Token`. A query
string would put the token in URLs, histories and any proxy log. The one request header a browser
lets a page fill is `Sec-WebSocket-Protocol`, so a client sends `athena-token.<token>` there and
the server echoes it, as the RFC requires of a selected subprotocol. The header still wins when
both are present, and a wrong header is refused even beside a right subprotocol, so neither path
can be used to probe the other. A `curl`-shaped client sends the header as always.

**A backend hears one utterance and speaks one line, and nothing else.** `VoiceBackend` is two
methods: a `Transcriber` fed chunks as they arrive that returns partials if it can and the final
text on `finish`, and `synthesize(text)` yielding PCM16 at a rate the backend names. The port is
utterance-shaped because push-to-talk makes the end of an utterance a key release, and it has
room for streaming because an open microphone needs partials to notice speech over a reply. The
one provider backend is OpenAI over `urllib`, keyed from the environment; with no key the daemon
starts with no voice channel rather than a broken one. No backend sees the lane, the gate, the
approval table or the text of a card.

**The turn is the ordinary browser-lane turn.** The gateway calls the same `turn_events`
generator `POST /run` streams, under the same writer lock, in front of the same gate, and sends
each event to the socket as the JSON the SSE frame would carry. The only difference between a
spoken turn and a typed one is two words on the ledger row: `surface = voice`, `trigger = voice`.
A host tool's `tool.call` goes to the client, which runs it on the page and answers with
`tool_result`; the gateway continues the turn on the answers, bounded at eight like the panel's
run store, and carries an unanswered call's timeout into the next utterance rather than spending
a turn on it. A `tool.call` the daemon already settled in the same turn — a gated call refused
`pending_approval` — is not the page's to run; only a call with no result behind it left the
daemon as an instruction.

**A spoken answer takes the button's path.** "approve", "decline", "yes", "no", or an option's own
label, said while a card is waiting, is recognised exactly on the normalised utterance and sent
through `routes.decide` — the function behind `POST /decisions/<id>` — with the utterance's
origin. The model never sees the word. A sentence that mentions approving is a message: a card is
consent to one action with the parameters on it, and "approve the first two" is not that consent.
A bare "yes" answers the card on top; an older card is answered by its label or from the inbox.

**Barge-in is a generation counter.** Every spoken line takes the next number when it is queued;
an interrupt — the key going down over a reply, a partial transcript arriving over one, or a
stop word — raises the cutoff to the newest number. The line playing stops at its next chunk, the
lines behind it are never started, and the surface hears `voice.stopped` with `barge_in` for the
generation it should drop. A stop word starts no turn; new speech starts the next one.

**What is spoken is the `TTS:` line, else the text cut to the cap and announced.** The parser
already holds a `TTS:` line to 1,200 characters. A reply with no such line is spoken from its
visible text, cut to the same cap with `(showing N of M)` appended, so a person who hears a reply
stop short hears that it stopped short.

## Consequences

- Three new channel events — `voice.transcript`, `voice.speaking`, `voice.stopped` — join
  `contracts/channel.py` as the `voice` family, with the parity test every event has. `TurnContext`
  gains `trigger`, and the harness writes it to the ledger instead of a constant.
- `docs/daemon.md` carries the socket's wire: what the client sends, what it hears, and the audio
  frame's four-byte generation prefix.
- Three threads per connection — reader, worker, speaker — and a `Condition` for the page's
  answers. The reader is the handler thread; a client that hangs up mid-turn ends the socket and
  not the turn, which runs to its end and writes its row (ADR 0012).
- The OpenAI backend transcribes one request per utterance and sends no partials, which
  push-to-talk makes harmless. A streaming provider is another backend behind the same port,
  not a change to the gateway.
- `tests/channels/` runs the whole channel over a real socket on a scripted engine and a
  scripted backend: the door (token, origin, no backend), one utterance as one row, both
  barge-ins, the cap, a card approved and declined by voice, the page's answers, and a hang-up.

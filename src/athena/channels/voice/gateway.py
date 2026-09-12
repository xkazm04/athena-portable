"""The voice gateway: a WebSocket under ``/voice``, PCM16 in, audio and events out (ADR 0019).

Voice is a transport and not a feature. An utterance becomes a message, the message runs the
ordinary browser-lane turn through :func:`athena.daemon.routes.turn_events` — the same generator
``POST /run`` streams, under the same writer lock, in front of the same gate — and the reply's
spoken line is synthesised back. The only things this module adds to a typed turn are the words
``surface = voice`` and ``trigger = voice`` on the ledger row.

**The wire.** Text frames carry JSON. From the client: ``start`` (the key went down; carries the
page origin, the host state and a project id), binary frames of PCM16 for as long as it is held,
``stop`` (the key came up: the end of the utterance), ``text`` (an utterance typed rather than
spoken, for a client with no microphone) and ``tool_result`` (the page's answer to a
``tool.call``). From the server: every channel event of the turn, one frame each, exactly the
JSON ``/run`` puts on an SSE frame — plus the voice family: ``voice.transcript``,
``voice.speaking`` and ``voice.stopped``. Audio comes back as binary frames of a 4-byte
big-endian generation number followed by PCM16 at the backend's rate.

**Three threads per connection, and why.** The handler thread reads the socket, because a
barge-in arrives *while* a reply is playing and a reader that was busy speaking would hear it
late. A worker runs utterances one at a time, because a turn holds the writer lock and two of
them would only queue on it. A speaker plays lines in order, because a continuation's reply must
not wait for the previous line to finish. The three share a send lock and a generation counter,
and nothing else.

**Barge-in is a generation counter.** Every spoken line takes the next number when it is queued;
an interrupt raises the cutoff to the newest number, so the line playing stops at its next chunk
and the lines behind it are never started. A surface that hears ``voice.stopped`` with
``barge_in`` for a generation drops what it still holds of it, and an audio frame whose
generation is at or below the cutoff is simply late.

**A host tool's answer rides the next frame.** The lane has no executor for a page's tool (ADR
0010), so a ``tool.call`` for one goes to the client, the client runs it on the page and sends
``tool_result``, and the gateway continues the turn with the answers — the same loop the panel's
run store runs, bounded by the same number. A client that never answers is not an error; the
timeouts are carried into the next utterance's frame, and that utterance's model is told.
"""

from __future__ import annotations

import json
import queue
import struct
import threading
import time
from collections.abc import Mapping, Sequence
from dataclasses import dataclass, field
from typing import TYPE_CHECKING, Any

from athena.channels.voice.backends import VoiceBackend, VoiceBackendError
from athena.channels.voice.commands import Card, Spoken, recognise
from athena.channels.voice.tts import SpokenLine, spoken_line
from athena.channels.voice.ws import WebSocket, WebSocketError
from athena.contracts.channel import (
    ChannelEvent,
    DecisionRequested,
    DecisionResolved,
    ToolCall,
    ToolResult,
    TurnError,
    TurnFinished,
    VoiceSpeaking,
    VoiceStopped,
    VoiceTranscript,
    now_iso,
)
from athena.daemon.routes import (
    PENDING_LINES,
    Request,
    decide,
    event_payload,
    turn_context,
    turn_events,
)
from athena.lane.turn_frame import tool_results_from

if TYPE_CHECKING:
    from athena.daemon.server import AthenaDaemon

__all__ = [
    "CONTINUE_MESSAGE",
    "MAX_CONTINUATIONS",
    "RESULT_TIMEOUT_S",
    "VOICE_PATH",
    "VoiceGateway",
    "VoiceSession",
]

#: Where the channel lives on the daemon's port.
VOICE_PATH = "/voice"

#: How long the gateway waits for the page to answer a turn's host calls before it carries the
#: timeouts forward. The relay gives a page 35 seconds per call (ADR 0014); this is the same.
RESULT_TIMEOUT_S = 35.0

#: How many times one utterance may continue on the page's answers. The panel's run store holds
#: the same number, for the same reason: a loop whose only limit is the model's judgement is not
#: a limit.
MAX_CONTINUATIONS = 8

#: The continuation's message. A fixed line rather than the user's words repeated: the user has
#: not said anything new, and a transcript that says they did is a false record.
CONTINUE_MESSAGE = "(the tools you called have answered; continue)"


@dataclass
class VoiceGateway:
    """One backend, bound to one daemon. Called once per accepted socket, on the handler thread."""

    daemon: AthenaDaemon
    backend: VoiceBackend
    result_timeout_s: float = RESULT_TIMEOUT_S
    max_continuations: int = MAX_CONTINUATIONS

    def __call__(self, ws: WebSocket, request: Request) -> None:
        VoiceSession(self, ws).serve()


@dataclass
class _Utterance:
    origin: str
    host_state: dict[str, Any]
    project_id: str
    transcriber: Any
    #: Whether this utterance began by talking over a reply. A stop word said that way is still
    #: a stop word, even though playback ended before the key came up.
    interrupted: bool = False


@dataclass
class _Job:
    text: str
    origin: str
    host_state: dict[str, Any]
    project_id: str
    interrupted: bool = False


@dataclass
class VoiceSession:
    """One connection: the reader, the worker, the speaker, and what they share."""

    gateway: VoiceGateway
    ws: WebSocket
    #: Cards this session has been shown, newest first. A bare "yes" answers the top one.
    cards: list[Card] = field(default_factory=list)
    #: Host answers produced since the last turn, waiting to ride the next frame.
    outstanding: list[dict[str, Any]] = field(default_factory=list)

    def __post_init__(self) -> None:
        self._lock = threading.Lock()
        self._jobs: queue.Queue[_Job | None] = queue.Queue()
        self._speech: queue.Queue[tuple[int, SpokenLine] | None] = queue.Queue()
        self._results: dict[str, dict[str, Any]] = {}
        self._results_ready = threading.Condition(self._lock)
        self._utterance: _Utterance | None = None
        self._counter = 0
        self._cutoff = 0
        self._playing: int | None = None
        self._closed = False

    @property
    def daemon(self) -> AthenaDaemon:
        return self.gateway.daemon

    # -- the reader ------------------------------------------------------------------------------

    def serve(self) -> None:
        worker = threading.Thread(target=self._work, name="voice-worker", daemon=True)
        speaker = threading.Thread(target=self._speak_loop, name="voice-speaker", daemon=True)
        worker.start()
        speaker.start()
        try:
            while True:
                try:
                    message = self.ws.recv()
                except WebSocketError:
                    break
                if message is None:
                    break
                if message.kind == "binary":
                    self._audio(message.data)
                else:
                    self._control(message.text)
        finally:
            self._closed = True
            self.interrupt()
            self._jobs.put(None)
            self._speech.put(None)
            self.ws.close()
            # A worker inside a turn holds the writer lock and runs to its end (ADR 0012); the
            # join is a courtesy to a worker that is idle, not a wait on one that is not.
            worker.join(timeout=1.0)
            speaker.join(timeout=1.0)

    def _audio(self, pcm: bytes) -> None:
        current = self._utterance
        if current is None:
            return  # audio with no key down is a client bug, and a quiet one
        for partial in current.transcriber.feed(pcm):
            if self.speaking:
                current.interrupted = True
                self.interrupt()
            self.send(VoiceTranscript(text=partial, final=False))

    def _control(self, raw: str) -> None:
        try:
            body = json.loads(raw)
        except json.JSONDecodeError:
            self.send(TurnError(reason="parse_error", detail="a control frame must be JSON"))
            return
        if not isinstance(body, dict):
            self.send(TurnError(reason="parse_error", detail="a control frame must be an object"))
            return
        kind = str(body.get("type", ""))
        if kind == "start":
            self._start(body)
        elif kind == "stop":
            self._stop()
        elif kind == "text":
            interrupted = self.speaking
            if interrupted:
                self.interrupt()
            self._jobs.put(_Job(**self._job_fields(body), interrupted=interrupted))
        elif kind == "tool_result":
            self._tool_result(body)
        else:
            self.send(TurnError(reason="validator_failed", detail=f"unknown frame type {kind!r}"))

    def _start(self, body: Mapping[str, Any]) -> None:
        interrupted = self.speaking
        if interrupted:
            self.interrupt()
        fields = self._job_fields(body)
        self._utterance = _Utterance(
            origin=fields["origin"],
            host_state=fields["host_state"],
            project_id=fields["project_id"],
            transcriber=self.gateway.backend.transcriber(),
            interrupted=interrupted,
        )

    def _stop(self) -> None:
        current = self._utterance
        self._utterance = None
        if current is None:
            return
        try:
            text = str(current.transcriber.finish() or "")
        except VoiceBackendError as exc:
            self.send(TurnError(reason="engine_error", detail=f"transcription: {exc}"))
            return
        self._jobs.put(
            _Job(
                text=text,
                origin=current.origin,
                host_state=current.host_state,
                project_id=current.project_id,
                interrupted=current.interrupted,
            )
        )

    def _tool_result(self, body: Mapping[str, Any]) -> None:
        call_id = str(body.get("call_id", ""))
        if not call_id:
            return
        row = {
            "call_id": call_id,
            "name": str(body.get("name", "")),
            "ok": bool(body.get("ok", False)),
            "output": str(body.get("output", "")),
            "error": body.get("error"),
            "tier": int(body.get("tier", 1) or 1),
            "ms": int(body.get("ms", 0) or 0),
        }
        with self._results_ready:
            self._results[call_id] = row
            self._results_ready.notify_all()

    @staticmethod
    def _job_fields(body: Mapping[str, Any]) -> dict[str, Any]:
        host_state = body.get("host_state")
        return {
            "text": str(body.get("text", "")),
            "origin": str(body.get("origin", "")).strip(),
            "host_state": dict(host_state) if isinstance(host_state, Mapping) else {},
            "project_id": str(body.get("project_id", "") or ""),
        }

    # -- sending ---------------------------------------------------------------------------------

    def send(self, event: ChannelEvent) -> None:
        if self._closed:
            return
        try:
            self.ws.send_text(json.dumps(event_payload(event), sort_keys=True))
        except WebSocketError:
            self._closed = True

    def _send_audio(self, generation: int, chunk: bytes) -> None:
        if self._closed:
            return
        try:
            self.ws.send_binary(struct.pack("!I", generation) + chunk)
        except WebSocketError:
            self._closed = True

    # -- playback --------------------------------------------------------------------------------

    @property
    def speaking(self) -> bool:
        """Whether a line is playing or waiting to."""
        with self._lock:
            return self._playing is not None or self._counter > self._cutoff

    def interrupt(self) -> None:
        """Barge-in: stop the line playing at its next chunk and drop every line behind it."""
        with self._lock:
            self._cutoff = self._counter
        # Drain rather than clear, because ``queue.Queue`` has no clear and the speaker may be
        # blocked on ``get``; a stale item it does pull is skipped by its generation anyway.
        while True:
            try:
                self._speech.get_nowait()
            except queue.Empty:
                break

    def say(self, line: SpokenLine) -> int:
        with self._lock:
            self._counter += 1
            generation = self._counter
        self._speech.put((generation, line))
        return generation

    def _speak_loop(self) -> None:
        backend = self.gateway.backend
        while True:
            item = self._speech.get()
            if item is None:
                return
            generation, line = item
            with self._lock:
                if generation <= self._cutoff:
                    continue
                self._playing = generation
            reason = "done"
            try:
                self.send(
                    VoiceSpeaking(
                        generation=generation,
                        text=line.text,
                        truncated=line.truncated,
                        sample_rate=backend.sample_rate,
                    )
                )
                for chunk in backend.synthesize(line.text):
                    with self._lock:
                        stale = generation <= self._cutoff
                    if stale or self._closed:
                        reason = "barge_in"
                        break
                    self._send_audio(generation, chunk)
            except VoiceBackendError:
                reason = "error"
            finally:
                with self._lock:
                    self._playing = None
                    if self._counter == generation and self._cutoff < generation:
                        # Nothing queued behind this line: ``speaking`` goes false with it.
                        self._cutoff = generation
            self.send(VoiceStopped(generation=generation, reason=reason))

    # -- the worker ------------------------------------------------------------------------------

    def _work(self) -> None:
        while True:
            job = self._jobs.get()
            if job is None:
                return
            try:
                self._handle(job)
            except Exception as exc:  # a bug ends the utterance honestly, never silently
                self.send(TurnError(reason="unknown", detail=type(exc).__name__))

    def _handle(self, job: _Job) -> None:
        self.send(VoiceTranscript(text=job.text, final=True))
        spoken = recognise(job.text, self._known_cards(), speaking=job.interrupted or self.speaking)
        if spoken.kind == "silence":
            return
        if spoken.kind == "stop":
            self.interrupt()
            return
        if spoken.kind == "answer":
            self._answer(job, spoken)
            return
        self._turn(job, job.text)

    def _known_cards(self) -> list[Card]:
        """The cards this session was shown, then the inbox's, newest of ours first."""
        seen = {card.id for card in self.cards}
        inbox = [
            Card(row.id, tuple((option, "") for option in row.options))
            for row in self.daemon.approvals.pending(PENDING_LINES).rows
            if row.id not in seen
        ]
        return [*self.cards, *inbox]

    def _turn(self, job: _Job, message: str) -> None:
        session = self.daemon.sessions.get(job.origin)
        if session is None:
            self.send(
                TurnError(
                    reason="foreign_origin",
                    detail=f"{job.origin!r} has sent no manifest; open the page first",
                )
            )
            return
        project = {"id": job.project_id} if job.project_id else None
        for step in range(self.gateway.max_continuations + 1):
            ctx = turn_context(
                self.daemon, session, job.project_id, surface="voice", trigger="voice"
            )
            carried, self.outstanding = self.outstanding, []
            proposed: list[ToolCall] = []
            settled: set[str] = set()
            finished: TurnFinished | None = None
            for event in turn_events(
                self.daemon,
                ctx,
                message=message,
                host_state=job.host_state,
                results=tool_results_from(carried),
                project=project,
            ):
                if isinstance(event, DecisionRequested):
                    self.cards.insert(
                        0, Card(event.id, tuple((o.id, o.label) for o in event.options))
                    )
                elif isinstance(event, ToolCall) and event.origin != "core":
                    proposed.append(event)
                elif isinstance(event, ToolResult):
                    settled.add(event.call_id)
                elif isinstance(event, TurnFinished):
                    finished = event
                self.send(event)
            # A host call the daemon already answered in the same turn — a gated one, refused
            # ``pending_approval`` until the card is answered — is not the page's to run. Only a
            # call with no result behind it left the daemon as an instruction (ADR 0010).
            host_calls = [call for call in proposed if call.call_id not in settled]
            if finished is not None:
                line = spoken_line(finished)
                if line is not None:
                    self.say(line)
            if not host_calls:
                return
            answered = self._await_results(host_calls)
            if not answered:
                # The page said nothing. The timeouts ride the next utterance's frame instead
                # of spending a turn now telling the model that nothing happened.
                return
            if step == self.gateway.max_continuations:
                self.send(
                    TurnError(
                        reason="budget_exhausted",
                        detail=f"the page answered {self.gateway.max_continuations} times "
                        "without the turn settling",
                    )
                )
                return
            message = CONTINUE_MESSAGE

    def _await_results(self, calls: Sequence[ToolCall]) -> bool:
        """Collect the page's answers to ``calls`` into ``outstanding``. ``True`` if any came."""
        wanted = {call.call_id: call for call in calls}
        deadline = time.monotonic() + self.gateway.result_timeout_s
        with self._results_ready:
            while not set(wanted) <= set(self._results):
                remaining = deadline - time.monotonic()
                if remaining <= 0 or self._closed:
                    break
                self._results_ready.wait(timeout=min(remaining, 0.25))
            rows = {cid: self._results.pop(cid) for cid in list(wanted) if cid in self._results}
        for call_id, call in wanted.items():
            row = rows.get(call_id) or {
                "call_id": call_id,
                "name": call.name,
                "ok": False,
                "output": "",
                "error": "timeout",
                "tier": call.tier,
                "ms": int(self.gateway.result_timeout_s * 1000),
            }
            self.outstanding.append(row)
        return bool(rows)

    def _answer(self, job: _Job, spoken: Spoken) -> None:
        """A spoken answer takes the button's path: :func:`athena.daemon.routes.decide`."""
        request = Request(
            method="POST",
            path=f"/decisions/{spoken.approval_id}",
            body={"choice": spoken.choice, "origin": job.origin},
        )
        status, reply = decide(self.daemon, request, spoken.approval_id)
        self.cards = [card for card in self.cards if card.id != spoken.approval_id]
        if status != 200:
            self.send(
                TurnError(
                    reason=str(reply.get("reason", "unknown")), detail=str(reply.get("detail", ""))
                )
            )
            return
        self.send(
            DecisionResolved(id=spoken.approval_id, choice=spoken.choice, by="user", at=now_iso())
        )
        self.say(SpokenLine("Approved." if reply.get("status") == "approved" else "Declined."))
        execute = [row for row in reply.get("execute", []) if isinstance(row, dict)]
        if not execute:
            return
        calls = [
            ToolCall(
                call_id=str(row.get("call_id", "")),
                name=str(row.get("name", "")),
                params=dict(row.get("params", {})),
                origin=str(row.get("origin", "")),
                tier=int(row.get("tier", 1) or 1),
            )
            for row in execute
        ]
        for call in calls:
            self.send(call)
        if self._await_results(calls):
            self._turn(job, CONTINUE_MESSAGE)

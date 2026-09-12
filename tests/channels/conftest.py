"""A voice socket on a real daemon, and a client that speaks to it (channels/voice; ADR 0019).

The daemon, the brain, the gate, the approval table, the ledger and the lane are the ones
``tests/daemon/conftest.py`` builds — the same fixtures, imported here so the two suites can never
disagree about what a live daemon is. The one thing added is the voice channel: a
:class:`ScriptedBackend` that hears what the test scripted and says what it is told, registered
on the daemon's socket table exactly as ``wiring.build_local`` would register a real one.
"""

from __future__ import annotations

import json
import time
from collections.abc import Iterator
from dataclasses import dataclass, field
from typing import Any

import pytest

from athena.channels.voice.backends import ScriptedBackend
from athena.channels.voice.gateway import VOICE_PATH, VoiceGateway
from athena.channels.voice.ws import WebSocket, connect

# ``tests/daemon`` is a package rooted at ``tests/``, which pytest puts on ``sys.path`` for it;
# importing its conftest by that name is how its fixtures become this directory's too.
from daemon.conftest import (  # noqa: F401 - fixtures are used by name
    PAGE_ORIGIN,
    SHELL_ORIGIN,
    TOKEN,
    Live,
    brain,
    daemon,
    live,
    local,
    transport,
)

#: How long a page has to answer a host call in these tests. Real: 35 s. Here: long enough for a
#: test that answers, short enough for one that deliberately does not.
RESULT_TIMEOUT_S = 0.4


@pytest.fixture
def backend() -> ScriptedBackend:
    return ScriptedBackend()


@pytest.fixture
def voiced(live: Live, backend: ScriptedBackend) -> Live:  # noqa: F811 - the fixture
    """The live daemon with ``/voice`` registered on the scripted backend."""
    live.daemon.sockets.add(
        VOICE_PATH, VoiceGateway(live.daemon, backend, result_timeout_s=RESULT_TIMEOUT_S)
    )
    return live


@dataclass
class VoiceClient:
    """One connection to ``/voice``, with the frames it has read so far."""

    ws: WebSocket
    events: list[dict[str, Any]] = field(default_factory=list)
    audio: list[tuple[int, bytes]] = field(default_factory=list)
    #: Which frames :meth:`until` has already handed out. Frames land in whatever order three
    #: daemon threads produce them, so a wait scans everything read so far and consumes only the
    #: frame it matched — a frame that arrived early is still there for the next wait.
    matched: set[int] = field(default_factory=set)

    # -- speaking ------------------------------------------------------------------------------

    def send(self, **body: Any) -> None:
        self.ws.send_text(json.dumps(body))

    def start(self, origin: str = PAGE_ORIGIN, **extra: Any) -> None:
        self.send(type="start", origin=origin, host_state={"page_url": origin}, **extra)

    def chunks(self, count: int = 3, size: int = 640) -> None:
        for _ in range(count):
            self.ws.send_binary(bytes(size))

    def stop(self) -> None:
        self.send(type="stop")

    def utter(self, origin: str = PAGE_ORIGIN, chunks: int = 3) -> None:
        """Key down, some audio, key up. What the backend hears is what the test scripted."""
        self.start(origin)
        self.chunks(chunks)
        self.stop()

    def say(self, text: str, origin: str = PAGE_ORIGIN) -> None:
        """The typed path: an utterance with no microphone behind it."""
        self.send(type="text", text=text, origin=origin, host_state={"page_url": origin})

    def tool_result(self, call: dict[str, Any], ok: bool = True, output: str = "done") -> None:
        self.send(
            type="tool_result",
            call_id=call["call_id"],
            name=call["name"],
            ok=ok,
            output=output,
            error=None if ok else "failed",
            tier=call.get("tier", 1),
        )

    # -- listening -----------------------------------------------------------------------------

    def next(self, timeout: float = 10.0) -> dict[str, Any] | None:
        """The next text frame as an event, collecting audio along the way. ``None`` on close."""
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            message = self.ws.recv()
            if message is None:
                return None
            if message.kind == "binary":
                generation = int.from_bytes(message.data[:4], "big")
                self.audio.append((generation, message.data[4:]))
                continue
            event = json.loads(message.text)
            assert isinstance(event, dict)
            self.events.append(event)
            return event
        raise AssertionError(f"no frame within {timeout}s")

    def until(self, kind: str, timeout: float = 10.0, **match: Any) -> dict[str, Any]:
        """The first unconsumed frame of ``kind`` whose fields match ``match``, reading more
        until one arrives; fail on close or timeout."""
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            for index, event in enumerate(self.events):
                if index in self.matched:
                    continue
                if event["kind"] == kind and all(event.get(k) == v for k, v in match.items()):
                    self.matched.add(index)
                    return event
            if self.next(timeout=max(0.01, deadline - time.monotonic())) is None:
                raise AssertionError(f"the socket closed before {kind}: {self.kinds()}")
        raise AssertionError(f"no {kind} within {timeout}s: {self.kinds()}")

    def kinds(self) -> list[str]:
        return [str(event["kind"]) for event in self.events]

    def of(self, kind: str) -> list[dict[str, Any]]:
        return [event for event in self.events if event["kind"] == kind]

    def close(self) -> None:
        self.ws.close()
        if self.ws.sock is not None:
            self.ws.sock.close()


@pytest.fixture
def client(voiced: Live) -> Iterator[VoiceClient]:
    ws = connect(voiced.host, voiced.port, VOICE_PATH, token=TOKEN, origin=SHELL_ORIGIN)
    voice = VoiceClient(ws)
    try:
        yield voice
    finally:
        voice.close()

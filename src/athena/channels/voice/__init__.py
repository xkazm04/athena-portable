"""The voice channel: PCM16 over a WebSocket, one backend, the ``TTS:`` rule (README §3.1).

Five files, each one thing (ADR 0019):

- :mod:`athena.channels.voice.ws` — RFC 6455 in the standard library: the handshake key, frames
  in and out, and a client half for tests and a shell-free client.
- :mod:`athena.channels.voice.backends` — the :class:`VoiceBackend` port (hear one utterance,
  speak one line), a scripted backend for tests, and one provider behind an environment key.
- :mod:`athena.channels.voice.commands` — what an utterance *is* before it is a turn: a stop
  word, an answer to the card on top, or a message.
- :mod:`athena.channels.voice.tts` — what is spoken for a finished turn: the ``TTS:`` line, or
  the text cut to the cap and announced.
- :mod:`athena.channels.voice.gateway` — the socket's life: a reader, a worker that runs the
  ordinary browser-lane turn, a speaker, and barge-in by generation counter.

Voice is a transport and not a feature. Nothing here decides policy, and a spoken "approve"
answers a card through the same route as a button.
"""

from athena.channels.voice.backends import (
    BACKENDS,
    INPUT_SAMPLE_RATE,
    OpenAIBackend,
    ScriptedBackend,
    Transcriber,
    VoiceBackend,
    VoiceBackendError,
    backend_from_name,
)
from athena.channels.voice.commands import Card, Spoken, recognise
from athena.channels.voice.gateway import (
    CONTINUE_MESSAGE,
    MAX_CONTINUATIONS,
    RESULT_TIMEOUT_S,
    VOICE_PATH,
    VoiceGateway,
    VoiceSession,
)
from athena.channels.voice.tts import TTS_CAP, SpokenLine, spoken_line
from athena.channels.voice.ws import (
    MAX_FRAME_BYTES,
    PROTOCOL_PREFIX,
    HandshakeError,
    Message,
    WebSocket,
    WebSocketError,
    accept_key,
    connect,
)

__all__ = [
    "BACKENDS",
    "CONTINUE_MESSAGE",
    "INPUT_SAMPLE_RATE",
    "MAX_CONTINUATIONS",
    "MAX_FRAME_BYTES",
    "PROTOCOL_PREFIX",
    "RESULT_TIMEOUT_S",
    "TTS_CAP",
    "VOICE_PATH",
    "Card",
    "HandshakeError",
    "Message",
    "OpenAIBackend",
    "ScriptedBackend",
    "Spoken",
    "SpokenLine",
    "Transcriber",
    "VoiceBackend",
    "VoiceBackendError",
    "VoiceGateway",
    "VoiceSession",
    "WebSocket",
    "WebSocketError",
    "accept_key",
    "backend_from_name",
    "connect",
    "recognise",
    "spoken_line",
]

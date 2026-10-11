# 0072. One utterance is at most two minutes of PCM

Date: 2026-10-11

Implements README section 3.1 (voice) and ADR 0019. Closes the full-council round 1
findings robustness-5 and economics-1 of voice-conversation (the hard failure
`unbounded_foreign_decode`).

## Context

`MAX_FRAME_BYTES` bounds one WebSocket frame, and the daemon removes the socket timeout for
`/voice`. `VoiceSession._audio` fed every binary frame to the transcriber and `BufferedTranscriber`
kept every frame, so a client holding the key down held memory without limit (the council's probe:
96 MiB in 1.6 s, with nothing said to the client). The HTTP twin `/voice/transcribe` already caps
a body at `MAX_RAW_BODY_BYTES`.

## Decision

One utterance is at most `MAX_UTTERANCE_BYTES` = 4,194,304 bytes of PCM16: two minutes of 16 kHz
mono, the same number as `MAX_RAW_BODY_BYTES`. The constant lives in `channels/voice/backends.py`
so the channel does not import the daemon; a test pins the two equal.

- The gateway counts the utterance's bytes before `feed`, for every transcriber. The frame that
  would cross the ceiling is not fed. The utterance is dropped: its transcriber is released,
  nothing is transcribed or billed, and the client gets one `turn.error` with reason
  `validator_failed` and a detail naming the limit in seconds. `ERROR_REASONS` is unchanged.
- Every later binary frame is ignored until the next `start`, and a `stop` for a dropped
  utterance starts no turn. The socket stays open.
- `BufferedTranscriber` also refuses past the same ceiling, so it never holds more than that.

## Consequences

- A person who talks for over two minutes in one press is told so and says it again shorter.
- Memory per connection is bounded by one ceiling, not by the client's patience.

# 0110. A heard utterance ends in a named outcome

Date: 2026-10-15

Amends the voice wire of [0019](0019-voice-is-a-socket-on-the-daemons-port-and-a-transport-around-the-one-lane.md):
`voice.transcript` gains two fields. Adds a level gate in front of the buffered transcriber that
[0072](0072-one-utterance-is-at-most-two-minutes-of-pcm.md) bounds and that
[0083](0083-a-metered-speech-request-is-a-ledger-row.md) meters. Implements README section 3.2
step 6 for the three endings that start no turn.

## Context

An utterance can end in six ways. The client could see three of them: a turn (`turn.finished`), a
failure (`turn.error`), and a card answered by voice (`decision.resolved`, then "Approved."). It
could not see the other three: a key tapped and let go, a silent or muted microphone, and a stop
word said over a reply. For those the gateway sent a final `voice.transcript` with `text` and
`final`, then returned and sent nothing else.

The panel's store sets `thinking` when the key comes up, and only `turn.finished` set it back to
`idle`. So after a silent press, a tap or a stop word, the halo stayed on its thinking edge and the
key read busy until the next press.

"Empty" was also worked out from the length of a string three times: in `BufferedTranscriber.finish`,
in `recognise()` and in the store. Too short, silent, and heard-but-no-words were one fact on the
wire. The only check before an engine was a tenth-of-a-second length check. A muted microphone's
two seconds of zeros went to whisper or to the metered provider: a request, a ledger row, and on
whisper sometimes words made up from silence that became a turn.

## Decision

1. **The stage that knows says it.** `BufferedTranscriber` measures the peak of what it is fed (one
   `array('h')` pass per frame, beside the byte count of ADR 0072). `finish` records `outcome`:
   `too_short` (under a tenth of a second), `silent` (peak below `SILENCE_FLOOR_DBFS`, -55 dBFS),
   `no_words` (the engine heard it and returned no words) or `words`. `too_short` and `silent`
   return before `transcribe` is called. No process starts, no request is sent, `requested` stays
   false, and no ledger row is owed (ADR 0083).
2. **One map, one vocabulary.** `commands.outcome_of(heard, spoken)` turns the transcriber's word
   and the recogniser's kind into the wire outcome. It is one of `TRANSCRIPT_OUTCOMES` in
   `contracts/channel.py`: `message`, `answer`, `stop`, `too_short`, `silent`, `no_words`. The
   transcriber wins where it knows more. The recogniser's `silence` (nothing left once
   normalised) becomes `no_words`, which also covers a transcriber that does not say, such as the
   scripted one or a typed line of spaces.
3. **The final transcript is sent once the utterance is known.** The gateway sends it after
   `recognise`, with `outcome` and `peak_dbfs` (the peak in dBFS to a tenth, `None` when the
   transcriber did not measure). Every event after it is unchanged. A message turn still emits
   `voice.transcript, text.delta, turn.summary, turn.finished, voice.speaking, voice.stopped`.
4. **The surface ends on it.** `apps/desktop/src/lib/events.ts` declares the same tuple, and
   `tests/contracts/test_channel.py` reads it. On a final transcript whose outcome is not
   `message` or `answer`, the voice store leaves `thinking` for `idle`, and each outcome has its
   own sentence: "hold the key while you speak"; "your microphone sounded silent (-70 dB), check
   the input in Voice settings"; "I heard sound but no words, try again". A stop word is quiet.

## Consequences

- A silent press, a tap and a stop word no longer leave Athena "thinking". A muted or misrouted
  microphone reports the level it measured instead of saying nothing.
- Silence never becomes a metered transcription or a whisper run, and so never becomes a turn
  built from words an engine made up from room tone.
- The fields default to `""` and `None`. A partial, a transcript from an older daemon, or one read
  by an older client reads either shape, and a reader takes `""` to mean "not said", never
  "silent". There is no stored state.
- The floor is a peak, not an energy measure. One click above -55 dBFS passes the gate, and the
  engine then reports `no_words`. That is deliberate: the gate only stops a capture that is
  certainly silent, and it never decides whether a sound was speech.
- The HTTP twin `/voice/transcribe` uses the same transcriber. A silent body answers `200` with
  empty text and starts no engine.
- Tests that fed zeros as if they were speech now feed a tone, because zeros are silence.

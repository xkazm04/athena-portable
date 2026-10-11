# 0083. A metered speech request is a ledger row

Date: 2026-10-11

Implements README section 2 invariant 6 and section 3.2. Closes the full-council round 2 findings
craft-3 and economics-4 of voice-conversation. Builds on ADRs 0005, 0019 and 0028.

## Context

Invariant 6 says one ledger row per model invocation, failures included, and AGENTS.md says the
same. `OpenAIBackend.transcribe` and `OpenAIBackend.synthesize` call two metered models,
`gpt-4o-mini-transcribe` once per utterance and `gpt-4o-mini-tts` once per spoken line, and wrote
nothing on success or on failure. Neither ADR 0019 nor ADR 0028 said why, so the gap read as an
unrecorded exception to the invariant. The cost of speech could not be seen, even in principle.

The voice studio composes a backend from two halves (ADR 0028). The provider may hear while Kokoro
speaks, the buffered transcriber answers a tapped key with `''` and never calls the provider, and
the rows would be written from two threads, the transcription worker and the speaker.

## Decision

**The reading of invariant 6 for speech.** A "model invocation" is a request Athena sends to a
metered provider. A transcription request and a synthesis request each are one. A local engine
process (whisper.cpp, Kokoro through sherpa-onnx) is not one: it runs on the user's machine, bills
nothing and has no provider whose cost could be hidden, so it gets no row. The scripted backend
gets none either.

**One row per request, not per turn.** A spoken turn can leave three rows: one transcription row,
the turn's own row, and one synthesis row per spoken line. A line spoken with no turn behind it,
the "Approved." of a card answered by voice, is a synthesis row too. An utterance under a tenth of
a second, which `BufferedTranscriber.finish` answers with `''`, sends nothing and writes nothing. A
`ComposedBackend` is metered per half: Kokoro speaking with the provider hearing gives
transcription rows only.

**The fields.**

| Field | Value |
|---|---|
| `engine` | the provider half's name, `openai` |
| `model` | its `stt_model` or `tts_model` |
| `surface`, `trigger` | `voice`, `voice` |
| `conversation` | the value the utterance's turn row carries: `conversation_for(session, project_id)` |
| `origin` | the value the turn row carries: `host:<app_id>` of the page's session when `is_origin` accepts it, else `core` |
| `rounds`, `input_tokens`, `output_tokens` | `1`, `0`, `0` |
| `cost_usd`, `cost_estimated` | `None`, `False` |
| `ms` | the request's wall time; for synthesis, from the call until the generator is closed |
| `turn_id` | the turn's id on a spoken line's row; `None` on a transcription row and on a line with no turn |

A page with no live session gets no turn row (`foreign_origin`). Its transcription row is still
written, with `conversation` empty and `origin` `core`. A `project_id` that is not a minted
project id falls back to the session's own conversation, so the row is still written.

**No price.** `cost_usd` stays `None` until a committed price exists. The data economics-4 named
as missing is still missing: a per-audio-minute rate for `gpt-4o-mini-transcribe`, and a
per-character or per-minute rate for `gpt-4o-mini-tts`. No price is taken from memory and no price
table is added. The rows give the count and the milliseconds, so the cost can be computed once
someone commits a rate.

**Failures and barge-in.** A request that raises `VoiceBackendError` is `is_error` with reason
`engine_error`. Any other exception is `is_error` with `unknown`, and it still reaches the gateway's
usual handling: the worker's `turn.error`, or the speaker's logged `voice.stopped` `error`. No
reason is added to `ERROR_REASONS`. A line cut off by barge-in is not an error. Its row has
`is_error` false and the milliseconds up to its close, which is also as far as the reply was read.

**Ledger-write failures.** A write that raises is tried once more, as `RoundHarness._finish` does
(commit 024cdec). `Ledger.record` is one INSERT in one transaction that rolls back, so the retry
never doubles a row. If it fails again, the gateway logs `voice: a speech ledger row was not
written` at warning level, with no exception text and no transcript, and goes on. A ledger fault
never ends a line, a transcript or a session. The client hears exactly what it heard before.

**No event.** A speech row sends no `turn.summary`. The socket's event sequence does not change.

**Where the rows are written.** The gateway writes them through `daemon.ledger.record`, because it
holds the session's context. The backend never sees the ledger, so `backends.py`'s docstring stays
true. The rows are written on the worker thread (transcription) and the speaker thread
(synthesis). `Brain.write_txn` is safe there: the writer connection is opened with
`check_same_thread=False`, and every write takes the brain's re-entrant `_write_lock` around one
`BEGIN IMMEDIATE`. The speaker never takes the daemon's writer lock, so a synthesis row waits
only for the length of another single write, never for a running turn. `core/ledger.py` and the
schema are unchanged.

**The seam.** `backends.py` gains a frozen `Meter(engine, model)` and two read-only properties,
`hearing_meter` and `speaking_meter`. `OpenAIBackend` answers them with its `stt_model` and
`tts_model`. `ComposedBackend` answers each from its own half, and a half that names none (Kokoro,
whisper.cpp, scripted) is unmetered. The gateway reads them through the module functions
`hearing_meter(backend)` and `speaking_meter(backend)`, which return `None` for anything that is not
a `Meter`. `BufferedTranscriber.requested` says whether `finish` handed the utterance to its engine.
It is set before the call, so a request that failed still counts as sent. A transcriber that does
not say is taken to have sent. The hearing meter is taken with the transcriber at key-down and the
speaking meter with the backend each line starts on, so a studio swap never bills a request to the
half that did not make it.

## Consequences

- `Ledger.recent` and `Ledger.rollup` now include rows with engine `openai` and trigger `voice`.
  A rollup by engine or model shows speech requests beside lane turns. A rollup by conversation
  counts a spoken turn's transcription and lines in the turn's conversation. A count of rows per
  conversation is no longer a count of turns.
- The activity view shows those rows with `cost_usd` null until a price is committed.
- The studio's comparison route `POST /voice/transcribe?engine=openai` (`daemon/voice.py`) also
  sends a metered request and still writes no row. It runs outside a voice session, with no
  conversation and no surface, and was outside this change's paths. It is left open.
- A provider added later as a speech half gets rows by naming a `Meter`, and nothing else changes.

## Amendment, 2026-10-11: the studio's comparison route writes its row

The open item above is closed. `POST /voice/transcribe` (`daemon/voice.py`) now writes one row
when the listener has a hearing meter and the transcriber did not report `requested == False`:
`failure` is `None` on success, `engine_error` for a `VoiceBackendError` (the reply is still a
503), and `unknown` for any other exception, which is then re-raised, as the gateway does. A
local engine, an unknown engine, an empty or odd body and an unready listener write none.

The row is the one a page with no session already gets from the gateway: conversation `""`,
origin `core`, surface `voice`, trigger `voice`, no turn id. A comparison belongs to no
conversation, has no surface of its own, and a new trigger value would change `ledger.TRIGGERS`
for a row that is the same kind of request. One helper, `record_speech` in `gateway.py`, writes
both rows, so the retry-once-then-log behaviour and the `LEDGER_ROW_LOST` line exist once.

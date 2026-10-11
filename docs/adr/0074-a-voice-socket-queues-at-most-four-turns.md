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

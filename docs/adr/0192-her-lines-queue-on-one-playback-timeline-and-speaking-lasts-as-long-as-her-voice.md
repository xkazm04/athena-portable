# 0192. Her lines queue on one playback timeline, and speaking lasts as long as her voice

Date: 2026-10-25

## Context

The live voice player (`apps/desktop/src/lib/voice.ts`, ADR 0019 and 0020) scheduled audio per
generation: each chunk started at `max(currentTime, end of this line)`. Nothing chained one line
behind another. The daemon sends each chunk the moment it is synthesized, with no pacing
(`src/athena/channels/voice/gateway.py`), and speaks one line per finished turn. A turn with a host
call therefore speaks "Opening it now.", runs the call, and speaks the continuation's line. A
spoken approval speaks "Approved." and then the approved call's line. Synthesis runs ahead of
playback, so the second line routinely arrived while the first was still audible, and it was
scheduled at `currentTime`, over the first.

The same gap broke barge-in and the phase. `voice.stopped` with `done` arrives when synthesis ends,
seconds before playback does. The push-to-talk store cleared `generation` and went `idle` at once.
A press during that tail had nothing to drop locally, and the daemon had already finished the
line, so she kept talking over the person. The store's own header names that failure as the reason
barge-in exists. The companion reads `phase === "speaking"` and showed her quiet while she was
audibly talking.

The registry's voice-io standard (tts-pipeline technique) holds that at most one utterance is
audible per listening context, that an order-is-meaning reply uses the append queue policy, and
that interruption cancels the whole utterance.

## Decision

1. **One timeline.** The player keeps one `tail` across generations. Every chunk starts at
   `max(currentTime, tail)`, so a new line is appended behind whatever is still sounding. Each
   line's own chunk list, and so `position(g)`, is unchanged: a queued line reads 0 until its
   first chunk starts. `drop(g)` recomputes the tail from the lines left.
2. **`silence()` and `onQuiet`.** `silence()` stops every source of every line, finished or not.
   A line still being synthesized is marked dropped, so its late chunks are ignored until its
   `voice.stopped`. `onQuiet` fires when the last source of any line has ended, and on a silence.
3. **Speaking lasts as long as she is heard.** On `voice.stopped` with `done` for the current line
   while the player still sounds it, the store keeps `phase`, `generation` and `speakingText`, and
   remembers the line as its tail. `onQuiet` then goes idle and clears the face line, but only if
   the current line is still that tail: a newer line that has begun keeps "speaking" until its own
   end. `barge_in` still drops at once and goes idle at once.
4. **A press or a typed line silences everything.** `press()` and `say()` drop the line in flight
   (player and face) and call `silence()`, so a press in the tail stops her before `start` is sent.
5. **The player leaves the first frame.** `Player` moves to `lib/voice-player.ts`, which the store
   loads with `import()` when it opens the voice socket, before any of her audio can arrive.
   `VoiceDeps.player` may return a promise. The module imports nothing at run time. What it needs
   of `lib/voice.ts` (`follow` for the halo, `pcm16ToFloat32`, `rms`) is handed in as `PlayerKit`
   (`PLAYER_KIT`). A runtime import back into `lib/voice.ts` made the bundler split that module
   and `lib/events.ts` into chunks of their own, which cost more than the move saved. Kept in the
   first frame, the new code was 261 B over the first-paint ceiling. Moved out, the first frame is
   474 B smaller than before.

## Consequences

- A multi-line reply, or an approval and its continuation, never plays two of her lines at once.
  A press at any moment she is audible stops her locally. The companion and the halo caption say
  "speaking" for exactly as long as she is heard. This closes the voice-io "at most one audible"
  deviation for the live channel.
- The face timeline (`lib/face-timeline.ts`) still holds one current line. When line 2's
  `voice.speaking` arrives during line 1's tail it moves to line 2 as it did before; this decision
  neither fixes nor worsens that.
- Append, not replace: a long first line delays the second. That is the queue policy an
  order-is-meaning reply needs. A future "newest wins" channel would need its own policy, not a
  change here.
- Anything that builds a `Player` passes `PLAYER_KIT`. The studio's `PreviewPlayer` is a separate
  class and is unaffected.
- Tests: `lib/voice.test.ts` ("her lines play on one timeline") and `stores/voice.test.ts` ("her
  voice outlives its voice.stopped") with the clocked fake context. The face-signal acceptance now
  expects "speaking" through the tail and idle when the player goes quiet.

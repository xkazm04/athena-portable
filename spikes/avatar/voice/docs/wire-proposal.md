# Wire proposal: carrying the viseme timeline live (design only)

Status: proposal from WP-L of the avatar spike. Nothing in `src/` or `apps/` was changed. It
covers what the daemon would add so a live avatar can move its mouth on Athena's real voice.

## What exists today (read, not changed)

- `contracts/channel.py`: the voice family is `voice.transcript`, `voice.speaking`
  (`generation`, `text`, `truncated`, `sample_rate`) and `voice.stopped` (`generation`, `reason`).
  An unknown `kind` raises in `event_from_dict`, by design.
- `channels/voice/gateway.py`, the `_speak_loop`: one `voice.speaking` per spoken line (one
  generation), then binary frames of `!I generation` + PCM16 as `backend.synthesize()` yields
  them, then `voice.stopped`. Text and binary frames go out on one socket under one send lock, so
  the client receives them in the order they were sent.
- `channels/voice/kokoro.py`: `synthesize()` splits the line into sentences, runs
  `sherpa-onnx-offline-tts` once per sentence (the next one renders while this one is sent) and
  yields each sentence's PCM in 100 ms chunks. Sentence n+1's samples follow sentence n's with no
  gap.
- `apps/desktop/src/lib/voice.ts` `Player.play()`: every chunk is scheduled at
  `max(context.currentTime, ends[generation])`, so chunks play back to back. **When a chunk arrives
  after the previous one has finished (an underrun), it starts late and every later sample of that
  generation shifts by the gap.** A timeline in "seconds since `voice.speaking`" would drift by
  every underrun. A timeline in *sample offsets of the generation's PCM stream* does not.

## The new event: `voice.visemes`

One event per sentence, sent **before that sentence's first PCM chunk**, in the voice family:

```python
@dataclass(frozen=True)
class VoiceVisemes(ChannelEvent):
    """The mouth shapes of one sentence of ``generation``. ``offset`` is the sample index, in the
    generation's PCM stream, of the sentence's first sample; segment times are in samples relative
    to it, so a client maps them through its own schedule and an underrun cannot drift them."""

    kind: ClassVar[str] = "voice.visemes"
    generation: int = 0
    sentence: int = 0            # 0-based index within the generation
    offset: int = 0              # samples before this sentence in the generation's PCM
    length: int = 0              # samples in this sentence
    sample_rate: int = 24000
    visemes: tuple[tuple[str, int, int], ...] = ()   # (oculus15, start, end) in samples
    version: int = 1
```

- `visemes` uses the same Oculus-15 vocabulary, ordering and coverage rules as Timeline v1
  (`spikes/avatar/CONTRACT.md`): sorted, non-overlapping, covering `0..length`, with gaps as
  `sil`. It is sent as `[v, start, end]` triples to keep it small: about 40 segments for a
  4 s sentence, ~1 KB of JSON. Phonemes are **not** sent live (no consumer needs them; Timeline v1
  keeps them for offline tracks).
- Ordering is guaranteed by the existing send lock: the gateway sends `voice.visemes` and then the
  chunks of the same sentence. A client that never heard of `voice.visemes` must not crash, but
  `event_from_dict` raises on an unknown kind. **This event therefore needs the desktop client
  updated in the same release** (or a client-side "ignore unknown voice.* kinds" rule first).
- The `synthesize()` iterator would yield `bytes | SentenceTiming` (or the backend gets a second
  method, `synthesize_timed()`). The gateway turns a `SentenceTiming` into `voice.visemes` with
  the generation and the running sample offset, which it already knows from the bytes it has sent.
  Piper and other backends simply never yield one, and the avatar falls back to amplitude
  (`Player.level()`), which is what the halo does today.

### Client alignment

The `Player` keeps, per generation, the list of chunks it scheduled as `(sampleStart, at)`, where
`sampleStart` is the running sum of chunk lengths. To draw a frame:

1. `t = context.currentTime`; find the chunk whose `[at, at + len/sr)` contains `t`, and take
   `sample = sampleStart + (t - at) * sr`. Between chunks (during an underrun) hold `sil`.
2. Find the `voice.visemes` whose `[offset, offset + length)` contains `sample`, and look up
   `sample - offset` in its segments.
3. Add `context.outputLatency` (or `baseLatency`) to `t` before step 1, so the mouth matches what
   the speaker emits rather than what was scheduled. A renderer may also *lead* by about 1 frame
   (~16-40 ms): lips visibly form before the sound, and a mouth that lags reads worse than one
   that leads.

`voice.stopped` with `barge_in` drops the generation's timings along with its sources, and the
same `finished()` clean-up applies.

## How the daemon gets the timings: three options, costed

Measured on this machine for the 3.85 s bench sentence "Do you want me to send the reminder to
Northwind now, or wait until Friday?" (CPU onnxruntime, 4 intra-op threads; the exe uses 2):

| Option | What changes | Cost per sentence | Exactness |
|---|---|---|---|
| **A. In-process Kokoro** | Replace the exe with onnxruntime in the daemon; the model has a second output with per-token durations; sherpa's frontend is kept by running the exe with `--debug=1` for token ids, or by porting it | warm full run 1.85 s (vs exe 3.4 s cold, including its ~1 s model load); +330 MB resident | exact (this spike's offline route) |
| **B. Exe + durations subgraph (recommended)** | Keep the exe, add `--debug=1 --tts-silence-scale=1`; parse the token ids from stderr; run a 56 MB *durations-only* subgraph of the same model (extracted with `onnx.utils.Extractor`); apply sherpa's `ScaleSilence(0.2)` in Python with a time map | **+72 ms warm** for the durations (1.1 s one-time load, ~60 MB resident); ScaleSilence over 100k samples is under 50 ms vectorised | exact: the exe's raw length is `sum(durations) * 600` (116400 = 116400 measured), and durations do not depend on the decoder's noise (identical across seeds) |
| C. Forced alignment | Align the WAV against the text with a CTC aligner | ~100-300 ms plus a second model and a second G2P | approximate; a second G2P can disagree with Kokoro's own |

**Recommendation: B.** The audio stays byte-for-byte the app's engine. The extra work is one small
ONNX run per sentence on the thread that already renders the next sentence ahead of playback, so
it never adds to time-to-first-audio beyond those ~70 ms. Two details:

- **The 55 ms lead.** Kokoro's audio runs ~55 ms ahead of its cumulative duration grid (measured:
  `avatar_voice.calibrate`, a score peak at -55 ms over 8 stop-rich sentences, with 7 of 8 between
  -45 and -65 ms). The daemon subtracts it from every boundary before `ScaleSilence` mapping, as
  `avatar_voice/engine.py` does.
- **Viseme mapping** (phone grouping, quiet-boundary to `sil`, short `sil` before PP/FF absorbed,
  40 ms merge with PP/FF protected) is ~200 lines of pure Python, `avatar_voice/visemes.py`, and
  belongs beside `kokoro.py`.

Wire cost: one ~1 KB text frame per sentence, against ~190 KB of PCM for the same sentence.

## Not proposed

- Streaming phonemes or blendshape weights per audio chunk: the sentence is fully known before its
  first chunk leaves, so per-chunk metadata adds frames and saves nothing.
- Shifting the timeline to anticipate articulation in the daemon. The daemon reports the truth,
  and the renderer chooses its own lead.

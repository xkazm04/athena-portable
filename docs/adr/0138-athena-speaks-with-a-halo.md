# 0138. Athena speaks with a halo

Date: 2026-10-23 (spark refilm-prep)

## Context
Kokoro's Heart (ADR 0028) is warm and clear, but it is the same voice every Kokoro app ships. For the refilm the
operator wanted Athena to sound like herself: a light, ethereal quality that stays intelligible and never turns into
an effect. Six designs were rendered over the same test line (`spikes/voice-ether/ether.py`: dry, halo, choir,
shimmer, aura, oracle) and played on an A/B page with letters, not names. The operator picked letter B, `halo`, blind.

Two constraints came with it. Her face (ADR 0120) is worked out from the audio's timeline, so a layer that adds or
removes samples would pull her mouth off her words. And the core is stdlib-only (ADR 0002), while a usable pitch and
formant shift needs numpy.

## Decision
- **The chain** (`athena.channels.voice.ether`, ported from the same author's lich chain, Apache-2.0): one STFT pass
  lifts her half a semitone with formants x1.04; an air shelf and a small presence bell open the top; a short bright
  plate from an impulse with a fixed seed adds a soft room; then a gentle compressor, a match to the dry line's
  loudness, and a look-ahead limiter. The output has exactly as many samples as the input (the plate's tail past the
  last sample is dropped), and the same input always gives the same bytes.
- **Where it runs.** Per sentence on Kokoro's render thread, after her face has been worked out on the dry audio and
  before the sentence is played. The voice preview runs through the same engine, so a preview sounds like her replies.
  About 12 ms per second of audio on a desktop CPU (measured 2026-10-23: 57 ms for 5 s, 118 ms for 10 s).
- **The setting.** `tts.tone` in `ATHENA_HOME/voice/config.json`, `natural` or `halo`, default `halo` (the operator's
  pick). A file written before the tone is `halo`; a `PUT /voice/config` whose `tts` has no `tone` keeps the saved
  one; an unknown tone is refused. `POST /voice/preview` takes an optional `tone`, so a tone is heard before it is
  chosen, and answers `X-Tts-Tone` with the tone actually laid on. The Voice module's settings have a Tone row:
  Natural or Halo, one line on each, and a play button that says a sample line in the chosen tone.
- **The optional extra.** numpy is the `voice-fx` extra, imported only inside `ether`. The desktop's dev fallback runs
  `uv run --extra voice-fx athena serve`, and the frozen sidecar ships numpy (`scripts/build-sidecar.py` refuses to
  build without it).
- **The fallback.** Without numpy, or if the layer fails on a sentence, the sentence plays dry: never a silence, never
  a crash. `GET /voice/config` carries `tone` (what she speaks in now), `tone_available` and `tone_note`, the plain
  line the Voice module shows: "The halo tone needs an add-on that is not installed; she speaks in her natural tone."
  The saved choice is kept, so installing the add-on brings the halo back with no visit to settings.
- **Only Kokoro.** A pinned OpenAI backend (`--voice-backend openai`) streams the provider's audio as it arrives, not
  sentence by sentence, so no tone is laid over it and the view reports `natural` there.

## Consequences
The shipped sidecar grows by numpy (45 MB installed on Windows with its bundled OpenBLAS, measured 2026-10-23; the
one-file binary compresses it, and the sidecar has not been rebuilt to measure that). A machine running the daemon from a plain `uv run athena
serve` without the extra hears her natural voice and is told why. Narration rendered for evidence films applies the
same `ether.apply` itself; `KokoroTTS` built without a choice speaks `natural`, so nothing is layered twice.

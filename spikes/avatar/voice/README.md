# WP-L: voice timeline

Athena's real voice (Kokoro `kokoro-multi-lang-v1_0`, af_heart = sid 3) for every bench line, as
`~/.athena-avatar/voice/<line-id>.wav` (24 kHz mono PCM16) plus `<line-id>.timeline.json`
(CONTRACT Timeline v1), with check images and measurements under `~/.athena-avatar/voice/check/`.

**Status: done.** No portrait is needed for this track (none has landed yet: only
`portraits/_smoke/` exists). All three lines are rendered and pass validation.

## Reproduce

```powershell
$env:UV_PROJECT_ENVIRONMENT = "$HOME\.athena-avatar\venvs\wp-l"   # venv outside the repo
uv run --project spikes/avatar/voice python -m avatar_voice.render  # WAVs, timelines, PNGs, verify
uv run --project spikes/avatar/voice python -m avatar_voice.calibrate  # re-measure the 55 ms lead
uv run --project spikes/avatar/voice python -m avatar_voice.sameness   # ours vs two sherpa runs
```

CPU only (onnxruntime CPU EP); no GPU lock taken. `render` is deterministic: decoder noise is
seeded (`--seed 1`, the default), and two runs give byte-identical WAVs and JSON. `--seed -1`
draws fresh noise like sherpa does. `--only calm,question` renders a subset.

## Route (step 1): (a+), the app's own engine and the same model's own durations

1. **(a) sherpa exposes no timings**, neither through the exe nor through the C++ `GeneratedAudio`.
   But the sherpa model's ONNX graph has a **second output** (`onnx::Shape_3623`): per-token
   durations in 600-sample frames (25 ms). sherpa reads only output 0. And `--debug=1` prints the
   exact token ids that sherpa's frontend (lexicon-us-en + espeak-ng) produced.
2. So: the exe is run with the app's exact argv (`kokoro.py build_args`, plus `--debug=1`) to get
   tokens. The same `model.onnx` then runs in onnxruntime with the same style row
   (`voices.bin[3][len-2]`) and speed 1, which gives audio and durations together. sherpa's only
   post-process, `ScaleSilence(0.2)` (`offline-tts.cc`), is reimplemented with a time map. The line
   is split into sentences by the app's own `split_sentences` (calm is 2 runs, concatenated with no
   gap, as the Player does).
3. **The WAV is ours, not the exe's**, because Kokoro's decoder draws noise (two sherpa runs of
   one sentence differ: 92427 vs 92430 samples, different bytes). Sameness is measured as log-mel
   DTW distance: sherpa A vs sherpa B is **0.919 dB**, sherpa A vs ours **0.916 dB**, sherpa B
   vs ours 0.507 dB. Lengths: sherpa 92426 / 92349, ours 92346. It is the same voice, within
   sherpa's own run-to-run spread.
4. **The lead.** Raw durations put each event ~55 ms late: the silent closure of /p/ fell on the
   vowel before it. `calibrate` scores vowel-loud and stop-quiet spans over shifts from -150 to
   +50 ms on 8 stop-rich sentences. The peak is **-55 ms** (7/8 sentences between -45 and -65).
   kokoro's own `join_timestamps` compensates the same effect with 3 units (75 ms). The grid is
   shifted by 55 ms before the silence map.

(b) kokoro-onnx + misaki was not needed: it would add a second G2P that can disagree with the
engine's. (c) Forced alignment was not needed: it is approximate where (a+) is exact by
construction.

## Phonemes to Oculus-15 visemes (step 2)

| Viseme | Phones (IPA as in the timeline) |
|---|---|
| sil | pauses: space, punctuation and pad tokens whose audio RMS < 0.02; any gap |
| PP | p b m |
| FF | f v |
| TH | θ ð |
| DD | t d ɾ ʔ ʈ ɖ |
| kk | k g ŋ x ç q |
| CH | tʃ dʒ ʃ ʒ |
| SS | s z |
| nn | n l ɫ ɲ |
| RR | ɹ r ɻ ɚ ɝ ɜ |
| aa | ɑ a æ ʌ ɐ |
| E | e ɛ ə (unknown phones also fall back to E) |
| ih | i ɪ ɨ j y |
| oh | o ɔ ɒ |
| ou | u ʊ w ɯ |
| two visemes | eɪ = E+ih, aɪ = aa+ih, oʊ = oh+ou, aʊ = aa+ou, ɔɪ = oh+ih (split 60/40) |
| h | takes the viseme of the next phone (the mouth is already shaped for the vowel) |

Token rules: stress marks `ˈ ˌ` start the next phone; `ː ʰ ʲ` extend the previous one; espeak
digraphs are fused; misaki letters are normalised (`A`=eɪ, `I`=aɪ, `O`=oʊ, `W`=aʊ, `Y`=ɔɪ,
`ʤ`=dʒ, `ʧ`=tʃ, `ᵊ`=ə, `ᵻ`=ɨ). A voiced boundary token (a word space inside connected speech) is
split between its neighbours, not turned into `sil`. A `sil` of 120 ms or less right before PP/FF
joins that viseme, because the lips are closing during a stop's silent closure and an /f/'s quiet
hiss. Then segments shorter than 40 ms merge into a non-closure neighbour (the longer one).
PP/FF are never merged away: they grow to 40 ms by taking time their neighbours can spare.

## Verification (step 3)

**Token check (added after Director review):** `verify` compares, character by character, the
phones the exe's frontend printed (`_work/<line>.tokens.json`, without pads, stress marks,
length marks and boundaries) with the timeline's non-`sil` phonemes. Any dropped or zero-length
phone fails it, and `render` then exits 1. Current result: `tokens_match: true` on calm (65
chars), question (57) and long (138).

All 3 lines: phonemes and visemes cover 0..duration with no gaps or overlaps. The timeline ends at
the audio end (to the sample). No viseme is shorter than 40 ms (min 40.0 ms). Line durations: calm
4.855 s, question 3.848 s, long 10.598 s; 56 / 46 / 127 visemes, 69 / 58 / 140 phoneme segments.

`avatar_voice.verify` (`check/verify.json`), with "best shift" meaning the shift of the whole track
that maximises the contrast (0 means on target):

| Line | PP on p/b: RMS inside/around (dips) | best shift | FF: >3 kHz share gain (rising) | best shift |
|---|---|---|---|---|
| calm | none in text | - | +0.21 (3/4) | +5 ms |
| question | none in text | - | +0.88 (1/1) | +20 ms |
| long | 0.215 (3/3) | -5 ms | +0.29 (6/6) | +5 ms |

Before the 55 ms lead fix, the same check gave FF rising 25 % / 0 % / 17 % with best shifts of
-50 to -60 ms, and p/b did not dip. PP on /m/ is not scored: a nasal murmur is voiced, so an RMS
dip is the wrong test. By eye in `check/long.png`, /m/ in "CRM" sits on the low-amplitude murmur.
Also by eye: the p closures of "polite", "unpaid" and "approve" sit on silence-then-burst, and
FF sits on visible frication in "every", "invoice", "drafted", "for", "four" and "Friday".
**Consonants land on their bursts.**

## Dead ends

- **Bug found in Director review: the /d/ of "Do" was missing from question.timeline.json.** The
  /d/ was in the exe's tokens (`0 46 156 63 ...`, 46 = d) and in the durations (raw samples
  7800-8400), and the audio has it (energy starts at raw 7784). Our time map lost it. The 55 ms
  lead moved the span to 6480-7080, inside the leading pause that ScaleSilence cuts (raw
  1556-7784). The old `map_samples` sent every position inside a cut to the cut point, so the
  span collapsed to zero length and the cover dropped it. Fix: each pause maps *linearly* onto the
  samples of it that ScaleSilence keeps (`engine.map_samples`, piecewise-linear `np.interp`), so
  order is kept and nothing collapses. Replaying the old map against the new token check fails
  question at char 0 (`expected "dujuwɔnt"`, `actual "ujuwɔntm"`); calm and long had dropped
  nothing. Residual: the /d/ is now 5 ms (0.054-0.059 s), because the lead pushes it into the
  compressed pause. It is in the phonemes, but the 40 ms merge folds it into the following `ou`
  viseme (a 5 ms tongue tap is not a visible mouth shape).

- Raw durations as timestamps: about 55 ms late. PP did not dip (median RMS ratio 1.06 on long)
  and FF was not frication (median gain -0.003). Fixed by the measured lead.
- Comparing against sherpa's WAV directly: impossible because of decoder noise (corr -0.005 between
  the unscaled raw and sherpa's output; lengths 116400 vs 92427 until ScaleSilence was found).
- Merging every short segment, PP/FF included: it removed closures (a /p/ is often 25-50 ms).
  Replaced by growing closures.

## Licences

| Component | Licence | commercial_ok |
|---|---|---|
| Kokoro-82M v1.0 weights (sherpa package `kokoro-multi-lang-v1_0`) | Apache-2.0 | true |
| sherpa-onnx (exe, app-installed) | Apache-2.0 | true |
| espeak-ng data/engine (inside sherpa's frontend) | GPL-3.0 | null (it ships in the app already; GPL linking terms for the exe need a legal read, not decided here) |
| misaki-derived lexicon-us-en.txt | Apache-2.0 (misaki), as packaged by k2-fsa | true |
| onnxruntime 1.31.0 | MIT | true |
| onnx 1.23.2 | Apache-2.0 | true |
| numpy 2.5.4 | BSD-3 | true |
| matplotlib 3.11.2 (check images only) | PSF-style matplotlib licence | true |

## Measurements

- Full render of 3 lines (CPU, includes 4 exe runs for tokens and seeded per-run sessions): 25-54 s
  depending on load. The exe for one 3.85 s sentence takes 3.4-4.3 s (RTF ~1.1, 2 threads).
- Warm onnxruntime full Kokoro run: 1.85 s per 3.85 s sentence (4 threads).
- Durations-only subgraph: 56 MB, 2260 of 5039 nodes, 1.08 s load, **72 ms** per sentence warm.
- Wire: about 1 KB of JSON per sentence for visemes, against ~190 KB of PCM.

## Wire proposal (step 4)

`docs/wire-proposal.md`: a new `voice.visemes` event per sentence (generation, sentence, offset,
length, sample_rate, `[v, start, end]` in samples), sent before the sentence's PCM. The client
maps times through its own chunk schedule, so underruns cannot drift the mouth. The recommended
daemon route is the exe with `--tts-silence-scale=1` plus the durations subgraph (+72 ms per
sentence, exact).

## Files

Repo (`spikes/avatar/voice/`): `pyproject.toml`, `uv.lock`, `README.md`, `docs/wire-proposal.md`,
`avatar_voice/{__init__,engine,visemes,render,check,verify,calibrate,sameness}.py`.

`~/.athena-avatar/`: `voice/{calm,question,long}.wav`, `voice/*.timeline.json`,
`voice/check/{calm,question,long}.png`, `voice/check/{verify,calibration,sameness}.json`,
`voice/_work/` (sherpa scratch WAVs, render-report.json), `venvs/wp-l/` (175 MB),
`models/kokoro-durations/durations.onnx` (54 MB, made for the wire costing; not used by render).

## Lessons (proved in this run)

- When a TTS engine hides timings, inspect its ONNX outputs before reaching for an aligner, because
  Kokoro's export already outputs per-token durations that the host simply ignores.
- When you use Kokoro durations as timestamps, shift them ~55 ms earlier (measure it on stops),
  because the decoder's audio leads the cumulative duration grid; unshifted, lip closures land on
  the previous vowel.
- When you must reproduce a host's TTS audio and timing, take its tokens from the host (debug output)
  and replay only the post-processing yourself with a time map, because a second G2P or a forced
  aligner adds disagreement that the same-model route has none of.
- When Kokoro output must be reproducible, seed its two Random*Like ops and rebuild the session per
  run, because ORT advances a seeded generator between runs. Durations need no seed: they are
  independent of the noise.
- When you shift token times and then compress pauses, map pauses linearly instead of snapping to
  the cut, and verify the phone string against the engine's tokens, because a shifted onset phone
  lands inside the cut leading pause and silently vanishes with a snap map.
- When you merge short viseme segments, protect PP/FF (grow them, never fold them), because a
  closure lasts 25-50 ms and is the one shape the eye checks against the audio.
- When you check lip-sync, score closures numerically (RMS dip for p/b, >3 kHz gain for f/v) over a
  shift sweep, because a 50 ms error is invisible on a full-line waveform plot and obvious in the
  sweep's peak.

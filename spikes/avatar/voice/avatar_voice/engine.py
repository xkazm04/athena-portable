"""Kokoro af_heart exactly as the app runs it, plus the durations the app throws away.

Route (WP-L step 1, option "a+"): the app's engine is ``sherpa-onnx-offline-tts`` over
``kokoro-multi-lang-v1_0``. That ONNX graph already has a second output (``onnx::Shape_3623``):
the predicted duration of every input token, in frames of 600 samples (25 ms at 24 kHz). sherpa
reads only output 0. So:

1. **Tokens** come from the app's own engine: the same argv as ``kokoro.py build_args`` plus
   ``--debug=1``, which prints the token ids sherpa's frontend (lexicon + espeak-ng) produced.
   No second G2P, so no G2P disagreement.
2. **Audio + durations** come from running the same ``model.onnx`` with the same style row
   (``voices.bin[sid][len(tokens)-2]``) and speed through onnxruntime, as
   ``offline-tts-kokoro-model.cc`` does.
3. **ScaleSilence(0.2)** - sherpa's only post-process - is reimplemented sample for sample
   (``offline-tts.cc``), with a time map so token times survive the cut.

Kokoro's decoder draws noise (two sherpa runs of one sentence are not byte-identical), so the WAV
cannot be "sherpa's WAV"; it is the same pipeline's output, and the timeline is exact for it.
"""

from __future__ import annotations

import os
import re
import subprocess
from dataclasses import dataclass
from pathlib import Path

import numpy as np

SAMPLE_RATE = 24_000
FRAME = 600  # samples per duration unit
SID_AF_HEART = 3  # kokoro.py VOICES: af_heart is speaker 3 (verified: sherpa --debug speaker2id)
SILENCE_SCALE = 0.2  # sherpa default --tts-silence-scale
#: Kokoro's decoder output runs ahead of its cumulative pred_dur grid. Measured by
#: ``avatar_voice.calibrate`` (8 stop-rich sentences, score peak at -55 ms, 7/8 sentences within
#: -45..-65 ms); kokoro's own join_timestamps compensates the same lead with 3 units (75 ms).
LEAD_S = float(os.environ.get("AVATAR_VOICE_LEAD_S", "0.055"))

KOKORO_DIR = Path(os.environ.get("ATHENA_KOKORO_DIR", Path.home() / ".personas/companion-tts/kokoro"))
SHERPA_EXE = Path(
    os.environ.get(
        "ATHENA_SHERPA_EXE", Path.home() / ".personas/companion-tts/bin/sherpa-onnx-offline-tts.exe"
    )
)


def app_args(output: Path, text: str, *, debug: bool = False) -> list[str]:
    """The argv ``src/athena/channels/voice/kokoro.py build_args`` builds (read, not imported)."""
    k = KOKORO_DIR
    args = [
        str(SHERPA_EXE),
        f"--kokoro-model={k / 'model.onnx'}",
        f"--kokoro-voices={k / 'voices.bin'}",
        f"--kokoro-tokens={k / 'tokens.txt'}",
        f"--kokoro-data-dir={k / 'espeak-ng-data'}",
    ]
    if (k / "lexicon-us-en.txt").is_file():
        args.append(f"--kokoro-lexicon={k / 'lexicon-us-en.txt'}")
    args += ["--num-threads=2", f"--sid={SID_AF_HEART}", f"--output-filename={output}"]
    if debug:
        args.append("--debug=1")
    args.append(f" {text}")  # spoken_entry: one leading space (ASCII text here, no folding needed)
    return args


_TOKEN_LINE = re.compile(r"^0( \d+)+ 0\s*$")


def sherpa_tokens(text: str, scratch: Path) -> tuple[list[list[int]], Path]:
    """Token-id sequences (one per sherpa batch) for ``text``, and sherpa's own WAV of it."""
    scratch.mkdir(parents=True, exist_ok=True)
    out = scratch / "sherpa.wav"
    proc = subprocess.run(
        app_args(out, text, debug=True), capture_output=True, timeout=180, stdin=subprocess.DEVNULL
    )
    log = (proc.stdout + proc.stderr).decode("utf-8", "replace")
    if proc.returncode != 0:
        raise RuntimeError(f"sherpa exited {proc.returncode}: {log[-600:]}")
    seqs = [[int(x) for x in ln.split()] for ln in log.splitlines() if _TOKEN_LINE.match(ln)]
    if not seqs:
        raise RuntimeError("no token line in sherpa --debug output")
    return seqs, out


def load_symbols() -> dict[int, str]:
    table: dict[int, str] = {}
    for line in (KOKORO_DIR / "tokens.txt").read_text(encoding="utf-8").splitlines():
        if not line:
            continue
        sym, _, idx = line.rpartition(" ")
        table[int(idx)] = sym if sym else " "
    return table


@dataclass
class Piece:
    """One sherpa batch after ScaleSilence: audio, and each token's span in output samples."""

    tokens: list[int]
    audio: np.ndarray  # float32, post ScaleSilence
    spans: list[tuple[int, int]]  # per token (incl. both pads), output-sample [start, end)
    raw_len: int


class Kokoro:
    def __init__(self, seed: float | None = None) -> None:
        """``seed``: fix the decoder's two random ops (the sine source's RandomUniformLike and
        RandomNormalLike) so a render is reproducible. The graph is patched in memory only - same
        weights file, one attribute per op. ORT advances a seeded generator from run to run, so
        a seeded engine builds a fresh session for every run."""
        import onnx
        import onnxruntime as ort

        self._ort = ort
        self.seed = seed
        self._so = ort.SessionOptions()
        self._so.intra_op_num_threads = 4
        if seed is None:
            self._bytes: bytes | str = str(KOKORO_DIR / "model.onnx")
        else:
            m = onnx.load(str(KOKORO_DIR / "model.onnx"))
            for node in m.graph.node:
                if node.op_type in ("RandomUniformLike", "RandomNormalLike"):
                    node.attribute.append(onnx.helper.make_attribute("seed", float(seed)))
            self._bytes = m.SerializeToString()
        self.sess = self._session()
        voices = np.fromfile(KOKORO_DIR / "voices.bin", dtype=np.float32)
        self.voices = voices.reshape(-1, 510, 256)  # metadata style_dim=510,1,256; 53 speakers

    def _session(self):
        return self._ort.InferenceSession(self._bytes, self._so, providers=["CPUExecutionProvider"])

    def run(self, tokens: list[int], sid: int = SID_AF_HEART, speed: float = 1.0) -> tuple[np.ndarray, np.ndarray]:
        style = self.voices[sid, len(tokens) - 2][None, :]
        if self.seed is not None:
            self.sess = self._session()
        audio, dur = self.sess.run(
            None,
            {
                "tokens": np.asarray([tokens], dtype=np.int64),
                "style": style.astype(np.float32),
                "speed": np.asarray([speed], dtype=np.float32),
            },
        )
        audio = np.asarray(audio, dtype=np.float32).reshape(-1)
        dur = np.asarray(dur).reshape(-1).astype(np.int64)
        if dur.shape[0] != len(tokens) or int(dur.sum()) * FRAME != audio.shape[0]:
            raise RuntimeError(f"duration output does not tile the audio: {dur.shape} {audio.shape}")
        return audio, dur

    def piece(self, tokens: list[int]) -> Piece:
        audio, dur = self.run(tokens)
        out, keep, segments = scale_silence(audio, SILENCE_SCALE)
        edges = np.concatenate([[0], np.cumsum(dur) * FRAME])
        # move the grid onto the audio (first and last edge stay pinned to 0 and the end)
        edges = np.clip(edges - int(round(LEAD_S * SAMPLE_RATE)), 0, audio.shape[0])
        edges[0], edges[-1] = 0, audio.shape[0]
        mapped = map_samples(edges, segments)
        spans = [(int(mapped[i]), int(mapped[i + 1])) for i in range(len(tokens))]
        return Piece(tokens, out, spans, audio.shape[0])


def scale_silence(
    samples: np.ndarray, scale: float
) -> tuple[np.ndarray, list[tuple[int, int]], list[tuple[int, int, int, int]]]:
    """sherpa ``GeneratedAudio::ScaleSilence`` for scale<=1. Also returns the kept raw ranges and
    the time map as ``(raw_a, raw_b, out_a, out_b)`` segments: speech is 1:1, and a whole pause
    ``[a, b)`` maps linearly onto the ``n`` samples of it that are kept, so a token boundary that
    falls inside a cut pause keeps its order and never collapses to zero length."""
    sr = SAMPLE_RATE
    threshold = int(sr * 0.2)
    n = samples.shape[0]
    quiet = np.abs(samples) <= 0.01
    intervals: list[tuple[int, int]] = []
    last = -1
    # same state machine as the C++ (vectorised over runs of quiet samples)
    i = 0
    while i < n:
        if quiet[i]:
            if last == -1:
                last = i
            i += 1
            continue
        if last != -1 and i - last < threshold:
            last = -1
            i += 1
            continue
        if last != -1:
            intervals.append((last, i))
            last = -1
        i += 1
    if last != -1 and n - last > threshold:
        intervals.append((last, n))
    keep: list[tuple[int, int]] = []
    segments: list[tuple[int, int, int, int]] = []
    pos = 0
    o = 0
    for a, b in intervals:
        keep.append((pos, a))
        segments.append((pos, a, o, o + (a - pos)))
        o += a - pos
        k = int((b - a) * scale)
        keep.append((a, a + k))
        segments.append((a, b, o, o + k))
        o += k
        pos = b
    if pos < n:
        keep.append((pos, n))
        segments.append((pos, n, o, o + (n - pos)))
    keep = [(a, b) for a, b in keep if b > a]
    out = np.concatenate([samples[a:b] for a, b in keep]) if keep else samples[:0]
    return out.astype(np.float32), keep, segments


def map_samples(raw: np.ndarray, segments: list[tuple[int, int, int, int]]) -> np.ndarray:
    """Raw sample positions -> output positions, piecewise linear over ``segments``.

    (A first version sent every position inside a cut pause to the cut point; with the 55 ms lead
    that collapsed the /d/ of "Do" - shifted into the cut leading pause - to zero length.)"""
    xs = [segments[0][0]] + [s[1] for s in segments]
    ys = [segments[0][2]] + [s[3] for s in segments]
    return np.round(np.interp(np.asarray(raw, dtype=np.float64), xs, ys)).astype(np.int64)


def to_pcm16(audio: np.ndarray) -> np.ndarray:
    """wave-writer.cc: clamp<int32_t>(x * 32767) - float->int truncates toward zero."""
    return np.clip(np.trunc(audio * 32767), -32768, 32767).astype(np.int16)

"""voice-io spike: a light ethereal layer over Athena's Kokoro voice, several designs to hear blind.

Overlord gave its lich a post-render effects chain (`tools/voice/shadowrunr_voice/fx.py`, same
author, Apache-2.0); this spike ports its core (STFT pitch/formant pass, generated impulse
reverb, block compressor, look-ahead limiter) and builds lighter, airier chains on it. Every
design keeps the sample count exactly, so her face timeline (worked out on the dry audio)
still holds.

    uv run --with numpy python spikes/voice-ether/ether.py [--out DIR]

Renders a few lines dry with the installed Kokoro (`af_heart`, the same engine and flags the
daemon uses), applies each design, and writes `DIR/<design>/<n>.wav` plus `DIR/index.html`: a
blind page (designs lettered in a fixed shuffle, a reveal button). Nothing here is wired into
the daemon; core stays stdlib-only, so a chosen design ships behind a lazy numpy import in the
voice channel, as overlord's does.
"""

from __future__ import annotations

import argparse
import base64
import functools
import random
import subprocess
import tempfile
import wave
from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path

import numpy as np

from athena.channels.voice.home import resolve_homes
from athena.channels.voice.kokoro import build_args, paths_for

SR = 24_000
N_FFT = 1024
HOP = 256
LIFTER = 40
CEILING = 0.975
SID_HEART = 3

LINES = (
    "I've read your insurer's statements. Two bills ask for more than your plan allows, and "
    "I'd like your okay before I dispute them.",
    "Good morning. Three chores come due this week, and the property tax protest closes on Friday.",
    "Nothing was sent. Every card here waits for your signature.",
    "I'm here. Take your time, and tell me what's on your mind.",
)


# --- spectrum (ported from overlord fx.py) ------------------------------------------------------


@functools.lru_cache(maxsize=2)
def _window(n: int) -> np.ndarray:
    return np.hanning(n + 1)[:-1]


def _stft(x: np.ndarray) -> np.ndarray:
    frames = 1 + (len(x) - N_FFT) // HOP
    idx = np.arange(N_FFT)[None, :] + HOP * np.arange(frames)[:, None]
    return np.fft.rfft(x[idx] * _window(N_FFT), axis=1)


def _istft(spec: np.ndarray, length: int) -> np.ndarray:
    frames = np.fft.irfft(spec, n=N_FFT, axis=1) * _window(N_FFT)
    out = np.zeros(length)
    norm = np.zeros(length)
    w2 = _window(N_FFT) ** 2
    for i, frame in enumerate(frames):
        at = i * HOP
        out[at : at + N_FFT] += frame
        norm[at : at + N_FFT] += w2
    return out / np.maximum(norm, 1e-8)


def _resample_bins(a: np.ndarray, ratio: float) -> np.ndarray:
    bins = a.shape[1]
    src = np.arange(bins) / ratio
    i0 = np.minimum(np.floor(src).astype(np.int64), bins - 1)
    i1 = np.minimum(i0 + 1, bins - 1)
    frac = src - i0
    out = a[:, i0] * (1.0 - frac) + a[:, i1] * frac
    out[:, src > bins - 1] = 0.0
    return out


def shift(x: np.ndarray, semitones: float, formant: float = 1.0) -> np.ndarray:
    """Pitch by ``semitones`` and formants by ``formant``, length kept (one STFT pass)."""
    if semitones == 0 and formant == 1.0:
        return x.copy()
    n = len(x)
    padded = np.concatenate([np.zeros(N_FFT), x, np.zeros(N_FFT + HOP)])
    spec = _stft(padded)
    mag, phase = np.abs(spec), np.angle(spec)
    ceps = np.fft.irfft(np.log(mag + 1e-9), n=N_FFT, axis=1)
    ceps[:, LIFTER : N_FFT - LIFTER + 1] = 0.0
    env = np.exp(np.fft.rfft(ceps, axis=1).real)
    fine = mag / env
    bins = np.arange(mag.shape[1])
    omega = 2.0 * np.pi * HOP * bins / N_FFT
    dphi = np.diff(phase, axis=0, prepend=phase[:1]) - omega
    dphi = (dphi + np.pi) % (2.0 * np.pi) - np.pi
    ratio = 2.0 ** (semitones / 12.0)
    new_mag = _resample_bins(fine, ratio) * _resample_bins(env, formant)
    new_phase = np.cumsum(_resample_bins(omega + dphi, ratio) * ratio, axis=0)
    out = _istft(new_mag * np.exp(1j * new_phase), len(padded))
    return out[N_FFT : N_FFT + n]


def eq(x: np.ndarray, *, highpass: float = 80.0, air_db: float = 0.0, air_hz: float = 8000.0,
       presence_db: float = 0.0, warmth_db: float = 0.0) -> np.ndarray:
    """Zero-phase EQ over the whole line: high-pass, a presence bell, an air shelf, a low shelf."""
    size = 1 << int(np.ceil(np.log2(len(x) + 1)))
    spec = np.fft.rfft(x, size)
    hz = np.fft.rfftfreq(size, 1.0 / SR)
    g = np.where(hz < highpass, (hz / highpass) ** 2, 1.0)
    g = g * 10.0 ** (presence_db * np.exp(-0.5 * ((hz - 3500.0) / 1100.0) ** 2) / 20.0)
    g = g * 10.0 ** (air_db / (1.0 + (air_hz / np.maximum(hz, 1.0)) ** 2) / 20.0)
    g = g * 10.0 ** (warmth_db / (1.0 + (np.maximum(hz, 1.0) / 250.0) ** 2) / 20.0)
    return np.fft.irfft(spec * g, size)[: len(x)]


@functools.lru_cache(maxsize=8)
def hall(rt60: float, bright: float, predelay_ms: float, seed: int) -> np.ndarray:
    """A generated airy room: dense diffuse tail, gentle (``bright`` near 1) or dark darkening."""
    rng = np.random.default_rng(seed)
    length = int(rt60 * SR)
    t = np.arange(length) / SR
    noise = rng.standard_normal(length)
    width = 1 + (t / rt60 * 24 * (1.0 - bright)).astype(np.int64)
    csum = np.concatenate([[0.0], np.cumsum(noise)])
    lo = np.maximum(np.arange(length) - width + 1, 0)
    smooth = (csum[np.arange(length) + 1] - csum[lo]) / (np.arange(length) + 1 - lo)
    tail = smooth * np.sqrt(width) * 10.0 ** (-3.0 * t / rt60)
    tail[: int(predelay_ms * SR / 1000)] = 0.0
    return tail / np.sqrt(np.sum(tail**2))


def convolve(x: np.ndarray, ir: np.ndarray) -> np.ndarray:
    size = 1 << int(np.ceil(np.log2(len(x) + len(ir))))
    return np.fft.irfft(np.fft.rfft(x, size) * np.fft.rfft(ir, size), size)[: len(x)]


def delay(x: np.ndarray, ms: float) -> np.ndarray:
    d = int(ms * SR / 1000)
    return np.concatenate([np.zeros(d), x[: len(x) - d]])


def envelope(x: np.ndarray, ms: float = 12.0) -> np.ndarray:
    w = max(int(ms * SR / 1000), 1)
    return np.sqrt(np.convolve(x**2, np.ones(w) / w, mode="same"))


def compress(x: np.ndarray, threshold_db: float = -20.0, ratio: float = 2.5, makeup_db: float = 3.0,
             block_s: float = 0.005) -> np.ndarray:
    block = max(int(block_s * SR), 1)
    blocks = -(-len(x) // block)
    padded = np.zeros(blocks * block)
    padded[: len(x)] = x
    level = 20.0 * np.log10(np.sqrt(np.mean(padded.reshape(blocks, block) ** 2, axis=1) + 1e-12))
    target = -np.maximum(level - threshold_db, 0.0) * (1.0 - 1.0 / ratio)
    attack, release = np.exp(-block_s / 0.005), np.exp(-block_s / 0.150)
    gain = np.empty(blocks)
    g = 0.0
    for i, want in enumerate(target):
        c = attack if want < g else release
        g = c * g + (1.0 - c) * want
        gain[i] = g
    per = np.interp(np.arange(len(x)), (np.arange(blocks) + 0.5) * block, gain)
    return x * 10.0 ** ((per + makeup_db) / 20.0)


def limit(x: np.ndarray, look_s: float = 0.002) -> np.ndarray:
    look = max(int(look_s * SR), 1)
    need = np.minimum(1.0, CEILING / np.maximum(np.abs(x), 1e-12))
    ahead = np.concatenate([need, np.ones(look - 1)])
    floor = np.lib.stride_tricks.sliding_window_view(ahead, look).min(axis=1)
    lead = np.concatenate([np.full(look - 1, floor[0]), floor])
    csum = np.concatenate([[0.0], np.cumsum(lead)])
    return np.clip(x * (csum[look:] - csum[:-look]) / look, -CEILING, CEILING)


def match_loudness(y: np.ndarray, ref: np.ndarray) -> np.ndarray:
    """Equal RMS to the dry line, so a blind listener judges tone, not volume."""
    return y * (np.sqrt(np.mean(ref**2)) / max(np.sqrt(np.mean(y**2)), 1e-9))


# --- the designs --------------------------------------------------------------------------------


@dataclass(frozen=True)
class Design:
    name: str
    blurb: str
    run: Callable[[np.ndarray], np.ndarray]


def _dry(x: np.ndarray) -> np.ndarray:
    return x.copy()


def _halo(x: np.ndarray) -> np.ndarray:
    """A lifted, open voice in a bright plate: +0.5 st, formants 1.04, air, short shine."""
    y = eq(shift(x, 0.5, 1.04), air_db=3.5, presence_db=1.5)
    y = y + 0.13 * convolve(y, hall(1.3, 0.85, 22, 0xA7E1))
    return limit(compress(y))


def _choir(x: np.ndarray) -> np.ndarray:
    """Herself, doubled faintly: two detuned, delayed copies (+/-12 cents) like a quiet ensemble."""
    up = delay(shift(x, 0.12), 11.0)
    down = delay(shift(x, -0.12), 17.0)
    y = eq(x + 0.26 * up + 0.26 * down, air_db=2.5)
    y = y + 0.10 * convolve(y, hall(1.6, 0.8, 28, 0xC401))
    return limit(compress(y))


def _shimmer(x: np.ndarray) -> np.ndarray:
    """A clean voice whose reverb rings an octave above: the dry line stays plain and close."""
    dry = eq(x, air_db=2.0)
    octave = shift(dry, 12.0, 2.0)
    y = dry + 0.07 * convolve(octave, hall(2.4, 0.9, 40, 0x5111)) + 0.08 * convolve(
        dry, hall(1.5, 0.8, 24, 0x5112)
    )
    return limit(compress(y))


def _aura(x: np.ndarray) -> np.ndarray:
    """A breath around the words: the voice's top band shapes soft noise, in a long airy hall."""
    rng = np.random.default_rng(0xA0A)
    top = eq(x, highpass=5000.0, air_db=4.0)
    breath = eq(rng.standard_normal(len(x)), highpass=5500.0) * envelope(x) * 0.9
    y = eq(x, air_db=3.0) + 0.10 * breath + 0.08 * top
    y = y + 0.10 * convolve(y, hall(2.2, 0.85, 45, 0xA0B))
    return limit(compress(y))


def _oracle(x: np.ndarray) -> np.ndarray:
    """Gravitas and air: a soft sub-octave under her and a whisper an octave over, in a plate."""
    sub = shift(x, -12.0, 1.0)
    over = eq(shift(x, 12.0, 1.0), highpass=3000.0)
    y = eq(x + 0.16 * sub + 0.05 * over, air_db=2.5, warmth_db=1.0)
    y = y + 0.11 * convolve(y, hall(1.6, 0.75, 26, 0x0AC1))
    return limit(compress(y))


DESIGNS = (
    Design("dry", "Kokoro af_heart as she speaks today, untouched.", _dry),
    Design("halo", "Lifted and open: +0.5 st, formants x1.04, air shelf, a short bright plate.", _halo),
    Design("choir", "Faintly doubled: two copies detuned +/-12 cents, 11 and 17 ms late, light hall.", _choir),
    Design("shimmer", "Clean close voice; only the reverb rings an octave above it.", _shimmer),
    Design("aura", "A breath around the words: noise shaped by her top band, long airy hall.", _aura),
    Design("oracle", "A soft sub-octave under her and a whisper above, in a warm plate.", _oracle),
)


# --- rendering ----------------------------------------------------------------------------------


def render_dry(text: str, tmp: Path) -> np.ndarray:
    paths = paths_for(resolve_homes())
    if paths.missing():
        raise SystemExit(f"Kokoro is not installed: {', '.join(paths.missing())}")
    out = tmp / "dry.wav"
    subprocess.run([str(paths.exe), *build_args(paths, SID_HEART, out, text)], check=True,
                   capture_output=True)
    with wave.open(str(out), "rb") as w:
        assert w.getframerate() == SR and w.getsampwidth() == 2 and w.getnchannels() == 1
        return np.frombuffer(w.readframes(w.getnframes()), dtype="<i2") / 32767.0


def write_wav(path: Path, x: np.ndarray) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with wave.open(str(path), "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(SR)
        w.writeframes(np.round(np.clip(x, -1, 1) * 32767).astype("<i2").tobytes())


def page(out: Path, letters: dict[str, Design]) -> None:
    rows = []
    for letter, d in letters.items():
        clips = "".join(
            f'<audio controls preload="none" src="data:audio/wav;base64,'
            f'{base64.b64encode((out / d.name / f"{i + 1}.wav").read_bytes()).decode()}"></audio>'
            for i in range(len(LINES))
        )
        rows.append(f'<section><h2>{letter} <span class="who">{d.name}: {d.blurb}</span></h2>{clips}</section>')
    lines = "".join(f"<li>{t}</li>" for t in LINES)
    (out / "index.html").write_text(f"""<!doctype html><meta charset="utf-8"><title>Athena voice ether</title>
<style>body{{font:15px system-ui;background:#0b1418;color:#dfe9ec;max-width:980px;margin:24px auto;padding:0 16px}}
section{{border:1px solid #234;border-radius:10px;padding:12px;margin:12px 0}}audio{{width:230px;margin:4px}}
.who{{display:none;font-weight:400;color:#8fb}}body.reveal .who{{display:inline}}button{{padding:6px 12px}}</style>
<h1>Athena: a light ethereal layer, blind</h1><p>Four lines, six versions lettered in a fixed shuffle,
equal loudness. Listen, pick a favourite, then reveal.</p><ol>{lines}</ol>
<button onclick="document.body.classList.toggle('reveal')">Reveal names</button>{''.join(rows)}""",
                                encoding="utf-8")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--out", type=Path, default=Path("proving-runs/voice-ether"))
    args = parser.parse_args()
    out = args.out.resolve()
    with tempfile.TemporaryDirectory() as tmp:
        for i, text in enumerate(LINES):
            dry = render_dry(text, Path(tmp))
            for d in DESIGNS:
                y = match_loudness(d.run(dry), dry)
                y = limit(y)
                assert len(y) == len(dry), d.name  # the face timeline holds
                write_wav(out / d.name / f"{i + 1}.wav", y)
            print(f"line {i + 1}: {len(dry) / SR:.1f} s, {len(DESIGNS)} designs")
    order = list(DESIGNS)
    random.Random(0xE7E7).shuffle(order)
    page(out, {chr(65 + i): d for i, d in enumerate(order)})
    print(f"open {out / 'index.html'}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

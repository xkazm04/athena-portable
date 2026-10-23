"""voice-io / ADR 0138 (Athena's tone): a light ethereal layer over her rendered voice.

``halo`` was picked blind on 2026-10-23 from six designs (`spikes/voice-ether/ether.py`: dry,
halo, choir, shimmer, aura, oracle). It lifts her half a semitone with formants x1.04 in one
STFT pass, opens the top with an air shelf and a small presence bell, adds a short bright plate
from an impulse generated from a fixed seed, then a gentle compressor and a look-ahead limiter.
The core is ported from overlord's lich chain (`tools/voice/shadowrunr_voice/fx.py`, same author,
Apache-2.0).

**The length is kept exactly.** Her face motion is worked out on the dry audio, so the wet audio
has as many samples as the dry; the plate's tail past a sentence's last sample is dropped. The
same input always gives the same bytes.

**numpy is optional and lazy** (AGENTS.md: core is stdlib-only; an optional dependency is imported
inside the package that needs it, behind an error naming the extra). Without it, :func:`apply`
raises :class:`EtherUnavailable` naming the ``voice-fx`` extra; the caller decides what to say.
"""

from __future__ import annotations

import functools
from typing import Any

__all__ = ["EXTRA", "TONES", "TONE_DEFAULT", "EtherUnavailable", "apply", "available"]

#: The tones a person can choose; ``natural`` is Kokoro as rendered, untouched.
TONES = ("natural", "halo")
TONE_DEFAULT = "halo"
#: The pyproject extra that brings numpy.
EXTRA = "voice-fx"

_N_FFT = 1024
_HOP = 256
_LIFTER = 40
_CEILING = 0.975
_IR_SEED = 0xA7E1


class EtherUnavailable(RuntimeError):
    """The tone needs numpy, and it is not installed."""


def _np() -> Any:
    try:
        import numpy
    except ImportError as exc:  # pragma: no cover - depends on the environment
        raise EtherUnavailable(
            f"the halo tone needs numpy, which is not installed (install the '{EXTRA}' extra)"
        ) from exc
    return numpy


def available() -> bool:
    """Whether the layer can run here (numpy importable)."""
    try:
        _np()
    except EtherUnavailable:
        return False
    return True


def apply(pcm: bytes, sample_rate: int, tone: str = TONE_DEFAULT) -> bytes:
    """PCM16LE mono in, PCM16LE out, the same number of samples. ``natural`` returns ``pcm``.

    Raises :class:`EtherUnavailable` without numpy and :class:`ValueError` for an unknown tone."""
    if tone == "natural" or len(pcm) < 2:
        return pcm
    if tone != "halo":
        raise ValueError(f"unknown tone {tone!r}; one of {', '.join(TONES)}")
    np = _np()
    x = np.frombuffer(pcm[: len(pcm) - len(pcm) % 2], dtype="<i2").astype(np.float64) / 32767.0
    y = _halo(np, x, sample_rate)
    return bytes(np.round(y * 32767.0).astype("<i2").tobytes())


# --- the chain ---------------------------------------------------------------------------------


def _halo(np: Any, x: Any, sr: int) -> Any:
    dry_rms = float(np.sqrt(np.mean(x**2)))
    y = _shift(np, x, 0.5, 1.04)
    y = _eq(np, y, sr, air_db=3.5, presence_db=1.5)
    y = y + 0.13 * _convolve(np, y, _plate(sr))
    y = _compress(np, y, sr)
    wet_rms = float(np.sqrt(np.mean(y**2)))
    if wet_rms > 1e-9:
        y = y * (dry_rms / wet_rms)  # as loud as the dry line: a tone, not a volume change
    return _limit(np, y, sr)


@functools.lru_cache(maxsize=2)
def _window(n: int) -> Any:
    np = _np()
    return np.hanning(n + 1)[:-1]


def _shift(np: Any, x: Any, semitones: float, formant: float) -> Any:
    n = len(x)
    if n == 0:
        return x.copy()
    padded = np.concatenate([np.zeros(_N_FFT), x, np.zeros(_N_FFT + _HOP)])
    frames = 1 + (len(padded) - _N_FFT) // _HOP
    idx = np.arange(_N_FFT)[None, :] + _HOP * np.arange(frames)[:, None]
    win = _window(_N_FFT)
    spec = np.fft.rfft(padded[idx] * win, axis=1)
    mag, phase = np.abs(spec), np.angle(spec)
    ceps = np.fft.irfft(np.log(mag + 1e-9), n=_N_FFT, axis=1)
    ceps[:, _LIFTER : _N_FFT - _LIFTER + 1] = 0.0
    env = np.exp(np.fft.rfft(ceps, axis=1).real)
    fine = mag / env
    bins = np.arange(mag.shape[1])
    omega = 2.0 * np.pi * _HOP * bins / _N_FFT
    dphi = np.diff(phase, axis=0, prepend=phase[:1]) - omega
    dphi = (dphi + np.pi) % (2.0 * np.pi) - np.pi
    ratio = 2.0 ** (semitones / 12.0)
    new_mag = _resample_bins(np, fine, ratio) * _resample_bins(np, env, formant)
    new_phase = np.cumsum(_resample_bins(np, omega + dphi, ratio) * ratio, axis=0)
    out_frames = np.fft.irfft(new_mag * np.exp(1j * new_phase), n=_N_FFT, axis=1) * win
    out = np.zeros(len(padded))
    norm = np.zeros(len(padded))
    w2 = win**2
    for i, frame in enumerate(out_frames):
        at = i * _HOP
        out[at : at + _N_FFT] += frame
        norm[at : at + _N_FFT] += w2
    out = out / np.maximum(norm, 1e-8)
    return out[_N_FFT : _N_FFT + n]


def _resample_bins(np: Any, a: Any, ratio: float) -> Any:
    bins = a.shape[1]
    src = np.arange(bins) / ratio
    i0 = np.minimum(np.floor(src).astype(np.int64), bins - 1)
    i1 = np.minimum(i0 + 1, bins - 1)
    frac = src - i0
    out = a[:, i0] * (1.0 - frac) + a[:, i1] * frac
    out[:, src > bins - 1] = 0.0
    return out


def _eq(np: Any, x: Any, sr: int, *, air_db: float, presence_db: float) -> Any:
    size = 1 << int(np.ceil(np.log2(len(x) + 1)))
    spec = np.fft.rfft(x, size)
    hz = np.fft.rfftfreq(size, 1.0 / sr)
    g = np.where(hz < 80.0, (hz / 80.0) ** 2, 1.0)
    g = g * 10.0 ** (presence_db * np.exp(-0.5 * ((hz - 3500.0) / 1100.0) ** 2) / 20.0)
    g = g * 10.0 ** (air_db / (1.0 + (8000.0 / np.maximum(hz, 1.0)) ** 2) / 20.0)
    return np.fft.irfft(spec * g, size)[: len(x)]


@functools.lru_cache(maxsize=4)
def _plate(sr: int, rt60: float = 1.3, bright: float = 0.85, predelay_ms: float = 22.0) -> Any:
    np = _np()
    rng = np.random.default_rng(_IR_SEED)
    length = int(rt60 * sr)
    t = np.arange(length) / sr
    noise = rng.standard_normal(length)
    width = 1 + (t / rt60 * 24 * (1.0 - bright)).astype(np.int64)
    csum = np.concatenate([[0.0], np.cumsum(noise)])
    lo = np.maximum(np.arange(length) - width + 1, 0)
    smooth = (csum[np.arange(length) + 1] - csum[lo]) / (np.arange(length) + 1 - lo)
    tail = smooth * np.sqrt(width) * 10.0 ** (-3.0 * t / rt60)
    tail[: int(predelay_ms * sr / 1000)] = 0.0
    return tail / np.sqrt(np.sum(tail**2))


def _convolve(np: Any, x: Any, ir: Any) -> Any:
    size = 1 << int(np.ceil(np.log2(len(x) + len(ir))))
    return np.fft.irfft(np.fft.rfft(x, size) * np.fft.rfft(ir, size), size)[: len(x)]


def _compress(np: Any, x: Any, sr: int, threshold_db: float = -20.0, ratio: float = 2.5) -> Any:
    block_s = 0.005
    block = max(int(block_s * sr), 1)
    blocks = -(-len(x) // block)
    padded = np.zeros(blocks * block)
    padded[: len(x)] = x
    rms = np.sqrt(np.mean(padded.reshape(blocks, block) ** 2, axis=1) + 1e-12)
    target = -np.maximum(20.0 * np.log10(rms) - threshold_db, 0.0) * (1.0 - 1.0 / ratio)
    attack, release = np.exp(-block_s / 0.005), np.exp(-block_s / 0.150)
    gain = np.empty(blocks)
    g = 0.0
    for i, want in enumerate(target):
        c = attack if want < g else release
        g = c * g + (1.0 - c) * want
        gain[i] = g
    per = np.interp(np.arange(len(x)), (np.arange(blocks) + 0.5) * block, gain)
    return x * 10.0 ** ((per + 3.0) / 20.0)


def _limit(np: Any, x: Any, sr: int) -> Any:
    look = max(int(0.002 * sr), 1)
    need = np.minimum(1.0, _CEILING / np.maximum(np.abs(x), 1e-12))
    ahead = np.concatenate([need, np.ones(look - 1)])
    floor = np.lib.stride_tricks.sliding_window_view(ahead, look).min(axis=1)
    lead = np.concatenate([np.full(look - 1, floor[0]), floor])
    csum = np.concatenate([[0.0], np.cumsum(lead)])
    return np.clip(x * (csum[look:] - csum[:-look]) / look, -_CEILING, _CEILING)

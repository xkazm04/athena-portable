"""voice-io / ADR 0120 (Athena has a face): a sentence's mouth shapes from Kokoro's own durations.

Ported from the spike's WP-L voice track (``avatar_voice/{engine,visemes}.py``), which measured
every rule here against the audio. Runs in the face helper's interpreter (numpy, onnxruntime).

**Times.** Kokoro's graph predicts how many 600-sample frames each input token lasts; a 56 MB
subgraph that computes only that runs in about 70 ms warm. Each batch's token edges are moved
:data:`LEAD_S` earlier (the decoder's audio leads its own duration grid, measured at -55 ms on
stops), clipped to the batch, laid end to end, then mapped through the daemon's ``ScaleSilence``
time map onto the audio actually played.

**Shapes.** Stress marks start the phone after them, length marks extend the one before, espeak
digraphs fuse, and a boundary token (space, punctuation, pad) is ``sil`` where the audio over it is
quiet and is otherwise split between its neighbours. Phones map to the Oculus 15; a short quiet gap
before PP or FF joins it (the lips close during a stop's silent closure), and segments under 40 ms
merge into a neighbour - except PP and FF, which grow, because a closure is the one shape the eye
checks against the sound.
"""

# ruff: noqa: RUF001 - the IPA letters are the data: Kokoro's token symbols, compared as they are.
from __future__ import annotations

from pathlib import Path
from typing import Any

FRAME = 600  # samples per duration unit at 24 kHz
LEAD_S = 0.055
STYLE_ROWS = 510
STYLE_DIM = 256
DURATIONS_OUTPUT = "onnx::Shape_3623"

STRESS = {"ˈ", "ˌ"}
POSTMOD = {"ː", "ʰ", "ʲ", "̃", "ʼ"}
BOUNDARY = {
    " ", ";", ":", ",", ".", "!", "?", "—", "…", '"', "(", ")", "“", "”",
    "↓", "→", "↗", "↘", "$PAD",
}  # fmt: skip
DIGRAPHS = {("a", "ɪ"), ("a", "ʊ"), ("e", "ɪ"), ("o", "ʊ"), ("ɔ", "ɪ"), ("t", "ʃ"), ("d", "ʒ")}
#: misaki's single-letter diphthongs and affricates, as IPA.
IPA = {
    "A": "eɪ", "I": "aɪ", "O": "oʊ", "W": "aʊ", "Y": "ɔɪ", "ʤ": "dʒ", "ʧ": "tʃ", "ᵊ": "ə",
    "ᵻ": "ɨ", "ɡ": "g",
}  # fmt: skip
_SINGLE = {
    "PP": "p b m", "FF": "f v", "TH": "θ ð", "DD": "t d ɾ ʔ ʈ ɖ", "kk": "k g ŋ x ç q",
    "CH": "tʃ dʒ ʃ ʒ", "SS": "s z", "nn": "n l ɫ ɲ", "RR": "ɹ r ɻ ɚ ɝ ɜ", "aa": "ɑ a æ ʌ ɐ",
    "E": "e ɛ ə", "ih": "i ɪ ɨ j y", "oh": "o ɔ ɒ", "ou": "u ʊ w ɯ",
}  # fmt: skip
VISEME: dict[str, tuple[str, ...]] = {
    phone: (viseme,) for viseme, phones in _SINGLE.items() for phone in phones.split()
}
VISEME.update(
    {
        "eɪ": ("E", "ih"),
        "aɪ": ("aa", "ih"),
        "oʊ": ("oh", "ou"),
        "aʊ": ("aa", "ou"),
        "ɔɪ": ("oh", "ih"),
    }
)
DIPHTHONG_SPLIT = 0.6
PRIORITY = {"PP", "FF"}
MIN_SEG_S = 0.04
QUIET_RMS = 0.02
PRE_CLOSURE_MAX_S = 0.12

Seg = dict[str, Any]


class Durations:
    """The durations-only subgraph of Kokoro's model, warm, and the voices' style rows."""

    def __init__(self, model: Path, voices: Path) -> None:
        import numpy as np
        import onnxruntime as ort

        options = ort.SessionOptions()
        options.intra_op_num_threads = 2
        self._np = np
        self.session = ort.InferenceSession(str(model), options, providers=["CPUExecutionProvider"])
        self.voices = np.fromfile(voices, dtype=np.float32).reshape(-1, STYLE_ROWS, STYLE_DIM)

    def frames(self, tokens: list[int], sid: int) -> list[int]:
        """Each token's length in 600-sample frames, as the engine's own run of it had."""
        np = self._np
        row = min(max(len(tokens) - 2, 0), STYLE_ROWS - 1)
        style = self.voices[sid, row][None, :].astype(np.float32)
        (dur,) = self.session.run(
            [DURATIONS_OUTPUT],
            {
                "tokens": np.asarray([tokens], dtype=np.int64),
                "style": style,
                "speed": np.asarray([1.0], dtype=np.float32),
            },
        )
        return [int(d) for d in np.asarray(dur).reshape(-1)]


def extract_durations(model: Path, out: Path) -> None:
    """Cut the durations subgraph out of Kokoro's model (about 15 s, once per model file)."""
    import onnx
    import onnx.utils

    sub = onnx.utils.Extractor(onnx.load(str(model))).extract_model(
        ["tokens", "style", "speed"], [DURATIONS_OUTPUT]
    )
    tmp = out.with_suffix(".tmp")
    onnx.save(sub, str(tmp))
    tmp.replace(out)


def load_symbols(tokens_txt: Path) -> dict[int, str]:
    table: dict[int, str] = {}
    for line in tokens_txt.read_text(encoding="utf-8").splitlines():
        if not line:
            continue
        sym, _, idx = line.rpartition(" ")
        table[int(idx)] = sym if sym else " "
    return table


def token_spans(
    batches: list[list[int]],
    frames: list[list[int]],
    raw_samples: int,
    time_map: list[list[int]],
    sample_rate: int,
) -> list[tuple[int, int]]:
    """Every token's ``[start, end)`` in played samples, the batches laid end to end."""
    import numpy as np

    lead = round(LEAD_S * sample_rate)
    edges_all: list[int] = []
    spans_idx: list[tuple[int, int]] = []
    base = 0
    for seq, dur in zip(batches, frames, strict=True):
        if len(dur) != len(seq):
            raise ValueError("the durations do not match the tokens")
        length = sum(dur) * FRAME
        edges = [0]
        for d in dur:
            edges.append(edges[-1] + d * FRAME)
        edges = [min(max(e - lead, 0), length) for e in edges]
        edges[0], edges[-1] = 0, length
        first = len(edges_all)
        edges_all += [base + e for e in edges]
        spans_idx += [(first + i, first + i + 1) for i in range(len(seq))]
        base += length
    if base != raw_samples:
        raise ValueError(f"the durations cover {base} samples, the audio {raw_samples}")
    xs = [time_map[0][0]] + [seg[1] for seg in time_map]
    ys = [time_map[0][2]] + [seg[3] for seg in time_map]
    mapped = np.round(np.interp(np.asarray(edges_all, dtype=np.float64), xs, ys)).astype(np.int64)
    return [(int(mapped[a]), int(mapped[b])) for a, b in spans_idx]


def phones(symbols: list[str], spans: list[tuple[int, int]], audio: Any) -> list[Seg]:
    """Phone segments in samples: ``{"p", "a", "b", "kind"}``, boundaries resolved."""
    import numpy as np

    units: list[Seg] = []
    pending_start: int | None = None
    i = 0
    while i < len(symbols):
        s, (a, b) = symbols[i], spans[i]
        if s in STRESS:
            pending_start = a if pending_start is None else pending_start
            i += 1
            continue
        if s in POSTMOD and units and units[-1]["kind"] == "ph":
            units[-1]["b"] = b
            i += 1
            continue
        if s in BOUNDARY:
            units.append({"p": s, "a": a, "b": b, "kind": "bd"})
            i += 1
            continue
        if i + 1 < len(symbols) and (s, symbols[i + 1]) in DIGRAPHS:
            s, b = s + symbols[i + 1], spans[i + 1][1]
            i += 1
        start = pending_start if pending_start is not None else a
        pending_start = None
        units.append({"p": IPA.get(s, s), "a": start, "b": b, "kind": "ph"})
        i += 1
    out: list[Seg] = []
    for k, u in enumerate(units):
        if u["kind"] == "ph":
            out.append(dict(u))
            continue
        if u["b"] <= u["a"]:
            continue
        seg = audio[u["a"] : u["b"]]
        rms = float(np.sqrt(np.mean(seg.astype(np.float64) ** 2))) if seg.size else 0.0
        prev_ph = out[-1] if out and out[-1]["kind"] == "ph" else None
        nxt = next((w for w in units[k + 1 :] if w["kind"] == "ph"), None)
        nxt_adjacent = k + 1 < len(units) and units[k + 1]["kind"] == "ph"
        if (
            rms < QUIET_RMS
            or (prev_ph is None and not nxt_adjacent)
            or (nxt is None and prev_ph is None)
        ):
            out.append({"p": "sil", "a": u["a"], "b": u["b"], "kind": "sil"})
        elif prev_ph is not None and nxt_adjacent:
            mid = (u["a"] + u["b"]) // 2
            prev_ph["b"] = mid
            units[k + 1]["a"] = mid
        elif prev_ph is not None:
            prev_ph["b"] = u["b"]
        else:
            units[k + 1]["a"] = u["a"]
    merged: list[Seg] = []
    for u in out:
        if merged and u["kind"] == "sil" and merged[-1]["kind"] == "sil":
            merged[-1]["b"] = u["b"]
        else:
            merged.append(u)
    return merged


def cover(segs: list[Seg], n: int) -> list[Seg]:
    """Phones laid over ``0..n`` with no gap and no overlap; any gap is ``sil``."""
    out: list[Seg] = []
    t = 0
    for u in segs:
        a, b = max(u["a"], t), min(u["b"], n)
        if b <= a:
            continue
        if a > t:
            out.append({"p": "sil", "a": t, "b": a})
        out.append({"p": u["p"], "a": a, "b": b})
        t = b
    if t < n:
        out.append({"p": "sil", "a": t, "b": n})
    return out


def visemes_of(ph: list[Seg]) -> list[Seg]:
    """Phones to raw viseme segments; ``h`` borrows its next vowel's shape."""
    segs: list[Seg] = []
    for k, u in enumerate(ph):
        p = u["p"]
        if p == "sil":
            segs.append({"v": "sil", "a": u["a"], "b": u["b"]})
            continue
        if p == "h":
            nxt = next((w["p"] for w in ph[k + 1 :] if w["p"] in VISEME), None)
            vs = VISEME.get(nxt, ("E",))[:1] if nxt else ("E",)
        else:
            vs = VISEME.get(p, ("E",))
        if len(vs) == 1:
            segs.append({"v": vs[0], "a": u["a"], "b": u["b"]})
        else:
            cut = u["a"] + int((u["b"] - u["a"]) * DIPHTHONG_SPLIT)
            segs.append({"v": vs[0], "a": u["a"], "b": cut})
            segs.append({"v": vs[1], "a": cut, "b": u["b"]})
    return segs


def _coalesce(segs: list[Seg]) -> list[Seg]:
    out: list[Seg] = []
    for s in segs:
        if s["b"] <= s["a"]:
            continue
        if out and out[-1]["v"] == s["v"]:
            out[-1]["b"] = s["b"]
            out[-1].pop("keep", None)
        else:
            out.append(dict(s))
    return out


def absorb_pre_closure(segs: list[Seg], sr: int, max_s: float = PRE_CLOSURE_MAX_S) -> list[Seg]:
    max_n = round(max_s * sr)
    segs = [dict(s) for s in segs]
    for i in range(1, len(segs) - 1):
        s, nxt = segs[i], segs[i + 1]
        if s["v"] == "sil" and nxt["v"] in PRIORITY and s["b"] - s["a"] <= max_n:
            nxt["a"] = s["a"]
            s["b"] = s["a"]
    return _coalesce(segs)


def merge_short(segs: list[Seg], sr: int, min_s: float = MIN_SEG_S) -> list[Seg]:
    """No segment under ``min_s``: short ones fold into a neighbour, PP/FF grow instead."""
    min_n = round(min_s * sr)
    segs = _coalesce(segs)
    for _ in range(1000):
        short = [i for i, s in enumerate(segs) if s["b"] - s["a"] < min_n and not s.get("keep")]
        if not short:
            break
        i = min(short, key=lambda j: (segs[j]["b"] - segs[j]["a"], segs[j]["v"] in PRIORITY))
        s = segs[i]
        left = segs[i - 1] if i > 0 else None
        right = segs[i + 1] if i + 1 < len(segs) else None
        need = min_n - (s["b"] - s["a"])
        if s["v"] in PRIORITY:
            spare_l = (
                max(0, left["b"] - left["a"] - min_n) if left and left["v"] not in PRIORITY else 0
            )
            spare_r = (
                max(0, right["b"] - right["a"] - min_n)
                if right and right["v"] not in PRIORITY
                else 0
            )
            take_l = min(spare_l, need // 2 if spare_r > 0 else need)
            take_r = min(spare_r, need - take_l)
            take_l = min(spare_l, need - take_r)
            if left is not None and take_l:
                left["b"] -= take_l
                s["a"] -= take_l
            if right is not None and take_r:
                right["a"] += take_r
                s["b"] += take_r
            if take_l + take_r < need:
                s["keep"] = True
            continue
        if left and right:
            pick_l = (left["v"] not in PRIORITY, left["b"] - left["a"]) >= (
                right["v"] not in PRIORITY,
                right["b"] - right["a"],
            )
        else:
            pick_l = left is not None
        if pick_l and left:
            left["b"] = s["b"]
        elif right:
            right["a"] = s["a"]
        else:
            break
        segs.pop(i)
        segs = _coalesce(segs)
    return segs


def sentence_visemes(
    durations: Durations,
    symbols: dict[int, str],
    *,
    batches: list[list[int]],
    raw_samples: int,
    time_map: list[list[int]],
    pcm: bytes,
    sample_rate: int,
    sid: int,
) -> list[list[Any]]:
    """The sentence's ``[[v, start, end], ...]`` in samples of the played audio."""
    import numpy as np

    audio = np.frombuffer(pcm, dtype="<i2").astype(np.float32) / 32767.0
    frames = [durations.frames(seq, sid) for seq in batches]
    spans = token_spans(batches, frames, raw_samples, time_map, sample_rate)
    syms = [symbols.get(t, "?") if t != 0 else "$PAD" for seq in batches for t in seq]
    laid = cover(phones(syms, spans, audio), int(audio.shape[0]))
    vis = merge_short(absorb_pre_closure(visemes_of(laid), sample_rate), sample_rate)
    return [[s["v"], int(s["a"]), int(s["b"])] for s in vis]

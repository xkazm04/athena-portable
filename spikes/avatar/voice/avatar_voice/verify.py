"""Do lip closures land on their bursts? A number, not an eyeball.

For every PP segment (p b m: the lips are closed, so the signal is a stop gap or a low nasal
murmur) the RMS inside the segment should dip below the RMS of the 60 ms on either side. For
every FF segment (f v: labiodental frication) the share of energy above 3 kHz should rise above
its neighbours'. Then the whole viseme track is shifted by -80..+80 ms and the shift that makes
those contrasts strongest is reported: ~0 ms means the timeline sits on the audio; a large shift
is a systematic lag to correct.

    uv run --project spikes/avatar/voice python -m avatar_voice.verify
"""

from __future__ import annotations

import json
import wave
from pathlib import Path

import numpy as np

from avatar_voice import engine
from avatar_voice.render import OUT
from avatar_voice.visemes import BOUNDARY, IPA, POSTMOD, STRESS

CTX = 0.06


def _load(line_id: str) -> tuple[np.ndarray, dict]:
    with wave.open(str(OUT / f"{line_id}.wav"), "rb") as w:
        x = np.frombuffer(w.readframes(w.getnframes()), dtype=np.int16).astype(np.float64) / 32768
    tl = json.loads((OUT / f"{line_id}.timeline.json").read_text(encoding="utf-8"))
    return x, tl


def _rms(x: np.ndarray) -> float:
    return float(np.sqrt(np.mean(x**2))) if x.size else 0.0


def _hf_share(x: np.ndarray, sr: int) -> float:
    if x.size < 64:
        return 0.0
    spec = np.abs(np.fft.rfft(x * np.hanning(x.size))) ** 2
    f = np.fft.rfftfreq(x.size, 1 / sr)
    tot = spec.sum()
    return float(spec[f > 3000].sum() / tot) if tot > 0 else 0.0


def token_check(line_id: str, tl: dict) -> dict:
    """Every phone the exe's frontend emitted must be in the timeline, in order.

    Expected: the exe's printed token ids (``_work/<line>.tokens.json``, all sentences), as
    symbols, without pads, stress marks, length/modifier marks and boundaries, misaki letters
    written as IPA. Actual: the timeline's non-``sil`` phoneme labels, concatenated. Compared
    character by character, independently of the grouping code, so a dropped or collapsed token
    fails."""
    sym = engine.load_symbols()
    seqs = json.loads((OUT / "_work" / f"{line_id}.tokens.json").read_text(encoding="utf-8"))
    expected = ""
    for sentence in seqs:
        for seq in sentence:
            for t in seq:
                s = sym.get(t, "?") if t != 0 else "$PAD"
                if s in STRESS or s in POSTMOD or s in BOUNDARY:
                    continue
                expected += IPA.get(s, s)
    actual = "".join(p["p"] for p in tl["phonemes"] if p["p"] != "sil")
    ok = expected == actual
    res: dict = {"tokens_match": ok, "phones_chars": len(actual)}
    if not ok:
        i = next((k for k, (a, b) in enumerate(zip(expected, actual)) if a != b), min(len(expected), len(actual)))
        res["first_mismatch"] = {"at": i, "expected": expected[max(0, i - 8) : i + 8], "actual": actual[max(0, i - 8) : i + 8]}
    zero = [p["p"] for p in tl["phonemes"] if p["end"] <= p["start"]]
    if zero:
        res["zero_length"] = zero
        res["tokens_match"] = False
    return res


def contrasts(x: np.ndarray, tl: dict, shift: float = 0.0) -> dict:
    sr = tl["sample_rate"]
    pp, ff, kinds = [], [], []
    for s in tl["visemes"]:
        if s["v"] not in ("PP", "FF"):
            continue
        a, b = s["start"] + shift, s["end"] + shift
        ia, ib = int(a * sr), int(b * sr)
        la, rb = int((a - CTX) * sr), int((b + CTX) * sr)
        if la < 0 or rb > len(x) or ib <= ia:
            continue
        inner = x[ia:ib]
        ctx = np.concatenate([x[la:ia], x[ib:rb]])
        if s["v"] == "PP":
            mid = (s["start"] + s["end"]) / 2
            ph = next((p["p"] for p in tl["phonemes"] if p["start"] <= mid < p["end"]), "?")
            kinds.append("m" if ph == "m" else "pb")
            pp.append(_rms(inner) / max(_rms(ctx), 1e-6))
        else:
            ff.append(_hf_share(inner, sr) - _hf_share(ctx, sr))
    return {"pp_rms_ratio": pp, "pp_kind": kinds, "ff_hf_gain": ff}


def main() -> int:
    out = {}
    for line_id in ("calm", "question", "long"):
        x, tl = _load(line_id)
        c0 = contrasts(x, tl)
        best = None
        for ms in range(-80, 81, 5):
            c = contrasts(x, tl, ms / 1000)
            stops = [r for r, k in zip(c["pp_rms_ratio"], c["pp_kind"]) if k == "pb"]
            score = -np.mean(np.log(stops)) if stops else 0.0
            if best is None or score > best[1]:
                best = (ms, score)
        best_ff = None
        for ms in range(-80, 81, 5):
            c = contrasts(x, tl, ms / 1000)
            score = float(np.mean(c["ff_hf_gain"])) if c["ff_hf_gain"] else 0.0
            if best_ff is None or score > best_ff[1]:
                best_ff = (ms, score)
        pp = np.array([r for r, k in zip(c0["pp_rms_ratio"], c0["pp_kind"]) if k == "pb"])
        mm = np.array([r for r, k in zip(c0["pp_rms_ratio"], c0["pp_kind"]) if k == "m"])
        ff = np.array(c0["ff_hf_gain"])
        out[line_id] = {
            **token_check(line_id, tl),
            "PP_m_n": int(mm.size),
            **({"PP_m_rms_ratio_median": round(float(np.median(mm)), 3)} if mm.size else {}),
            "PP_pb_n": int(pp.size),
            **({"PP_pb_rms_ratio_median": round(float(np.median(pp)), 3),
                "PP_pb_dipping_share": round(float((pp < 1).mean()), 3)} if pp.size else {}),
            **({"PP_pb_best_shift_ms": best[0]} if pp.size else {}),
            "FF_n": int(ff.size),
            **({"FF_hf_gain_median": round(float(np.median(ff)), 3),
                "FF_rising_share": round(float((ff > 0).mean()), 3)} if ff.size else {}),
            **({"FF_best_shift_ms": best_ff[0]} if ff.size else {}),
        }
        print(line_id, json.dumps(out[line_id], ensure_ascii=False))
    (OUT / "check" / "verify.json").write_text(json.dumps(out, indent=1, ensure_ascii=False), encoding="utf-8")
    return 0 if all(r["tokens_match"] for r in out.values()) else 1


if __name__ == "__main__":
    raise SystemExit(main())

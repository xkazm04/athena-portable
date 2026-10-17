"""Kokoro tokens with times -> phonemes -> Oculus-15 visemes (Timeline v1).

Token stream rules (the symbols are misaki/espeak IPA from tokens.txt):
- stress marks ``ˈ ˌ`` belong to the phone after them (their frames start that phone);
- length/modifier marks ``ː ʰ ʲ ̃`` belong to the phone before them;
- espeak digraphs ``aɪ aʊ eɪ oʊ ɔɪ tʃ dʒ`` are fused into one phone;
- spaces, punctuation and the two pads are *boundary* tokens: they become ``sil`` when the audio
  over them is actually quiet, otherwise their time is split between the neighbouring phones.
"""

from __future__ import annotations

import numpy as np

STRESS = {"ˈ", "ˌ"}
POSTMOD = {"ː", "ʰ", "ʲ", "̃", "ʼ"}
BOUNDARY = {" ", ";", ":", ",", ".", "!", "?", "—", "…", '"', "(", ")", "“", "”", "↓", "→", "↗", "↘", "$PAD"}
DIGRAPHS = {("a", "ɪ"), ("a", "ʊ"), ("e", "ɪ"), ("o", "ʊ"), ("ɔ", "ɪ"), ("t", "ʃ"), ("d", "ʒ")}

#: misaki's single-letter diphthongs/affricates, written as IPA in the timeline.
IPA = {"A": "eɪ", "I": "aɪ", "O": "oʊ", "W": "aʊ", "Y": "ɔɪ", "ʤ": "dʒ", "ʧ": "tʃ", "ᵊ": "ə", "ᵻ": "ɨ", "ɡ": "g"}

#: Phone (IPA, after IPA{} normalisation) -> Oculus viseme. Diphthongs map to two visemes.
VISEME: dict[str, tuple[str, ...]] = {}
for _ph, _v in {
    # PP - lips closed
    "p": "PP", "b": "PP", "m": "PP",
    # FF - lower lip to teeth
    "f": "FF", "v": "FF",
    # TH - tongue between teeth
    "θ": "TH", "ð": "TH",
    # DD - alveolar stops/flap
    "t": "DD", "d": "DD", "ɾ": "DD", "ʔ": "DD", "ʈ": "DD", "ɖ": "DD",
    # kk - velar
    "k": "kk", "g": "kk", "ŋ": "kk", "x": "kk", "ç": "kk", "q": "kk",
    # CH - postalveolar
    "tʃ": "CH", "dʒ": "CH", "ʃ": "CH", "ʒ": "CH",
    # SS - sibilant
    "s": "SS", "z": "SS",
    # nn - n, l
    "n": "nn", "l": "nn", "ɫ": "nn", "ɲ": "nn",
    # RR - r and r-coloured vowels
    "ɹ": "RR", "r": "RR", "ɻ": "RR", "ɚ": "RR", "ɝ": "RR", "ɜ": "RR",
    # aa - open
    "ɑ": "aa", "a": "aa", "æ": "aa", "ʌ": "aa", "ɐ": "aa",
    # E - mid front / schwa
    "e": "E", "ɛ": "E", "ə": "E",
    # ih - close front
    "i": "ih", "ɪ": "ih", "ɨ": "ih", "j": "ih", "y": "ih",
    # oh - rounded mid/open back
    "o": "oh", "ɔ": "oh", "ɒ": "oh",
    # ou - rounded close
    "u": "ou", "ʊ": "ou", "w": "ou", "ɯ": "ou",
}.items():
    VISEME[_ph] = (_v,)
VISEME.update({"eɪ": ("E", "ih"), "aɪ": ("aa", "ih"), "oʊ": ("oh", "ou"), "aʊ": ("aa", "ou"), "ɔɪ": ("oh", "ih")})
DIPHTHONG_SPLIT = 0.6  # first target holds 60% of a diphthong

#: Visemes that must never be merged away: a closure the eye checks against the audio.
PRIORITY = {"PP", "FF"}
MIN_SEG_S = 0.04
QUIET_RMS = 0.02  # float audio; boundary spans quieter than this are sil


def phones(symbols: list[str], spans: list[tuple[int, int]], audio: np.ndarray) -> list[dict]:
    """Phone segments in samples: [{"p", "a", "b"}], boundaries resolved, gaps = "sil"."""
    units: list[dict] = []  # {"p", "a", "b", "kind"}
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
        if s in BOUNDARY or s in STRESS:
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
    # boundaries: quiet -> sil, voiced -> split between neighbours
    out: list[dict] = []
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
        if rms < QUIET_RMS or (prev_ph is None and not nxt_adjacent) or nxt is None and prev_ph is None:
            out.append({"p": "sil", "a": u["a"], "b": u["b"], "kind": "sil"})
        elif prev_ph is not None and nxt_adjacent:
            mid = (u["a"] + u["b"]) // 2
            prev_ph["b"] = mid
            units[k + 1]["a"] = mid
        elif prev_ph is not None:
            prev_ph["b"] = u["b"]
        else:
            units[k + 1]["a"] = u["a"]
    # coalesce adjacent sil
    merged: list[dict] = []
    for u in out:
        if merged and u["kind"] == "sil" and merged[-1]["kind"] == "sil":
            merged[-1]["b"] = u["b"]
        else:
            merged.append(u)
    return merged


def visemes_of(ph: list[dict]) -> list[dict]:
    """Phones (samples) -> raw viseme segments (samples), h borrowing its next vowel's shape."""
    segs: list[dict] = []
    for k, u in enumerate(ph):
        p = u["p"]
        if p == "sil":
            segs.append({"v": "sil", "a": u["a"], "b": u["b"]})
            continue
        if p == "h":
            nxt = next((w["p"] for w in ph[k + 1 :] if w["p"] in VISEME), None)
            vs = VISEME.get(nxt, ("E",))[:1] if nxt else ("E",)
        else:
            vs = VISEME.get(p, ("E",))  # unknown phone: neutral, half-open
        if len(vs) == 1:
            segs.append({"v": vs[0], "a": u["a"], "b": u["b"]})
        else:
            cut = u["a"] + int((u["b"] - u["a"]) * DIPHTHONG_SPLIT)
            segs.append({"v": vs[0], "a": u["a"], "b": cut})
            segs.append({"v": vs[1], "a": cut, "b": u["b"]})
    return segs


def _coalesce(segs: list[dict]) -> list[dict]:
    out: list[dict] = []
    for s in segs:
        if s["b"] <= s["a"]:
            continue
        if out and out[-1]["v"] == s["v"]:
            out[-1]["b"] = s["b"]
            out[-1].pop("keep", None)
        else:
            out.append(dict(s))
    return out


#: A sentence-internal quiet gap shorter than this, right before PP or FF, is the lips already
#: forming the closure (a stop's silent closure, or low-energy /f/ hiss), so it joins that viseme.
PRE_CLOSURE_MAX_S = 0.12


def absorb_pre_closure(segs: list[dict], sr: int, max_s: float = PRE_CLOSURE_MAX_S) -> list[dict]:
    max_n = int(round(max_s * sr))
    segs = [dict(s) for s in segs]
    for i in range(1, len(segs) - 1):
        s, nxt = segs[i], segs[i + 1]
        if s["v"] == "sil" and nxt["v"] in PRIORITY and s["b"] - s["a"] <= max_n:
            nxt["a"] = s["a"]
            s["b"] = s["a"]
    return _coalesce(segs)


def merge_short(segs: list[dict], sr: int, min_s: float = MIN_SEG_S) -> list[dict]:
    """No segment shorter than ``min_s``: short ones fold into a neighbour, except PP/FF, which
    grow to ``min_s`` by taking time from their neighbours, so a closure is never lost."""
    min_n = int(round(min_s * sr))
    segs = _coalesce(segs)
    for _ in range(1000):
        short = [i for i, s in enumerate(segs) if s["b"] - s["a"] < min_n and not s.get("keep")]
        if not short:
            break
        # shortest first; priority visemes handled by growing
        i = min(short, key=lambda j: (segs[j]["b"] - segs[j]["a"], segs[j]["v"] in PRIORITY))
        s = segs[i]
        L = segs[i - 1] if i > 0 else None
        R = segs[i + 1] if i + 1 < len(segs) else None
        need = min_n - (s["b"] - s["a"])
        if s["v"] in PRIORITY:
            # grow the closure toward min_n with time its non-closure neighbours can spare
            # without going short themselves (half each); what cannot be found stays short
            spare_l = max(0, L["b"] - L["a"] - min_n) if L and L["v"] not in PRIORITY else 0
            spare_r = max(0, R["b"] - R["a"] - min_n) if R and R["v"] not in PRIORITY else 0
            take_l = min(spare_l, need // 2 if spare_r > 0 else need)
            take_r = min(spare_r, need - take_l)
            take_l = min(spare_l, need - take_r)
            if take_l:
                L["b"] -= take_l
                s["a"] -= take_l
            if take_r:
                R["a"] += take_r
                s["b"] += take_r
            if take_l + take_r < need:
                s["keep"] = True  # a real closure, as long as the audio allows
            continue
        # merge into a neighbour: a non-closure one first (a closure must not outlast its
        # audio), then the longer one
        if L and R:
            pick_l = (L["v"] not in PRIORITY, L["b"] - L["a"]) >= (R["v"] not in PRIORITY, R["b"] - R["a"])
        else:
            pick_l = L is not None
        if pick_l and L:
            L["b"] = s["b"]
        elif R:
            R["a"] = s["a"]
        else:
            break
        segs.pop(i)
        segs = _coalesce(segs)
    return segs

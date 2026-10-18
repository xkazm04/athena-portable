"""The mouth-shape path per sentence: ``face_helper.visemes.sentence_visemes`` on CPU (onnxruntime).

    python bench_visemes.py            # prepare inputs once, then every config in a fresh process

Inputs are made the daemon's way: Kokoro with ``FACE_ARGS`` (``--debug=1 --tts-silence-scale=1``),
the token ids parsed with ``face.token_lines`` and the audio cut with ``face.scale_silence``. The
durations subgraph is extracted once into DATA (not the operator's ATHENA_HOME). The shipped
helper runs the subgraph with ``intra_op_num_threads = 2``; the configs below vary that number
and pin the process like the motion bench does.
"""

from __future__ import annotations

import argparse
import base64
import json
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import common  # noqa: E402

PREP = common.DATA / "visemes"
CONFIGS = {
    "shipped-ort2": {"ort": 2, "aff": ""},
    "ort4": {"ort": 4, "aff": ""},
    "ort8": {"ort": 8, "aff": ""},
    "ort16": {"ort": 16, "aff": ""},
    "aff4-ort2": {"ort": 2, "aff": "0,2,4,6"},
    "aff2-ort2": {"ort": 2, "aff": "0,2"},
}


def prepare() -> None:
    sys.path.insert(0, str(common.REPO / "src"))
    from athena.channels.voice.face import FACE_ARGS, scale_silence, token_lines
    from render import LENGTHS, render

    sys.path.insert(0, str(common.HELPER_PARENT))
    from face_helper.main import _durations_model

    model = _durations_model(common.KOKORO_DIR, PREP)
    for name, text in LENGTHS.items():
        if (PREP / f"{name}.json").is_file():
            continue
        wav = PREP / f"{name}.raw.wav"
        _, output = render(text, wav, extra=FACE_ARGS)
        raw, sr = common.read_wav(wav)
        pcm, time_map = scale_silence(raw, sr)
        common.write_json(
            PREP / f"{name}.json",
            {
                "tokens": token_lines(output),
                "raw_samples": len(raw) // 2,
                "time_map": [list(seg) for seg in time_map],
                "pcm": base64.b64encode(pcm).decode(),
                "sample_rate": sr,
                "duration_s": round(len(pcm) / 2 / sr, 3),
            },
        )
    print("durations model:", model)


def run_config(name: str, reps: int) -> dict:
    cfg = CONFIGS[name]
    common.set_high_priority()
    if cfg["aff"]:
        common.set_affinity([int(c) for c in cfg["aff"].split(",")])
    sys.path.insert(0, str(common.HELPER_PARENT))
    with common.Meter() as m_imp:
        import onnxruntime as ort
        from face_helper import visemes as fv

    orig = ort.SessionOptions
    model = next(PREP.glob("kokoro-durations-*.onnx"))

    class Opts:  # intra_op_num_threads is set by the helper; pin ours after it
        def __init__(self) -> None:
            self._o = orig()

        def __setattr__(self, k, v):  # type: ignore[no-untyped-def]
            if k == "_o":
                object.__setattr__(self, k, v)
            elif k == "intra_op_num_threads":
                self._o.intra_op_num_threads = cfg["ort"]
            else:
                setattr(self._o, k, v)

    real_session = ort.InferenceSession

    def session(path, opts, providers=None):  # type: ignore[no-untyped-def]
        return real_session(path, opts._o if isinstance(opts, Opts) else opts, providers=providers)

    ort.SessionOptions = Opts  # type: ignore[assignment, misc]
    ort.InferenceSession = session  # type: ignore[assignment]
    with common.Meter() as m_load:
        dur = fv.Durations(model, common.KOKORO_DIR / "voices.bin")
        symbols = fv.load_symbols(common.KOKORO_DIR / "tokens.txt")
    out = {"config": name, **cfg, "import": m_imp.row(), "load": m_load.row(), "sentences": {}}
    for f in sorted(PREP.glob("s*.json")):
        d = json.loads(f.read_text(encoding="utf-8"))
        pcm = base64.b64decode(d["pcm"])
        rows = []
        for i in range(reps + 1):
            with common.Meter() as m:
                vis = fv.sentence_visemes(
                    dur, symbols, batches=d["tokens"], raw_samples=d["raw_samples"],
                    time_map=d["time_map"], pcm=pcm, sample_rate=d["sample_rate"], sid=common.SID_AF_HEART,
                )
            with common.Meter() as m2:
                for seq in d["tokens"]:
                    dur.frames(seq, common.SID_AF_HEART)
            if i == 0:
                first = m.row()  # the first call through a fresh session
                continue
            r = m.row()
            r["durations_only_s"] = round(m2.wall, 4)
            rows.append(r)
        out["sentences"][f.stem] = {
            "duration_s": d["duration_s"],
            "n_tokens": sum(len(s) for s in d["tokens"]),
            "n_visemes": len(vis),
            "first_call": first,
            "wall_s": common.summary([r["wall_s"] for r in rows]),
            "durations_only_s": common.summary([r["durations_only_s"] for r in rows]),
            "runs": rows,
        }
    out["mem_end"] = common.memory_mb()
    out["machine"] = common.machine()
    return out


def main() -> None:
    p = argparse.ArgumentParser()
    p.add_argument("--config", default="")
    p.add_argument("--reps", type=int, default=7)
    p.add_argument("--repeat", type=int, default=3, help="fresh processes per config")
    a = p.parse_args()
    if a.config:
        print(json.dumps(run_config(a.config, a.reps)))
        return
    prepare()
    for name in CONFIGS:
        for r in range(a.repeat):
            out = common.RESULTS / "visemes" / f"{name}-r{r}.json"
            if out.is_file():
                continue
            proc = subprocess.run(
                [sys.executable, __file__, "--config", name, "--reps", str(a.reps)],
                capture_output=True, text=True, check=True,
            )
            d = json.loads(proc.stdout.strip().splitlines()[-1])
            common.write_json(out, d)
            print(name, r, {k: v["wall_s"]["median"] for k, v in d["sentences"].items()}, flush=True)


if __name__ == "__main__":
    main()

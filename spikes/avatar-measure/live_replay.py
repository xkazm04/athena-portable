"""Replay the daemon's live schedule for a 5-sentence line and count the motion that arrives in time.

    python live_replay.py --device cpu --threads 4 --affinity 0,2,4,6 --lines 3 --out r.json

The schedule is the shipped one (``KokoroTTS.synthesize_face`` + ``face_helper.main``):

- Kokoro renders the sentences one after another, as fast as it can (the daemon does not pace its
  audio): sentence k+1's render starts the moment sentence k's is done. Each render here is a real
  ``sherpa-onnx-offline-tts`` run (2 threads, ``FACE_ARGS``), a child of this process - so on a
  pinned config it shares the same cores, as it would on a small machine.
- When a render finishes, its sentence is handed to the motion worker (one thread, FIFO, the
  shipped ``Motion.frames``), exactly as the helper queues it. ``--kokoro none`` instead releases
  all five pre-rendered sentences at once (render time 0), the best case for audio, the worst for
  motion: nothing hides the motion queue behind Kokoro.
- The client plays sentence 0 from its render-done time plus its visemes (``--visemes-s``, the
  measured cost, default 0.1 s), and sentence k at ``max(end of k-1, render-done of k)``.

Motion for sentence k is in time when it is done before sentence k starts playing; its lateness
is how long after that start it arrived (the avatar crossfades it in, over procedural motion). The
model is loaded and warmed (the helper's 1 s tone) before the first line.
"""

from __future__ import annotations

import argparse
import queue
import sys
import tempfile
import threading
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import common  # noqa: E402


def main() -> None:
    p = argparse.ArgumentParser()
    p.add_argument("--device", default="cpu")
    p.add_argument("--threads", type=int, default=0)
    p.add_argument("--affinity", default="")
    p.add_argument("--variant", default="")
    p.add_argument("--lines", type=int, default=3)
    p.add_argument("--kokoro", choices=["live", "none"], default="live",
                   help="none: sentences are ready at once (render time 0), isolates motion")
    p.add_argument("--visemes-s", type=float, default=0.1)
    p.add_argument("--label", default="")
    p.add_argument("--out", required=True)
    a = p.parse_args()

    import bench_motion
    from render import LINE, render

    sys.path.insert(0, str(common.REPO / "src"))
    from athena.channels.voice.face import FACE_ARGS, scale_silence

    s = bench_motion.load(a.device, a.threads, a.affinity, [v for v in a.variant.split(",") if v])
    model = s["model"]
    rate, tone = s["warm"]
    with common.Meter() as m_warm:
        model.frames(tone(), rate)

    lines = []
    for li in range(a.lines):
        jobs: queue.Queue = queue.Queue()
        t0 = time.perf_counter()
        ready: list[float] = [0.0] * len(LINE)
        dur: list[float] = [0.0] * len(LINE)
        mstart: list[float] = [0.0] * len(LINE)
        mdone: list[float] = [0.0] * len(LINE)

        def worker() -> None:
            while True:
                item = jobs.get()
                if item is None:
                    return
                k, pcm, sr = item
                mstart[k] = time.perf_counter() - t0
                model.frames(pcm, sr)
                mdone[k] = time.perf_counter() - t0

        th = threading.Thread(target=worker)
        th.start()
        with common.Meter() as m_line, tempfile.TemporaryDirectory() as tmp:
            for k, text in enumerate(LINE):
                if a.kokoro == "live":
                    wav = Path(tmp) / f"{k}.wav"
                    render(text, wav, extra=FACE_ARGS)
                    raw, sr = common.read_wav(wav)
                    pcm, _ = scale_silence(raw, sr)
                else:
                    pcm, sr = common.read_wav(common.DATA / "line" / f"line{k}.wav")
                ready[k] = time.perf_counter() - t0
                dur[k] = len(pcm) / 2 / sr
                jobs.put((k, pcm, sr))
            jobs.put(None)
            th.join()
        play = [0.0] * len(LINE)
        for k in range(len(LINE)):
            play[k] = ready[0] + a.visemes_s if k == 0 else max(play[k - 1] + dur[k - 1], ready[k] + a.visemes_s)
        sentences = []
        for k in range(len(LINE)):
            late = mdone[k] - play[k]
            sentences.append({
                "k": k, "duration_s": round(dur[k], 3), "render_done_s": round(ready[k], 3),
                "play_start_s": round(play[k], 3), "motion_start_s": round(mstart[k], 3),
                "motion_done_s": round(mdone[k], 3), "motion_compute_s": round(mdone[k] - mstart[k], 3),
                "late_s": round(late, 3), "in_time": late <= 0,
                "covered_frac": round(1 - min(max(late, 0), dur[k]) / dur[k], 3),
            })
        gaps = [round(play[k] - (play[k - 1] + dur[k - 1]), 3) for k in range(1, len(LINE))]
        lines.append({
            "sentences": sentences,
            "in_time": sum(x["in_time"] for x in sentences),
            "first_sentence_late_s": sentences[0]["late_s"],
            "max_late_after_first_s": max(x["late_s"] for x in sentences[1:]),
            "audio_gaps_s": gaps,
            "first_audio_s": round(play[0], 3),
            "line_audio_s": round(sum(dur), 3),
            "machine_busy_pct": m_line.row()["machine_busy_pct"],
            "process_cores_used": m_line.row()["cores_used"],
        })
        print(a.label, li, f"in time {lines[-1]['in_time']}/5",
              [x["late_s"] for x in sentences], "gaps", gaps, flush=True)
        time.sleep(1.0)
    common.write_json(Path(a.out), {
        "label": a.label, "device": s["dev"], "threads": a.threads, "affinity": a.affinity,
        "variant": a.variant, "kokoro": a.kokoro, "visemes_s": a.visemes_s,
        "warmup_tone": m_warm.row(), "lines": lines, "machine": common.machine(),
        "mem_end": common.memory_mb(),
    })


if __name__ == "__main__":
    main()

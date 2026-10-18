"""Render Kokoro (af_heart) sentences the way the daemon does: sherpa-onnx-offline-tts, 2 threads.

    python render.py lengths     # the four bench sentences (~1.5 / 3 / 6 / 10 s) -> DATA/lengths/
    python render.py line        # the 5-sentence line for the live-schedule replay -> DATA/line/

The WAVs keep sherpa's default silence scale (0.2), i.e. the audio the daemon actually plays.
"""

from __future__ import annotations

import os
import subprocess
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from common import DATA, KOKORO_DIR, SHERPA_EXE, SID_AF_HEART, read_wav, write_json  # noqa: E402

LENGTHS = {
    "s1_5": "Sure, I can do that.",
    "s3": "I found two invoices that are still waiting for your approval.",
    "s6": (
        "The reminder for Northwind is drafted, and I scheduled it to go out on Friday morning "
        "unless you change your mind."
    ),
    "s10": (
        "I compared this month's expenses against the budget you set in March, and travel is the "
        "only category running over, mostly because of the two conference trips that were booked "
        "late."
    ),
}

LINE = [
    "Good morning, I have three things for you today.",
    "First, the quarterly report is finished and waiting in your shared folder.",
    "Second, Anna asked to move tomorrow's call.",
    "I suggested Thursday at ten, which is free on both calendars, and she has not replied yet, "
    "so I will remind her this afternoon.",
    "Last, the invoice from Contoso is overdue by a week.",
]


def args(text: str, out: Path, threads: int = 2, extra: tuple[str, ...] = ()) -> list[str]:
    k = KOKORO_DIR
    argv = [
        str(SHERPA_EXE),
        f"--kokoro-model={k / 'model.onnx'}",
        f"--kokoro-voices={k / 'voices.bin'}",
        f"--kokoro-tokens={k / 'tokens.txt'}",
        f"--kokoro-data-dir={k / 'espeak-ng-data'}",
    ]
    if (k / "lexicon-us-en.txt").is_file():
        argv.append(f"--kokoro-lexicon={k / 'lexicon-us-en.txt'}")
    argv += [f"--num-threads={threads}", f"--sid={SID_AF_HEART}", f"--output-filename={out}", *extra]
    argv.append(f" {text}")
    return argv


def render(text: str, out: Path, threads: int = 2, extra: tuple[str, ...] = ()) -> tuple[float, str]:
    """Render one sentence; returns (wall seconds, sherpa's combined output)."""
    out.parent.mkdir(parents=True, exist_ok=True)
    t = time.perf_counter()
    proc = subprocess.run(
        args(text, out, threads, extra),
        capture_output=True,
        creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0)
        | (0x80 if os.environ.get("MEASURE_HIGH_PRIORITY") == "1" else 0),  # match the bench process
        check=False,
    )
    if proc.returncode != 0:
        raise RuntimeError(proc.stderr.decode("utf-8", "replace")[-400:])
    return time.perf_counter() - t, (proc.stdout + proc.stderr).decode("utf-8", "replace")


def main() -> None:
    which = sys.argv[1] if len(sys.argv) > 1 else "lengths"
    items = LENGTHS if which == "lengths" else {f"line{i}": t for i, t in enumerate(LINE)}
    meta = {}
    for name, text in items.items():
        out = DATA / which / f"{name}.wav"
        wall, _ = render(text, out)
        pcm, sr = read_wav(out)
        meta[name] = {"text": text, "duration_s": round(len(pcm) / 2 / sr, 3), "render_s": round(wall, 3)}
        print(name, meta[name])
    write_json(DATA / which / "meta.json", meta)


if __name__ == "__main__":
    main()

"""A stand-in for the face helper, run as ``python fake_face.py <mode> <log> <delay_s> ...``.

voice-io / ADR 0120 (Athena has a face).

It speaks the helper's protocol (:mod:`athena.channels.voice.face_helper.main`) with no model: the
mouth shapes of a sentence are ``sil`` over its first half and ``aa`` over the rest, and its motion
is two frames. Every line it reads is logged to ``<log>`` as JSON with the audio replaced by its
length, so a test sees what the daemon asked for, in order, cancels included.

Modes:

- ``ok``: hello with visemes and motion; motion ``<delay_s>`` after the visemes.
- ``visemes``: hello with visemes only.
- ``slow``: answers the visemes ``<delay_s>`` late.
- ``crash2``: answers the first sentence, then exits 3 on the second.
- ``fatal``: says it cannot run, and exits.
- ``mute``: never says hello.
- ``probed``: hello with visemes and motion pending, then, once a file ``<log>.go`` exists, the
  caps of a motion model that timed itself on this machine and kept up (25 steps, 0.62 s, CPU).
- ``tooslow``: hello as ``probed``, then ``<delay_s>`` later the caps of a model that did not keep
  up: motion is off, and says why.
"""

from __future__ import annotations

import base64
import json
import sys
import threading
import time
from pathlib import Path

HERE = Path(__file__).resolve()


def command(mode: str, log: Path, delay_s: float = 0.0) -> list[str]:
    return [sys.executable, str(HERE), mode, str(log), str(delay_s)]


def received(log: Path) -> list[dict[str, object]]:
    if not log.exists():
        return []
    return [json.loads(line) for line in log.read_text(encoding="utf-8").splitlines() if line]


def main() -> int:
    mode, log, delay = sys.argv[1], Path(sys.argv[2]), float(sys.argv[3])
    lock = threading.Lock()

    def send(message: dict[str, object]) -> None:
        with lock:
            sys.stdout.write(json.dumps(message) + "\n")
            sys.stdout.flush()

    def note(message: dict[str, object]) -> None:
        with lock, open(log, "a", encoding="utf-8") as out:
            out.write(json.dumps(message) + "\n")

    note({"type": "argv", "argv": sys.argv[4:]})
    if mode == "mute":
        time.sleep(60)
        return 0
    if mode == "fatal":
        send({"type": "fatal", "reason": "the face environment has no onnxruntime"})
        return 2
    if mode in ("probed", "tooslow"):
        send(
            {
                "type": "hello",
                "protocol": 1,
                "visemes": True,
                "motion": False,
                "motion_pending": True,
                "motion_reason": "loading, then timing itself on this machine",
                "reason": None,
            }
        )
        go = log.with_name(log.name + ".go")
        deadline = time.monotonic() + 30
        while mode == "probed" and not go.exists() and time.monotonic() < deadline:
            time.sleep(0.01)
        time.sleep(delay)
        if mode == "probed":
            send(
                {
                    "type": "caps",
                    "motion": True,
                    "warm": True,
                    "steps": 25,
                    "window_s": 0.62,
                    "device": "cpu",
                    "probe": {"10": [0.31, 0.3], "25": [0.62, 0.63], "50": [1.21, 1.2]},
                }
            )
        else:
            send(
                {
                    "type": "caps",
                    "motion": False,
                    "device": "cpu",
                    "window_s": 1.4,
                    "motion_reason": "too slow here (window 1.40 s > 1.0 s at 10 steps)",
                }
            )
    else:
        send({"type": "hello", "protocol": 1, "visemes": True, "motion": mode != "visemes"})
    seen = 0
    for raw in sys.stdin:
        message = json.loads(raw)
        if message.get("type") == "sentence":
            pcm = base64.b64decode(message.pop("pcm"))
            message["pcm_samples"] = len(pcm) // 2
            seen += 1
        note(message)
        if message.get("type") != "sentence":
            continue
        if mode == "crash2" and seen == 2:
            return 3
        n = message["pcm_samples"]
        ident = message["id"]
        if mode == "slow":
            time.sleep(delay)
        send({"type": "visemes", "id": ident, "visemes": [["sil", 0, n // 2], ["aa", n // 2, n]]})
        if message.get("motion"):
            frames = [{"t": 0.0, "head": {"yaw": 1.0}}, {"t": 0.5, "head": {"yaw": -1.0}}]
            later = threading.Timer(
                delay if mode == "ok" else 0.0,
                send,
                args=[{"type": "motion", "id": ident, "fps": 60, "frames": frames}],
            )
            later.daemon = True
            later.start()
    return 0


if __name__ == "__main__":
    sys.exit(main())

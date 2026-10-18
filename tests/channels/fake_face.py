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

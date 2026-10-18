"""voice-io / ADR 0120 (Athena has a face): the face helper's protocol, JSON lines on stdio.

Out, first: ``{"type": "hello", "protocol": 1, "visemes": bool, "motion": bool, "reason"}``, as
soon as the durations model is warm (extracting it from Kokoro's model the first time takes about
15 s); motion loads after the hello, on its own thread, and a load that fails is reported as
``{"type": "caps", "motion": false, "reason": ...}``.

In: ``{"type": "sentence", "id", "sid", "sample_rate", "tokens": [[...]], "raw_samples",
"time_map": [[raw_a, raw_b, out_a, out_b]], "pcm": base64 PCM16LE, "visemes": bool,
"motion": bool}`` and ``{"type": "cancel", "ids": [...]}``.

Out, per sentence: ``{"type": "visemes", "id", "visemes": [[v, start, end]]}`` at once, then
``{"type": "motion", "id", "fps": 60, "frames": [...]}`` when the model has run; a failure is
``{"type": "error", "id", "op": "visemes"|"motion", "reason"}``. Motion runs one sentence at a
time in arrival order and skips a cancelled one. The mouth shapes never wait behind motion: they
are answered on the reading thread.

The protocol owns the process's real stdout. Anything else that prints - torch, JoyVASA - is sent
to stderr, at the file-descriptor level, so a library's chatter cannot corrupt a line; and it
owns the real stdin, with fd 0 pointed at the null device (see :func:`_protocol_input`). The helper
exits when its stdin closes, which is how it never outlives the daemon.
"""

from __future__ import annotations

import argparse
import base64
import json
import math
import os
import queue
import sys
import threading
from pathlib import Path
from typing import IO, Any

PROTOCOL = 1
JOYVASA_ENV = "ATHENA_FACE_JOYVASA"


def _protocol_stream() -> IO[str]:
    """The real stdout for the protocol; fd 1 and ``sys.stdout`` become stderr from here on."""
    sys.stdout.flush()
    proto = os.fdopen(os.dup(1), "w", encoding="utf-8", newline="\n")
    os.dup2(2, 1)
    sys.stdout = sys.stderr
    return proto


def _protocol_input() -> IO[bytes]:
    """The real stdin for the protocol; fd 0 and ``sys.stdin`` become the null device.

    On Windows a thread blocked reading a synchronous pipe holds that pipe: any other thread that
    so much as asks the handle what it is (``isatty``, as torch and progress bars do on import)
    waits until the read returns. With the protocol reading the only stdin, JoyVASA's load sat
    there until the daemon happened to send a sentence (measured: minutes). The pipe is moved off
    the standard handle, so nothing but the reading thread ever touches it."""
    proto = os.fdopen(os.dup(0), "rb")
    null = os.open(os.devnull, os.O_RDONLY)
    os.dup2(null, 0)
    os.close(null)
    sys.stdin = open(os.devnull, encoding="utf-8")  # noqa: SIM115 - lives as long as the process
    return proto


class Out:
    def __init__(self, stream: IO[str]) -> None:
        self._stream = stream
        self._lock = threading.Lock()

    def send(self, message: dict[str, Any]) -> None:
        line = json.dumps(message, separators=(",", ":"), ensure_ascii=False)
        with self._lock:
            self._stream.write(line + "\n")
            self._stream.flush()


def _durations_model(kokoro_dir: Path, cache_dir: Path) -> Path:
    from .visemes import extract_durations

    model = kokoro_dir / "model.onnx"
    cached = cache_dir / f"kokoro-durations-{model.stat().st_size}.onnx"
    if not cached.is_file():
        print(f"face: extracting the durations subgraph to {cached}", file=sys.stderr, flush=True)
        cache_dir.mkdir(parents=True, exist_ok=True)
        extract_durations(model, cached)
    return cached


def _joyvasa_dir(asked: str | None) -> Path:
    if asked:
        return Path(asked)
    env = os.environ.get(JOYVASA_ENV, "")
    if env:
        return Path(env)
    return Path.home() / ".athena-avatar" / "models" / "joyvasa"


WARMUP_RATE = 24_000


def _warmup_tone() -> bytes:
    """One second of a quiet 220 Hz tone, PCM16 at :data:`WARMUP_RATE`."""
    return b"".join(
        int(3000 * math.sin(2 * math.pi * 220 * i / WARMUP_RATE)).to_bytes(2, "little", signed=True)
        for i in range(WARMUP_RATE)
    )


class MotionWorker:
    """JoyVASA on its own thread: loaded once, then one sentence at a time."""

    def __init__(self, out: Out, joyvasa: Path) -> None:
        self.out = out
        self.joyvasa = joyvasa
        self.jobs: queue.Queue[tuple[int, bytes, int] | None] = queue.Queue()
        self.cancelled: set[int] = set()
        self.lock = threading.Lock()
        threading.Thread(target=self._run, name="face-motion", daemon=True).start()

    def put(self, ident: int, pcm: bytes, sample_rate: int) -> None:
        self.jobs.put((ident, pcm, sample_rate))

    def cancel(self, ids: list[int]) -> None:
        with self.lock:
            self.cancelled.update(ids)

    def _is_cancelled(self, ident: int) -> bool:
        with self.lock:
            return ident in self.cancelled

    def _run(self) -> None:
        from .motion import FPS, Motion

        try:
            model = Motion(self.joyvasa)
            # One throwaway second first: the first sentence through a cold model pays the audio
            # loader's and the GPU kernels' first-use cost (measured: about 7 s), a warm one not.
            model.frames(_warmup_tone(), WARMUP_RATE)
            self.out.send({"type": "caps", "motion": True, "warm": True})
        except Exception as exc:
            reason = f"JoyVASA would not load ({type(exc).__name__}: {exc})"[:300]
            print(f"face: {reason}", file=sys.stderr, flush=True)
            self.out.send({"type": "caps", "motion": False, "reason": reason})
            while True:  # refuse whatever is still queued
                item = self.jobs.get()
                if item is None:
                    return
                self.out.send({"type": "error", "id": item[0], "op": "motion", "reason": reason})
        while True:
            item = self.jobs.get()
            if item is None:
                return
            ident, pcm, sample_rate = item
            if self._is_cancelled(ident):
                continue
            try:
                frames = model.frames(pcm, sample_rate)
            except Exception as exc:
                self.out.send(
                    {
                        "type": "error",
                        "id": ident,
                        "op": "motion",
                        "reason": f"{type(exc).__name__}: {exc}"[:300],
                    }
                )
                continue
            if not self._is_cancelled(ident):
                self.out.send({"type": "motion", "id": ident, "fps": FPS, "frames": frames})


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="athena-face-helper")
    parser.add_argument("--kokoro-dir", required=True)
    parser.add_argument("--cache-dir", required=True)
    parser.add_argument("--joyvasa", default=None)
    parser.add_argument("--no-motion", action="store_true")
    args = parser.parse_args(argv)
    out = Out(_protocol_stream())
    inbox = _protocol_input()
    kokoro_dir = Path(args.kokoro_dir)

    from .visemes import Durations, load_symbols, sentence_visemes

    durations: Durations | None = None
    symbols: dict[int, str] = {}
    reasons: list[str] = []
    try:
        durations = Durations(
            _durations_model(kokoro_dir, Path(args.cache_dir)), kokoro_dir / "voices.bin"
        )
        symbols = load_symbols(kokoro_dir / "tokens.txt")
    except Exception as exc:
        durations = None
        reasons.append(f"visemes: {type(exc).__name__}: {exc}"[:300])

    worker: MotionWorker | None = None
    if not args.no_motion:
        from .motion import available

        joyvasa = _joyvasa_dir(args.joyvasa)
        why = available(joyvasa)
        if why is None:
            worker = MotionWorker(out, joyvasa)
        else:
            reasons.append(f"motion: {why}")
    out.send(
        {
            "type": "hello",
            "protocol": PROTOCOL,
            "visemes": durations is not None,
            "motion": worker is not None,
            "reason": "; ".join(reasons) or None,
        }
    )

    for raw in inbox:
        try:
            message = json.loads(raw)
        except ValueError:
            continue
        if not isinstance(message, dict):
            continue
        kind = message.get("type")
        if kind == "cancel":
            if worker is not None:
                worker.cancel([i for i in message.get("ids", []) if isinstance(i, int)])
            continue
        if kind != "sentence":
            continue
        ident = message.get("id")
        if not isinstance(ident, int):
            continue
        try:
            pcm = base64.b64decode(message["pcm"])
            sample_rate = int(message["sample_rate"])
        except (KeyError, TypeError, ValueError) as exc:
            out.send({"type": "error", "id": ident, "op": "visemes", "reason": str(exc)[:300]})
            continue
        if message.get("visemes"):
            if durations is None:
                out.send(
                    {"type": "error", "id": ident, "op": "visemes", "reason": "no durations model"}
                )
            else:
                try:
                    visemes = sentence_visemes(
                        durations,
                        symbols,
                        batches=[list(map(int, seq)) for seq in message["tokens"]],
                        raw_samples=int(message["raw_samples"]),
                        time_map=[list(map(int, seg)) for seg in message["time_map"]],
                        pcm=pcm,
                        sample_rate=sample_rate,
                        sid=int(message["sid"]),
                    )
                    out.send({"type": "visemes", "id": ident, "visemes": visemes})
                except Exception as exc:
                    out.send(
                        {
                            "type": "error",
                            "id": ident,
                            "op": "visemes",
                            "reason": f"{type(exc).__name__}: {exc}"[:300],
                        }
                    )
        if message.get("motion"):
            if worker is None:
                out.send({"type": "error", "id": ident, "op": "motion", "reason": "no motion"})
            else:
                worker.put(ident, pcm, sample_rate)
    if worker is not None:
        worker.jobs.put(None)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

"""A stand-in for ``sherpa-onnx-offline-tts`` and ``whisper-cli``, run as ``python fake_engine.py``.

voice-io / ADR 0028 (Athena's voice is set up in a studio), README section 3.1.

The first three arguments are the fake's own — ``<mode> <log> <delay_s>`` — and the rest are what
the engine adapter built, exactly as the real executable would receive them. Every run appends one
JSON line to ``<log>``: the adapter's argv and when the run started and ended, which is how a test
proves argument building and the prefetch order without a real model.

Modes:

- ``kokoro``: write a 24 kHz mono 16-bit WAV to ``--output-filename=`` whose frames *are* the
  UTF-8 text, padded to whole samples — so the PCM a test reads back says which sentence it was.
- ``kokoro-fail``: complain on stderr and exit 2.
- ``kokoro-badwav``: write a WAV at the wrong rate.
- ``hang``: sleep far longer than any test's timeout.
- ``whisper``: check ``-f`` is a 16 kHz mono WAV and print a transcript with a non-speech marker.
- ``broken``: ``--help`` exits 3, as a binary missing a DLL would.
"""

from __future__ import annotations

import json
import sys
import time
import wave
from pathlib import Path

HERE = Path(__file__).resolve()


def command(mode: str, log: Path, delay_s: float = 0.0) -> list[str]:
    """The argv prefix an adapter is given in place of the engine executable."""
    return [sys.executable, str(HERE), mode, str(log), str(delay_s)]


def runs(log: Path) -> list[dict[str, object]]:
    """Every run the fake logged, in the order they finished."""
    if not log.exists():
        return []
    return [json.loads(line) for line in log.read_text(encoding="utf-8").splitlines() if line]


def lay_out_kokoro(root: Path, *, lexicon: bool = True) -> None:
    """The model files Kokoro's probe looks for, under ``<root>/companion-tts/kokoro``."""
    model = root / "companion-tts" / "kokoro"
    (model / "espeak-ng-data").mkdir(parents=True, exist_ok=True)
    for name in ("model.onnx", "voices.bin", "tokens.txt"):
        (model / name).write_bytes(b"x")
    if lexicon:
        (model / "lexicon-us-en.txt").write_text("hello h@loU", encoding="utf-8")


def lay_out_whisper_model(root: Path, model_id: str = "base.en") -> Path:
    path = root / "companion-stt" / "models" / f"ggml-{model_id}.bin"
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(b"ggml")
    return path


def main() -> int:
    mode, log, delay = sys.argv[1], sys.argv[2], float(sys.argv[3])
    args = sys.argv[4:]
    if args == ["--help"]:
        return 3 if mode == "broken" else 0
    started = time.time()
    if mode == "hang":
        time.sleep(60)
    time.sleep(delay)
    code = 0
    if mode.startswith("kokoro"):
        code = kokoro(mode, args)
    elif mode == "whisper":
        code = whisper(args)
    with open(log, "a", encoding="utf-8") as out:
        out.write(json.dumps({"argv": args, "start": started, "end": time.time()}) + "\n")
    return code


def kokoro(mode: str, args: list[str]) -> int:
    if mode == "kokoro-fail":
        sys.stderr.write("the model would not load\n")
        return 2
    flags = dict(arg[2:].split("=", 1) for arg in args[:-1] if arg.startswith("--"))
    text = args[-1].encode("utf-8")
    if len(text) % 2:
        text += b" "
    with wave.open(flags["output-filename"], "wb") as wav:
        wav.setnchannels(1)
        wav.setsampwidth(2)
        wav.setframerate(16_000 if mode == "kokoro-badwav" else 24_000)
        wav.writeframes(text)
    return 0


def whisper(args: list[str]) -> int:
    wav_path = args[args.index("-f") + 1]
    with wave.open(wav_path, "rb") as wav:
        if wav.getframerate() != 16_000 or wav.getnchannels() != 1 or wav.getsampwidth() != 2:
            sys.stderr.write("not 16 kHz mono 16-bit\n")
            return 4
        frames = wav.getnframes()
    print(f" Heard {frames} frames.")
    print(" [BLANK_AUDIO]")
    return 0


if __name__ == "__main__":
    sys.exit(main())

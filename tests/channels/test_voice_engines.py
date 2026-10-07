"""The local engines through a fake executable: arguments, WAV, prefetch, timeout, probes.

voice-io / ADR 0028 (Athena's voice is set up in a studio), README section 3.1.

The fake (``fake_engine.py``) is a Python script run as ``sys.executable fake_engine.py`` in
place of ``sherpa-onnx-offline-tts`` and ``whisper-cli``. It logs the argv it was handed and,
for Kokoro, writes a WAV whose frames are the sentence's own bytes — so the PCM read back proves
the WAV was parsed and says which sentence it came from, in which order.
"""

from __future__ import annotations

import time
from pathlib import Path

import pytest

from athena.channels.voice import kokoro, whisper
from athena.channels.voice.backends import VoiceBackendError
from athena.channels.voice.home import EngineHomes, resolve_homes

from .fake_engine import command, lay_out_kokoro, lay_out_whisper_model, runs


def _pcm(text: str) -> bytes:
    raw = text.encode("utf-8")
    return raw + b" " if len(raw) % 2 else raw


@pytest.fixture
def homes(tmp_path: Path) -> EngineHomes:
    return EngineHomes(tmp_path / "personas")


@pytest.fixture
def log(tmp_path: Path) -> Path:
    return tmp_path / "runs.jsonl"


# -- the home --------------------------------------------------------------------------------------


def test_the_home_is_personas_home_else_dot_personas(tmp_path: Path) -> None:
    assert resolve_homes({}, home=tmp_path).root == tmp_path / ".personas"
    shared = resolve_homes({"PERSONAS_HOME": str(tmp_path / "p")}, home=tmp_path)
    assert shared.tts_bin == tmp_path / "p" / "companion-tts" / "bin"
    assert shared.kokoro_dir == tmp_path / "p" / "companion-tts" / "kokoro"
    assert shared.stt_bin == tmp_path / "p" / "companion-stt" / "bin"
    assert shared.stt_models == tmp_path / "p" / "companion-stt" / "models"


def test_the_engine_overrides_personas_honours_are_honoured(tmp_path: Path) -> None:
    exe = tmp_path / "custom-tts.exe"
    exe.write_bytes(b"")
    homes = resolve_homes({"PERSONAS_KOKORO_BIN": str(exe)}, home=tmp_path)
    assert kokoro.paths_for(homes).exe == exe


# -- kokoro ----------------------------------------------------------------------------------------


def test_heart_is_speaker_three_and_the_only_voice() -> None:
    """Load-bearing: a wrong sid silently speaks as somebody else."""
    heart = kokoro.find_voice("af_heart")
    assert heart is not None
    assert heart.sid == 3
    assert heart.to_dict() == {
        "id": "af_heart",
        "name": "Heart",
        "language": "en-US",
        "gender": "female",
        "grade": "A",
        "blurb": "Warm, expressive US female — Kokoro's flagship voice.",
    }
    assert [voice.id for voice in kokoro.VOICES] == ["af_heart"]
    assert kokoro.find_voice("zz_nobody") is None


def test_the_arguments_are_personas_with_the_text_last(homes: EngineHomes) -> None:
    lay_out_kokoro(homes.root)
    paths = kokoro.paths_for(homes)
    args = kokoro.build_args(paths, 3, Path("out.wav"), "Hello there.")
    assert args == [
        f"--kokoro-model={homes.kokoro_dir / 'model.onnx'}",
        f"--kokoro-voices={homes.kokoro_dir / 'voices.bin'}",
        f"--kokoro-tokens={homes.kokoro_dir / 'tokens.txt'}",
        f"--kokoro-data-dir={homes.kokoro_dir / 'espeak-ng-data'}",
        f"--kokoro-lexicon={homes.kokoro_dir / 'lexicon-us-en.txt'}",
        "--num-threads=2",
        "--sid=3",
        "--output-filename=out.wav",
        "Hello there.",
    ]


def test_the_lexicon_flag_is_left_out_when_there_is_no_lexicon(homes: EngineHomes) -> None:
    lay_out_kokoro(homes.root, lexicon=False)
    args = kokoro.build_args(kokoro.paths_for(homes), 3, Path("o.wav"), "Hi.")
    assert not any(arg.startswith("--kokoro-lexicon") for arg in args)


def test_sentences_split_at_their_ends_and_fragments_fold_back() -> None:
    assert kokoro.split_sentences("One is late. Two are paid! Is three? Yes.") == [
        "One is late.",
        "Two are paid! Is three? Yes.",
    ]
    assert kokoro.split_sentences("The first is late. The second is paid.") == [
        "The first is late.",
        "The second is paid.",
    ]
    assert kokoro.split_sentences("no stop at all") == ["no stop at all"]
    assert kokoro.split_sentences("   ") == []


def test_synthesis_runs_one_process_per_sentence_and_yields_the_wav_frames_in_order(
    homes: EngineHomes, log: Path
) -> None:
    lay_out_kokoro(homes.root)
    tts = kokoro.KokoroTTS(homes, command=command("kokoro", log))
    text = "The first invoice is late. The second one was paid yesterday."

    audio = b"".join(tts.synthesize(text))

    assert audio == _pcm("The first invoice is late.") + _pcm("The second one was paid yesterday.")
    seen = runs(log)
    assert [run["argv"][-1] for run in seen] == [  # type: ignore[index]
        "The first invoice is late.",
        "The second one was paid yesterday.",
    ]
    assert all("--sid=3" in run["argv"] for run in seen)  # type: ignore[operator]
    assert tts.sample_rate == 24_000


def test_the_next_sentence_renders_while_this_one_is_played(homes: EngineHomes, log: Path) -> None:
    """Prefetch: sentence n+1 is started before sentence n is handed out, so a listener who
    takes as long as the engine never waits between sentences."""
    lay_out_kokoro(homes.root)
    delay = 0.6
    tts = kokoro.KokoroTTS(homes, command=command("kokoro", log, delay))
    stream = tts.synthesize("Sentence number one is here. Sentence number two follows it.")

    first = next(stream)
    assert first.startswith(b"Sentence number one")
    assert tts.started == ["Sentence number one is here.", "Sentence number two follows it."]

    time.sleep(delay + 1.0)  # playing sentence one, for as long as the engine takes
    before = time.monotonic()
    rest = b"".join(stream)
    assert time.monotonic() - before < delay / 2, "sentence two was not rendered ahead"
    assert rest.endswith(_pcm("Sentence number two follows it."))


def test_closing_the_stream_early_stops_the_sentence_still_rendering(
    homes: EngineHomes, log: Path
) -> None:
    lay_out_kokoro(homes.root)
    tts = kokoro.KokoroTTS(homes, command=command("kokoro", log, 0.8))
    stream = tts.synthesize("A first sentence to say. A second one never heard.")
    next(stream)
    stream.close()  # a barge-in
    time.sleep(1.2)
    assert [run["argv"][-1] for run in runs(log)] == ["A first sentence to say."]  # type: ignore[index]


def test_a_sentence_that_never_finishes_times_out(homes: EngineHomes, log: Path) -> None:
    lay_out_kokoro(homes.root)
    tts = kokoro.KokoroTTS(homes, command=command("hang", log), timeout_s=0.5)
    started = time.monotonic()
    with pytest.raises(VoiceBackendError, match="timed out"):
        b"".join(tts.synthesize("Hello."))
    assert time.monotonic() - started < 10


def test_an_engine_failure_quotes_its_stderr_and_a_wrong_wav_is_refused(
    homes: EngineHomes, log: Path
) -> None:
    lay_out_kokoro(homes.root)
    failing = kokoro.KokoroTTS(homes, command=command("kokoro-fail", log))
    with pytest.raises(VoiceBackendError, match="exited with 2: the model would not load"):
        b"".join(failing.synthesize("Hello."))
    wrong = kokoro.KokoroTTS(homes, command=command("kokoro-badwav", log))
    with pytest.raises(VoiceBackendError, match="16000 Hz"):
        b"".join(wrong.synthesize("Hello."))


def test_text_past_the_cap_is_refused_rather_than_cut_silently(homes: EngineHomes) -> None:
    tts = kokoro.KokoroTTS(homes)
    with pytest.raises(VoiceBackendError, match="at most"):
        next(tts.synthesize("x" * (kokoro.MAX_CHARS + 1)))


def test_the_probe_names_the_missing_file_then_tells_broken_from_ready(
    homes: EngineHomes, log: Path
) -> None:
    absent = kokoro.probe(homes)
    assert absent.state == "absent"
    assert absent.reason is not None
    assert absent.reason.startswith(f"Kokoro is not installed: {kokoro.ENGINE_FILENAME} is missing")

    lay_out_kokoro(homes.root)
    (homes.kokoro_dir / "voices.bin").unlink()
    half = kokoro.probe(homes, command=command("kokoro", log))
    assert half.state == "absent"
    assert "voices.bin is missing" in str(half.reason)

    lay_out_kokoro(homes.root)
    broken = kokoro.probe(homes, command=command("broken", log))
    assert broken.state == "broken"
    assert "exited with 3" in str(broken.reason)
    assert kokoro.probe(homes, command=command("kokoro", log)).ready


# -- whisper ---------------------------------------------------------------------------------------


def test_the_whisper_models_are_an_allowlist_with_sizes() -> None:
    assert [(m.id, m.size_mb) for m in whisper.MODELS] == [
        ("tiny.en", 75),
        ("base.en", 142),
        ("small.en", 466),
        ("tiny", 75),
        ("base", 142),
        ("small", 466),
    ]
    with pytest.raises(ValueError):
        whisper.model_path(EngineHomes(Path("h")), "../../etc/passwd")


def test_whisper_arguments_are_personas() -> None:
    assert whisper.build_args(Path("m.bin"), Path("in.wav")) == [
        "-m",
        "m.bin",
        "-f",
        "in.wav",
        "-nt",
        "-np",
    ]
    assert whisper.build_args(Path("m.bin"), Path("in.wav"), "cs")[-2:] == ["-l", "cs"]


def test_non_speech_markers_reduce_to_the_empty_string() -> None:
    assert whisper.clean_transcript(" [BLANK_AUDIO]\n") == ""
    assert whisper.clean_transcript("(silence)") == ""
    assert whisper.clean_transcript("\n  Hello   there \n\n world.  \n") == "Hello there world."
    assert whisper.clean_transcript("call [him] later") == "call [him] later"


def test_whisper_transcribes_a_buffered_utterance_from_a_16k_wav(
    homes: EngineHomes, log: Path
) -> None:
    lay_out_whisper_model(homes.root, "base.en")
    stt = whisper.WhisperSTT(homes, "base.en", command=command("whisper", log))
    heard = stt.transcriber()
    assert list(heard.feed(bytes(3200 * 2))) == []
    heard.feed(bytes(3200 * 2))

    assert heard.finish() == "Heard 6400 frames."
    argv = runs(log)[0]["argv"]
    assert argv[:2] == ["-m", str(homes.stt_models / "ggml-base.en.bin")]  # type: ignore[index]
    assert argv[-2:] == ["-nt", "-np"]  # type: ignore[index]


def test_whisper_without_its_model_or_engine_says_so(homes: EngineHomes, log: Path) -> None:
    stt = whisper.WhisperSTT(homes, "base.en", command=command("whisper", log))
    with pytest.raises(VoiceBackendError, match=r"base\.en is not installed"):
        stt.transcribe(bytes(6400))
    absent = whisper.probe(homes)
    assert absent.state == "absent"
    assert str(absent.reason).startswith("Whisper is not installed")
    assert whisper.probe(homes, command=command("broken", log)).state == "broken"
    assert whisper.probe(homes, command=command("whisper", log)).ready

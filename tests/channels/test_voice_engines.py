"""The local engines through a fake executable: arguments, WAV, prefetch, timeout, probes.

voice-io / ADR 0028 (Athena's voice is set up in a studio), README section 3.1.

The fake (``fake_engine.py``) is a Python script run as ``sys.executable fake_engine.py`` in
place of ``sherpa-onnx-offline-tts`` and ``whisper-cli``. It logs the argv it was handed and,
for Kokoro, writes a WAV whose frames are the sentence's own bytes — so the PCM read back proves
the WAV was parsed and says which sentence it came from, in which order.
"""

from __future__ import annotations

import codecs
import subprocess
import sys
import time
from pathlib import Path
from typing import Any

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
        " Hello there.",
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

    assert audio == _pcm(" The first invoice is late.") + _pcm(
        " The second one was paid yesterday."
    )
    seen = runs(log)
    assert [run["argv"][-1] for run in seen] == [  # type: ignore[index]
        " The first invoice is late.",
        " The second one was paid yesterday.",
    ]
    assert all("--sid=3" in run["argv"] for run in seen)  # type: ignore[operator]
    assert tts.sample_rate == 24_000


def test_started_keeps_only_the_newest_sentences(
    homes: EngineHomes, monkeypatch: pytest.MonkeyPatch
) -> None:
    """``started`` is evidence for a test, not a log: a long-lived engine keeps the newest 32."""
    tts = kokoro.KokoroTTS(homes)
    monkeypatch.setattr(tts, "_render", lambda job: b"")
    sentences = [f"Sentence {n}." for n in range(kokoro.STARTED_KEPT + 8)]

    for sentence in sentences:
        tts._start(sentence).result()

    assert len(tts.started) == kokoro.STARTED_KEPT == 32
    assert tts.started == sentences[-32:]
    assert tts.started[-1] == sentences[-1]


def test_the_next_sentence_renders_while_this_one_is_played(homes: EngineHomes, log: Path) -> None:
    """Prefetch: sentence n+1 is started before sentence n is handed out, so a listener who
    takes as long as the engine never waits between sentences."""
    lay_out_kokoro(homes.root)
    delay = 0.6
    tts = kokoro.KokoroTTS(homes, command=command("kokoro", log, delay))
    stream = tts.synthesize("Sentence number one is here. Sentence number two follows it.")

    first = next(stream)
    assert first.startswith(b" Sentence number one")
    assert tts.started == ["Sentence number one is here.", "Sentence number two follows it."]

    # Playing sentence one: wait, undrained, for sentence two's render to finish by itself. Without
    # prefetch it is never started until the drain, so this deadline expires. The wait is an event,
    # not a clock budget, so a loaded machine only makes it longer.
    deadline = time.monotonic() + 60
    while len(runs(log)) < 2 and time.monotonic() < deadline:
        time.sleep(0.05)
    seen = runs(log)
    assert len(seen) == 2, "sentence two was not rendered ahead"
    drain_began = time.time()
    rest = b"".join(stream)
    one, two = seen
    assert one["argv"][-1] == " Sentence number one is here."  # type: ignore[index]
    assert two["argv"][-1] == " Sentence number two follows it."  # type: ignore[index]
    assert two["end"] < drain_began, "sentence two finished only once the drain began"  # type: ignore[operator]
    assert rest.endswith(_pcm(" Sentence number two follows it."))


def test_closing_the_stream_early_stops_the_sentence_still_rendering(
    homes: EngineHomes, log: Path
) -> None:
    lay_out_kokoro(homes.root)
    tts = kokoro.KokoroTTS(homes, command=command("kokoro", log, 0.8))
    stream = tts.synthesize("A first sentence to say. A second one never heard.")
    next(stream)
    stream.close()  # a barge-in
    time.sleep(1.2)
    assert [run["argv"][-1] for run in runs(log)] == [" A first sentence to say."]  # type: ignore[index]


def test_a_render_cancelled_before_its_process_exists_is_killed_when_it_starts(
    homes: EngineHomes, log: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    lay_out_kokoro(homes.root)
    tts = kokoro.KokoroTTS(homes, command=command("hang", log), timeout_s=5)
    job = kokoro._Render(tts._render, "Hello.")
    real = subprocess.Popen

    def cancelled_while_spawning(*args: Any, **kwargs: Any) -> subprocess.Popen[bytes]:
        proc = real(*args, **kwargs)
        job.cancel()  # runs before ``job.proc`` is assigned: it finds no process to kill
        return proc

    monkeypatch.setattr(kokoro.subprocess, "Popen", cancelled_while_spawning)
    began = time.monotonic()

    assert tts._render(job) == b""

    assert time.monotonic() - began < 4, "the engine ran until its timeout"
    assert job.proc is not None and job.proc.returncode not in (None, 0)


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
    sound = (5000).to_bytes(2, "little") * 3200  # -16 dBFS: over the level gate
    assert list(heard.feed(sound)) == []
    heard.feed(sound)

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


_DASH_LED = [
    "--output-filename=pwned.wav hello",
    "-- note",
    "--help",
    "---",
    "-5 degrees outside.",
    *kokoro.split_sentences("It is done. --output-filename=x.wav now"),
]


@pytest.mark.parametrize("text", _DASH_LED)
def test_a_dash_led_sentence_never_reaches_the_engine_as_an_option(
    homes: EngineHomes, text: str
) -> None:
    lay_out_kokoro(homes.root)
    paths = kokoro.paths_for(homes)
    out = Path("out.wav")
    plain = kokoro.build_args(paths, 3, out, "Hello there.")
    args = kokoro.build_args(paths, 3, out, text)
    assert args[-1] == f" {text}"
    assert args[:-1] == plain[:-1]
    assert [a for a in args if a.startswith("--output-filename")] == ["--output-filename=out.wav"]


#: The code points a narrow Windows argv (code pages 1250 and 1252) folds to an ASCII ``-``, and
#: the dashes beside them that it does not (ADR 0069, amended).
_DASHES = [0x2010, 0x2011, 0x2012, 0x2015, 0x2212, 0xFF0D, 0x2013, 0x2014, 0xFE63]


@pytest.mark.parametrize(
    "text",
    ["Hello there.", "--output-filename=x.wav", *(f"{chr(c)} word" for c in _DASHES)],
)
def test_every_sentence_is_one_space_then_itself_byte_for_byte(text: str) -> None:
    entry = kokoro.spoken_entry(text, None)  # argv off Windows: bytes, no best fit
    assert entry.startswith(" ")
    assert entry[1:] == text
    for code_page in (1250, 1252):  # a narrow line: the space stays, the rest is made carried
        assert kokoro.spoken_entry(text, code_page) == f" {kokoro.narrow_safe(text, code_page)}"


def test_a_dash_led_sentence_writes_to_the_callers_path_only(homes: EngineHomes, log: Path) -> None:
    lay_out_kokoro(homes.root)
    tts = kokoro.KokoroTTS(homes, command=command("kokoro", log))
    audio = b"".join(tts.synthesize("--output-filename=pwned.wav hello"))
    assert audio == _pcm(" --output-filename=pwned.wav hello")
    assert not Path("pwned.wav").exists()
    assert not (log.parent / "pwned.wav").exists()


# -- the narrow command line: every character the child's code page carries (ADR 0069) ---------

windows_only = pytest.mark.skipif(
    sys.platform != "win32",
    reason="best fit, the ANSI code page and CommandLineToArgvW are Windows'",
)

_PATHS = kokoro.KokoroPaths(
    exe=Path("sherpa-onnx-offline-tts.exe"),
    model=Path("k/model.onnx"),
    voices=Path("k/voices.bin"),
    tokens=Path("k/tokens.txt"),
    espeak=Path("k/espeak-ng-data"),
    lexicon=Path("k/no-such-lexicon.txt"),
)

#: The council's probe (full r2 robustness-2) and the harmless sentence that split beside it.
_COUNCIL = [
    "Read this \uff02 --output-filename=C:/Users/Public/pwned.wav \uff02 now please",
    "He said \uff02hello there\uff02 to me today",
]


def _command_line_to_argv(line: str) -> list[str]:
    import ctypes
    from ctypes import wintypes

    shell32 = ctypes.WinDLL("shell32")
    kernel32 = ctypes.WinDLL("kernel32")
    shell32.CommandLineToArgvW.restype = ctypes.POINTER(wintypes.LPWSTR)
    shell32.CommandLineToArgvW.argtypes = [wintypes.LPCWSTR, ctypes.POINTER(ctypes.c_int)]
    kernel32.LocalFree.argtypes = [ctypes.c_void_p]
    count = ctypes.c_int()
    argv = shell32.CommandLineToArgvW(line, ctypes.byref(count))
    assert argv, "CommandLineToArgvW failed"
    try:
        return [argv[i] for i in range(count.value)]
    finally:
        kernel32.LocalFree(ctypes.cast(argv, ctypes.c_void_p))


def _through_the_narrow_line(args: list[str], code_page: int) -> list[str]:
    """What a narrow main is handed: list2cmdline, best fit to the code page, back, then split."""
    line = subprocess.list2cmdline([str(_PATHS.exe), *args])
    raw = codecs.code_page_encode(code_page, line, "replace")[0]  # "replace" applies best fit
    narrow = codecs.code_page_decode(code_page, raw, "replace", True)[0]
    return _command_line_to_argv(narrow)[1:]


def _flags() -> list[str]:
    return kokoro.build_args(_PATHS, 3, Path("out.wav"), "x", None)[:-1]


def _args(text: str, code_page: int | None) -> list[str]:
    return kokoro.build_args(_PATHS, 3, Path("out.wav"), text, code_page)


def _assert_one_positional(argv: list[str], text: str, code_page: int) -> None:
    assert argv[:-1] == _flags()
    assert argv[-1].startswith(" ")
    assert argv[-1] == kokoro.spoken_entry(text, code_page)


@windows_only
@pytest.mark.parametrize("code_page", [1250, 1252])
@pytest.mark.parametrize("text", _COUNCIL, ids=["pwned", "harmless"])
def test_the_councils_sentences_reach_a_narrow_main_as_one_positional(
    text: str, code_page: int
) -> None:
    unguarded = _through_the_narrow_line([*_flags(), f" {text}"], code_page)
    assert len(unguarded) > len(_flags()) + 1  # the defect: the fullwidth quote closed the quoting
    argv = _through_the_narrow_line(_args(text, code_page), code_page)
    _assert_one_positional(argv, text, code_page)
    assert [a for a in argv if a.startswith("--output-filename")] == ["--output-filename=out.wav"]


def _bmp_chunks(size: int) -> list[list[str]]:
    # Surrogates are not characters. U+0000 cannot be on a command line at all: Popen refuses it
    # before any process starts, and CommandLineToArgvW reads to the first NUL.
    points = [chr(c) for c in range(1, 0x10000) if not 0xD800 <= c <= 0xDFFF]
    return [points[at : at + size] for at in range(0, len(points), size)]


@windows_only
@pytest.mark.parametrize("code_page", sorted({1250, 1252, kokoro.ANSI_CODE_PAGE or 1252}))
def test_no_bmp_code_point_on_either_side_of_a_flag_splits_the_narrow_line(
    code_page: int,
) -> None:
    for chunk in _bmp_chunks(1024):
        text = " ".join(f"{c} --output-filename=x {c}" for c in chunk)
        _assert_one_positional(
            _through_the_narrow_line(_args(text, code_page), code_page), text, code_page
        )


@windows_only
@pytest.mark.parametrize("code_page", [1250, 1252])
def test_a_fullwidth_backslash_at_the_end_does_not_escape_the_closing_quote(
    code_page: int,
) -> None:
    text = "It ends in a slash \uff3c"
    argv = _through_the_narrow_line([*_args(text, code_page), "--sid=9"], code_page)
    assert argv == [*_flags(), " It ends in a slash \\", "--sid=9"]


@windows_only
@pytest.mark.parametrize("code_page", [1250, 1252])
def test_an_ascii_quote_and_backslash_reach_the_positional_as_themselves(code_page: int) -> None:
    text = 'He said "go --output-filename=x" and C:\\dir\\ \\'
    argv = _through_the_narrow_line(_args(text, code_page), code_page)
    assert argv == [*_flags(), f" {text}"]


_CZECH = "Příliš žluťoučký kůň úpěl"


def test_czech_under_1250_is_byte_for_byte_after_the_leading_space() -> None:
    entry = kokoro.spoken_entry(_CZECH, 1250)
    assert entry.encode("utf-8") == b" " + _CZECH.encode("utf-8")


@windows_only
def test_czech_under_1250_reaches_a_narrow_main_unchanged() -> None:
    assert _through_the_narrow_line(_args(_CZECH, 1250), 1250) == [*_flags(), f" {_CZECH}"]


@pytest.mark.parametrize(
    ("char", "code_page", "becomes"),
    [
        ("\uff02", 1250, '"'),  # NFKC: a fullwidth quote is a quote, which list2cmdline escapes
        ("\uff3c", 1252, "\\"),
        ("\ufb01", 1252, "fi"),  # a ligature is its letters
        ("\u0159", 1252, "r"),  # NFKD with the mark dropped: 1252 has no ř
        ("\u0159", 1250, "\u0159"),  # carried, so never changed
        ("\U0001f44d", 1250, " "),  # nothing carried: one space, so no two words run together
        ("\u2212", 1252, " "),
    ],
)
def test_a_character_the_code_page_cannot_carry_folds_or_becomes_one_space(
    char: str, code_page: int, becomes: str
) -> None:
    assert kokoro.narrow_safe(f"a{char}b", code_page) == f"a{becomes}b"


def test_with_no_code_page_the_sentence_is_the_identity() -> None:
    text = "Read this \uff02 --output-filename=x \uff02 \U0001f44d"
    assert kokoro.narrow_safe(text, None) == text
    if sys.platform != "win32":
        assert kokoro.ANSI_CODE_PAGE is None
        assert _args(text, None)[-1] == f" {text}"

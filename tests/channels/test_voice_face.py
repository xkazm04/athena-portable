"""Her face on the daemon's side: the helper client, the replayed cut, and the face events.

voice-io / ADR 0120 (Athena has a face), README section 3.1.

Kokoro is ``fake_engine.py`` and the helper is ``fake_face.py``, both real processes speaking the
real arguments and the real protocol, so what these prove is the daemon's half: the audio is the
same with or without a helper, the mouth shapes go out before their sentence's audio at the right
offset, motion follows them, nothing follows the line, and a helper that is slow, dies or never
starts costs the voice nothing. One test at the end runs the real helper, when one is set up.
"""

from __future__ import annotations

import itertools
import os
import random
import threading
import time
from collections.abc import Iterator
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import pytest

from athena.channels.voice import gateway as gateway_module
from athena.channels.voice import kokoro
from athena.channels.voice.backends import ScriptedBackend
from athena.channels.voice.config import ConfigError, VoiceChoice, VoiceStudio
from athena.channels.voice.face import (
    FACE_ARGS,
    QUIET_LEVEL,
    FaceHelper,
    scale_silence,
    token_lines,
)
from athena.channels.voice.gateway import VoiceSession, _FaceLine
from athena.channels.voice.home import EngineHomes
from athena.connectors.seal import FileSeal
from athena.contracts.channel import ChannelEvent, VoiceMotion, VoiceVisemes
from daemon.conftest import Live, claude_round

from . import fake_face
from .conftest import VoiceClient
from .fake_engine import command, lay_out_kokoro, lay_out_whisper_model, runs

SR = kokoro.SAMPLE_RATE
#: The second of steady sound ``kokoro-long`` adds after a sentence's own bytes.
LONG = (1000).to_bytes(2, "little") * SR
TWO = "The first sentence is here. And the second one follows it."


@pytest.fixture
def homes(tmp_path: Path) -> EngineHomes:
    homes = EngineHomes(tmp_path / "personas")
    lay_out_kokoro(homes.root)
    return homes


def _helper(
    tmp_path: Path, mode: str = "ok", delay: float = 0.0, **kwargs: Any
) -> tuple[FaceHelper, Path]:
    log = tmp_path / "face.jsonl"
    helper = FaceHelper(
        "python",
        kokoro_dir=tmp_path / "personas" / "companion-tts" / "kokoro",
        cache_dir=tmp_path / "face-cache",
        command=fake_face.command(mode, log, delay),
        **kwargs,
    )
    return helper, log


def _ready(helper: FaceHelper, timeout: float = 10.0) -> None:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if helper.probe().ready:
            return
        time.sleep(0.02)
    raise AssertionError(f"the helper never became ready: {helper.probe()}")


class Line:
    """What one line put out, in order: face events as they were emitted, audio as yielded."""

    def __init__(self) -> None:
        self.lock = threading.Lock()
        self.order: list[tuple[str, Any]] = []

    def emit(self, event: ChannelEvent) -> None:
        with self.lock:
            self.order.append((event.kind, event))

    def play(self, chunks: Any) -> bytes:
        pcm = b""
        for chunk in chunks:
            with self.lock:
                self.order.append(("audio", len(chunk)))
            pcm += chunk
        return pcm

    def events(self, kind: str) -> list[Any]:
        with self.lock:
            return [event for k, event in self.order if k == kind]


def _sentence_pcm(sentence: str) -> bytes:
    raw = f" {sentence}".encode()
    return raw + b" " if len(raw) % 2 else raw


def _argvs(log: Path) -> list[list[str]]:
    """Every run's argv, its temporary output path aside."""
    return [
        [a if not a.startswith("--output-filename=") else "--output-filename=" for a in r["argv"]]
        for r in runs(log)
    ]


# -- sherpa's arithmetic, replayed ---------------------------------------------------------------


def _reference_scale_silence(samples: list[float], sr: int, scale: float) -> list[float]:
    """``GeneratedAudio::ScaleSilence`` from sherpa-onnx's ``offline-tts.cc``, line for line."""
    threshold = int(sr * 0.2)
    intervals: list[tuple[int, int]] = []
    last = -1
    n = len(samples)
    for i in range(n):
        if abs(samples[i]) <= 0.01:
            if last == -1:
                last = i
            continue
        if last != -1 and i - last < threshold:
            last = -1
            continue
        if last != -1:
            intervals.append((last, i))
            last = -1
    if last != -1 and n - last > threshold:
        intervals.append((last, n))
    if not intervals:
        return samples
    out: list[float] = []
    i = 0
    for a, b in intervals:
        out += samples[i:a]
        i = b
        out += samples[a : a + int((b - a) * scale)]
    if i < n:
        out += samples[i:]
    return out


def _pcm16(values: list[int]) -> bytes:
    return b"".join(v.to_bytes(2, "little", signed=True) for v in values)


@pytest.mark.parametrize("seed", range(6))
def test_the_replayed_cut_is_sherpas_sample_for_sample(seed: int) -> None:
    rng = random.Random(seed)
    sr = 1000  # a 200-sample pause threshold keeps the signals small
    values: list[int] = []
    for _ in range(30):
        quiet = rng.random() < 0.5
        length = rng.choice([1, 50, 199, 200, 201, 450])
        if quiet:
            values += [rng.randint(-QUIET_LEVEL, QUIET_LEVEL) for _ in range(length)]
        else:
            values += [
                rng.choice([-1, 1]) * rng.randint(QUIET_LEVEL + 1, 30000) for _ in range(length)
            ]
    floats = [v / 32767 for v in values]
    expected = _reference_scale_silence(floats, sr, 0.2)
    out, time_map = scale_silence(_pcm16(values), sr)
    got = [
        int.from_bytes(out[i : i + 2], "little", signed=True) / 32767 for i in range(0, len(out), 2)
    ]
    assert got == expected
    # The map is ordered, covers the uncut audio and lands on the cut one.
    assert time_map[0][0] == 0 and time_map[-1][1] == len(values)
    assert time_map[-1][3] == len(out) // 2
    assert all(a[1] == b[0] and a[3] == b[2] for a, b in itertools.pairwise(time_map))


def test_a_trailing_pause_is_cut_only_when_longer_than_the_threshold() -> None:
    loud = [5000] * 10
    exactly = _pcm16(loud + [0] * 200)
    assert scale_silence(exactly, 1000)[0] == exactly  # n - last > threshold is strict
    longer = _pcm16(loud + [0] * 201)
    assert len(scale_silence(longer, 1000)[0]) // 2 == 10 + 40


def test_the_token_ids_are_read_off_sherpas_debug_output() -> None:
    output = (
        "kokoro-multi-lang-lexicon.cc:ConvertTextToTokenIds:158 \r\n"
        "0 46 156 63 158 16 52 0\r\n\r\n"
        "Split it into 2 batches.\n0 1 2 0\nsample=49200, progress=1.000000\n"
        "0 is not a token line\n"
    )
    assert token_lines(output) == [[0, 46, 156, 63, 158, 16, 52, 0], [0, 1, 2, 0]]


# -- the helper ----------------------------------------------------------------------------------


def test_with_no_helper_set_up_the_face_is_absent_and_nothing_starts(tmp_path: Path) -> None:
    helper = FaceHelper(None, kokoro_dir=tmp_path, cache_dir=tmp_path / "c")
    found = helper.probe()
    assert (found.state, found.visemes, found.motion) == ("absent", False, False)
    assert "face.python" in (found.reason or "")
    missing = FaceHelper(
        str(tmp_path / "nope" / "python.exe"), kokoro_dir=tmp_path, cache_dir=tmp_path
    )
    assert missing.probe().state == "absent"
    assert not (tmp_path / "c").exists()


def test_the_helper_says_hello_and_is_ready_with_its_powers(tmp_path: Path) -> None:
    helper, log = _helper(tmp_path)
    assert helper.probe().reason == "Her face helper is starting."
    _ready(helper)
    found = helper.probe()
    assert (found.state, found.visemes, found.motion) == ("ready", True, True)
    argv = fake_face.received(log)[0]["argv"]
    assert argv[:2] == ["--kokoro-dir", str(tmp_path / "personas" / "companion-tts" / "kokoro")]
    helper.stop()


def test_a_helper_that_cannot_run_is_broken_and_says_why(tmp_path: Path) -> None:
    helper, _ = _helper(tmp_path, "fatal")
    helper.ensure()
    deadline = time.monotonic() + 10
    while helper.probe().state != "broken" and time.monotonic() < deadline:
        time.sleep(0.02)
    assert helper.probe().reason == "the face environment has no onnxruntime"


def test_a_helper_that_never_says_hello_is_broken_at_its_deadline(tmp_path: Path) -> None:
    helper, _ = _helper(tmp_path, "mute", start_timeout_s=0.3)
    helper.ensure()
    time.sleep(0.5)
    found = helper.probe()
    assert found.state == "broken" and "hello" in (found.reason or "")


# -- kokoro with and without her face ------------------------------------------------------------


def test_with_no_helper_the_line_is_the_same_process_the_same_args_and_the_same_bytes(
    homes: EngineHomes, tmp_path: Path
) -> None:
    plain_log, faced_log = tmp_path / "plain.jsonl", tmp_path / "faced.jsonl"
    plain = kokoro.KokoroTTS(homes, command=command("kokoro", plain_log))
    unset = FaceHelper(None, kokoro_dir=homes.kokoro_dir, cache_dir=tmp_path / "c")
    faced = kokoro.KokoroTTS(homes, command=command("kokoro", faced_log), face=unset)
    line = Line()

    expected = b"".join(plain.synthesize(TWO))
    got = line.play(faced.synthesize_face(TWO, line.emit))

    assert got == expected
    assert _argvs(faced_log) == _argvs(plain_log)
    assert not any(arg in FACE_ARGS for r in runs(faced_log) for arg in r["argv"])
    assert line.events("voice.visemes") == [] and line.events("voice.motion") == []


def test_a_ready_helper_asks_for_the_tokens_and_the_uncut_audio_before_the_text(
    homes: EngineHomes, tmp_path: Path
) -> None:
    helper, face_log = _helper(tmp_path, "visemes")
    _ready(helper)
    log = tmp_path / "runs.jsonl"
    tts = kokoro.KokoroTTS(homes, command=command("kokoro", log), face=helper)

    Line().play(tts.synthesize_face("Just the one sentence here.", Line().emit))

    argv = runs(log)[0]["argv"]
    assert argv[-3:-1] == list(FACE_ARGS)
    assert argv[-1] == " Just the one sentence here."
    sent = [m for m in fake_face.received(face_log) if m.get("type") == "sentence"]
    assert sent[0]["tokens"] == [[0, 46, 156, 63, 158, 16, 52, 0]]
    assert (sent[0]["sid"], sent[0]["sample_rate"]) == (3, SR)
    helper.stop()


def test_the_cut_audio_with_a_helper_is_the_audio_without_one(
    homes: EngineHomes, tmp_path: Path
) -> None:
    helper, face_log = _helper(tmp_path, "visemes")
    _ready(helper)
    plain = kokoro.KokoroTTS(homes, command=command("kokoro-pause", tmp_path / "a.jsonl"))
    faced = kokoro.KokoroTTS(
        homes, command=command("kokoro-pause", tmp_path / "b.jsonl"), face=helper
    )
    line = Line()

    expected = b"".join(plain.synthesize(TWO))
    got = line.play(faced.synthesize_face(TWO, line.emit))

    assert got == expected
    sent = [m for m in fake_face.received(face_log) if m.get("type") == "sentence"]
    # The helper was handed the uncut length and the time map from it onto what is played.
    first = _sentence_pcm("The first sentence is here.")
    assert sent[0]["raw_samples"] == len(first) + 7200
    assert sent[0]["pcm_samples"] == len(first) + 1440
    assert sent[0]["time_map"][-1][1] == sent[0]["raw_samples"]
    helper.stop()


def test_each_sentences_visemes_go_out_before_its_audio_at_its_offset_then_its_motion(
    homes: EngineHomes, tmp_path: Path
) -> None:
    helper, _ = _helper(tmp_path, "ok")
    _ready(helper)
    # A second of sound per sentence, so the line is still being heard when the last motion lands.
    tts = kokoro.KokoroTTS(homes, command=command("kokoro-long", tmp_path / "r.jsonl"), face=helper)
    line = Line()

    pcm = line.play(tts.synthesize_face(TWO, line.emit))

    first, second = (_sentence_pcm(s) + LONG for s in kokoro.split_sentences(TWO))
    assert pcm == first + second
    kinds = [kind for kind, _ in line.order]
    v0, v1 = kinds.index("voice.visemes"), len(kinds) - 1 - kinds[::-1].index("voice.visemes")
    audio = [i for i, kind in enumerate(kinds) if kind == "audio"]
    assert v0 < audio[0]  # the first sentence's shapes before any of its audio
    second_audio = next(
        i for i in audio if sum(line.order[j][1] for j in audio if j < i) >= len(first)
    )
    assert v0 < v1 < second_audio
    visemes = line.events("voice.visemes")
    assert [(v.sentence, v.offset, v.sample_rate) for v in visemes] == [
        (0, 0, SR),
        (1, len(first) // 2, SR),
    ]
    n0 = len(first) // 2
    assert visemes[0].visemes == (("sil", 0, n0 // 2), ("aa", n0 // 2, n0))
    assert all(v.generation == 0 for v in visemes)  # the gateway stamps the line's own
    motion = line.events("voice.motion")
    assert sorted((m.sentence, m.offset) for m in motion) == [(0, 0), (1, len(first) // 2)]
    assert motion[0].fps == 60 and motion[0].frames[0]["head"] == {"yaw": 1.0}
    for m in motion:  # a sentence's motion never precedes its visemes
        assert kinds.index("voice.visemes") <= line.order.index(("voice.motion", m))
    helper.stop()


def test_the_line_waits_for_motion_still_coming_while_it_is_still_being_heard(
    homes: EngineHomes, tmp_path: Path
) -> None:
    helper, _ = _helper(tmp_path, "ok", delay=0.3)
    _ready(helper)
    tts = kokoro.KokoroTTS(homes, command=command("kokoro-long", tmp_path / "r.jsonl"), face=helper)
    line = Line()

    line.play(tts.synthesize_face("One sentence that lasts a second.", line.emit))

    assert [m.sentence for m in line.events("voice.motion")] == [0]
    helper.stop()


def test_closing_the_line_cancels_the_helpers_work_and_nothing_more_is_emitted(
    homes: EngineHomes, tmp_path: Path
) -> None:
    helper, face_log = _helper(tmp_path, "ok", delay=0.4)
    _ready(helper)
    tts = kokoro.KokoroTTS(homes, command=command("kokoro", tmp_path / "r.jsonl"), face=helper)
    line = Line()

    chunks = tts.synthesize_face(TWO, line.emit)
    next(chunks)
    chunks.close()  # the gateway's barge-in
    emitted = len(line.order)
    time.sleep(0.6)

    assert len(line.order) == emitted
    assert line.events("voice.motion") == []
    cancels = [m for m in fake_face.received(face_log) if m.get("type") == "cancel"]
    assert cancels, "the helper was never told to drop the line's work"
    helper.stop()


def test_a_slow_helper_costs_the_sentence_its_shapes_and_then_is_broken(
    homes: EngineHomes, tmp_path: Path
) -> None:
    helper, _ = _helper(tmp_path, "slow", delay=1.0, visemes_timeout_s=0.1)
    _ready(helper)
    tts = kokoro.KokoroTTS(homes, command=command("kokoro", tmp_path / "r.jsonl"), face=helper)
    line = Line()

    pcm = line.play(tts.synthesize_face(TWO, line.emit))

    assert pcm == b"".join(_sentence_pcm(s) for s in kokoro.split_sentences(TWO))
    assert line.events("voice.visemes") == []
    found = helper.probe()
    assert found.state == "broken" and "in time" in (found.reason or "")


def test_a_helper_that_dies_mid_line_costs_the_rest_of_the_line_its_face_not_its_voice(
    homes: EngineHomes, tmp_path: Path
) -> None:
    helper, _ = _helper(tmp_path, "crash2", backoff_s=(3.0, 3.0))
    _ready(helper)
    log = tmp_path / "r.jsonl"
    tts = kokoro.KokoroTTS(homes, command=command("kokoro", log), face=helper)
    line = Line()
    three = "The first sentence is here. The second one follows it. And a third ends it."

    pcm = line.play(tts.synthesize_face(three, line.emit))

    assert pcm == b"".join(_sentence_pcm(s) for s in kokoro.split_sentences(three))
    assert [v.sentence for v in line.events("voice.visemes")] == [0]
    assert helper.probe().state == "broken"
    # The next line, past the backoff, finds the helper started again.
    time.sleep(3.1)
    _ready(helper)
    helper.stop()


def test_the_studios_preview_never_uses_the_face(homes: EngineHomes, tmp_path: Path) -> None:
    helper, face_log = _helper(tmp_path, "ok")
    _ready(helper)
    log = tmp_path / "r.jsonl"
    tts = kokoro.KokoroTTS(homes, command=command("kokoro", log), face=helper)

    b"".join(tts.synthesize("A preview sentence for the studio."))

    assert not any(arg in FACE_ARGS for r in runs(log) for arg in r["argv"])
    assert not [m for m in fake_face.received(face_log) if m.get("type") == "sentence"]
    helper.stop()


# -- the gateway's door ---------------------------------------------------------------------------


class _Session:
    def __init__(self) -> None:
        self.cutoff = 0
        self.sent: list[ChannelEvent] = []

    def _stale(self, generation: int) -> bool:
        return generation <= self.cutoff

    def send(self, event: ChannelEvent) -> None:
        self.sent.append(event)


def test_a_face_event_is_stamped_with_its_line_and_dropped_once_barged_in_or_shut() -> None:
    session = _Session()
    door = _FaceLine(session, 4)  # type: ignore[arg-type]
    shapes = VoiceVisemes(sentence=0, offset=0, visemes=(("sil", 0, 10),))

    door.emit(shapes)
    session.cutoff = 4  # a barge-in
    door.emit(VoiceMotion(sentence=0))
    session.cutoff = 0
    door.shut()  # the line is over: its voice.stopped is next
    door.emit(VoiceMotion(sentence=1))

    assert session.sent == [
        VoiceVisemes(generation=4, sentence=0, offset=0, visemes=(("sil", 0, 10),))
    ]


@dataclass
class FacedBackend(ScriptedBackend):
    """A scripted speaker with a face: two sentences, each its shapes, two chunks, its motion -
    and one motion that only lands after the line is over."""

    late: list[threading.Timer] = field(default_factory=list)

    def synthesize_face(self, text: str, emit: Any) -> Iterator[bytes]:
        self.spoken.append(text)
        for index in range(2):
            offset = index * 640
            emit(VoiceVisemes(sentence=index, offset=offset, visemes=(("aa", 0, 640),)))
            for _ in range(2):
                yield bytes(640)
            emit(VoiceMotion(sentence=index, offset=offset, frames=({"t": 0.0},)))
        timer = threading.Timer(0.2, emit, args=[VoiceMotion(sentence=9)])
        timer.start()
        self.late.append(timer)


@pytest.fixture
def backend() -> ScriptedBackend:
    return FacedBackend()


def test_on_the_socket_a_line_is_its_shapes_then_audio_then_motion_and_nothing_after_it_stops(
    voiced: Live,
    backend: FacedBackend,
    client: VoiceClient,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    sent: list[tuple[str, int, int]] = []
    send, send_audio = VoiceSession.send, VoiceSession._send_audio

    def recording(self: VoiceSession, event: Any) -> None:
        if event.kind.startswith("voice.") and event.kind != "voice.transcript":
            sent.append(
                (event.kind, getattr(event, "generation", 0), getattr(event, "sentence", -1))
            )
        send(self, event)

    def recording_audio(self: VoiceSession, generation: int, chunk: bytes) -> None:
        sent.append(("audio", generation, len(chunk)))
        send_audio(self, generation, chunk)

    monkeypatch.setattr(gateway_module.VoiceSession, "send", recording)
    monkeypatch.setattr(gateway_module.VoiceSession, "_send_audio", recording_audio)
    voiced.register()
    voiced.script(claude_round("TTS: Two are late.\nTwo invoices are over thirty days."))
    backend.utterances = ["what is overdue"]

    client.utter()
    client.until("voice.stopped")
    for timer in backend.late:
        timer.join()

    assert sent == [
        ("voice.speaking", 1, -1),
        ("voice.visemes", 1, 0),
        ("audio", 1, 640),
        ("audio", 1, 640),
        ("voice.motion", 1, 0),
        ("voice.visemes", 1, 1),
        ("audio", 1, 640),
        ("audio", 1, 640),
        ("voice.motion", 1, 1),
        ("voice.stopped", 1, -1),
    ]
    shapes = client.until("voice.visemes", sentence=1)
    assert shapes == {
        "kind": "voice.visemes",
        "generation": 1,
        "sentence": 1,
        "offset": 640,
        "sample_rate": 24000,
        "visemes": [["aa", 0, 640]],
    }


# -- the studio ----------------------------------------------------------------------------------


def _studio(tmp_path: Path, face_command: list[str] | None = None) -> VoiceStudio:
    log = tmp_path / "runs.jsonl"
    return VoiceStudio(
        tmp_path / "voice",
        homes=EngineHomes(tmp_path / "personas"),
        seal=FileSeal(tmp_path / "voice" / "sealed"),
        environ={},
        kokoro_command=command("kokoro", log),
        whisper_command=command("whisper", log),
        face_command=face_command,
    )


HEART = {"engine": "kokoro", "voice": "af_heart"}
BASE = {"engine": "whisper", "model": "base.en"}


def test_face_python_is_an_absolute_path_or_nothing() -> None:
    absolute = str(Path(os.path.abspath(os.sep)) / "envs" / "face" / "python.exe")
    assert VoiceChoice.from_dict({"tts": HEART, "stt": BASE}).face_python is None
    chosen = VoiceChoice.from_dict({"tts": HEART, "stt": BASE, "face": {"python": absolute}})
    assert chosen.face_python == absolute
    assert (
        VoiceChoice.from_dict({"tts": HEART, "stt": BASE, "face": {"python": " "}}).face_python
        is None
    )
    for bad in (
        {"python": "python"},
        {"python": 3},
        "python",
        {"python": absolute.replace("envs", "en\nvs")},
    ):
        with pytest.raises(ConfigError):
            VoiceChoice.from_dict({"tts": HEART, "stt": BASE, "face": bad})


def test_a_put_without_face_keeps_the_helper_and_the_engines_say_whether_her_face_is_live(
    tmp_path: Path,
) -> None:
    lay_out_kokoro(tmp_path / "personas")
    lay_out_whisper_model(tmp_path / "personas")
    face_log = tmp_path / "face.jsonl"
    studio = _studio(tmp_path, fake_face.command("visemes", face_log))
    absolute = str(Path(os.path.abspath(os.sep)) / "envs" / "face" / "python.exe")

    view = studio.update({"tts": HEART, "stt": BASE, "face": {"python": absolute}})
    assert view["face"] == {"python": absolute}
    view = studio.update({"tts": HEART, "stt": BASE})
    assert view["face"] == {"python": absolute}

    _ready(studio.face)
    row = next(e for e in studio.view()["engines"] if e["id"] == "face")
    assert (row["direction"], row["state"], row["visemes"], row["motion"]) == (
        "face",
        "ready",
        True,
        False,
    )
    speaker, _ = studio.speaker("af_heart")
    assert isinstance(speaker, kokoro.KokoroTTS) and speaker.face is studio.face

    view = studio.update({"tts": HEART, "stt": BASE, "face": {"python": None}})
    row = next(e for e in view["engines"] if e["id"] == "face")
    assert row["state"] == "absent"


# -- the real helper, when one is set up -----------------------------------------------------------


@pytest.mark.skipif(
    not os.environ.get("ATHENA_FACE_PYTHON"),
    reason="ATHENA_FACE_PYTHON names no face environment to run the real helper in",
)
def test_the_real_helper_gives_a_real_sentence_shapes_that_cover_its_audio(tmp_path: Path) -> None:
    from athena.channels.voice.home import resolve_homes

    homes = resolve_homes()
    if not kokoro.probe(homes).ready:
        pytest.skip("Kokoro is not installed in the engine home")
    helper = FaceHelper(
        os.environ["ATHENA_FACE_PYTHON"],
        kokoro_dir=homes.kokoro_dir,
        cache_dir=tmp_path / "face",
    )
    _ready(helper, timeout=180)
    tts = kokoro.KokoroTTS(homes, face=helper)
    line = Line()

    pcm = line.play(tts.synthesize_face("Do you want me to send it now?", line.emit))

    (visemes,) = line.events("voice.visemes")
    segments = visemes.visemes
    assert segments[0][1] == 0 and segments[-1][2] == len(pcm) // 2
    assert all(a[2] == b[1] for a, b in itertools.pairwise(segments))
    assert {"PP", "ou"} <= {v for v, _, _ in segments}  # "me", "you"
    helper.stop()

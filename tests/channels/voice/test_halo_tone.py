"""Her halo tone wired in: the layer, the choice that names it, Kokoro laying it on, the fallback.

voice-io / ADR 0138 (Athena speaks with a halo).

The layer's own promises (``ether.apply``): the length is kept, ``natural`` is the identity, an
unknown tone is refused, and the same input gives the same bytes. Those that need numpy are skipped
with the reason when it is missing. Then the wiring: ``tts.tone`` defaults to ``halo``, persists,
and survives a body that leaves it out; Kokoro lays it over each sentence after her face was worked
out on the dry audio; and without numpy she speaks natural and the view says so in one plain line.
"""

from __future__ import annotations

import json
import math
import struct
import threading
import time
from pathlib import Path
from typing import Any

import pytest

from athena.channels.voice import ether, kokoro
from athena.channels.voice.backends import ComposedBackend, ScriptedBackend
from athena.channels.voice.config import (
    DEFAULT_CHOICE,
    TONE_UNAVAILABLE_NOTE,
    ConfigError,
    VoiceChoice,
    VoiceStudio,
    load_choice,
    save_choice,
)
from athena.channels.voice.face import FaceHelper
from athena.channels.voice.home import EngineHomes
from athena.connectors.seal import FileSeal
from athena.contracts.channel import ChannelEvent
from channels import fake_face
from channels.fake_engine import command, lay_out_kokoro, lay_out_whisper_model

SR = kokoro.SAMPLE_RATE
TWO = "The first sentence is here. And the second one follows it."

needs_numpy = pytest.mark.skipif(
    not ether.available(), reason="the halo tone needs numpy (the 'voice-fx' extra)"
)


def _tone_pcm(seconds: float = 0.6) -> bytes:
    """A voiced-ish test signal: two partials with a slow swell, PCM16LE mono at 24 kHz."""
    n = int(SR * seconds)
    samples = (
        int(
            9000
            * math.sin(math.pi * i / n)
            * (math.sin(2 * math.pi * 220 * i / SR) + 0.4 * math.sin(2 * math.pi * 660 * i / SR))
        )
        for i in range(n)
    )
    return struct.pack(f"<{n}h", *samples)


def _no_numpy(monkeypatch: pytest.MonkeyPatch) -> None:
    def gone() -> Any:
        raise ether.EtherUnavailable("numpy is not installed")

    monkeypatch.setattr(ether, "_np", gone)


# -- the layer -------------------------------------------------------------------------------------


@needs_numpy
def test_the_halo_keeps_every_sample_and_changes_the_sound() -> None:
    dry = _tone_pcm()
    wet = ether.apply(dry, SR, "halo")
    assert len(wet) == len(dry)
    assert wet != dry


@needs_numpy
def test_the_same_line_gives_the_same_bytes() -> None:
    dry = _tone_pcm(0.4)
    assert ether.apply(dry, SR, "halo") == ether.apply(dry, SR, "halo")


def test_natural_is_the_identity_and_needs_nothing(monkeypatch: pytest.MonkeyPatch) -> None:
    _no_numpy(monkeypatch)
    dry = _tone_pcm(0.1)
    assert ether.apply(dry, SR, "natural") is dry


def test_an_unknown_tone_is_refused() -> None:
    with pytest.raises(ValueError, match="unknown tone"):
        ether.apply(_tone_pcm(0.1), SR, "choir")


def test_without_numpy_the_halo_raises_naming_the_extra(monkeypatch: pytest.MonkeyPatch) -> None:
    _no_numpy(monkeypatch)
    assert ether.available() is False
    with pytest.raises(ether.EtherUnavailable):
        ether.apply(_tone_pcm(0.1), SR, "halo")


# -- the choice ------------------------------------------------------------------------------------


def test_the_default_tone_is_halo_and_it_lives_with_the_voice() -> None:
    assert DEFAULT_CHOICE.tone == "halo" == ether.TONE_DEFAULT
    assert DEFAULT_CHOICE.to_dict()["tts"] == {
        "engine": "kokoro",
        "voice": "af_heart",
        "tone": "halo",
    }


def test_the_tone_persists_and_a_file_without_one_is_halo(tmp_path: Path) -> None:
    save_choice(tmp_path, VoiceChoice(tone="natural"))
    assert load_choice(tmp_path).tone == "natural"
    saved = json.loads((tmp_path / "config.json").read_text(encoding="utf-8"))
    assert saved["tts"]["tone"] == "natural"

    # A file written before the tone existed.
    del saved["tts"]["tone"]
    (tmp_path / "config.json").write_text(json.dumps(saved), encoding="utf-8")
    assert load_choice(tmp_path).tone == "halo"


def test_an_unknown_tone_in_a_body_is_refused() -> None:
    body = {
        "tts": {"engine": "kokoro", "voice": "af_heart", "tone": "choir"},
        "stt": {"engine": "whisper"},
    }
    with pytest.raises(ConfigError, match="unknown tone"):
        VoiceChoice.from_dict(body)


def _studio(tmp_path: Path) -> VoiceStudio:
    log = tmp_path / "runs.jsonl"
    lay_out_kokoro(tmp_path / "personas")
    lay_out_whisper_model(tmp_path / "personas", "base.en")
    return VoiceStudio(
        tmp_path / "voice",
        homes=EngineHomes(tmp_path / "personas"),
        seal=FileSeal(tmp_path / "voice" / "sealed"),
        environ={},
        kokoro_command=command("kokoro", log),
        whisper_command=command("whisper", log),
    )


def test_a_put_without_a_tone_keeps_the_saved_one_and_the_speaker_carries_it(
    tmp_path: Path,
) -> None:
    studio = _studio(tmp_path)
    heart = {"engine": "kokoro", "voice": "af_heart"}
    studio.update({"tts": {**heart, "tone": "natural"}, "stt": {"engine": "whisper"}})
    view = studio.update({"tts": heart, "stt": {"engine": "whisper"}})

    assert view["tts"]["tone"] == "natural"
    assert load_choice(tmp_path / "voice").tone == "natural"
    speaker, _ = studio.speaker("af_heart")
    assert isinstance(speaker, kokoro.KokoroTTS) and speaker.tone == "natural"
    halo, _ = studio.speaker("af_heart", "halo")
    assert isinstance(halo, kokoro.KokoroTTS) and halo.tone == "halo"

    studio.update({"tts": {**heart, "tone": "halo"}, "stt": {"engine": "whisper"}})
    composed, _ = studio.compose(studio.choice)
    assert isinstance(composed, ComposedBackend)
    assert isinstance(composed.speaker, kokoro.KokoroTTS) and composed.speaker.tone == "halo"


def test_without_numpy_the_view_says_she_speaks_natural_and_why(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    _no_numpy(monkeypatch)
    view = _studio(tmp_path).view()
    assert view["tts"]["tone"] == "halo", "the choice is kept; only what is heard changes"
    assert (view["tone"], view["tone_available"]) == ("natural", False)
    assert view["tone_note"] == TONE_UNAVAILABLE_NOTE
    assert "add-on" in TONE_UNAVAILABLE_NOTE and "natural tone" in TONE_UNAVAILABLE_NOTE


def test_a_natural_choice_needs_no_note_and_a_pin_speaks_natural(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _no_numpy(monkeypatch)
    assert VoiceStudio.tone_view(VoiceChoice(tone="natural"))["tone_note"] is None
    monkeypatch.undo()
    pinned = VoiceStudio.tone_view(VoiceChoice(), pinned=True)
    assert pinned["tone"] == "natural"


def test_a_pinned_backend_is_reported_natural(tmp_path: Path) -> None:
    studio = _studio(tmp_path)
    studio.attach(_Slot(), pinned=ScriptedBackend())  # type: ignore[arg-type]
    assert studio.view()["tone"] == "natural"


class _Slot:
    def swap(self, backend: object, reason: str | None = None) -> None:
        self.backend = backend


# -- kokoro lays it on -----------------------------------------------------------------------------


@pytest.fixture
def homes(tmp_path: Path) -> EngineHomes:
    homes = EngineHomes(tmp_path / "personas")
    lay_out_kokoro(homes.root)
    return homes


def _speak(homes: EngineHomes, tmp_path: Path, tone: str, name: str) -> bytes:
    tts = kokoro.KokoroTTS(homes, command=command("kokoro", tmp_path / f"{name}.jsonl"), tone=tone)
    return b"".join(tts.synthesize(TWO))


@needs_numpy
def test_kokoro_in_the_halo_speaks_the_same_length_and_different_bytes(
    homes: EngineHomes, tmp_path: Path
) -> None:
    natural = _speak(homes, tmp_path, "natural", "a")
    halo = _speak(homes, tmp_path, "halo", "b")
    assert len(halo) == len(natural)
    assert halo != natural


def test_kokoro_without_numpy_speaks_the_dry_sentence(
    homes: EngineHomes, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    natural = _speak(homes, tmp_path, "natural", "a")
    _no_numpy(monkeypatch)
    assert _speak(homes, tmp_path, "halo", "b") == natural


def test_a_failing_layer_costs_the_sentence_nothing(
    homes: EngineHomes, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    natural = _speak(homes, tmp_path, "natural", "a")

    def broken(pcm: bytes, sample_rate: int, tone: str = "halo") -> bytes:
        raise RuntimeError("a bug in the layer")

    monkeypatch.setattr(ether, "apply", broken)
    assert _speak(homes, tmp_path, "halo", "b") == natural


class _Line:
    def __init__(self) -> None:
        self.lock = threading.Lock()
        self.events: list[ChannelEvent] = []

    def emit(self, event: ChannelEvent) -> None:
        with self.lock:
            self.events.append(event)


@needs_numpy
def test_her_face_is_worked_out_on_the_dry_audio_and_still_lines_up(
    homes: EngineHomes, tmp_path: Path
) -> None:
    log = tmp_path / "face.jsonl"
    helper = FaceHelper(
        "python",
        kokoro_dir=homes.kokoro_dir,
        cache_dir=tmp_path / "face-cache",
        command=fake_face.command("visemes", log),
    )
    deadline = time.monotonic() + 10
    while not helper.probe().ready and time.monotonic() < deadline:
        time.sleep(0.02)
    assert helper.probe().ready
    try:
        plain = kokoro.KokoroTTS(homes, command=command("kokoro", tmp_path / "a.jsonl"))
        faced = kokoro.KokoroTTS(
            homes, command=command("kokoro", tmp_path / "b.jsonl"), face=helper, tone="halo"
        )
        line = _Line()
        dry = b"".join(plain.synthesize(TWO))
        wet = b"".join(faced.synthesize_face(TWO, line.emit))

        assert len(wet) == len(dry) and wet != dry
        sent = [m for m in fake_face.received(log) if m.get("type") == "sentence"]
        assert sum(int(m["pcm_samples"]) for m in sent) == len(dry) // 2  # type: ignore[call-overload]
        visemes = [e for e in line.events if e.kind == "voice.visemes"]
        assert len(visemes) == 2, "the mouth shapes still match a sentence of the same length"
    finally:
        helper.stop()

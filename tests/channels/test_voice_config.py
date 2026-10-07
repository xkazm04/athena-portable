"""The studio's choice: validation, persistence, readiness, the sealed key and the live swap.

voice-io / ADR 0028 (Athena's voice is set up in a studio), README section 3.1.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import pytest

from athena.channels.voice.backends import ComposedBackend, ScriptedBackend, VoiceBackend
from athena.channels.voice.config import (
    DEFAULT_CHOICE,
    OFF_REASON,
    ConfigError,
    VoiceChoice,
    VoiceStudio,
    load_choice,
    save_choice,
)
from athena.channels.voice.home import EngineHomes
from athena.connectors.seal import FileSeal

from .fake_engine import command, lay_out_kokoro, lay_out_whisper_model

KEY = "sk-test-not-a-real-key-0123456789"


class Slot:
    """What the studio feeds: a gateway's :meth:`swap`, recorded."""

    def __init__(self) -> None:
        self.backend: VoiceBackend | None = None
        self.reason: str | None = None
        self.swaps = 0

    def swap(self, backend: VoiceBackend | None, reason: str | None = None) -> None:
        self.backend, self.reason = backend, reason
        self.swaps += 1


def _studio(tmp_path: Path, environ: dict[str, str] | None = None) -> VoiceStudio:
    log = tmp_path / "runs.jsonl"
    return VoiceStudio(
        tmp_path / "voice",
        homes=EngineHomes(tmp_path / "personas"),
        seal=FileSeal(tmp_path / "voice" / "sealed"),
        environ=environ or {},
        kokoro_command=command("kokoro", log),
        whisper_command=command("whisper", log),
    )


def _attach(studio: VoiceStudio, **kwargs: Any) -> Slot:
    slot = Slot()
    studio.attach(slot, **kwargs)  # type: ignore[arg-type]
    return slot


# -- the choice --------------------------------------------------------------------------------


def test_the_default_is_kokoro_heart_and_local_base_en() -> None:
    assert DEFAULT_CHOICE.to_dict() == {
        "tts": {"engine": "kokoro", "voice": "af_heart"},
        "stt": {"engine": "whisper", "model": "base.en"},
    }


@pytest.mark.parametrize(
    "body",
    [
        {"tts": {"engine": "piper", "voice": "af_heart"}, "stt": {"engine": "whisper"}},
        {"tts": {"engine": "kokoro", "voice": "af_nobody"}, "stt": {"engine": "whisper"}},
        {"tts": {"engine": "kokoro", "voice": "af_heart"}, "stt": {"engine": "deepgram"}},
        {
            "tts": {"engine": "kokoro", "voice": "af_heart"},
            "stt": {"engine": "whisper", "model": "large-v3"},
        },
        {"tts": {"engine": "kokoro", "voice": "af_heart"}},
        [],
    ],
)
def test_an_unknown_id_is_refused(body: Any) -> None:
    with pytest.raises(ConfigError):
        VoiceChoice.from_dict(body)


def test_a_cloud_listener_has_no_model_and_a_local_one_defaults_to_base_en() -> None:
    heart = {"engine": "kokoro", "voice": "af_heart"}
    cloud = VoiceChoice.from_dict({"tts": heart, "stt": {"engine": "openai", "model": "x"}})
    assert cloud.stt_model is None
    local = VoiceChoice.from_dict({"tts": heart, "stt": {"engine": "whisper"}})
    assert local.stt_model == "base.en"


def test_the_choice_persists_and_a_bad_file_is_the_defaults(tmp_path: Path) -> None:
    root = tmp_path / "voice"
    assert load_choice(root) == DEFAULT_CHOICE
    chosen = VoiceChoice(stt_engine="whisper", stt_model="small.en")
    save_choice(root, chosen)
    assert load_choice(root) == chosen
    assert json.loads((root / "config.json").read_text(encoding="utf-8"))["stt"]["model"] == (
        "small.en"
    )
    (root / "config.json").write_text("{not json", encoding="utf-8")
    assert load_choice(root) == DEFAULT_CHOICE
    (root / "config.json").write_text(json.dumps({"tts": {"engine": "evil"}}), encoding="utf-8")
    assert load_choice(root) == DEFAULT_CHOICE


# -- readiness and the swap ----------------------------------------------------------------------


def test_an_empty_home_is_not_ready_and_says_the_first_reason(tmp_path: Path) -> None:
    studio = _studio(tmp_path)
    slot = _attach(studio)
    view = studio.view()

    assert view["ready"] is False
    assert view["reason"].startswith("Kokoro is not installed: model.onnx is missing")
    assert slot.backend is None and slot.reason == view["reason"]
    assert view["home"] == str(tmp_path / "personas")
    # The null convention: every key of every engine is present, absent values are None.
    keys = {"id", "direction", "kind", "state", "reason", "size_mb", "voices", "models"}
    assert all(set(engine) == keys for engine in view["engines"])
    whisper = next(e for e in view["engines"] if e["id"] == "whisper")
    assert whisper["size_mb"] is None
    assert {"id": "base.en", "size_mb": 142, "installed": False} in whisper["models"]


def test_ready_needs_the_chosen_whisper_model_and_then_swaps_a_composed_backend(
    tmp_path: Path,
) -> None:
    lay_out_kokoro(tmp_path / "personas")
    studio = _studio(tmp_path)
    slot = _attach(studio)
    assert studio.view()["reason"] == "The Whisper model base.en is not installed."

    lay_out_whisper_model(tmp_path / "personas", "base.en")
    view = studio.view()

    assert view["ready"] is True and view["reason"] is None
    assert isinstance(slot.backend, ComposedBackend)
    assert slot.backend.name == "kokoro+whisper"
    assert slot.backend.sample_rate == 24_000


def test_a_put_persists_and_swaps_live(tmp_path: Path) -> None:
    lay_out_kokoro(tmp_path / "personas")
    lay_out_whisper_model(tmp_path / "personas", "base.en")
    studio = _studio(tmp_path)
    slot = _attach(studio)
    assert slot.backend is not None

    view = studio.update(
        {"tts": {"engine": "kokoro", "voice": "af_heart"}, "stt": {"engine": "openai"}}
    )

    assert view["stt"] == {"engine": "openai", "model": None}
    assert view["ready"] is False
    assert slot.backend is None
    assert "OpenAI key" in str(slot.reason)
    assert load_choice(tmp_path / "voice").stt_engine == "openai"
    # A fresh studio over the same root reads the saved choice back.
    assert _studio(tmp_path).choice.stt_engine == "openai"


def test_a_pin_outranks_the_choice_and_off_leaves_the_slot_empty(tmp_path: Path) -> None:
    pinned = ScriptedBackend()
    studio = _studio(tmp_path)
    slot = _attach(studio, pinned=pinned)
    studio.update({"tts": {"engine": "kokoro", "voice": "af_heart"}, "stt": {"engine": "openai"}})
    assert slot.backend is pinned
    # The view reports the socket, not the choice: the home here is empty, the pin still speaks.
    view = studio.view()
    assert view["ready"] is True and view["reason"] is None

    off = _studio(tmp_path / "off")
    off_slot = _attach(off, off=True)
    off_view = off.view()
    assert off_slot.backend is None and off_slot.reason == OFF_REASON
    assert off_view["ready"] is False and off_view["reason"] == OFF_REASON


# -- the key -------------------------------------------------------------------------------------


def test_the_sealed_key_comes_first_the_environment_second_and_neither_is_in_the_view(
    tmp_path: Path,
) -> None:
    lay_out_kokoro(tmp_path / "personas")
    studio = _studio(tmp_path, environ={"OPENAI_API_KEY": "sk-from-the-environment"})
    slot = _attach(studio)
    studio.update({"tts": {"engine": "kokoro", "voice": "af_heart"}, "stt": {"engine": "openai"}})
    assert studio.openai_key() == "sk-from-the-environment"
    assert slot.backend is not None

    studio.set_key("openai", KEY)
    assert studio.openai_key() == KEY
    assert KEY not in json.dumps(studio.view())
    assert KEY not in repr(slot.backend)

    studio.delete_key("openai")
    assert studio.openai_key() == "sk-from-the-environment"


def test_a_key_is_one_token_for_a_known_provider(tmp_path: Path) -> None:
    studio = _studio(tmp_path)
    with pytest.raises(ConfigError):
        studio.set_key("anthropic", KEY)
    with pytest.raises(ConfigError):
        studio.set_key("openai", "two words")
    with pytest.raises(ConfigError):
        studio.set_key("openai", "")

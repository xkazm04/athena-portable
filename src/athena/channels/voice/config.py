"""voice-io / ADR 0028 (Athena's voice is set up in a studio), README section 3.1.

The studio: which engine speaks, which one hears, whether each is ready, and the live swap.

**The choice is a file.** ``ATHENA_HOME/voice/config.json`` holds two picks and nothing else —
``{"tts": {"engine", "voice"}, "stt": {"engine", "model"}}`` — defaulting to Kokoro's Heart and
the local ``base.en`` whisper model. A missing or unreadable file is the defaults, never an error:
a person who has not opened the studio still has a voice to be onboarded into. Ids are validated
against the catalogs in code, so a hand-edited file cannot name a model this build would then
build a path from.

**Readiness is probed, not remembered.** Every view re-reads the engine home (the dry check is
cached per file version, :mod:`athena.channels.voice.home`), because the files can change under a
running daemon — an install finishing here, or Personas installing beside it. ``ready`` is the
chosen speaker ready *and* the chosen listener ready (for whisper: the engine and the chosen
model); ``reason`` is the first sentence of why not.

**The swap is live.** :meth:`VoiceStudio.refresh` composes a backend from the choice and hands it
to the gateway — or hands it ``None`` with the reason, which is what a ``start`` on the socket is
then refused with. A daemon started with a pinned backend (``--voice-backend openai`` or a test's
scripted one) keeps the pin, and one started with ``--voice-backend none`` keeps an empty slot:
either way the choice is still saved, and applies when the daemon is next started without one.
While the slot is empty the gateway asks again on every press, so an engine installed beside a
running daemon is heard without anyone opening the studio first.

**The provider key is sealed.** ``PUT /voice/key`` seals it with the connectors' seal
(:mod:`athena.connectors.seal`) under ``voice.openai``; the environment variable is the fallback.
The key is read when a backend is composed and is never in a view, a reason or an error.
"""

from __future__ import annotations

import json
import os
import threading
from collections.abc import Callable, Mapping, Sequence
from dataclasses import dataclass
from pathlib import Path
from typing import TYPE_CHECKING, Any

from athena.channels.voice import kokoro, whisper
from athena.channels.voice.backends import (
    OPENAI_KEY_ENV,
    ComposedBackend,
    Listener,
    OpenAIBackend,
    Speaker,
    VoiceBackend,
)
from athena.channels.voice.home import EngineHomes, EngineProbe, resolve_homes
from athena.channels.voice.install import Installer, Sources
from athena.connectors.seal import SealPort, SealUnavailable, select_seal

if TYPE_CHECKING:
    from athena.channels.voice.gateway import VoiceGateway

__all__ = [
    "CONFIG_FILENAME",
    "DEFAULT_CHOICE",
    "KEY_PROVIDERS",
    "STT_ENGINES",
    "TTS_ENGINES",
    "ConfigError",
    "VoiceChoice",
    "VoiceStudio",
    "load_choice",
    "save_choice",
]

CONFIG_FILENAME = "config.json"
TTS_ENGINES: tuple[str, ...] = ("kokoro",)
STT_ENGINES: tuple[str, ...] = ("whisper", "openai")
KEY_PROVIDERS: tuple[str, ...] = ("openai",)
#: The seal handle the provider key rests under.
OPENAI_SEAL_NAME = "voice.openai"
#: What the socket says when the daemon was started with voice switched off.
OFF_REASON = "Voice was switched off when the daemon started (--voice-backend none)."
#: A key longer than this is not a key.
MAX_KEY_CHARS = 512


class ConfigError(ValueError):
    """A choice names something this build does not have. The message says what."""


@dataclass(frozen=True)
class VoiceChoice:
    tts_engine: str = "kokoro"
    tts_voice: str = "af_heart"
    stt_engine: str = "whisper"
    #: The whisper model; ``None`` for a listener that has no local model.
    stt_model: str | None = whisper.DEFAULT_MODEL

    def to_dict(self) -> dict[str, Any]:
        return {
            "tts": {"engine": self.tts_engine, "voice": self.tts_voice},
            "stt": {"engine": self.stt_engine, "model": self.stt_model},
        }

    @classmethod
    def from_dict(cls, raw: Any) -> VoiceChoice:
        """Validate a body or a file. Unknown engine, voice or model raises :class:`ConfigError`."""
        if not isinstance(raw, Mapping):
            raise ConfigError("a voice config is an object with tts and stt")
        tts, stt = raw.get("tts"), raw.get("stt")
        if not isinstance(tts, Mapping) or not isinstance(stt, Mapping):
            raise ConfigError("a voice config has a tts object and an stt object")
        tts_engine = str(tts.get("engine", ""))
        if tts_engine not in TTS_ENGINES:
            raise ConfigError(f"unknown tts engine {tts_engine!r}; one of {', '.join(TTS_ENGINES)}")
        voice = str(tts.get("voice", ""))
        if kokoro.find_voice(voice) is None:
            names = ", ".join(v.id for v in kokoro.VOICES)
            raise ConfigError(f"unknown voice {voice!r}; one of {names}")
        stt_engine = str(stt.get("engine", ""))
        if stt_engine not in STT_ENGINES:
            raise ConfigError(f"unknown stt engine {stt_engine!r}; one of {', '.join(STT_ENGINES)}")
        model: str | None = None
        if stt_engine == "whisper":
            asked = stt.get("model")
            model = whisper.DEFAULT_MODEL if asked is None else str(asked)
            if whisper.find_model(model) is None:
                names = ", ".join(m.id for m in whisper.MODELS)
                raise ConfigError(f"unknown whisper model {model!r}; one of {names}")
        return cls(tts_engine, voice, stt_engine, model)


DEFAULT_CHOICE = VoiceChoice()


def load_choice(root: Path) -> VoiceChoice:
    """The saved choice, or the defaults when there is none or it does not validate."""
    path = root / CONFIG_FILENAME
    try:
        return VoiceChoice.from_dict(json.loads(path.read_text(encoding="utf-8")))
    except (OSError, ValueError):
        return DEFAULT_CHOICE


def save_choice(root: Path, choice: VoiceChoice) -> None:
    """Written whole and swapped in, so a reader never sees half a file."""
    root.mkdir(parents=True, exist_ok=True)
    path = root / CONFIG_FILENAME
    tmp = path.with_suffix(".json.tmp")
    tmp.write_text(json.dumps(choice.to_dict(), indent=2), encoding="utf-8")
    os.replace(tmp, path)


class VoiceStudio:
    """The choice, the probes, the key, the installer, and the gateway they feed."""

    def __init__(
        self,
        root: str | Path,
        *,
        homes: EngineHomes | None = None,
        seal: SealPort | None = None,
        environ: Mapping[str, str] | None = None,
        kokoro_command: Sequence[str] | None = None,
        whisper_command: Sequence[str] | None = None,
        sources: Sources | None = None,
        platform: str | None = None,
        openai_factory: Callable[[str], OpenAIBackend] | None = None,
    ) -> None:
        self.root = Path(root)
        self.environ: Mapping[str, str] = os.environ if environ is None else environ
        self.homes = homes if homes is not None else resolve_homes(self.environ)
        self._seal = seal
        self._seal_tried = seal is not None
        self.kokoro_command = kokoro_command
        self.whisper_command = whisper_command
        self.openai_factory = openai_factory or (lambda key: OpenAIBackend(api_key=key))
        self._lock = threading.RLock()
        self.choice = load_choice(self.root)
        self.gateway: VoiceGateway | None = None
        #: A backend the daemon was started with, which outranks the choice (``--voice-backend``).
        self.pinned: VoiceBackend | None = None
        #: Voice switched off at start (``--voice-backend none``): the slot stays empty.
        self.off = False
        installer_args: dict[str, Any] = {"homes": self.homes, "on_done": self._installed}
        if sources is not None:
            installer_args["sources"] = sources
        if platform is not None:
            installer_args["platform"] = platform
        if kokoro_command is not None:
            installer_args["kokoro_ready"] = lambda: self.probe_kokoro().ready
        if whisper_command is not None:
            installer_args["whisper_ready"] = lambda model: (
                self.probe_whisper().ready and whisper.model_installed(self.homes, model)
            )
        self.installer = Installer(**installer_args)

    # -- the gateway -------------------------------------------------------------------------------

    def attach(
        self, gateway: VoiceGateway, *, pinned: VoiceBackend | None = None, off: bool = False
    ) -> None:
        """Feed ``gateway`` from now on: the pin if there is one, nothing if voice was switched
        off at start, else the composed choice."""
        with self._lock:
            self.gateway = gateway
            self.pinned = pinned
            self.off = off
            gateway.recheck = self.refresh
        self.refresh()

    def refresh(self) -> tuple[VoiceBackend | None, str | None]:
        """Compose the choice and swap it into the gateway. Returns what the gateway now has."""
        with self._lock:
            backend: VoiceBackend | None
            reason: str | None
            if self.pinned is not None:
                backend, reason = self.pinned, None
            elif self.off:
                backend, reason = None, OFF_REASON
            else:
                backend, reason = self.compose(self.choice)
            if self.gateway is not None:
                self.gateway.swap(backend, reason)
            return backend, reason

    def _installed(self, component: str) -> None:
        self.refresh()

    # -- probes ------------------------------------------------------------------------------------

    def probe_kokoro(self) -> EngineProbe:
        return kokoro.probe(self.homes, command=self.kokoro_command)

    def probe_whisper(self) -> EngineProbe:
        return whisper.probe(self.homes, command=self.whisper_command)

    def probe_openai(self) -> EngineProbe:
        if self.openai_key():
            return EngineProbe("ready")
        return EngineProbe(
            "absent",
            "No OpenAI key is set; add one in the voice studio to transcribe in the cloud.",
        )

    def speaker(self, voice_id: str) -> tuple[Speaker | None, str | None]:
        voice = kokoro.find_voice(voice_id)
        if voice is None:
            return None, f"Kokoro has no voice {voice_id!r}."
        found = self.probe_kokoro()
        if not found.ready:
            return None, found.reason
        return kokoro.KokoroTTS(self.homes, voice, command=self.kokoro_command), None

    def listener(self, engine: str, model: str | None = None) -> tuple[Listener | None, str | None]:
        if engine == "openai":
            key = self.openai_key()
            if not key:
                return None, self.probe_openai().reason
            return self.openai_factory(key), None
        if engine == "whisper":
            model_id = model or whisper.DEFAULT_MODEL
            found = self.probe_whisper()
            if not found.ready:
                return None, found.reason
            if not whisper.model_installed(self.homes, model_id):
                return None, f"The Whisper model {model_id} is not installed."
            return whisper.WhisperSTT(self.homes, model_id, command=self.whisper_command), None
        return None, f"There is no speech-to-text engine {engine!r}."

    def compose(self, choice: VoiceChoice) -> tuple[VoiceBackend | None, str | None]:
        """The backend the choice describes, or ``None`` and the first reason it cannot be."""
        speaker, reason = self.speaker(choice.tts_voice)
        if speaker is None:
            return None, reason
        listener, reason = self.listener(choice.stt_engine, choice.stt_model)
        if listener is None:
            return None, reason
        return ComposedBackend(speaker, listener), None

    # -- the view ----------------------------------------------------------------------------------

    def engines(self) -> list[dict[str, Any]]:
        tts, stt, cloud = self.probe_kokoro(), self.probe_whisper(), self.probe_openai()
        return [
            {
                "id": "kokoro",
                "direction": "tts",
                "kind": "local",
                "state": tts.state,
                "reason": tts.reason,
                "size_mb": kokoro.KOKORO_SIZE_MB,
                "voices": [voice.to_dict() for voice in kokoro.VOICES],
                "models": [],
            },
            {
                "id": "whisper",
                "direction": "stt",
                "kind": "local",
                "state": stt.state,
                "reason": stt.reason,
                "size_mb": None,
                "voices": [],
                "models": [
                    {
                        "id": model.id,
                        "size_mb": model.size_mb,
                        "installed": whisper.model_installed(self.homes, model.id),
                    }
                    for model in whisper.MODELS
                ],
            },
            {
                "id": "openai",
                "direction": "stt",
                "kind": "cloud",
                "state": cloud.state,
                "reason": cloud.reason,
                "size_mb": None,
                "voices": [],
                "models": [],
            },
        ]

    def view(self) -> dict[str, Any]:
        """``VoiceConfig`` on the wire. Refreshes the gateway as a side effect, so a file that
        appeared since the last look — an install by Personas — takes effect when it is seen."""
        with self._lock:
            choice = self.choice
            # What the socket has, not what the choice would compose: a pinned backend is ready
            # and an empty slot is not, whatever the engines on disk say.
            _, reason = self.refresh()
        return {
            **choice.to_dict(),
            "engines": self.engines(),
            "ready": reason is None,
            "reason": reason,
            "home": str(self.homes.root),
        }

    def update(self, raw: Any) -> dict[str, Any]:
        """Validate, persist, swap. :class:`ConfigError` for an unknown id, before anything."""
        choice = VoiceChoice.from_dict(raw)
        with self._lock:
            save_choice(self.root, choice)
            self.choice = choice
        return self.view()

    # -- the key -----------------------------------------------------------------------------------

    def _seal_port(self) -> SealPort:
        if not self._seal_tried:
            self._seal_tried = True
            try:
                self._seal = select_seal(self.root / "sealed")
            except SealUnavailable:
                self._seal = None
        if self._seal is None:
            raise SealUnavailable("no seal is available on this machine; the key was not stored")
        return self._seal

    def openai_key(self) -> str:
        """The sealed key, else the environment's, else ``""``."""
        try:
            sealed = self._seal_port().unseal(OPENAI_SEAL_NAME)
        except SealUnavailable:
            sealed = None
        return sealed or self.environ.get(OPENAI_KEY_ENV, "")

    def set_key(self, provider: str, key: str) -> None:
        if provider not in KEY_PROVIDERS:
            raise ConfigError(f"unknown provider {provider!r}; one of {', '.join(KEY_PROVIDERS)}")
        key = key.strip()
        if not key or len(key) > MAX_KEY_CHARS or any(ch.isspace() for ch in key):
            raise ConfigError("the key is empty or is not one token")
        self._seal_port().seal(OPENAI_SEAL_NAME, key)
        self.refresh()

    def delete_key(self, provider: str) -> None:
        if provider not in KEY_PROVIDERS:
            raise ConfigError(f"unknown provider {provider!r}; one of {', '.join(KEY_PROVIDERS)}")
        self._seal_port().destroy(OPENAI_SEAL_NAME)
        self.refresh()

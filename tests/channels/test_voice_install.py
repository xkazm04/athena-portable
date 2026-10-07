"""The installers against a local HTTP server: progress, verify, one-at-a-time, the lock.

voice-io / ADR 0028 (Athena's voice is set up in a studio), README section 3.1.

Nothing here reaches the network or the machine's real engine home: the archives are built in
``tmp_path`` with the layout upstream ships, served from ``127.0.0.1:0``, and the installer is
pointed at them through :class:`Sources` — the one seam production never uses.
"""

from __future__ import annotations

import io
import os
import tarfile
import threading
import time
import zipfile
from collections.abc import Iterator
from dataclasses import dataclass, field
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

import pytest

from athena.channels.voice import kokoro, whisper
from athena.channels.voice.home import EngineHomes
from athena.channels.voice.install import (
    LOCK_FILENAME,
    SOURCES,
    STALE_LOCK_S,
    InstallBusy,
    Installer,
    Sources,
    parse_component,
)

WAIT_S = 20.0


@dataclass
class Files:
    """What the server serves, by path, and how slowly."""

    bodies: dict[str, bytes] = field(default_factory=dict)
    #: Seconds to sleep between 1 KiB chunks for a path; a test that needs a run to be "still
    #: going" serves it slowly.
    slow: dict[str, float] = field(default_factory=dict)
    requested: list[str] = field(default_factory=list)


@pytest.fixture
def files() -> Files:
    return Files()


@pytest.fixture
def server(files: Files) -> Iterator[str]:
    class Handler(BaseHTTPRequestHandler):
        def log_message(self, format: str, *args: object) -> None:
            return

        def do_GET(self) -> None:
            files.requested.append(self.path)
            body = files.bodies.get(self.path)
            if body is None:
                self.send_response(404)
                self.send_header("Content-Length", "0")
                self.end_headers()
                return
            self.send_response(200)
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            delay = files.slow.get(self.path, 0.0)
            try:
                for at in range(0, len(body), 1024):
                    self.wfile.write(body[at : at + 1024])
                    if delay:
                        time.sleep(delay)
            except (BrokenPipeError, ConnectionError):
                pass

    httpd = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    httpd.daemon_threads = True
    thread = threading.Thread(target=httpd.serve_forever, daemon=True)
    thread.start()
    try:
        yield f"http://127.0.0.1:{httpd.server_address[1]}"
    finally:
        httpd.shutdown()
        httpd.server_close()


def _sources(base: str) -> Sources:
    return Sources(
        kokoro_engine=f"{base}/engine.tar.bz2",
        kokoro_model=f"{base}/model.tar.bz2",
        whisper_engine=f"{base}/whisper-bin-x64.zip",
        whisper_models=f"{base}/models",
    )


def _tar(entries: dict[str, bytes], dirs: tuple[str, ...] = ()) -> bytes:
    out = io.BytesIO()
    with tarfile.open(fileobj=out, mode="w:bz2") as tar:
        for name in dirs:
            info = tarfile.TarInfo(name)
            info.type = tarfile.DIRTYPE
            tar.addfile(info)
        for name, data in entries.items():
            info = tarfile.TarInfo(name)
            info.size = len(data)
            tar.addfile(info, io.BytesIO(data))
    return out.getvalue()


def _zip(entries: dict[str, bytes]) -> bytes:
    out = io.BytesIO()
    with zipfile.ZipFile(out, "w") as bundle:
        for name, data in entries.items():
            bundle.writestr(name, data)
    return out.getvalue()


ENGINE_ROOT = "sherpa-onnx-v1.13.4-win-x64-shared-MT-Release"
PREFIX = "kokoro-multi-lang-v1_0"


def _kokoro_archives(files: Files, *, with_model: bool = True, padding: int = 0) -> None:
    files.bodies["/engine.tar.bz2"] = _tar(
        {
            f"{ENGINE_ROOT}/bin/{kokoro.ENGINE_FILENAME}": b"exe",
            f"{ENGINE_ROOT}/bin/onnxruntime.dll": b"dll",
            f"{ENGINE_ROOT}/bin/sherpa-onnx-offline-asr.exe": b"not wanted",
            f"{ENGINE_ROOT}/include/c-api.h": b"not wanted",
        }
    )
    model = {
        f"{PREFIX}/voices.bin": b"voices",
        f"{PREFIX}/tokens.txt": b"tokens",
        f"{PREFIX}/lexicon-us-en.txt": b"lexicon",
        f"{PREFIX}/lexicon-zh.txt": b"not wanted",
        f"{PREFIX}/espeak-ng-data/en_dict": b"dict",
        f"{PREFIX}/padding.bin": os.urandom(padding),
    }
    if with_model:
        model[f"{PREFIX}/model.onnx"] = b"onnx"
    files.bodies["/model.tar.bz2"] = _tar(model, dirs=(f"{PREFIX}/espeak-ng-data",))


def _installer(tmp_path: Path, base: str, **kwargs: object) -> Installer:
    return Installer(
        EngineHomes(tmp_path / "personas"),
        sources=_sources(base),
        platform="win32",
        **kwargs,  # type: ignore[arg-type]
    )


def _settle(installer: Installer) -> str:
    installer.join(WAIT_S)
    return installer.state().state


# -- the component -------------------------------------------------------------------------------


def test_a_component_is_kokoro_or_a_whisper_model_from_the_allowlist() -> None:
    assert parse_component("kokoro") == ("kokoro", None)
    engine, model = parse_component("whisper:small.en")
    assert engine == "whisper" and model is not None and model.id == "small.en"
    for bad in ("piper", "whisper:large-v3", "whisper:../x", "https://evil.example/x.tar.bz2"):
        with pytest.raises(ValueError):
            parse_component(bad)


def test_the_production_sources_are_the_pinned_constants() -> None:
    assert SOURCES.kokoro_engine.endswith(
        "/v1.13.4/sherpa-onnx-v1.13.4-win-x64-shared-MT-Release.tar.bz2"
    )
    assert SOURCES.kokoro_model.endswith("/tts-models/kokoro-multi-lang-v1_0.tar.bz2")
    assert all(
        url.startswith("https://")
        for url in (SOURCES.kokoro_engine, SOURCES.kokoro_model, SOURCES.whisper_engine)
    )


# -- kokoro --------------------------------------------------------------------------------------


def test_kokoro_installs_engine_then_model_and_verifies(
    tmp_path: Path, files: Files, server: str
) -> None:
    _kokoro_archives(files)
    done: list[str] = []
    installer = _installer(tmp_path, server, on_done=done.append)

    first = installer.start("kokoro")

    assert first.state == "downloading_engine" and first.component == "kokoro"
    assert _settle(installer) == "completed"
    homes = installer.homes
    assert kokoro.paths_for(homes).missing() == []
    assert (homes.tts_bin / "onnxruntime.dll").read_bytes() == b"dll"
    assert not (homes.tts_bin / "sherpa-onnx-offline-asr.exe").exists()
    assert not (homes.kokoro_dir / "lexicon-zh.txt").exists()
    assert (homes.kokoro_dir / "espeak-ng-data" / "en_dict").read_bytes() == b"dict"
    assert files.requested == ["/engine.tar.bz2", "/model.tar.bz2"]
    assert done == ["kokoro"]
    assert not (homes.tts / LOCK_FILENAME).exists()
    assert installer.state().to_dict() == {
        "component": "kokoro",
        "state": "completed",
        "received_bytes": 0,
        "total_bytes": None,
        "error": None,
    }


def test_progress_reports_bytes_against_the_declared_total(
    tmp_path: Path, files: Files, server: str
) -> None:
    _kokoro_archives(files, padding=64 * 1024)
    files.slow["/model.tar.bz2"] = 0.01
    installer = _installer(tmp_path, server)
    installer.start("kokoro")

    seen = []
    deadline = time.monotonic() + WAIT_S
    while installer.running and time.monotonic() < deadline:
        seen.append(installer.state())
        time.sleep(0.02)
    downloading = [s for s in seen if s.state == "downloading_model" and s.received_bytes]
    assert downloading, "no progress was reported while the model downloaded"
    total = len(files.bodies["/model.tar.bz2"])
    assert all(s.total_bytes == total and 0 < s.received_bytes <= total for s in downloading)
    assert _settle(installer) == "completed"


def test_an_archive_without_the_model_fails_and_claims_nothing(
    tmp_path: Path, files: Files, server: str
) -> None:
    _kokoro_archives(files, with_model=False)
    installer = _installer(tmp_path, server)
    installer.start("kokoro")

    assert _settle(installer) == "failed"
    assert installer.state().error == "the model archive had no model.onnx"


def test_a_verify_after_extract_catches_a_tree_that_still_will_not_resolve(
    tmp_path: Path, files: Files, server: str
) -> None:
    _kokoro_archives(files)
    installer = _installer(tmp_path, server, kokoro_ready=lambda: False)
    installer.start("kokoro")

    assert _settle(installer) == "failed"
    assert "still not where they belong" in str(installer.state().error)


def test_a_missing_upstream_asset_is_a_failure_naming_the_status(
    tmp_path: Path, files: Files, server: str
) -> None:
    installer = _installer(tmp_path, server)
    installer.start("kokoro")
    assert _settle(installer) == "failed"
    assert installer.state().error == "download of engine.tar.bz2 failed (HTTP 404)"


def test_an_entry_that_climbs_out_of_the_model_directory_is_refused(
    tmp_path: Path, files: Files, server: str
) -> None:
    _kokoro_archives(files)
    files.bodies["/model.tar.bz2"] = _tar(
        {f"{PREFIX}/model.onnx": b"onnx", f"{PREFIX}/../../evil.dll": b"nope"}
    )
    installer = _installer(tmp_path, server)
    installer.start("kokoro")
    assert _settle(installer) == "failed"
    assert "escapes" in str(installer.state().error)
    assert not (tmp_path / "personas" / "evil.dll").exists()


def test_a_second_install_while_one_runs_is_refused(
    tmp_path: Path, files: Files, server: str
) -> None:
    _kokoro_archives(files, padding=32 * 1024)
    files.slow["/engine.tar.bz2"] = 0.05
    installer = _installer(tmp_path, server)
    installer.start("kokoro")

    with pytest.raises(InstallBusy):
        installer.start("whisper:base.en")
    files.slow.clear()
    assert _settle(installer) == "completed"


def test_a_lock_held_by_another_installer_fails_the_run_and_a_stale_one_is_taken_over(
    tmp_path: Path, files: Files, server: str
) -> None:
    _kokoro_archives(files)
    lock = tmp_path / "personas" / "companion-tts" / LOCK_FILENAME
    lock.parent.mkdir(parents=True)
    lock.write_text("{}", encoding="utf-8")
    installer = _installer(tmp_path, server)

    installer.start("kokoro")
    assert _settle(installer) == "failed"
    assert "another install is writing companion-tts" in str(installer.state().error)
    assert files.requested == [], "nothing is downloaded while another installer holds the home"

    old = time.time() - STALE_LOCK_S - 60
    os.utime(lock, (old, old))
    installer.start("kokoro")
    assert _settle(installer) == "completed"
    assert not lock.exists()


def test_off_windows_the_answer_is_manual_and_an_installed_engine_is_not_needed(
    tmp_path: Path, files: Files, server: str
) -> None:
    elsewhere = Installer(EngineHomes(tmp_path / "personas"), platform="linux")
    manual = elsewhere.start("kokoro")
    assert manual.state == "manual"
    assert manual.error is not None and "by hand" in manual.error

    installer = _installer(tmp_path, server, kokoro_ready=lambda: True)
    assert installer.start("kokoro").state == "not_needed"
    assert files.requested == []


# -- whisper -------------------------------------------------------------------------------------


def test_a_whisper_model_brings_whisper_cli_when_it_is_missing(
    tmp_path: Path, files: Files, server: str
) -> None:
    files.bodies["/whisper-bin-x64.zip"] = _zip(
        {
            f"Release/{whisper.ENGINE_CANDIDATES[0]}": b"cli",
            "Release/whisper.dll": b"dll",
            "Release/README.md": b"no",
            "../../evil.exe": b"nope",
        }
    )
    files.bodies["/models/ggml-tiny.en.bin"] = b"ggml" * 100
    installer = _installer(tmp_path, server)

    assert installer.start("whisper:tiny.en").state == "downloading_engine"
    assert _settle(installer) == "completed"
    homes = installer.homes
    assert whisper.engine_path(homes) == homes.stt_bin / whisper.ENGINE_CANDIDATES[0]
    assert whisper.model_installed(homes, "tiny.en")
    assert not (homes.stt_bin / "README.md").exists()
    assert not (tmp_path / "evil.exe").exists()
    assert not list(homes.stt_models.glob("*.partial"))

    files.bodies["/models/ggml-base.en.bin"] = b"ggml"
    assert installer.start("whisper:base.en").state == "downloading_model"
    assert _settle(installer) == "completed"
    assert files.requested.count("/whisper-bin-x64.zip") == 1


def test_a_failed_model_download_leaves_no_partial_file(
    tmp_path: Path, files: Files, server: str
) -> None:
    exe = tmp_path / "personas" / "companion-stt" / "bin" / whisper.ENGINE_CANDIDATES[0]
    exe.parent.mkdir(parents=True)
    exe.write_bytes(b"cli")
    installer = _installer(tmp_path, server)
    installer.start("whisper:small")
    assert _settle(installer) == "failed"
    assert not list((tmp_path / "personas" / "companion-stt" / "models").glob("*"))

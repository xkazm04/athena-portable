"""The installers against a local HTTP server: progress, verify, one-at-a-time, the lock.

voice-io / ADR 0028 (Athena's voice is set up in a studio), README section 3.1.

Nothing here reaches the network or the machine's real engine home: the archives are built in
``tmp_path`` with the layout upstream ships, served from ``127.0.0.1:0``, and the installer is
pointed at them through :class:`Sources` — the one seam production never uses.
"""

from __future__ import annotations

import hashlib
import io
import os
import re
import tarfile
import threading
import time
import zipfile
from collections.abc import Iterator, Mapping
from dataclasses import dataclass, field
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

import pytest

from athena.channels.voice import kokoro, whisper
from athena.channels.voice.home import EngineHomes
from athena.channels.voice.install import (
    DOWNLOAD_CHUNK,
    DOWNLOAD_DEADLINE_S,
    LOCK_FILENAME,
    READ_TIMEOUT_S,
    SOURCES,
    STALE_LOCK_S,
    InstallBusy,
    Installer,
    InstallError,
    Sources,
    _inside,
    _safe_parts,
    extract_kokoro_model,
    extract_sherpa_engine,
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
    #: Paths served without a Content-Length header.
    no_length: set[str] = field(default_factory=set)


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
            if self.path not in files.no_length:
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
    base = f"http://127.0.0.1:{httpd.server_address[1]}"
    _SERVED[base] = files
    try:
        yield base
    finally:
        del _SERVED[base]
        httpd.shutdown()
        httpd.server_close()


#: What each running test server serves, by its base URL, so a test's pins can follow its files.
_SERVED: dict[str, Files] = {}


class _ServedDigests(Mapping[str, str]):
    """The SHA-256 of what the server serves at each URL now: the fixtures' own pins (ADR 0078).

    A path the server does not have is pinned to zeros, so its download still fails on the 404
    that test is about rather than on a missing pin.
    """

    def __init__(self, base: str, files: Files) -> None:
        self.base, self.files = base, files

    def __getitem__(self, url: str) -> str:
        body = self.files.bodies.get(url.removeprefix(self.base))
        return "0" * 64 if body is None else hashlib.sha256(body).hexdigest()

    def __iter__(self) -> Iterator[str]:
        return iter([f"{self.base}{path}" for path in self.files.bodies])

    def __len__(self) -> int:
        return len(self.files.bodies)


class _ServedSizes(Mapping[str, int]):
    """The byte count of what the server serves at each URL now: the fixtures' own size pins.

    A path the server does not have is pinned to 1, so its download still fails on the 404.
    """

    def __init__(self, base: str, files: Files) -> None:
        self.base, self.files = base, files

    def __getitem__(self, url: str) -> int:
        body = self.files.bodies.get(url.removeprefix(self.base))
        return 1 if body is None else len(body)

    def __iter__(self) -> Iterator[str]:
        return iter([f"{self.base}{path}" for path in self.files.bodies])

    def __len__(self) -> int:
        return len(self.files.bodies)


def _sources(
    base: str, sha256: Mapping[str, str] | None = None, size: Mapping[str, int] | None = None
) -> Sources:
    return Sources(
        kokoro_engine=f"{base}/engine.tar.bz2",
        kokoro_model=f"{base}/model.tar.bz2",
        whisper_engine=f"{base}/whisper-bin-x64.zip",
        whisper_models=f"{base}/models",
        sha256=_ServedDigests(base, _SERVED[base]) if sha256 is None else sha256,
        size=_ServedSizes(base, _SERVED[base]) if size is None else size,
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


DRIVE_MEMBER = f"{PREFIX}/espeak-ng-data/D:\\evil.txt"
DRIVE_EXE = f"sherpa/bin/D:{kokoro.ENGINE_FILENAME}"


def _files_under(root: Path) -> set[Path]:
    return {p for p in root.rglob("*") if p.is_file()}


def test_a_colon_in_any_part_of_a_member_name_is_refused() -> None:
    assert _safe_parts(DRIVE_MEMBER) is None
    assert _safe_parts(DRIVE_EXE) is None
    assert _safe_parts(f"{PREFIX}/espeak-ng-data/voices") == (PREFIX, "espeak-ng-data", "voices")


def test_a_kokoro_member_with_a_drive_letter_raises_and_writes_nothing_outside(
    tmp_path: Path,
) -> None:
    archive = tmp_path / "model.tar.bz2"
    archive.write_bytes(_tar({f"{PREFIX}/model.onnx": b"onnx", DRIVE_MEMBER: b"nope"}))
    model_dir = tmp_path / "home" / "model"
    with pytest.raises(InstallError, match="escapes"):
        extract_kokoro_model(archive, model_dir)
    assert all(model_dir in p.parents for p in _files_under(tmp_path / "home"))
    assert _files_under(tmp_path) == {archive, *_files_under(model_dir)}


def test_an_engine_whose_only_exe_has_a_drive_letter_writes_nothing_outside_bin_dir(
    tmp_path: Path,
) -> None:
    archive = tmp_path / "engine.tar.bz2"
    archive.write_bytes(_tar({DRIVE_EXE: b"exe"}))
    bin_dir = tmp_path / "home" / "bin"
    bin_dir.mkdir(parents=True)
    with pytest.raises(InstallError, match=r"had no"):
        extract_sherpa_engine(archive, bin_dir)
    assert _files_under(tmp_path) == {archive}


def test_a_destination_outside_its_home_is_refused_by_name(tmp_path: Path) -> None:
    home = tmp_path / "home"
    home.mkdir()
    assert _inside(home / "a" / "b.dll", home, "a/b.dll") == home / "a" / "b.dll"
    with pytest.raises(InstallError, match=r"x\.dll escapes the engine home; refusing"):
        _inside(tmp_path / "x.dll", home, "x.dll")


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


# -- every byte fetched matches a pinned SHA-256 (ADR 0078) -------------------------------------

_HEX64 = re.compile(r"[0-9a-f]{64}")


def _production_urls() -> list[str]:
    return [
        SOURCES.kokoro_engine,
        SOURCES.kokoro_model,
        SOURCES.whisper_engine,
        *(SOURCES.whisper_model(model) for model in whisper.MODELS),
    ]


def test_every_production_archive_and_whisper_model_has_a_pinned_sha256() -> None:
    urls = _production_urls()
    assert len(urls) == 3 + len(whisper.MODELS) == 9
    for url in urls:
        assert _HEX64.fullmatch(SOURCES.sha256[url]), url
        assert SOURCES.pinned(url) == SOURCES.sha256[url]
    assert set(SOURCES.sha256) == set(urls)


def test_no_production_url_follows_a_moving_branch() -> None:
    for url in [*_production_urls(), SOURCES.whisper_models]:
        assert "/resolve/main" not in url, url
    assert re.search(r"/resolve/[0-9a-f]{40}$", SOURCES.whisper_models)


def _pins_with(base: str, files: Files, path: str, wrong: bytes) -> dict[str, str]:
    """The fixtures' own pins, except that ``path`` is pinned to the digest of other bytes."""
    pins = dict(_ServedDigests(base, files))
    pins[f"{base}{path}"] = hashlib.sha256(wrong).hexdigest()
    return pins


def test_an_engine_archive_that_does_not_match_its_pin_fails_and_leaves_nothing(
    tmp_path: Path, files: Files, server: str
) -> None:
    _kokoro_archives(files)
    installer = Installer(
        EngineHomes(tmp_path / "personas"),
        sources=_sources(server, _pins_with(server, files, "/engine.tar.bz2", b"what was pinned")),
        platform="win32",
    )
    installer.start("kokoro")
    assert _settle(installer) == "failed"
    assert installer.state().error == (
        "engine.tar.bz2 does not match its pinned SHA-256 digest; nothing was installed"
    )
    assert files.requested == ["/engine.tar.bz2"]
    assert _files_under(tmp_path / "personas") == set()


def test_a_whisper_model_that_does_not_match_its_pin_leaves_no_partial_and_no_engine(
    tmp_path: Path, files: Files, server: str
) -> None:
    files.bodies["/whisper-bin-x64.zip"] = _zip({f"Release/{whisper.ENGINE_CANDIDATES[0]}": b"cli"})
    files.bodies["/models/ggml-tiny.en.bin"] = b"ggml" * 100
    installer = Installer(
        EngineHomes(tmp_path / "personas"),
        sources=_sources(
            server, _pins_with(server, files, "/models/ggml-tiny.en.bin", b"the pinned model")
        ),
        platform="win32",
    )
    installer.start("whisper:tiny.en")
    assert _settle(installer) == "failed"
    assert installer.state().error == (
        "ggml-tiny.en.bin does not match its pinned SHA-256 digest; nothing was installed"
    )
    assert _files_under(tmp_path / "personas") == set()


def test_an_archive_that_matches_its_written_pin_installs_as_before(
    tmp_path: Path, files: Files, server: str
) -> None:
    _kokoro_archives(files)
    pins = {
        f"{server}/engine.tar.bz2": hashlib.sha256(files.bodies["/engine.tar.bz2"]).hexdigest(),
        f"{server}/model.tar.bz2": hashlib.sha256(files.bodies["/model.tar.bz2"]).hexdigest(),
    }
    installer = Installer(
        EngineHomes(tmp_path / "personas"), sources=_sources(server, pins), platform="win32"
    )
    installer.start("kokoro")
    assert _settle(installer) == "completed"
    assert kokoro.paths_for(installer.homes).missing() == []


def test_a_component_with_no_pinned_digest_is_never_downloaded(
    tmp_path: Path, files: Files, server: str
) -> None:
    _kokoro_archives(files)
    unpinned = {
        f"{server}/model.tar.bz2": hashlib.sha256(files.bodies["/model.tar.bz2"]).hexdigest()
    }
    installer = Installer(
        EngineHomes(tmp_path / "personas"), sources=_sources(server, unpinned), platform="win32"
    )
    installer.start("kokoro")
    assert _settle(installer) == "failed"
    assert installer.state().error == (
        "engine.tar.bz2 has no pinned SHA-256 digest; it is never downloaded"
    )
    assert files.requested == []
    assert _files_under(tmp_path / "personas") == set()


# -- size and time ceilings (ADR 0078, amended) ----------------------------------------------------


def test_every_production_url_has_a_positive_size_pin_and_the_archives_match_the_adr() -> None:
    for url in _production_urls():
        size = SOURCES.pinned_size(url)
        assert size is not None and size > 0, url
    assert set(SOURCES.size) == set(_production_urls())
    assert SOURCES.pinned_size(SOURCES.kokoro_engine) == 24_378_225
    assert SOURCES.pinned_size(SOURCES.kokoro_model) == 349_906_910
    assert SOURCES.pinned_size(SOURCES.whisper_engine) == 8_194_445


def test_a_run_cannot_outlive_its_own_lock() -> None:
    assert DOWNLOAD_DEADLINE_S + READ_TIMEOUT_S < STALE_LOCK_S


def test_a_size_pin_that_is_not_a_positive_int_is_no_pin() -> None:
    sources = Sources("a", "b", "c", "d", sha256={}, size={"a": 5, "b": 0, "c": -1, "d": True})  # type: ignore[dict-item]
    assert sources.pinned_size("a") == 5
    assert [sources.pinned_size(u) for u in ("b", "c", "d", "e")] == [None] * 4


def test_a_component_with_no_pinned_size_is_never_downloaded(
    tmp_path: Path, files: Files, server: str
) -> None:
    _kokoro_archives(files)
    installer = Installer(
        EngineHomes(tmp_path / "personas"),
        sources=_sources(server, size={f"{server}/model.tar.bz2": 5}),
        platform="win32",
    )
    installer.start("kokoro")
    assert _settle(installer) == "failed"
    assert installer.state().error == "engine.tar.bz2 has no pinned size; it is never downloaded"
    assert files.requested == []
    assert _files_under(tmp_path / "personas") == set()


def test_a_size_pin_that_differs_from_the_content_length_fails_before_a_byte_is_written(
    tmp_path: Path, files: Files, server: str
) -> None:
    _kokoro_archives(files)
    served = len(files.bodies["/engine.tar.bz2"])
    sizes = dict(_ServedSizes(server, files))
    sizes[f"{server}/engine.tar.bz2"] = served + 7
    installer = Installer(
        EngineHomes(tmp_path / "personas"), sources=_sources(server, size=sizes), platform="win32"
    )
    installer.start("kokoro")
    assert _settle(installer) == "failed"
    assert installer.state().error == (
        f"engine.tar.bz2 is {served} bytes upstream, not its pinned {served + 7}; "
        "nothing was downloaded"
    )
    assert installer.state().received_bytes == 0
    assert _files_under(tmp_path / "personas") == set()


def test_a_body_without_content_length_that_passes_its_pin_stops_within_one_chunk(
    tmp_path: Path, files: Files, server: str
) -> None:
    files.bodies["/whisper-bin-x64.zip"] = _zip({f"Release/{whisper.ENGINE_CANDIDATES[0]}": b"cli"})
    pin = 1024
    files.bodies["/models/ggml-tiny.en.bin"] = b"ggml" * (pin * 5 * DOWNLOAD_CHUNK // 4 // pin)
    files.no_length.add("/models/ggml-tiny.en.bin")
    sizes = dict(_ServedSizes(server, files))
    sizes[f"{server}/models/ggml-tiny.en.bin"] = pin
    installer = Installer(
        EngineHomes(tmp_path / "personas"), sources=_sources(server, size=sizes), platform="win32"
    )
    installer.start("whisper:tiny.en")
    assert _settle(installer) == "failed"
    assert installer.state().error == "download of ggml-tiny.en.bin passed its pinned 1024 bytes"
    assert pin < installer.state().received_bytes <= pin + DOWNLOAD_CHUNK
    assert _files_under(tmp_path / "personas") == set()


def test_downloads_that_outlast_the_runs_deadline_fail_and_leave_no_partial(
    tmp_path: Path, files: Files, server: str, monkeypatch: pytest.MonkeyPatch
) -> None:
    from athena.channels.voice import install

    monkeypatch.setattr(install, "DOWNLOAD_DEADLINE_S", 0.3)
    files.bodies["/whisper-bin-x64.zip"] = _zip({f"Release/{whisper.ENGINE_CANDIDATES[0]}": b"cli"})
    files.bodies["/models/ggml-tiny.en.bin"] = b"ggml" * 16 * 1024
    files.slow["/models/ggml-tiny.en.bin"] = 0.02
    installer = _installer(tmp_path, server)
    installer.start("whisper:tiny.en")
    assert _settle(installer) == "failed"
    assert installer.state().error == (
        "download of ggml-tiny.en.bin passed the 0.005-minute limit for one install"
    )
    assert _files_under(tmp_path / "personas") == set()


def test_without_content_length_progress_total_is_the_size_pin(
    tmp_path: Path, files: Files, server: str
) -> None:
    _kokoro_archives(files, padding=64 * 1024)
    files.no_length.update({"/engine.tar.bz2", "/model.tar.bz2"})
    files.slow["/model.tar.bz2"] = 0.01
    installer = _installer(tmp_path, server)
    installer.start("kokoro")
    seen = []
    deadline = time.monotonic() + WAIT_S
    while installer.running and time.monotonic() < deadline:
        seen.append(installer.state())
        time.sleep(0.02)
    total = len(files.bodies["/model.tar.bz2"])
    downloading = [s for s in seen if s.state == "downloading_model" and s.received_bytes]
    assert downloading and all(s.total_bytes == total for s in downloading)
    assert _settle(installer) == "completed"

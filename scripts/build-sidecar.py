"""Freeze ``athena serve`` into the binary the desktop shell spawns (README §3.1; ADR 0015).

    uv sync --extra build --extra voice-fx
    uv run --extra build --extra voice-fx python scripts/build-sidecar.py \
        [--clean] [--target-triple X] [--out DIR]

One PyInstaller one-file binary, named the way Tauri wants an external binary —
``athena-daemon-<target-triple>`` with ``.exe`` on Windows — dropped in
``apps/desktop/src-tauri/binaries/``. Tauri's ``externalBin`` resolves a sidecar by *appending*
the host triple and strips it again when it copies the file next to the executable, so the suffix
is load-bearing rather than decoration: without it the binary is simply not found.

The triple is the *host* triple of the toolchain that will build the shell, which is what
``rustc -vV`` prints. With no rustc on the machine a small table off ``platform`` covers the
triples this project ships, and ``--target-triple`` overrides both. There is no
cross-compilation: a mac build happens on a mac.

**Not committed.** The binary is a build artefact (``.gitignore`` drops
``src-tauri/binaries/athena-daemon-*``); this script is the committed part. The shell falls back
to ``uv run athena serve`` when no binary is there, so a missing build is a slower start and not
a broken app — which is also why PyInstaller is an optional ``build`` extra and not a dev
dependency: the daily loop never runs it.

**numpy goes in** (ADR 0138). Her halo tone (:mod:`athena.channels.voice.ether`) imports numpy
inside a function, so it is a hidden import PyInstaller's analysis cannot see; a build without the
``voice-fx`` extra is refused rather than shipping a sidecar that speaks without her tone.
"""

from __future__ import annotations

import argparse
import os
import platform
import shutil
import subprocess
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
ENTRY = ROOT / "scripts" / "sidecar_entry.py"
OUT_DIR = ROOT / "apps" / "desktop" / "src-tauri" / "binaries"
WORK_DIR = ROOT / "build" / "sidecar"
NAME = "athena-daemon"

#: Used only when there is no rustc to ask. Rust's host triples, per platform.
FALLBACK_TRIPLES = {
    ("win32", "AMD64"): "x86_64-pc-windows-msvc",
    ("win32", "ARM64"): "aarch64-pc-windows-msvc",
    ("darwin", "arm64"): "aarch64-apple-darwin",
    ("darwin", "x86_64"): "x86_64-apple-darwin",
    ("linux", "x86_64"): "x86_64-unknown-linux-gnu",
    ("linux", "aarch64"): "aarch64-unknown-linux-gnu",
}

#: Modules nothing imports at module scope, so PyInstaller's analysis cannot see them.
#: ``athena.daemon.server.serve`` imports ``athena.wiring`` inside the function, because importing
#: the composition root at module scope would make the package graph a cycle; a frozen binary that
#: dropped it would fail at the worst possible moment, which is the first ``athena serve``.
HIDDEN_IMPORTS = [
    "athena.wiring",
    "athena.daemon.server",
    "athena.harness.engines",
    "athena.core.brain.reconcile",
    "sqlite3",
    # Her halo tone (ADR 0138): imported lazily by athena.channels.voice.ether.
    "numpy",
]

#: The dev toolchain never goes inside a shipped binary.
EXCLUDES = ["pytest", "mypy", "ruff", "IPython", "tkinter", "matplotlib"]

#: ``(source, destination inside the bundle)``. A one-file binary unpacks into ``sys._MEIPASS``,
#: and ``athena.core.constitution`` looks there *first* (``Source("frozen", ...)``) precisely so a
#: frozen daemon carries its own law and can never read a sibling's. Ship it under the loader's
#: ``DIRNAME`` and nothing else has to know.
DATAS = [(ROOT / "constitution", "constitution")]

#: The playbook library's JSON, which the adopt studio reads (``athena.adopt.slots`` looks in
#: ``_MEIPASS/playbooks`` first) and its showcase shapes and benches (ADR 0097). Only these
#: files: the stills, thumbnails, films and story media stay out of the binary.
PLAYBOOK_FILES = ("playbook.json", "world.json", "truth.json")
LIBRARY_FILES = ("taxonomy.json",)

#: Package data that lives beside its module, read as ``Path(__file__).parent / ...``, which in a
#: frozen binary is ``_MEIPASS/athena/<package>``: ``athena.adopt.legs`` reads ``tiers.json``
#: (without it ``POST /adopt`` answers 503), and ``athena.connectors.spec`` globs
#: ``connectors/builtin/*.json`` (without them the vault's catalog is silently empty). So every
#: JSON file under ``src/athena`` ships, found rather than listed, and a new connector spec ships
#: the day it lands. The proving ground's are left out: the tier bench's scenarios and the hosted
#: proving server belong to ``python -m athena.proving``, which the sidecar cannot run.
PACKAGE_DATA = "*.json"
PACKAGE_EXCLUDED = ("proving",)

#: Her face helper's scripts (ADR 0120) run in ANOTHER interpreter - the one ``face.python`` names -
#: loaded by path, never imported by the daemon, so PyInstaller's import graph never finds them.
#: They ship as data beside their package, or a frozen daemon reports the helper broken.
HELPER_SCRIPTS = ("channels/voice/face_helper/*.py",)

#: The phone page the beacon serves at ``/m/`` (ADR 0140, WP4): read by ``athena.peer.phone`` as
#: ``Path(__file__).parent / "mobile"``, so it ships beside its module like the JSON above.
PHONE_PAGE = ("peer/mobile/*",)


def package_files(root: Path = ROOT) -> list[tuple[Path, str]]:
    """Every package data file, ``(source, its package's directory in the bundle)``."""
    package = root / "src" / "athena"
    files: list[tuple[Path, str]] = []
    for source in sorted(package.rglob(PACKAGE_DATA)):
        rel = source.relative_to(package)
        if rel.parts[0] in PACKAGE_EXCLUDED or "__pycache__" in rel.parts:
            continue
        files.append((source, (Path("athena") / rel.parent).as_posix()))
    for pattern in (*HELPER_SCRIPTS, *PHONE_PAGE):
        for source in sorted(p for p in package.glob(pattern) if p.is_file()):
            rel = source.relative_to(package)
            files.append((source, (Path("athena") / rel.parent).as_posix()))
    return files


def data_files(root: Path = ROOT) -> list[tuple[Path, str]]:
    """Every single file shipped as data, ``(source, destination directory in the bundle)``.

    PyInstaller's ``--add-data`` takes a directory whole or one file at a time, and a glob would
    flatten ``playbooks/<id>/world.json`` into one directory; so the library is listed file by
    file, each into ``playbooks/<id>``.
    """
    library = root / "playbooks"
    files: list[tuple[Path, str]] = [(library / name, "playbooks") for name in LIBRARY_FILES]
    for directory in sorted(p for p in library.iterdir() if p.is_dir()):
        if not (directory / "playbook.json").is_file():
            continue
        files += [
            (directory / name, f"playbooks/{directory.name}")
            for name in PLAYBOOK_FILES
            if (directory / name).is_file()
        ]
    return files + package_files(root)


def add_data_args(root: Path = ROOT) -> list[str]:
    """The ``--add-data`` arguments: the data directories, then every data file."""
    args: list[str] = []
    for source, dest in DATAS:
        source = root / source.relative_to(ROOT)
        if not source.is_dir():
            raise SystemExit(f"{source} is missing; the frozen daemon would ship without its law")
        args += ["--add-data", f"{source}{os.pathsep}{dest}"]
    for source, dest in data_files(root):
        if not source.is_file():
            raise SystemExit(f"{source} is missing; the frozen daemon would ship without it")
        args += ["--add-data", f"{source}{os.pathsep}{dest}"]
    return args


def target_triple(override: str | None) -> tuple[str, str]:
    """``(triple, how it was decided)``. rustc is the authority; the table is the fallback."""
    if override:
        return override, "--target-triple"
    rustc = shutil.which("rustc")
    if rustc:
        try:
            out = subprocess.run(
                [rustc, "-vV"], capture_output=True, text=True, check=True, timeout=60
            ).stdout
        except (OSError, subprocess.SubprocessError) as exc:
            print(f"rustc -vV failed ({exc}); falling back to the table", file=sys.stderr)
        else:
            for line in out.splitlines():
                if line.startswith("host:"):
                    return line.split(":", 1)[1].strip(), "rustc -vV"
            print("rustc -vV printed no host line; falling back to the table", file=sys.stderr)
    key = (sys.platform, platform.machine())
    triple = FALLBACK_TRIPLES.get(key)
    if triple is None:
        raise SystemExit(
            f"no rustc and no fallback triple for {key}. Install Rust, or pass --target-triple."
        )
    return triple, "fallback table"


def build(triple: str, out_dir: Path, clean: bool) -> Path:
    """Run PyInstaller and return the binary it wrote."""
    try:
        import PyInstaller.__main__ as pyi
    except ImportError as exc:  # pragma: no cover - depends on the machine's environment
        raise SystemExit(
            "PyInstaller is not installed. It is a build tool, not a runtime dependency and not\n"
            "part of the daily loop:\n"
            "  uv sync --extra build --extra voice-fx\n"
            f"({exc})"
        ) from exc
    try:
        import numpy  # noqa: F401  - only asked whether it is here: it ships for her halo tone
    except ImportError as exc:  # pragma: no cover - depends on the machine's environment
        raise SystemExit(
            "numpy is not installed, and the sidecar carries it for her halo tone (ADR 0138):\n"
            "  uv sync --extra build --extra voice-fx\n"
            f"({exc})"
        ) from exc

    stem = f"{NAME}-{triple}"
    suffix = ".exe" if sys.platform == "win32" else ""
    out_dir.mkdir(parents=True, exist_ok=True)
    args = [
        str(ENTRY),
        "--onefile",
        "--name",
        stem,
        "--distpath",
        str(out_dir),
        "--workpath",
        str(WORK_DIR / "work"),
        "--specpath",
        str(WORK_DIR),
        "--paths",
        str(ROOT / "src"),
        # A console program: the ready line is on stdout and the shell reads it from a pipe. The
        # shell spawns it with CREATE_NO_WINDOW, so nobody sees a console either way.
        "--console",
        "--noconfirm",
        "--log-level",
        "WARN",
    ]
    if clean:
        args.append("--clean")
    args += add_data_args()
    for name in HIDDEN_IMPORTS:
        args += ["--hidden-import", name]
    for name in EXCLUDES:
        args += ["--exclude-module", name]

    pyi.run(args)

    built = out_dir / f"{stem}{suffix}"
    if not built.is_file():  # pragma: no cover - PyInstaller would have raised first
        raise SystemExit(f"PyInstaller reported success but {built} is missing")
    return built


def main() -> int:
    parser = argparse.ArgumentParser(description=(__doc__ or "").splitlines()[0])
    parser.add_argument("--target-triple", default=None, help="override the Rust host triple")
    parser.add_argument("--out", default=None, help="output directory (default: binaries/)")
    parser.add_argument("--clean", action="store_true", help="clear PyInstaller's cache first")
    parser.add_argument(
        "--list-data", action="store_true", help="print what ships as data, and build nothing"
    )
    args = parser.parse_args()

    if args.list_data:
        shipped = data_files()
        size = sum(source.stat().st_size for source, _ in shipped if source.is_file())
        for source, dest in shipped:
            print(f"{source.relative_to(ROOT).as_posix()} -> {dest}")
        print(f"{len(shipped)} files, {size / (1024 * 1024):.1f} MB, plus: constitution/")
        return 0

    triple, how = target_triple(args.target_triple)
    out_dir = Path(args.out).resolve() if args.out else OUT_DIR
    print(f"target triple: {triple} ({how})")
    print(f"entry:         {ENTRY.relative_to(ROOT).as_posix()}")
    print(f"out:           {out_dir.name}/")

    started = time.monotonic()
    binary = build(triple, out_dir, args.clean)
    size_mb = binary.stat().st_size / (1024 * 1024)
    print(f"\nbuilt {binary.name} ({size_mb:.1f} MB) in {time.monotonic() - started:.0f}s")
    print(
        "\nSmoke it:\n"
        f"  {binary.name} --port 0 --token-file <a temp file> --brain <a temp dir>\n"
        "The first stdout line is the ready JSON; GET <url>/health with the token answers 200."
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

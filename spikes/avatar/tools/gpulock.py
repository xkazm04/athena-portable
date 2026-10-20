"""One GPU job at a time on this machine.

Every spike track that touches CUDA runs its command through this lock, so two builders never
load models onto the RTX 4090 together. The lock is an OS file lock on
``~/.athena-avatar/gpu.lock`` (released by the OS if the holder dies), and the holder writes who
it is to ``gpu.lock.info`` so a waiting builder can say what it is waiting on.

CLI:
    python gpulock.py [--label NAME] [--wait-s 7200] -- <command> [args...]
    python gpulock.py --status

Library:
    from gpulock import gpu_lock
    with gpu_lock("t2-neural: liveportrait bench"):
        ...
"""

from __future__ import annotations

import argparse
import contextlib
import json
import os
import subprocess
import sys
import time
from pathlib import Path

HOME = Path(os.environ.get("ATHENA_AVATAR_HOME", Path.home() / ".athena-avatar"))
LOCK = HOME / "gpu.lock"
INFO = HOME / "gpu.lock.info"
POLL_S = 2.0


def _try_lock(fh) -> bool:
    try:
        if os.name == "nt":
            import msvcrt

            fh.seek(0)
            msvcrt.locking(fh.fileno(), msvcrt.LK_NBLCK, 1)
        else:
            import fcntl

            fcntl.flock(fh.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
        return True
    except OSError:
        return False


def _unlock(fh) -> None:
    if os.name == "nt":
        import msvcrt

        fh.seek(0)
        msvcrt.locking(fh.fileno(), msvcrt.LK_UNLCK, 1)
    else:
        import fcntl

        fcntl.flock(fh.fileno(), fcntl.LOCK_UN)


def holder() -> dict | None:
    try:
        return json.loads(INFO.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None


@contextlib.contextmanager
def gpu_lock(label: str, wait_s: float = 7200.0):
    HOME.mkdir(parents=True, exist_ok=True)
    fh = open(LOCK, "a+b")
    if fh.seek(0, 2) == 0:
        fh.write(b"\0")
        fh.flush()
    deadline = time.monotonic() + wait_s
    announced = False
    while not _try_lock(fh):
        if time.monotonic() > deadline:
            fh.close()
            raise TimeoutError(f"gpu lock not acquired in {wait_s:.0f} s; held by {holder()}")
        if not announced:
            print(f"[gpulock] waiting for the GPU, held by {holder()}", file=sys.stderr, flush=True)
            announced = True
        time.sleep(POLL_S)
    INFO.write_text(
        json.dumps({"label": label, "pid": os.getpid(), "since": time.strftime("%Y-%m-%dT%H:%M:%S")}),
        encoding="utf-8",
    )
    try:
        yield
    finally:
        with contextlib.suppress(OSError):
            INFO.unlink()
        _unlock(fh)
        fh.close()


def main(argv: list[str] | None = None) -> int:
    argv = list(sys.argv[1:] if argv is None else argv)
    cmd: list[str] = []
    if "--" in argv:
        i = argv.index("--")
        argv, cmd = argv[:i], argv[i + 1 :]
    ap = argparse.ArgumentParser(description="Run a command holding the machine's GPU lock.")
    ap.add_argument("--label", default="")
    ap.add_argument("--wait-s", type=float, default=7200.0)
    ap.add_argument("--status", action="store_true")
    ns = ap.parse_args(argv)
    if ns.status:
        print(json.dumps(holder()))
        return 0
    if not cmd:
        ap.error("give the command after --")
    with gpu_lock(ns.label or " ".join(cmd)[:120], ns.wait_s):
        return subprocess.call(cmd)


if __name__ == "__main__":
    sys.exit(main())

"""voice-io / ADR 0120 (Athena has a face), README section 3.1.

The daemon's half of her face: the stdlib client of one *face helper* process, and the two pieces
of sherpa's arithmetic the daemon replays so a sentence's mouth shapes match its audio exactly.

**One helper, another interpreter.** The helper (:mod:`athena.channels.voice.face_helper`) needs
numpy and onnxruntime, and for motion torch and JoyVASA; the daemon's core imports none of them.
So the helper runs in a Python environment the person points at (``face.python`` in
``ATHENA_HOME/voice/config.json``), started once with ``CREATE_NO_WINDOW`` like the engines, and
the two speak JSON lines over its stdin and stdout. Its first line is a ``hello`` naming what it
can do (``visemes``, ``motion``); after that the daemon sends one ``sentence`` per spoken sentence
and the helper answers ``visemes`` at once and ``motion`` when its model has run.

**The face never holds the voice.** Every wait on the helper has a deadline, a write goes through
its own thread so a helper that stops reading cannot block a sentence, and a helper that dies is
``broken`` until the next line, when it is started again behind a backoff. With no helper, or a
broken one, Kokoro runs exactly as it always did and no face event is sent.

**Exact timings, same audio** (the spike's wire proposal, option B). The engine already knows how
long each token lasts but prints only the token ids (``--debug=1``) and throws the durations away;
it then cuts every pause longer than 0.2 s to a fifth (``ScaleSilence``). So with the helper ready
the engine is run with ``--tts-silence-scale=1`` and the daemon replays the cut itself
(:func:`scale_silence`, sample for sample as ``offline-tts.cc`` does it), keeping a time map from
the uncut audio to the cut one. The audio played is the same selection of the same samples the
engine would have written; the helper runs the model's durations-only subgraph on the token ids
and maps each token's span through that time map.
"""

from __future__ import annotations

import base64
import collections
import contextlib
import json
import logging
import queue
import re
import subprocess
import sys
import threading
import time
from array import array
from collections.abc import Callable, Sequence
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from athena.channels.voice.home import ProbeState, creation_flags

__all__ = [
    "FACE_ARGS",
    "HELPER_DIR",
    "MOTION_TAIL_S",
    "QUIET_LEVEL",
    "SILENCE_SCALE",
    "START_TIMEOUT_S",
    "VISEMES_TIMEOUT_S",
    "FaceHelper",
    "FaceJob",
    "FaceProbe",
    "scale_silence",
    "token_lines",
]

#: Where the helper's own code is: run by path in the other interpreter, never imported here.
HELPER_DIR = Path(__file__).resolve().parent / "face_helper"

#: What the engine is asked for when the helper is ready: the token ids, and the audio uncut.
FACE_ARGS: tuple[str, ...] = ("--debug=1", "--tts-silence-scale=1")

#: sherpa's default ``--tts-silence-scale``: a pause keeps a fifth of itself.
SILENCE_SCALE = 0.2
#: A pause is at least this long (``sample_rate * 0.2`` in ``ScaleSilence``).
PAUSE_S = 0.2
#: ``fabs(x) <= 0.01`` on the float sample, read off the 16-bit WAV the engine wrote with
#: ``trunc(x * 32767)``: ``|s| <= 327``. The two disagree only for ``0.01 < |x| < 0.01001``.
QUIET_LEVEL = 327

#: How long a sentence waits for its mouth shapes. The helper answers in under 0.1 s warm; past
#: this the sentence plays without them, and the wait is spent on a render running ahead of
#: playback except for the first sentence of a line.
VISEMES_TIMEOUT_S = 1.0
#: How long the helper may take to say hello. The first start extracts the durations subgraph
#: from Kokoro's model once (about 15 s), and a cold disk can triple that.
START_TIMEOUT_S = 180.0
#: Two sentences in a row with no answer in time and the helper is called broken and stopped.
MAX_MISSES = 2
#: The backoff before a broken helper is started again: it doubles from the first to the last.
BACKOFF_S: tuple[float, float] = (2.0, 60.0)
#: After a line's last audio, how long it waits for motion still being computed. Motion that
#: arrives after its sentence was heard is useless; this is a ceiling, the line's own length
#: bounds it first.
MOTION_TAIL_S = 2.0
#: How many lines of the helper's stderr a broken reason may quote from.
STDERR_KEPT = 20

#: The bootstrap the other interpreter runs: the helper package loaded from its directory under a
#: name of its own, so nothing else in this directory can shadow a module of that environment.
_BOOT = (
    "import importlib.util as u, sys\n"
    "d = sys.argv[1]\n"
    "s = u.spec_from_file_location('athena_face_helper', d + '/__init__.py', "
    "submodule_search_locations=[d])\n"
    "m = u.module_from_spec(s); sys.modules[s.name] = m; s.loader.exec_module(m)\n"
    "from athena_face_helper.main import main\n"
    "sys.exit(main(sys.argv[2:]))\n"
)

_TOKEN_LINE = re.compile(r"^0(?: \d+)+ 0$")

log = logging.getLogger(__name__)


# --- sherpa's arithmetic, replayed --------------------------------------------------------------


def token_lines(output: str) -> list[list[int]]:
    """The token-id sequences ``--debug=1`` printed, one per batch the engine ran.

    sherpa prints each batch's ids padded with ``0`` on both sides on a line of their own."""
    return [
        [int(x) for x in line.split()]
        for line in (raw.strip() for raw in output.splitlines())
        if _TOKEN_LINE.match(line)
    ]


TimeMap = list[tuple[int, int, int, int]]


def scale_silence(
    pcm: bytes, sample_rate: int, scale: float = SILENCE_SCALE
) -> tuple[bytes, TimeMap]:
    """sherpa's ``GeneratedAudio::ScaleSilence`` over 16-bit PCM, and the time map it implies.

    A run of quiet samples (:data:`QUIET_LEVEL`) at least :data:`PAUSE_S` long ending in a loud
    sample — or longer than that at the very end — is a pause, and only its first
    ``int(len * scale)`` samples are kept. The map is ``(raw_a, raw_b, out_a, out_b)`` segments:
    speech maps one to one, and a whole pause maps linearly onto the part of it that is kept, so a
    token boundary inside a cut pause keeps its order and never collapses to nothing.
    """
    samples = array("h")
    samples.frombytes(pcm[: len(pcm) - len(pcm) % 2])
    if sys.byteorder != "little":
        samples.byteswap()
    n = len(samples)
    threshold = int(sample_rate * PAUSE_S)
    quiet = bytes(1 if -QUIET_LEVEL <= s <= QUIET_LEVEL else 0 for s in samples)
    intervals: list[tuple[int, int]] = []
    for run in re.finditer(b"\x01+", quiet):
        a, b = run.span()
        if b < n:
            if b - a >= threshold:
                intervals.append((a, b))
        elif n - a > threshold:
            intervals.append((a, n))
    if not intervals:
        return pcm, [(0, n, 0, n)]
    out = bytearray()
    time_map: TimeMap = []
    pos = 0
    at = 0
    for a, b in intervals:
        out += pcm[pos * 2 : a * 2]
        time_map.append((pos, a, at, at + (a - pos)))
        at += a - pos
        kept = int((b - a) * scale)
        out += pcm[a * 2 : (a + kept) * 2]
        time_map.append((a, b, at, at + kept))
        at += kept
        pos = b
    if pos < n:
        out += pcm[pos * 2 : n * 2]
        time_map.append((pos, n, at, at + (n - pos)))
    return bytes(out), [seg for seg in time_map if seg[1] > seg[0]]


# --- the helper ---------------------------------------------------------------------------------


@dataclass(frozen=True)
class FaceProbe:
    """What the helper is now. ``reason`` is one sentence for a person, ``None`` when ready.

    The ``motion_*`` fields are what the helper measured of its motion model on this machine
    (``spikes/avatar-measure/README.md``): the sampler steps it chose, one 4 s window's median time
    at those steps (or, when off for slowness, at the fewest steps tried), the device, and why
    motion is not on. ``None`` when the helper did not say."""

    state: ProbeState
    reason: str | None = None
    visemes: bool = False
    motion: bool = False
    motion_steps: int | None = None
    motion_window_s: float | None = None
    motion_device: str | None = None
    motion_reason: str | None = None

    @property
    def ready(self) -> bool:
        return self.state == "ready" and (self.visemes or self.motion)

    def motion_fields(self) -> dict[str, Any]:
        """The ``motion_*`` fields that are known, for an ``engines`` row; unknown ones are left
        out."""
        return {
            key: value
            for key, value in (
                ("motion_steps", self.motion_steps),
                ("motion_window_s", self.motion_window_s),
                ("motion_device", self.motion_device),
                ("motion_reason", self.motion_reason),
            )
            if value is not None
        }


def _motion_caps(caps: dict[str, Any]) -> dict[str, Any]:
    """The helper's motion measurements, type-checked: anything malformed is dropped."""
    steps, window, device, why = (
        caps.get("steps"),
        caps.get("window_s"),
        caps.get("device"),
        caps.get("motion_reason"),
    )
    return {
        "motion_steps": steps if isinstance(steps, int) and not isinstance(steps, bool) else None,
        "motion_window_s": (
            float(window)
            if isinstance(window, (int, float)) and not isinstance(window, bool)
            else None
        ),
        "motion_device": device if device in ("cpu", "cuda") else None,
        "motion_reason": (
            str(why)[:300] if isinstance(why, str) and why and not caps.get("motion") else None
        ),
    }


MotionSink = Callable[[int, list[dict[str, Any]]], None]


@dataclass
class FaceJob:
    """One sentence sent to the helper: its mouth shapes, and its motion when that comes."""

    id: int
    helper: FaceHelper
    on_motion: MotionSink | None = None
    visemes: list[tuple[str, int, int]] | None = None
    #: Set when the visemes answered, failed, or the helper went away: the wait is over.
    answered: threading.Event = field(default_factory=threading.Event)
    #: Set when no motion will come any more: delivered, refused, cancelled, or the helper died.
    settled: threading.Event = field(default_factory=threading.Event)

    def wait_visemes(self, timeout: float) -> list[tuple[str, int, int]] | None:
        """The sentence's shapes, or ``None`` past ``timeout``. Only an answer in time clears the
        helper's count of misses, so one that always answers late is still called broken."""
        if not self.answered.wait(timeout):
            self.helper._missed()
            return None
        self.helper._in_time()
        return self.visemes

    def cancel(self) -> None:
        """Nothing more is wanted for this sentence: the helper drops its queued work."""
        if not self.settled.is_set():
            self.helper._cancel(self)

    def _resolve_visemes(self, visemes: list[tuple[str, int, int]] | None) -> None:
        self.visemes = visemes
        self.answered.set()

    def _deliver_motion(self, fps: int, frames: list[dict[str, Any]]) -> None:
        if self.settled.is_set():
            return
        self.settled.set()
        sink = self.on_motion
        if sink is not None:
            try:
                sink(fps, frames)
            except Exception:  # a surface's fault must not take the helper's reader down
                log.exception("voice: a face motion sink failed")

    def _end(self) -> None:
        self.answered.set()
        self.settled.set()


class FaceHelper:
    """The one face helper of a daemon: started on demand, probed, restarted behind a backoff.

    ``python`` is the interpreter the person configured; ``command`` replaces the whole argv
    prefix — a test's ``[sys.executable, fake_helper.py, mode]`` — and then ``python`` only has to
    be truthy.
    """

    def __init__(
        self,
        python: str | None,
        *,
        kokoro_dir: Path,
        cache_dir: Path,
        command: Sequence[str] | None = None,
        visemes_timeout_s: float = VISEMES_TIMEOUT_S,
        start_timeout_s: float = START_TIMEOUT_S,
        backoff_s: tuple[float, float] = BACKOFF_S,
    ) -> None:
        self.python = python or None
        self.kokoro_dir = kokoro_dir
        self.cache_dir = cache_dir
        self.command = list(command) if command is not None else None
        self.visemes_timeout_s = visemes_timeout_s
        self.start_timeout_s = start_timeout_s
        self.backoff_s = backoff_s
        self._lock = threading.RLock()
        self._proc: subprocess.Popen[bytes] | None = None
        self._outbox: queue.Queue[bytes | None] | None = None
        self._jobs: dict[int, FaceJob] = {}
        self._next_id = 0
        self._caps: dict[str, Any] | None = None
        self._broken: str | None = None
        self._retry_at = 0.0
        self._backoff = backoff_s[0]
        self._misses = 0
        self._started_at = 0.0
        self._stderr: collections.deque[str] = collections.deque(maxlen=STDERR_KEPT)

    # -- configuration ---------------------------------------------------------------------------

    @property
    def configured(self) -> bool:
        return self.python is not None

    def configure(self, python: str | None) -> None:
        """Point at another interpreter (or none). A running helper is stopped first."""
        python = python or None
        with self._lock:
            if python == self.python:
                return
            self.stop()
            self.python = python
            self._broken = None
            self._retry_at = 0.0
            self._backoff = self.backoff_s[0]

    def argv(self) -> list[str]:
        prefix = (
            self.command
            if self.command is not None
            else [str(self.python), "-I", "-u", "-X", "utf8", "-c", _BOOT, str(HELPER_DIR)]
        )
        return [
            *prefix,
            "--kokoro-dir",
            str(self.kokoro_dir),
            "--cache-dir",
            str(self.cache_dir),
        ]

    # -- the probe -------------------------------------------------------------------------------

    def probe(self) -> FaceProbe:
        """Absent (not set up, missing, or starting), broken (and why), or ready with its powers.

        A probe starts the helper when it is set up and not running, so a person who just pointed
        at an environment sees it come up on the studio's next look."""
        if not self.configured:
            return FaceProbe(
                "absent", "Her face helper is not set up; set face.python in the voice config."
            )
        if self.command is None and not Path(str(self.python)).is_file():
            return FaceProbe("absent", f"The face helper's Python is missing: {self.python}.")
        self.ensure()
        with self._lock:
            if self._broken is not None:
                return FaceProbe("broken", self._broken)
            if self._caps is None:
                return FaceProbe("absent", "Her face helper is starting.")
            caps = self._caps
        visemes, motion = bool(caps.get("visemes")), bool(caps.get("motion"))
        measured = _motion_caps(caps)
        if not (visemes or motion):
            if caps.get("motion_pending"):
                return FaceProbe("absent", "Her face helper is starting.", **measured)
            why = "; ".join(
                str(part) for part in (caps.get("reason"), measured["motion_reason"]) if part
            )
            return FaceProbe(
                "broken",
                why or "The face helper can do neither visemes nor motion.",
                **measured,
            )
        return FaceProbe("ready", None, visemes, motion, **measured)

    @property
    def ready(self) -> bool:
        return self.probe().ready

    # -- the process -----------------------------------------------------------------------------

    def ensure(self) -> None:
        """Start the helper if it is set up, not running, and its backoff has passed."""
        with self._lock:
            if not self.configured or self._proc is not None:
                if self._proc is not None and self._caps is None:
                    self._check_start_deadline()
                return
            if self._broken is not None and time.monotonic() < self._retry_at:
                return
            self._spawn()

    def _spawn(self) -> None:
        self.cache_dir.mkdir(parents=True, exist_ok=True)
        try:
            proc = subprocess.Popen(
                self.argv(),
                stdin=subprocess.PIPE,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                creationflags=creation_flags(),
            )
        except OSError as exc:
            self._fail(f"The face helper would not start ({type(exc).__name__}).")
            return
        outbox: queue.Queue[bytes | None] = queue.Queue()
        self._proc, self._outbox = proc, outbox
        self._caps = None
        self._broken = None
        self._misses = 0
        self._started_at = time.monotonic()
        self._stderr.clear()
        for target, name in (
            (self._read, "face-read"),
            (self._drain, "face-stderr"),
            (self._write, "face-write"),
        ):
            threading.Thread(target=target, args=(proc, outbox), name=name, daemon=True).start()

    def _check_start_deadline(self) -> None:
        if time.monotonic() - self._started_at > self.start_timeout_s:
            self._fail(
                f"The face helper did not say hello within {self.start_timeout_s:.0f} s.", kill=True
            )

    def stop(self) -> None:
        """Stop the helper. Every sentence waiting on it gets nothing, at once."""
        with self._lock:
            proc, outbox = self._proc, self._outbox
            self._proc, self._outbox, self._caps = None, None, None
            jobs, self._jobs = list(self._jobs.values()), {}
        if outbox is not None:
            outbox.put(None)
        if proc is not None and proc.poll() is None:
            proc.kill()
        for job in jobs:
            job._end()

    def _fail(self, reason: str, *, kill: bool = False) -> None:
        """Broken: say why, end every job, and come back no sooner than the backoff."""
        with self._lock:
            proc, outbox = self._proc, self._outbox
            self._proc, self._outbox, self._caps = None, None, None
            jobs, self._jobs = list(self._jobs.values()), {}
            self._broken = reason
            self._retry_at = time.monotonic() + self._backoff
            self._backoff = min(self._backoff * 2, self.backoff_s[1])
        if outbox is not None:
            outbox.put(None)
        if kill and proc is not None and proc.poll() is None:
            proc.kill()
        for job in jobs:
            job._end()
        log.info("voice: face helper broken: %s", reason)

    def _in_time(self) -> None:
        with self._lock:
            self._misses = 0

    def _missed(self) -> None:
        with self._lock:
            self._misses += 1
            misses = self._misses
        if misses >= MAX_MISSES:
            self._fail(
                f"The face helper did not answer {MAX_MISSES} sentences in a row in time.",
                kill=True,
            )

    # -- the threads -----------------------------------------------------------------------------

    def _read(self, proc: subprocess.Popen[bytes], outbox: queue.Queue[bytes | None]) -> None:
        assert proc.stdout is not None
        for raw in proc.stdout:
            try:
                message = json.loads(raw)
            except ValueError:
                continue
            if isinstance(message, dict):
                self._on_message(proc, message)
        code = proc.wait()
        with self._lock:
            current = self._proc is proc
            said = self._caps is not None
        if current:
            tail = " ".join(line for line in self._stderr if line)[-300:]
            what = "stopped" if said else "exited before it was ready"
            self._fail(f"The face helper {what} (exit {code}). {tail}".strip())

    def _drain(self, proc: subprocess.Popen[bytes], outbox: queue.Queue[bytes | None]) -> None:
        assert proc.stderr is not None
        for raw in proc.stderr:
            self._stderr.append(raw.decode("utf-8", "replace").strip())

    def _write(self, proc: subprocess.Popen[bytes], outbox: queue.Queue[bytes | None]) -> None:
        assert proc.stdin is not None
        while True:
            line = outbox.get()
            if line is None:
                break
            try:
                proc.stdin.write(line)
                proc.stdin.flush()
            except (OSError, ValueError):
                break
        with contextlib.suppress(OSError, ValueError):
            proc.stdin.close()

    def _on_message(self, proc: subprocess.Popen[bytes], message: dict[str, Any]) -> None:
        kind = message.get("type")
        if kind in ("hello", "caps"):
            if kind == "caps":  # the motion verdict is in: no longer pending
                message = {**message, "motion_pending": False}
            with self._lock:
                if self._proc is proc:
                    self._caps = {**(self._caps or {}), **message}
            return
        if kind == "fatal":
            self._fail(str(message.get("reason") or "The face helper gave up."), kill=True)
            return
        ident = message.get("id")
        with self._lock:
            job = self._jobs.get(ident) if isinstance(ident, int) else None
        if job is None:
            return
        if kind == "visemes":
            visemes = _visemes_from(message.get("visemes"))
            with self._lock:
                self._backoff = self.backoff_s[0]  # it works: a next fault backs off afresh
            job._resolve_visemes(visemes)
            if not job.on_motion:
                self._forget(job)
        elif kind == "motion":
            frames = message.get("frames")
            fps = message.get("fps")
            self._forget(job)
            if isinstance(frames, list) and isinstance(fps, int):
                job._deliver_motion(fps, [f for f in frames if isinstance(f, dict)])
            else:
                job._end()
        elif kind == "error":
            if message.get("op") == "motion":
                self._forget(job)
                job._end()
            else:
                job._resolve_visemes(None)
                if not job.on_motion:  # nothing more will come for it: forget it, as an answer is
                    self._forget(job)

    def _forget(self, job: FaceJob) -> None:
        with self._lock:
            self._jobs.pop(job.id, None)

    def _post(self, message: dict[str, Any]) -> bool:
        with self._lock:
            outbox = self._outbox
        if outbox is None:
            return False
        outbox.put(json.dumps(message, separators=(",", ":")).encode("utf-8") + b"\n")
        return True

    def _cancel(self, job: FaceJob) -> None:
        self._forget(job)
        job._end()
        self._post({"type": "cancel", "ids": [job.id]})

    # -- one sentence ----------------------------------------------------------------------------

    def submit(
        self,
        *,
        tokens: Sequence[Sequence[int]],
        raw_samples: int,
        time_map: TimeMap,
        pcm: bytes,
        sample_rate: int,
        sid: int,
        on_motion: MotionSink | None = None,
    ) -> FaceJob | None:
        """Send one sentence. ``None`` when the helper is not ready to take it."""
        found = self.probe()
        if not found.ready:
            return None
        with self._lock:
            self._next_id += 1
            job = FaceJob(self._next_id, self, on_motion if found.motion else None)
            if job.on_motion is None:
                job.settled.set()  # no motion was asked for, so none is awaited
            self._jobs[job.id] = job
        sent = self._post(
            {
                "type": "sentence",
                "id": job.id,
                "sid": sid,
                "sample_rate": sample_rate,
                "tokens": [list(seq) for seq in tokens],
                "raw_samples": raw_samples,
                "time_map": [list(seg) for seg in time_map],
                "pcm": base64.b64encode(pcm).decode("ascii"),
                "visemes": found.visemes,
                "motion": job.on_motion is not None,
            }
        )
        if not sent:
            self._forget(job)
            return None
        if not found.visemes:
            job._resolve_visemes(None)
        return job


def _visemes_from(raw: object) -> list[tuple[str, int, int]] | None:
    """The helper's ``[[v, start, end], ...]``, checked: ordered, not overlapping, not empty."""
    if not isinstance(raw, list) or not raw:
        return None
    out: list[tuple[str, int, int]] = []
    at = 0
    for item in raw:
        if not (isinstance(item, list) and len(item) == 3):
            return None
        v, a, b = item
        if not (isinstance(v, str) and isinstance(a, int) and isinstance(b, int)):
            return None
        if a < at or b <= a:
            return None
        out.append((v, a, b))
        at = b
    return out

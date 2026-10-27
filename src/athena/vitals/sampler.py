"""The thread that keeps this PC's reading fresh (ADR 0143, "Sampler").

Every :data:`~athena.vitals.SAMPLE_EVERY_S` it takes one reading through the :class:`Probe` and
hands it to the :class:`Gate`; the GPUs are asked only every :data:`~athena.vitals.GPU_EVERY_S`,
because a GPU reading is a subprocess and the others are a few system calls. The latest reading is
all that is kept: there is no history here, and nothing is written to disk.

It runs in the served daemon only (``athena serve`` starts it, like the chores loop and the peer
lifecycle), so a test or a second Athena built in the same process never spawns ``nvidia-smi``.
A reading taken on demand (:meth:`Sampler.sample`) serves ``GET /vitals`` before the thread's first.
"""

from __future__ import annotations

import sys
import threading
import time
from collections.abc import Callable
from contextlib import suppress

from athena.vitals import GPU_EVERY_S, SAMPLE_EVERY_S
from athena.vitals.gate import Gate
from athena.vitals.probe import Probe, Reading

__all__ = ["Sampler"]


class Sampler:
    """Probe, then gate, every :attr:`every_s` from :meth:`start` to :meth:`stop`."""

    def __init__(
        self,
        probe: Probe,
        gate: Gate,
        *,
        every_s: float = SAMPLE_EVERY_S,
        gpu_every_s: float = GPU_EVERY_S,
        clock: Callable[[], float] = time.monotonic,
    ) -> None:
        self.probe = probe
        self.gate = gate
        self.every_s = every_s
        self.gpu_every_s = gpu_every_s
        self._clock = clock
        self._lock = threading.Lock()
        self._gpu_at: float | None = None
        self._ram_unknown = False
        self._failing: str | None = None
        self._stop = threading.Event()
        self._thread: threading.Thread | None = None

    def sample(self) -> Reading:
        """One reading now, handed to the gate. The GPUs are asked when they are due."""
        with self._lock:
            now = self._clock()
            gpu = self._gpu_at is None or now - self._gpu_at >= self.gpu_every_s
            if gpu:
                self._gpu_at = now
            reading = self.probe.read(gpu=gpu)
            self.gate.observe(reading)
            self._say_ram(reading)
        return reading

    def _say_ram(self, reading: Reading) -> None:
        """Say once when RAM turns unknown, and once when it is back: an unknown RAM figure
        holds nothing (the gate fails open), so a PC whose memory reader broke would admit every
        task with no trace. Transitions only, not every :attr:`every_s`."""
        unknown = reading.ram_pct is None
        if unknown == self._ram_unknown:
            return
        self._ram_unknown = unknown
        _say(
            "[vitals] RAM could not be read, so the gate cannot hold for it and admits tasks"
            if unknown
            else "[vitals] RAM is readable again; the gate holds for it once more"
        )

    def start(self) -> None:
        if self._thread is not None:
            return
        self._stop.clear()
        self._thread = threading.Thread(target=self._run, name="vitals-sampler", daemon=True)
        self._thread.start()

    def stop(self, timeout: float = 5.0) -> None:
        self._stop.set()
        thread = self._thread
        if thread is not None and thread is not threading.current_thread():
            thread.join(timeout=timeout)
        self._thread = None

    def _run(self) -> None:
        while not self._stop.is_set():
            try:
                self.sample()
            except Exception as exc:  # a reading's bug must not end the loop
                # A persistent fault is said once, with its message; a different one is said
                # again, and so is the recovery. Not one line per tick.
                what = f"{type(exc).__name__}: {exc}"
                if what != self._failing:
                    self._failing = what
                    _say(f"[vitals] a reading raised {what}")
            else:
                if self._failing is not None:
                    self._failing = None
                    _say("[vitals] readings are working again")
            if self._stop.wait(self.every_s):
                return


def _say(line: str) -> None:
    with suppress(Exception):
        print(line, file=sys.stderr)

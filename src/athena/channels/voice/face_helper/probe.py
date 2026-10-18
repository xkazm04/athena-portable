"""voice-io / ADR 0120 (Athena has a face): where her motion runs, and whether it keeps up there.

Pure decisions, stdlib only, so the daemon's tests can hold them without torch. The measurements
behind them are in ``spikes/avatar-measure/README.md`` (one machine, 2026-10-18):

- **Device.** CUDA when torch has it, else the CPU; ``ATHENA_FACE_DEVICE=cpu|cuda`` overrides it
  for testing. JoyVASA's wrapper picks ``cuda:0`` whenever MPS is absent, so before this a machine
  without CUDA got no motion at all.
- **Threads.** The motion model leaves two logical cores to Kokoro, which renders with two threads
  on the same machine: torch gets ``cpu_count - 2`` intra-op threads (at least one) and
  :data:`INTEROP_THREADS` inter-op threads (eager inference barely uses that pool).
- **Steps.** JoyVASA always generates one 4 s window at a time, so one warm window predicts every
  sentence. The probe times a window :data:`PROBE_REPS` times at each step count in
  :data:`STEP_CANDIDATES`, cheapest first, and keeps the largest count whose median is within
  :data:`BUDGET_S`. Under that line a CPU covered at least 80 % of her speech with neural motion
  live; the next measured config (1.36 s) covered 67 %, which reads as "sometimes neural, sometimes
  not". Nothing fits: motion is off, and her face uses procedural motion.
"""

from __future__ import annotations

import statistics
from collections.abc import Callable, Mapping, Sequence
from dataclasses import dataclass, field

DEVICE_ENV = "ATHENA_FACE_DEVICE"
DEVICES = ("cpu", "cuda")
#: Kokoro's own threads, left free on the same machine.
KOKORO_THREADS = 2
INTEROP_THREADS = 2
#: The sampler step counts tried, most quality first. 50 is the model's own sampler, unchanged; the
#: others are a deterministic DDIM over the same schedule (the model predicts the clean sample).
STEP_CANDIDATES: tuple[int, ...] = (50, 25, 10)
TRAINED_STEPS = 50
#: The longest median warm window (seconds) that keeps her motion in time.
BUDGET_S = 1.0
PROBE_REPS = 2


def choose_device(override: str | None, cuda_available: bool) -> str:
    """``"cuda"`` or ``"cpu"``: the override when set (``ValueError`` when it is neither), else CUDA
    whenever torch has it."""
    asked = (override or "").strip().lower()
    if asked:
        if asked not in DEVICES:
            raise ValueError(f"{DEVICE_ENV} must be cpu or cuda, not {override!r}")
        return asked
    return "cuda" if cuda_available else "cpu"


def cpu_threads(cpu_count: int | None) -> int:
    """Torch's intra-op threads: every logical core but Kokoro's two, and at least one."""
    return max(1, (cpu_count or 1) - KOKORO_THREADS)


def choose_steps(
    windows: Mapping[int, Sequence[float]], budget_s: float = BUDGET_S
) -> tuple[int | None, float | None]:
    """The largest step count whose median window time is within ``budget_s``, and that median.

    Step counts with no measurement are skipped. Nothing fits: ``(None, m)`` with ``m`` the median
    of the cheapest count measured (what "too slow" quotes), or ``(None, None)`` with nothing."""
    medians = {k: statistics.median(v) for k, v in windows.items() if len(v)}
    fits = [k for k, m in medians.items() if m <= budget_s]
    if fits:
        best = max(fits)
        return best, medians[best]
    if not medians:
        return None, None
    return None, medians[min(medians)]


def too_slow(steps: int, window_s: float, budget_s: float = BUDGET_S) -> str:
    return f"too slow here (window {window_s:.2f} s > {budget_s:.1f} s at {steps} steps)"


@dataclass
class ProbeResult:
    steps: int | None
    window_s: float | None
    #: Every timing taken, by step count, in seconds.
    windows: dict[int, list[float]] = field(default_factory=dict)
    reason: str | None = None

    @property
    def motion(self) -> bool:
        return self.steps is not None


def run_probe(
    time_window: Callable[[int], float],
    candidates: Sequence[int] = STEP_CANDIDATES,
    budget_s: float = BUDGET_S,
    reps: int = PROBE_REPS,
) -> ProbeResult:
    """Time one window ``reps`` times per step count, cheapest first, and choose by
    :func:`choose_steps`.

    Cost grows with the step count, so the first count over budget ends the probe: a costlier one
    cannot fit. A first timing over ``reps * budget_s`` ends its count early, since the median of
    two timings is their mean and it is already over (only for ``reps == 2``)."""
    windows: dict[int, list[float]] = {}
    for steps in sorted(candidates):
        times = windows.setdefault(steps, [])
        for _ in range(reps):
            times.append(float(time_window(steps)))
            if reps == 2 and len(times) == 1 and times[0] > reps * budget_s:
                break
        if statistics.median(times) > budget_s:
            break
    chosen, window = choose_steps(windows, budget_s)
    reason = None
    if chosen is None and window is not None:
        reason = too_slow(min(windows), window, budget_s)
    return ProbeResult(chosen, window, windows, reason)

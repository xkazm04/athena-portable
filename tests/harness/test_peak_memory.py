"""What an engine child weighed at its peak, measured by the real spawn (ADR 0143).

athena/harness/transports.py. A real child (the base interpreter, not a venv launcher that would
be measured instead) allocates a known amount; the transport reports its peak working set on the
request's exit handle, the field the turn's ledger row is filled from. The Linux reader is also
driven from recorded ``/proc/<pid>/status`` text, so its arithmetic runs on any OS.
"""

from __future__ import annotations

import asyncio
import sys
from pathlib import Path

import pytest

from athena.harness.transports import CliRequest, PeakMemory, SubprocessTransport, vm_hwm_kb

MEASURED = sys.platform == "win32" or sys.platform.startswith("linux")

#: Allocate and touch 200 MiB, say so, close stdout, and stay alive a moment: the transport reads
#: a Linux child's high-water mark between its stdout closing and its exit.
ALLOCATE = (
    "import sys, time\n"
    "block = bytearray(200 * 1024 * 1024)\n"
    "print('done', flush=True)\n"
    "sys.stdout.close()\n"
    "time.sleep(0.5)\n"
)


def _interpreter() -> str:
    return str(getattr(sys, "_base_executable", "") or sys.executable)


@pytest.mark.skipif(not MEASURED, reason="peak working set is read on Windows and Linux only")
def test_the_real_spawn_reports_the_childs_peak_working_set(tmp_path: Path) -> None:
    request = CliRequest(argv=["-c", ALLOCATE], stdin="", cwd=str(tmp_path), timeout_s=30)
    transport = SubprocessTransport(_interpreter())

    async def collect() -> list[str]:
        return [line async for line in transport.run(request)]

    lines = asyncio.run(collect())
    assert [line.rstrip("\r") for line in lines] == ["done"]
    assert request.exit.peak_mb is not None
    assert 190 <= request.exit.peak_mb <= 2000


def test_the_linux_high_water_mark_is_the_largest_sample_kept() -> None:
    statuses = iter(
        [
            "Name:\tclaude\nVmHWM:\t  204800 kB\nVmRSS:\t  100000 kB\n",
            "Name:\tclaude\nVmHWM:\t  409600 kB\n",
            None,  # the process is gone
        ]
    )
    peak = PeakMemory(4242, platform="linux", read_status=lambda pid: next(statuses))
    assert peak.sampled
    peak.sample()
    peak.sample()
    assert peak.finish() == 400
    assert peak.finish() == 400, "idempotent"


def test_a_platform_with_no_reader_measures_nothing() -> None:
    peak = PeakMemory(4242, platform="darwin")
    assert not peak.sampled
    peak.sample()
    assert peak.finish() is None
    assert vm_hwm_kb(None) is None and vm_hwm_kb("VmHWM: lots kB") is None

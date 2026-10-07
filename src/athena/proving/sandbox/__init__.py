"""Token Factory Sandboxes as a branching world: the WP4 spike (README §9; ADR 0033).

Sandboxes saves a run's filesystem as an immutable image, so a checkpoint is an image and a fork
is a second run on it. :mod:`~athena.proving.sandbox.client` is the five REST calls that needs,
over the standard library; :mod:`~athena.proving.sandbox.spike` asks the five questions the
Proving Ground needs answered before it builds worlds on top (boot, daemon, network, fork,
timing) and writes ``proving-runs/<ts>/sandbox-spike.json`` and ``.md``.

Run it with ``python -m athena.proving.sandbox spike``. Nothing here is imported by
``athena.core``, and nothing here needs an extra: it is ``urllib`` and ``tarfile``.
"""

from __future__ import annotations

from athena.proving.sandbox.client import Operation, SandboxClient, SandboxError
from athena.proving.sandbox.spike import SpikeConfig, SpikeResult, run_spike, write_report

__all__ = [
    "Operation",
    "SandboxClient",
    "SandboxError",
    "SpikeConfig",
    "SpikeResult",
    "run_spike",
    "write_report",
]

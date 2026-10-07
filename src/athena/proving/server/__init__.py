"""The Proving Ground's trigger page: a runner that serves its own page (README §9; ADR 0037).

``python -m athena.proving.server`` serves one HTML page and a small JSON API beside it: anyone
can read the latest runs and watch one live; a judge with the token can start one, under
per-run and daily caps this package enforces. A claude.ai artifact cannot reach a runner on
someone's machine, so the runner is the host; the same process is what a Nebius Serverless
Endpoint would run (``proving/serverless/``).
"""

from __future__ import annotations

from athena.proving.server.app import ProvingServer, build_handler
from athena.proving.server.runner import Runner
from athena.proving.server.runs import RunIndex

__all__ = ["ProvingServer", "RunIndex", "Runner", "build_handler"]

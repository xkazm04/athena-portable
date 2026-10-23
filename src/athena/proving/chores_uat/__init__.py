"""uat chores (spark chores-uat): Character-driven UAT over every chore in the playbook library.

Each chore is paired with two chores Characters (``uat/chores/pairs.json``, :mod:`.cast`). Per
pair the harness invents the Character's concrete case (:mod:`.cases`), then holds the REAL adopt
conversation with the Character played by a model, approves the brief as the desktop would, runs
the REAL rehearsal on a world shaped like the case, and has a blind judge score the experience in
the Character's own voice (:mod:`.run`, :mod:`.judge`). Beside it, a deterministic audit of the
numbers every chore promises, mirrored from the desktop's own arithmetic (:mod:`.numbers`).
:mod:`.report` turns a run directory into ``report.md`` and LC findings.

``uv run python -m athena.proving.chores_uat numbers|cases|run|report``; ``run --dry`` spends
nothing.
"""

from __future__ import annotations

__all__: list[str] = []

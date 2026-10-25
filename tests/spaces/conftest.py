"""The daemon's fixtures, shared: a real daemon on a real socket over a real brain (ADR 0225).

``tests/daemon`` is a package rooted at ``tests/``, which pytest puts on ``sys.path`` for it;
importing its conftest by that name is how its fixtures become this directory's too, as
``tests/channels`` does.
"""

from __future__ import annotations

from daemon.conftest import (  # noqa: F401 - fixtures are used by name
    Live,
    brain,
    daemon,
    live,
    local,
    studio,
    transport,
)

"""Where a brain lives and what its directory looks like (README §2 invariant 1; ref §8).

The tree is the product: one markdown file per memory, laid out so a human can read it with
``ls`` and a machine can rebuild the index from it. ``index.sqlite`` sits beside the tree and is
derivable from it, which is what makes "a brain is portable by copying the directory" true —
copy the directory, drop the index, run :func:`athena.core.brain.reconcile.reconcile_from_disk`.
"""

from __future__ import annotations

import os
from pathlib import Path

#: Every directory the tree has, in the order ref §8 lists them. Created eagerly so that a fresh
#: brain looks the same as a full one and no writer has to invent a layout on the fly.
TREE: tuple[str, ...] = (
    "episodes",
    "semantic",
    "semantic/user",
    "semantic/project",
    "semantic/world",
    "procedurals",
    "procedurals/chat",
    "procedurals/action",
    "procedurals/memory",
    "procedurals/build",
    "goals",
    "backlog",
    "backlog/self_promise",
    "backlog/capability_gap",
    "rituals",
    "rituals/quiet_hours",
    "rituals/cadence",
    "rituals/focus_window",
    "reflections",
    "cycles",
)

#: The index is named for what it is. A reader who finds it in a backup should not have to guess
#: whether deleting it loses anything; the name and ADR 0003 both say it does not.
INDEX_FILENAME = "index.sqlite"

#: Set this and the brain moves with it: ``$ATHENA_HOME/brain``.
HOME_ENV = "ATHENA_HOME"


def athena_home() -> Path:
    """``$ATHENA_HOME`` if set, else ``~/.athena``. Always absolute — see :func:`brain_root`."""
    env = os.environ.get(HOME_ENV)
    return (Path(env).expanduser() if env else Path.home() / ".athena").absolute()


def brain_root(root: str | Path | None = None) -> Path:
    """Resolve the brain root: an explicit argument wins, then the environment, then the default.

    **The answer is always absolute**, and that is not tidiness. ``Brain.read_connection`` opens a
    read-only handle through a ``file:`` URI, and ``Path.as_uri`` raises on a relative path — so
    ``athena serve --brain demo-brain`` bound a socket happily and then failed every read route
    and every turn with a bare ``ValueError``. It is ``absolute()`` rather than ``resolve()``: the
    cwd is prepended once, here, and a symlinked brain directory stays the path the user typed.
    """
    if root is not None:
        return Path(root).expanduser().absolute()
    return athena_home() / "brain"


def index_path(root: str | Path | None = None) -> Path:
    return brain_root(root) / INDEX_FILENAME


def ensure_tree(root: str | Path | None = None) -> Path:
    """Create the tree if it is absent and return the root. Idempotent."""
    base = brain_root(root)
    for rel in ("", *TREE):
        (base / rel).mkdir(parents=True, exist_ok=True)
    return base

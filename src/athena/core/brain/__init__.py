"""The brain: one markdown file per memory, a rebuildable SQLite index beside it (README §3.1).

Read the modules in this order. :mod:`paths` is the directory layout; :mod:`frontmatter` is the
file format and the one refusal that keeps it injectable-proof; :mod:`schema` is the index;
:mod:`store` is the writer, the provenance gate and the per-request read handle; :mod:`reconcile`
rebuilds the second from the first, which is the invariant this package exists to hold.
"""

from __future__ import annotations

from athena.core.brain.frontmatter import FrontmatterError
from athena.core.brain.paths import INDEX_FILENAME, brain_root, ensure_tree
from athena.core.brain.reconcile import ReconcileStats, index_fingerprint, reconcile_from_disk
from athena.core.brain.store import Brain, MemoryRef, NodeRow, ProvenanceError

__all__ = [
    "INDEX_FILENAME",
    "Brain",
    "FrontmatterError",
    "MemoryRef",
    "NodeRow",
    "ProvenanceError",
    "ReconcileStats",
    "brain_root",
    "ensure_tree",
    "index_fingerprint",
    "reconcile_from_disk",
]

"""The memory wall's two acts reach a paired PC as write-once records (ADR 0233).

Promote and erase used to rewrite and delete replicated files in place, which ADR 0140's pull of
write-once files cannot carry: a peer kept the stamped copy (or filed a conflict), and an erased
project's memories lived on at every peer and came back on the next pull. Now a promotion is a new
core memory that ``supersedes`` the stamped one and says ``promoted_from``, and an erase is a
retired core fact that ``erases`` the space; both replicate like any other fact, and the receiver
applies them to its own brain.

Two real brains over real HTTP, as in ``test_replicate.py``. Each PC holds the project's file
(``spaces/<id>.md``) - spaces themselves do not replicate yet, so B's copy is placed by hand - so
"in the project" means a recall *in* that project on B, not a project B cannot see at all.
"""

from __future__ import annotations

import shutil
from collections.abc import Iterator
from pathlib import Path

import pytest

from athena.core.brain import index_fingerprint, paths
from athena.core.brain.store import Brain
from athena.core.recall import recall
from athena.peer.replicate import CURSORS_FILENAME, PEER_DIRNAME, Puller
from athena.spaces.book import SpaceBook
from athena.spaces.memory import (
    erase_space_memory,
    promote_to_core,
    space_counts,
    space_memory_page,
)

from .conftest import Probe
from .test_replicate import Node, _node, pull, share


@pytest.fixture
def pair(tmp_path: Path) -> Iterator[tuple[Node, Node]]:
    probe = Probe()
    a, b = _node(tmp_path / "a", probe), _node(tmp_path / "b", probe)
    try:
        yield a, b
    finally:
        for node in (a, b):
            node.host.close()
            node.brain.close()


def project_on_both(a: Node, b: Node, name: str) -> str:
    """A project made on A, its file copied to B (what project replication will do later)."""
    space = SpaceBook(a.brain).create({"name": name}).id
    target = paths.space_file(b.brain.root, space)
    target.parent.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(paths.space_file(a.brain.root, space), target)
    return space


def served(brain: Brain, query: str, space: str = "") -> set[str]:
    return {memory.id for memory in recall(brain, query, space=space).items}


def bodies(brain: Brain, query: str, space: str = "") -> set[str]:
    return {memory.excerpt for memory in recall(brain, query, space=space).items}


def file_of(brain: Brain, node_id: str) -> Path | None:
    node = brain.node(node_id)
    return None if node is None else brain.root / node.file_path


def forget_cursor(node: Node) -> None:
    """What a re-pair (or a lost ``.peer/``) leaves: no cursor, so the next pull reads from zero."""
    (node.brain.root / PEER_DIRNAME / CURSORS_FILENAME).unlink(missing_ok=True)
    node.puller = Puller(node.host, node.brain)


# -- promote ---------------------------------------------------------------------------------------


def test_a_promotion_on_a_reaches_b_as_a_core_memory_and_leaves_the_project(
    pair: tuple[Node, Node],
) -> None:
    a, b = pair
    share(a, b)
    taxes = project_on_both(a, b, "Taxes")
    said = a.brain.append_episode("we talked about the zephyr invoice", space=taxes)
    fact = a.brain.write_fact(
        "zephyr detail", "The zephyr invoice is due on Friday.", sources=[said.id], space=taxes
    )
    assert pull(b, a).pulled == 2
    assert fact.id in served(b.brain, "zephyr", taxes) and fact.id not in served(b.brain, "zephyr")
    original = (a.brain.root / fact.path).read_bytes()

    assert promote_to_core(a.brain, taxes, fact.id) == "fact"

    # Write-once on A too: the stamped original keeps its bytes; the promotion is a new memory.
    assert (a.brain.root / fact.path).read_bytes() == original
    passed = pull(b, a)
    assert passed.state == "ok" and passed.pulled == 1
    assert passed.conflicts == 0 and passed.deferred == 0 and passed.refused == 0
    assert not (b.brain.root / PEER_DIRNAME / "conflicts").exists()

    # B serves the memory in core - and so in every project - under its successor's id ...
    assert "The zephyr invoice is due on Friday." in bodies(b.brain, "zephyr")
    assert "The zephyr invoice is due on Friday." in bodies(b.brain, "zephyr", taxes)
    # ... and never the project's stamped copy, in core or in the project.
    assert fact.id not in served(b.brain, "zephyr") | served(b.brain, "zephyr", taxes)
    page, total = space_memory_page(b.brain, taxes, "fact", 50)
    assert total == 0 and fact.id not in {row.id for row in page}
    assert space_counts(b.brain, taxes).facts == 0
    # A and B agree on what each serves.
    assert served(a.brain, "zephyr") == served(b.brain, "zephyr")
    assert served(a.brain, "zephyr", taxes) == served(b.brain, "zephyr", taxes)

    # A second promotion of the same memory is nothing to do.
    assert promote_to_core(a.brain, taxes, fact.id) is None

    # Replicating twice changes nothing on either side.
    before = index_fingerprint(b.brain)
    again = pull(b, a)
    assert (again.pulled, again.conflicts, again.deferred, again.refused) == (0, 0, 0, 0)
    assert index_fingerprint(b.brain) == before
    back = pull(a, b)
    assert (back.pulled, back.conflicts, back.refused) == (0, 0, 0)


# -- erase -----------------------------------------------------------------------------------------


def test_an_erase_on_a_erases_the_project_on_b_and_a_re_pair_does_not_bring_it_back(
    pair: tuple[Node, Node],
) -> None:
    a, b = pair
    share(a, b)
    taxes = project_on_both(a, b, "Taxes")
    said = a.brain.append_episode("we talked about the zephyr invoice", space=taxes)
    fact = a.brain.write_fact(
        "zephyr detail", "The zephyr invoice is due on Friday.", sources=[said.id], space=taxes
    )
    kept = a.brain.append_episode("the harbour invoice is core's", space="")
    assert pull(b, a).pulled == 3
    erased = {said.id, fact.id}
    on_b = {node_id: file_of(b.brain, node_id) for node_id in erased}
    assert all(path is not None and path.exists() for path in on_b.values())

    assert erase_space_memory(a.brain, taxes) == (1, 1, 0)
    # Written on B after the erase, in the same project: not the erase's to take.
    later = b.brain.append_episode("a later zephyr note, after the erase", space=taxes)

    # A re-pair before B has heard of the erase: B still offers the project, A takes none of it.
    forget_cursor(a)
    early = pull(a, b)
    assert early.state == "ok" and early.refused == 0
    assert all(a.brain.node(node_id) is None for node_id in erased)
    assert not any(path.exists() for path in (a.brain.root / "episodes").rglob(f"{said.id}_*"))

    passed = pull(b, a)
    assert passed.state == "ok" and passed.deferred == 0 and passed.refused == 0
    # B no longer holds or serves what was erased: no row, no file, no recall in the project.
    assert all(b.brain.node(node_id) is None for node_id in erased)
    assert not any(path is not None and path.exists() for path in on_b.values())
    assert erased.isdisjoint(served(b.brain, "zephyr", taxes) | served(b.brain, "zephyr"))
    # What the erase did not name is untouched on B: core's memory, and B's later project note.
    assert b.brain.node(kept.id) is not None
    later_file = file_of(b.brain, later.id)
    assert later_file is not None and later_file.exists()
    assert later.id in served(b.brain, "zephyr later note", taxes)

    # A re-pair after: still nothing of the erased project comes back to A, and none to B.
    forget_cursor(a)
    forget_cursor(b)
    pull(a, b)
    pull(b, a)
    assert all(a.brain.node(node_id) is None for node_id in erased)
    assert all(b.brain.node(node_id) is None for node_id in erased)

    # Replicating twice changes nothing.
    before_a, before_b = index_fingerprint(a.brain), index_fingerprint(b.brain)
    again_b, again_a = pull(b, a), pull(a, b)
    assert (again_b.pulled, again_b.conflicts, again_b.refused) == (0, 0, 0)
    assert (again_a.pulled, again_a.conflicts, again_a.refused) == (0, 0, 0)
    assert index_fingerprint(a.brain) == before_a and index_fingerprint(b.brain) == before_b

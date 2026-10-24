"""Write-once memory replication between two paired PCs, over real HTTP (ADR 0140, WP2).

Two brains, two device ids, two peer hosts on loopback sockets (``admit_loopback``, the test flag).
The pairing ceremony has its own tests (``test_pairing.py``, ``test_devices.py``); here each host
is given the row and the sealed key the ceremony would have left, so a test says exactly which
grants each side gave. Pullers are built by hand and never started: a pass runs when the test
says so, which is what lets a test put "the fact arrives before its episode" in a known order.
"""

from __future__ import annotations

import threading
from collections.abc import Iterator
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path

import pytest

from athena.contracts import ids
from athena.core.brain import frontmatter
from athena.core.brain.reconcile import index_fingerprint, reconcile_from_disk
from athena.core.brain.store import REPLICATED_KINDS, Brain, device_of
from athena.core.recall import recall
from athena.peer.devices import devices
from athena.peer.listener import PeerHost
from athena.peer.registry import mint_token
from athena.peer.replicate import (
    CONFLICTS_DIRNAME,
    CURSORS_FILENAME,
    PEER_DIRNAME,
    SKEW,
    PassResult,
    Puller,
    brain_routes,
    manifest,
    memory_view,
    peer_routes,
)

from .conftest import MemorySeal, Probe, http


@dataclass
class Node:
    """One PC: its brain, stamped with its own device id, and its peer host."""

    brain: Brain
    host: PeerHost
    puller: Puller

    @property
    def device_id(self) -> str:
        return self.host.identity.identity.device_id

    @property
    def url(self) -> str:
        base = self.host.base_url()
        assert base is not None, "the peer listener is not bound"
        return base


def _node(root: Path, probe: Probe) -> Node:
    host = PeerHost(root / "peer", port=0, probe=probe, seal=MemorySeal(), admit_loopback=True)
    brain = Brain(root / "brain", device_id=host.identity.identity.device_id)
    host.add_routes(brain_routes(brain))
    return Node(brain, host, Puller(host, brain))


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


def grant(giver: Node, taker: Node, grants: list[str]) -> str:
    """What an approved, claimed pairing leaves: ``giver`` lets ``taker`` in with ``grants``."""
    token = mint_token()
    giver.host.registry.admit(
        taker.device_id, name="other", kind="pc", grants=grants, token=token, expires_days=None
    )
    giver.host.reconcile()
    taker.host.keys.keep(giver.device_id, giver.url, token)
    return token


def pull(taker: Node, giver: Node) -> PassResult:
    """One pass of ``taker`` against ``giver``, with the key ``taker`` holds for it."""
    token = taker.host.keys.token(giver.device_id)
    assert token is not None
    return taker.puller.pull(giver.device_id, giver.url, token)


def share(a: Node, b: Node) -> None:
    grant(a, b, ["chat", "memory"])
    grant(b, a, ["chat", "memory"])


def replicated(brain: Brain) -> set[tuple[str, str]]:
    """``(id, sha256)`` of every write-once memory, read from the brain's own manifest."""
    page = manifest(brain, None, limit=10_000)
    return {(item["id"], item["sha256"]) for item in page["items"]}


def text_of(brain: Brain, node_id: str) -> str:
    node = brain.node(node_id)
    assert node is not None
    return (brain.root / node.file_path).read_text(encoding="utf-8")


# -- acceptance 1: convergence --------------------------------------------------------------------


def test_two_brains_with_interleaved_writes_converge_after_a_mutual_pull(
    pair: tuple[Node, Node],
) -> None:
    a, b = pair
    share(a, b)
    a1 = a.brain.append_episode("Northwind pays on the 30th", "user")
    b1 = b.brain.append_episode("the study PC runs the invoices", "user")
    a2 = a.brain.append_episode("noted", "assistant")
    a.brain.write_fact("northwind", "Northwind pays on the 30th", sources=[a1.id])
    b.brain.write_procedural("invoices", "open the study PC", scope="action", sources=[b1.id])
    b.brain.write_fact("study", "the study PC runs invoices", sources=[b1.id], every_turn=True)
    a.brain.write_procedural("thanks", "say noted", sources=[a1.id, a2.id])

    first = pull(a, b)
    assert first.state == "ok" and first.pulled == 3 and first.conflicts == 0
    back = pull(b, a)
    # b gets a's four, and skips its own three that a now serves too.
    assert back.state == "ok" and back.pulled == 4 and back.skipped == 3

    assert replicated(a.brain) == replicated(b.brain)
    assert len(replicated(a.brain)) == 7
    # The sender's bytes, the sender's stamp: a copy says where it was written.
    assert text_of(a.brain, b1.id) == text_of(b.brain, b1.id)
    meta, _ = frontmatter.parse(text_of(a.brain, b1.id))
    assert device_of(meta) == b.device_id
    meta, _ = frontmatter.parse(text_of(b.brain, a1.id))
    assert device_of(meta) == a.device_id
    # A received fact is a live memory with its provenance, not a file beside the index.
    assert a.brain.sources_of(next(i for i, _ in replicated(a.brain) if i.startswith("proc_")))
    assert a.brain.counts() == b.brain.counts()

    again = pull(a, b)
    assert again.pulled == 0 and again.conflicts == 0 and again.deferred == 0


def test_the_cursor_is_the_newest_stamp_less_the_skew_and_is_written_whole(
    pair: tuple[Node, Node],
) -> None:
    a, b = pair
    share(a, b)
    b.brain.append_episode("one", "user")
    a.puller.pull_all()
    cursor = a.puller.cursor(b.device_id)
    assert cursor is not None
    path = a.brain.root / PEER_DIRNAME / CURSORS_FILENAME
    assert path.is_file()
    assert b.device_id in path.read_text(encoding="utf-8")
    newest = max(item["created"] for item in manifest(b.brain, None)["items"])
    assert datetime.fromisoformat(newest) - datetime.fromisoformat(cursor) == SKEW
    # A fresh puller reads the cursor back from disk.
    assert Puller(a.host, a.brain).cursor(b.device_id) == cursor


def test_a_manifest_pages_with_next_and_a_tie_break_on_one_stamp(pair: tuple[Node, Node]) -> None:
    a, b = pair
    share(a, b)
    same = datetime(2026, 10, 24, 9, 0, tzinfo=UTC)
    made = {b.brain.append_episode(f"tick {n}", "user", created=same).id for n in range(5)}
    page = manifest(b.brain, None, limit=2)
    assert page["truncated"] is True and page["next"] is not None and page["next_after"]
    seen = {item["id"] for item in page["items"]}
    while page["next"] is not None:
        page = manifest(b.brain, page["next"], page["next_after"], limit=2)
        seen |= {item["id"] for item in page["items"]}
    assert seen == made, "a page that is all one instant still moves on"
    assert page["truncated"] is False


# -- acceptance 2: provenance is not bypassed -----------------------------------------------------


def test_a_fact_citing_a_remote_episode_lands_only_after_that_episode(
    pair: tuple[Node, Node],
) -> None:
    a, b = pair
    share(a, b)
    episode = b.brain.append_episode("Contoso moved to net-60", "user")
    fact = b.brain.write_fact("contoso", "Contoso pays net-60", sources=[episode.id])
    # The episode is not in b's manifest this pass (its file is away), so a sees only the fact.
    held = b.brain.root / episode.path
    away = held.with_name("away.tmp")
    held.rename(away)

    first = pull(a, b)
    assert first.deferred == 1 and first.pulled == 0
    assert a.brain.node(fact.id) is None
    assert not (a.brain.root / fact.path).exists(), "never written with a dead source"
    view = memory_view(a.host, b.device_id)
    assert view is not None and view["deferred"] == 1 and view["state"] == "ok"

    away.rename(held)
    second = pull(a, b)
    assert second.pulled == 2 and second.deferred == 0
    assert a.brain.sources_of(fact.id) == [episode.id]
    assert a.brain.live_episode_ids([episode.id]) == {episode.id}


# -- acceptance 3: a rebuild over a merged tree changes nothing -----------------------------------


def test_reconcile_over_a_merged_tree_is_idempotent(pair: tuple[Node, Node]) -> None:
    a, b = pair
    share(a, b)
    e = a.brain.append_episode("from a", "user")
    a.brain.write_fact("a", "fact from a", sources=[e.id], every_turn=True)
    f = b.brain.append_episode("from b", "assistant")
    b.brain.write_procedural("b", "rule from b", sources=[f.id])
    a.puller.pull_all()
    b.puller.pull_all()

    for node in (a, b):
        before = index_fingerprint(node.brain)
        counts = node.brain.counts()
        stats = reconcile_from_disk(node.brain)
        assert stats.skipped == [] and stats.unsourced == []
        assert index_fingerprint(node.brain) == before
        assert node.brain.counts() == counts


# -- acceptance 4: eight-hex episodes still travel and recall -------------------------------------


def test_an_eight_hex_episode_on_disk_replicates_is_cited_and_recalls(
    pair: tuple[Node, Node],
) -> None:
    a, b = pair
    share(a, b)
    legacy = "ep_0badc0de"
    rel = f"episodes/2026/01/02/{legacy}_user.md"
    (b.brain.root / rel).parent.mkdir(parents=True, exist_ok=True)
    (b.brain.root / rel).write_bytes(
        frontmatter.render(
            [
                ("id", legacy),
                ("type", "episode"),
                ("role", "user"),
                ("session", "cli"),
                ("created", "2026-01-02T08:00:00+00:00"),
            ],
            "the old laptop kept the Fabrikam ledger",
        ).encode("utf-8")
    )
    reconcile_from_disk(b.brain)
    b.brain.write_fact("fabrikam", "Fabrikam ledger lives on the old laptop", sources=[legacy])
    assert len(b.brain.append_episode("new", "user").id) == len("ep_") + 12

    a.puller.pull_all()
    assert a.brain.live_episode_ids([legacy]) == {legacy}
    trace = recall(a.brain, "Fabrikam ledger")
    assert legacy in {memory.id for memory in trace.items}


# -- acceptance 5: a conflict keeps the local copy ------------------------------------------------


def test_same_id_different_bytes_keeps_local_and_files_the_remote_copy(
    pair: tuple[Node, Node],
) -> None:
    a, b = pair
    share(a, b)
    theirs = b.brain.append_episode("the remote telling", "user")
    remote_bytes = (b.brain.root / theirs.path).read_bytes()
    # The same id on a, with another body: a write-once id with two bodies.
    mine = remote_bytes.replace(b"the remote telling", b"the local telling")
    (a.brain.root / theirs.path).parent.mkdir(parents=True, exist_ok=True)
    (a.brain.root / theirs.path).write_bytes(mine)
    reconcile_from_disk(a.brain)

    result = pull(a, b)
    assert result.conflicts == 1 and result.pulled == 0
    assert (a.brain.root / theirs.path).read_bytes() == mine, "the local file is untouched"
    filed = a.brain.root / PEER_DIRNAME / CONFLICTS_DIRNAME / f"{theirs.id}.{b.device_id}.md"
    assert filed.read_bytes() == remote_bytes
    assert a.brain.read_body(theirs.id) == "the local telling"

    again = pull(a, b)
    assert again.conflicts == 0, "filed once, counted once"
    view = memory_view(a.host, b.device_id)
    assert view is not None and view["conflicts"] == 1
    # A conflict file is beside the brain, not in it: a rebuild does not index it.
    assert reconcile_from_disk(a.brain).skipped == []


# -- acceptance 6: what is not write-once is not served -------------------------------------------


def test_goals_rituals_and_the_peer_directory_never_appear_in_a_manifest(
    pair: tuple[Node, Node],
) -> None:
    a, b = pair
    token = grant(b, a, ["memory"])
    episode = b.brain.append_episode("a case starts", "user")
    goal = ids.mint("project")
    b.brain.write_goal(goal, "Invoices", "chase Northwind", session_id="cli", created="2026-10-24")
    ritual = ids.mint("ritual")
    b.brain.write_ritual(
        ritual, "cadence", "weekly", "Weekly", "every Monday", session_id="cli", created="2026"
    )
    (b.brain.root / PEER_DIRNAME / CONFLICTS_DIRNAME).mkdir(parents=True)
    (b.brain.root / PEER_DIRNAME / CONFLICTS_DIRNAME / "x.md").write_text("---\nid: ep_1\n---\n")
    port = b.host.bound[1] if b.host.bound else 0
    auth = {"Authorization": f"Bearer {token}"}

    listed = http(port, "/peer/brain/manifest", headers=auth)
    assert listed.status == 200
    assert {item["id"] for item in listed.body["items"]} == {episode.id}
    assert {item["kind"] for item in listed.body["items"]} <= set(REPLICATED_KINDS)
    assert listed.body["next"] is None and listed.body["truncated"] is False
    for refused in (goal, ritual, "index.sqlite", "../index.sqlite"):
        assert http(port, f"/peer/brain/file?id={refused}", headers=auth).status == 404
    served = http(port, f"/peer/brain/file?id={episode.id}", headers=auth)
    assert served.status == 200 and served.raw == (b.brain.root / episode.path).read_bytes()
    assert http(port, "/peer/brain/manifest?since=yesterday", headers=auth).status == 400


def test_a_manifest_needs_the_memory_grant(pair: tuple[Node, Node]) -> None:
    a, b = pair
    token = grant(b, a, ["chat"])
    port = b.host.bound[1] if b.host.bound else 0
    answer = http(port, "/peer/brain/manifest", headers={"Authorization": f"Bearer {token}"})
    assert answer.status == 403 and answer.body["grant"] == "memory"
    assert http(port, "/peer/brain/manifest").status == 401


def test_a_peer_that_did_not_share_memory_back_is_not_shared_and_shows_in_devices(
    pair: tuple[Node, Node],
) -> None:
    a, b = pair
    grant(a, b, ["chat", "memory"])  # a shares with b...
    grant(b, a, ["chat"])  # ...but b did not share with a
    b.brain.append_episode("private to b", "user")
    status, body = devices(a.host)
    assert status == 200 and body["peers"][0]["memory"] is None, "null until pulled"

    results = a.puller.pull_all()
    assert results[b.device_id].state == "not_shared" and results[b.device_id].pulled == 0
    _, body = devices(a.host)
    memory = body["peers"][0]["memory"]
    assert memory["state"] == "not_shared" and memory["last_pull_at"] is not None
    assert set(memory) == {"last_pull_at", "pulled", "conflicts", "deferred", "state"}
    assert a.puller.cursor(b.device_id) is None


def test_an_unreachable_peer_is_recorded_and_its_cursor_kept(pair: tuple[Node, Node]) -> None:
    a, b = pair
    share(a, b)
    url = b.url
    b.host.close()
    result = a.puller.pull(b.device_id, url, b.host.keys.token(a.device_id) or "")
    assert result.state == "unreachable"
    view = memory_view(a.host, b.device_id)
    assert view is not None and view["state"] == "unreachable"


def test_only_pcs_this_device_granted_memory_are_pulled(pair: tuple[Node, Node]) -> None:
    a, b = pair
    grant(a, b, ["chat"])
    grant(b, a, ["memory"])
    assert a.puller.candidates() == []


# -- the loop -------------------------------------------------------------------------------------


def test_the_wired_puller_pulls_on_peer_changed_and_ends_with_the_host(tmp_path: Path) -> None:
    probe = Probe()
    a, b = _node(tmp_path / "a", probe), _node(tmp_path / "b", probe)
    try:
        share(a, b)
        episode = b.brain.append_episode("heard on b", "user")
        before = set(threading.enumerate())
        peer_routes(a.host, a.brain)  # starts a puller on a, as wiring does
        started = [t for t in set(threading.enumerate()) - before if t.name == "peer-replicate"]
        assert len(started) == 1
        a.host.publish("peer.changed", peer_id=b.device_id)
        for _ in range(200):
            if a.brain.node(episode.id) is not None:
                break
            threading.Event().wait(0.05)
        assert a.brain.node(episode.id) is not None
        a.host.close()
        started[0].join(timeout=10)
        assert not started[0].is_alive(), "the puller ends when the host closes its bus"
    finally:
        a.host.close()
        b.host.close()
        a.brain.close()
        b.brain.close()

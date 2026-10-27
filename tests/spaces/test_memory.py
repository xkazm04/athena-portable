"""A project's memory through the daemon: counts, the page, make core, erase, and what a turn in
it is told (ADR 0225, "Memory wall"). spaces/memory.py, spaces/routes.py, spaces/frame.py.

The memory is written the way the turn paths write it - through the brain's writers with the
turn's ``space`` - and read back only through the routes and the frame.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from athena.contracts.spaces import MEMORY_LINE_CAP
from athena.core.recall import recall
from athena.daemon.server import AthenaDaemon
from athena.spaces.book import SpaceBook
from athena.spaces.frame import space_frame

from .conftest import Live


def create(live: Live, name: str) -> str:
    reply = live.request("/spaces", method="POST", json_body={"name": name})
    assert reply.status == 201, reply.body
    return str(reply.body["id"])


def written(daemon: AthenaDaemon, space: str, word: str) -> dict[str, str]:
    """An episode, a fact, an always fact and a procedural in ``space``."""
    brain = daemon.brain
    episode = brain.append_episode(f"we settled the {word} question " + "x" * 400, space=space)
    return {
        "episode": episode.id,
        "fact": brain.write_fact(
            f"{word} fact", f"The {word} answer is 42.", sources=[episode.id], space=space
        ).id,
        "always": brain.write_fact(
            f"{word} always",
            f"Always mind the {word}.",
            sources=[episode.id],
            every_turn=True,
            space=space,
        ).id,
        "procedural": brain.write_procedural(
            f"when {word}", f"ask about the {word} first", sources=[episode.id], space=space
        ).id,
    }


def test_counts_and_the_memory_page_show_only_what_the_project_holds(
    live: Live, daemon: AthenaDaemon
) -> None:
    a = create(live, "Taxes")
    b = create(live, "Garden")
    mine = written(daemon, a, "zephyr")
    written(daemon, b, "quokka")
    written(daemon, "", "harbour")

    summary = live.request(f"/spaces/{a}").body
    assert summary["counts"] == {"episodes": 1, "facts": 2, "procedurals": 1, "chores": 0}

    page = live.request(f"/spaces/{a}/memory")
    assert page.status == 200
    assert (page.body["showing"], page.body["total"]) == (4, 4)
    assert {row["id"] for row in page.body["rows"]} == set(mine.values())
    for row in page.body["rows"]:
        assert set(row) == {"id", "kind", "line", "created"}
        assert len(row["line"]) <= MEMORY_LINE_CAP
        assert json.loads(row["line"])  # one quoted line, inert
    (episode_row,) = [r for r in page.body["rows"] if r["kind"] == "episode"]
    assert episode_row["line"].endswith('…"') and len(episode_row["line"]) == MEMORY_LINE_CAP

    facts = live.request(f"/spaces/{a}/memory?kind=fact&limit=1")
    assert (facts.body["showing"], facts.body["total"]) == (1, 2)
    assert facts.body["rows"][0]["kind"] == "fact"

    core = live.request("/spaces/core/memory").body
    assert core["total"] == 4 and set(mine.values()).isdisjoint(r["id"] for r in core["rows"])


def test_make_core_moves_a_fact_out_of_the_project_and_another_project_then_recalls_it(
    live: Live, daemon: AthenaDaemon
) -> None:
    a = create(live, "Taxes")
    b = create(live, "Garden")
    mine = written(daemon, a, "zephyr")
    assert mine["fact"] not in {m.id for m in recall(daemon.brain, "zephyr", space=b).items}

    moved = live.request(f"/spaces/{a}/memory/{mine['fact']}/core", method="POST")
    assert moved.status == 200 and moved.body == {"id": mine["fact"], "kind": "fact"}

    assert mine["fact"] in {m.id for m in recall(daemon.brain, "zephyr", space=b).items}
    assert live.request(f"/spaces/{a}").body["counts"]["facts"] == 1
    again = live.request(f"/spaces/{a}/memory/{mine['fact']}/core", method="POST")
    assert again.status == 404 and again.body["reason"] == "unknown_ref"
    # Another project's memory is not this project's to move.
    other = written(daemon, b, "quokka")
    wrong = live.request(f"/spaces/{a}/memory/{other['procedural']}/core", method="POST")
    assert wrong.status == 404 and wrong.body["reason"] == "unknown_ref"


def test_make_core_refuses_a_closed_memory_and_a_retired_marker_and_says_why(
    live: Live, daemon: AthenaDaemon
) -> None:
    """A memory a same-project successor closes would be hidden everywhere once core's (its
    closer is invisible there), and a retired forget marker would bar its key in every project:
    the move answers a reason, nothing moves, and recall is as it was."""
    a = create(live, "Taxes")
    brain = daemon.brain
    mine = written(daemon, a, "zephyr")
    newer = brain.write_fact(
        "zephyr fact",
        "The zephyr answer is 43.",
        sources=[mine["episode"]],
        supersedes=[mine["fact"]],
        space=a,
    )
    closed = live.request(f"/spaces/{a}/memory/{mine['fact']}/core", method="POST")
    assert closed.status == 409 and closed.body["reason"] == "validator_failed"
    assert "superseded" in closed.body["detail"]
    marker = brain.write_fact(
        "forgotten: zephyr always",
        "A person forgot this.",
        sources=[mine["episode"]],
        supersedes=[mine["always"]],
        retired=True,
        space=a,
    )
    retired = live.request(f"/spaces/{a}/memory/{marker.id}/core", method="POST")
    assert retired.status == 409 and "retired" in retired.body["detail"]
    node = brain.node(mine["fact"])
    assert node is not None and node.space == a, "nothing moved"
    # The live successor still moves: the refusal is about what is closed, not about the project.
    ok = live.request(f"/spaces/{a}/memory/{newer.id}/core", method="POST")
    assert ok.status == 200


def test_erase_answers_what_went_and_leaves_core_and_other_projects(
    live: Live, daemon: AthenaDaemon
) -> None:
    a = create(live, "Taxes")
    b = create(live, "Garden")
    mine = written(daemon, a, "zephyr")
    theirs = written(daemon, b, "quokka")
    files = [Path(daemon.brain.root) / _path(daemon, node) for node in mine.values()]

    erased = live.request(f"/spaces/{a}", method="DELETE")

    assert erased.status == 200
    assert erased.body == {
        "id": a,
        "episodes": 1,
        "facts": 2,
        "procedurals": 1,
        "chores_unlinked": 0,
    }
    assert not any(path.exists() for path in files)
    assert all(daemon.brain.node(node) is None for node in mine.values())
    assert all(daemon.brain.node(node) is not None for node in theirs.values())
    assert live.request(f"/spaces/{b}").body["counts"]["facts"] == 2


def _path(daemon: AthenaDaemon, node_id: str) -> str:
    node = daemon.brain.node(node_id)
    assert node is not None
    return node.file_path


def test_a_turn_in_a_project_is_told_what_is_kept_for_it_and_core_is_told_nothing(
    live: Live, daemon: AthenaDaemon
) -> None:
    a = create(live, "Taxes")
    b = create(live, "Garden")
    written(daemon, a, "zephyr")
    written(daemon, "", "harbour")
    book = SpaceBook(daemon.brain)

    frame = space_frame(book, a)
    assert frame is not None
    assert frame.kept == ('"Always mind the zephyr."',) and frame.kept_total == 1
    other = space_frame(book, b)
    assert other is not None and other.kept == () and other.kept_total == 0
    assert space_frame(book, "") is None


def test_the_core_recall_tool_answers_within_the_turns_project(
    live: Live, daemon: AthenaDaemon
) -> None:
    from athena.contracts import ids
    from athena.contracts.registry import Lane, TurnContext
    from athena.wiring import recall_executor

    a = create(live, "Taxes")
    mine = written(daemon, a, "zephyr")
    run = recall_executor(daemon.brain)

    def answer(space: str) -> Any:
        ctx = TurnContext(
            conversation_id="conv_wall", turn_id=ids.mint("turn"), lane=Lane.BROWSER, space_id=space
        )
        return run({"query": "zephyr question"}, ctx).output

    inside, outside = answer(a), answer("")
    assert mine["episode"] in inside and "The zephyr answer is 42." in inside
    assert mine["episode"] not in outside and "zephyr answer" not in outside


def test_a_memory_line_is_held_to_its_cap_with_its_quotes_and_escapes_counted(
    live: Live, daemon: AthenaDaemon
) -> None:
    a = create(live, "Taxes")
    for body in ('"' * 600, "\\" * 600, "plain " * 100, "short"):
        daemon.brain.append_episode(body, space=a)

    rows = live.request(f"/spaces/{a}/memory").body["rows"]

    assert len(rows) == 4
    for row in rows:
        assert len(row["line"]) <= MEMORY_LINE_CAP
        json.loads(row["line"])
    assert '"short"' in {row["line"] for row in rows}

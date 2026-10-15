"""Another tab's text, read by name, and the rest of the turn held to cards (ADR 0105).

``tabs_read`` is a shell hand: reversible, no side effects, so its flags derive ``AUTO`` and it is
offered on every trusted page. What it brings back is what the gate guards. Once the surface has
had text back from one, it says so on every request until the user's next message
(``tainted_by``), and every host call on the page files a card naming the tab the text came from,
an ``AUTO`` one included. The reading hand itself is the one exception. The surface also tags the
result with the tab it read (``source``), and the record groups the episode under that app.

``chase`` is the registered page's reversible, internal tool: its flags say ``AUTO``.
"""

from __future__ import annotations

from typing import Any

import pytest

from athena.contracts.channel import ToolResult, event_from_json
from athena.daemon.routes import MAX_GATED_NAMES, ListTooLong, tainted_by_from
from athena.daemon.server import AthenaDaemon
from athena.lane.turn_frame import tool_results_from

from .conftest import APP_ID, Live, claude_round, manifest_body, op

CHASE = f"host.{APP_ID}.chase"
READ = f"host.{APP_ID}.tabs_read"
BANK = "https://bank.test"

#: The hand as the panel appends it to the page's tools (``lib/hands.ts`` ``withHands``).
TABS_READ_TOOL: dict[str, Any] = {
    "name": "tabs_read",
    "description": "The text of another open tab, by its url, without acting there.",
    "params_schema": {
        "type": "object",
        "properties": {
            "url": {"type": "string", "maxLength": 2048},
            "query": {"type": "string", "maxLength": 200},
            "cursor": {"type": "string", "maxLength": 64},
        },
        "required": ["url"],
    },
    "reversible": True,
    "side_effects": "none",
    "runner": "shell",
}


def _register(live: Live) -> None:
    body = manifest_body()
    body["tools"] = [*body["tools"], TABS_READ_TOOL]
    reply = live.request("/manifest", method="POST", json_body=body)
    assert reply.status == 200, reply.body


def _all_episode_bodies(daemon: AthenaDaemon) -> list[str]:
    with daemon.brain.read_connection() as con:
        ids = [
            str(row[0])
            for row in con.execute(
                "SELECT id FROM companion_node WHERE kind = 'episode' ORDER BY created_at, id"
            ).fetchall()
        ]
    return [daemon.brain.read_body(node_id) for node_id in ids]


def _kinds(frames: list[tuple[str, dict[str, Any]]]) -> list[str]:
    return [kind for kind, _ in frames]


def _errors(frames: list[tuple[str, dict[str, Any]]]) -> list[Any]:
    return [payload.get("error") for kind, payload in frames if kind == "tool.result"]


# -- the gate, over HTTP -------------------------------------------------------------------------


def test_after_a_tab_read_an_auto_tool_files_a_card_that_names_the_source(live: Live) -> None:
    _register(live)
    live.script(claude_round(op(CHASE, invoice="7")))

    frames = live.run("chase it", tainted_by=[BANK]).frames()

    assert "decision.requested" in _kinds(frames)
    assert _errors(frames) == ["pending_approval"]
    (card,) = live.daemon.approvals.pending(10).rows
    assert card.action == CHASE
    assert f"uses text read from {BANK}" in card.summary
    (event,) = [p for k, p in frames if k == "decision.requested"]
    assert f"uses text read from {BANK}" in event["rationale"]


def test_in_an_exchange_with_no_tab_read_the_same_tool_runs_auto(live: Live) -> None:
    _register(live)
    live.script(claude_round(op(CHASE, invoice="7")))

    frames = live.run("chase it").frames()

    assert "decision.requested" not in _kinds(frames)
    assert "tool.call" in _kinds(frames) and _errors(frames) == []


def test_the_reading_hand_itself_is_not_held_by_the_taint(live: Live) -> None:
    _register(live)
    live.script(claude_round(op(READ, url=f"{BANK}/statements/9", cursor="cur_0_1_1400")))

    frames = live.run("read on", tainted_by=[BANK]).frames()

    assert "decision.requested" not in _kinds(frames)
    calls = [p for k, p in frames if k == "tool.call"]
    assert [c["name"] for c in calls] == [READ] and calls[0]["tier"] == 2


def test_a_malformed_taint_tightens_nothing_and_a_long_one_is_refused_whole() -> None:
    assert tainted_by_from({}) == frozenset()
    assert tainted_by_from({"tainted_by": BANK}) == frozenset()
    assert tainted_by_from({"tainted_by": [BANK, 3, " "]}) == frozenset({BANK})
    with pytest.raises(ListTooLong):
        tainted_by_from({"tainted_by": ["x"] * (MAX_GATED_NAMES + 1)})


# -- the result's source, and the record ----------------------------------------------------------


def test_a_tool_result_source_round_trips_and_a_malformed_one_is_dropped() -> None:
    result = ToolResult(call_id="c1", name=READ, output="from x", tier=2, source="host:bank")
    again = event_from_json(result.to_json())
    assert again == result and isinstance(again, ToolResult) and again.source == "host:bank"
    assert ToolResult().source is None

    (kept, dropped, absent) = tool_results_from(
        [
            {"name": READ, "output": "a", "source": "host:bank"},
            {"name": READ, "output": "b", "source": "https://bank.test"},
            {"name": READ, "output": "c"},
        ]
    )
    assert (kept.source, dropped.source, absent.source) == ("host:bank", None, None)


def test_the_episode_of_a_tab_read_is_marked_with_the_source_app(
    live: Live, daemon: AthenaDaemon
) -> None:
    _register(live)
    live.script(claude_round("The balance is there."))

    reply = live.run(
        "what is the closing balance?",
        tool_results=[
            {
                "call_id": "c1",
                "name": READ,
                "ok": True,
                "output": f"from {BANK} - Statement ({BANK}/s)\nClosing balance $12,480.22",
                "tier": 2,
                "source": "host:bank",
            },
            {"call_id": "c2", "name": CHASE, "ok": True, "output": "drafted", "tier": 1},
        ],
    )

    assert reply.status == 200
    bodies = _all_episode_bodies(daemon)
    assert any(
        b.startswith(f"[host:bank tier2] {READ} returned: from https://bank.test") for b in bodies
    ), bodies
    assert any(b.startswith(f"[host:{APP_ID} tier1] {CHASE} returned") for b in bodies), bodies

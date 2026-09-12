"""``POST /run``: one turn, over a real socket, on a scripted engine (README §3.2; ADR 0012).

These are the daemon's end-to-end tests. Everything but the CLI process is real — the brain, the
catalog, the gate with structural policy in front of it, the approval table, the ledger, the lane
and the HTTP server — so what they prove is what a browser would get: a well-formed SSE stream, a
gated call that stops and becomes a card, a host tool that leaves as an instruction, and a call
from the wrong origin refused in the one word the gate uses.
"""

from __future__ import annotations

from athena.contracts.registry import ToolClass
from athena.daemon.routes import DECISION_TOOL
from athena.daemon.server import AthenaDaemon

from .conftest import (
    APP_ID,
    OTHER_APP_ID,
    OTHER_PAGE_ORIGIN,
    PAGE_ORIGIN,
    Live,
    claude_round,
    op,
)

PROJECT = "proj_000000000001"


# -- the stream ------------------------------------------------------------------------------


def test_a_turn_streams_well_formed_frames_and_ends_with_turn_finished(live: Live) -> None:
    """Each frame is ``event:`` plus one line of ``data:``; ``Response.frames`` parses or fails."""
    live.register()
    live.script(claude_round("Two invoices are over thirty days."))

    reply = live.run("what is overdue?")

    assert reply.status == 200
    assert reply.header("Content-Type") == "text/event-stream"
    assert reply.header("Connection") == "close"
    frames = reply.frames()
    assert [kind for kind, _ in frames] == ["text.delta", "turn.summary", "turn.finished"]
    assert frames[-1][1]["text"] == "Two invoices are over thirty days."
    assert frames[-2][1]["engine"] == "claude_code"


def test_an_engine_that_says_nothing_ends_the_stream_with_turn_error(live: Live) -> None:
    """The harness guarantees a last event either way; the daemon does not invent one."""
    live.register()

    reply = live.run("what is overdue?")

    assert reply.status == 200
    kinds = [kind for kind, _ in reply.frames()]
    assert kinds[-1] == "turn.error"
    assert reply.frames()[-1][1]["reason"] == "engine_error"


# -- the gate --------------------------------------------------------------------------------


def test_a_gated_call_becomes_a_decision_frame_and_a_row_that_is_still_pending(
    live: Live, daemon: AthenaDaemon
) -> None:
    """The heart of it: nothing gated ran, the user has a card, and the row outlives the turn."""
    live.register()
    live.script(
        claude_round(
            "I will need your approval for that.\n"
            + op("host.invoices.pay", "the invoice the user named", invoice="7")
        )
    )

    reply = live.run("pay invoice 7")

    kinds = [kind for kind, _ in reply.frames()]
    assert kinds == [
        "text.delta",
        "tool.call",
        "decision.requested",
        "tool.result",
        "turn.summary",
        "turn.finished",
    ]
    card = dict(reply.frames()[2][1])
    assert card["action"] == "host.invoices.pay"
    assert card["params"] == {"invoice": "7"}
    assert card["rationale"] == "the invoice the user named"
    # The AG-UI convention a panel renders the card as, on the same frame as the event itself.
    assert card["tool"] == DECISION_TOOL
    assert [option["id"] for option in card["options"]] == ["approve", "decline"]

    # The call was refused for the one reason a card is, and the row is waiting on the user.
    assert reply.frames()[3][1]["error"] == "pending_approval"
    page = daemon.approvals.pending(10)
    assert page.total == 1
    row = page.rows[0]
    assert (row.id, row.action, row.params) == (card["id"], "host.invoices.pay", {"invoice": "7"})
    assert row.conversation == "conv_invoices"
    assert live.request("/health").body["pending"] == {"showing": 1, "total": 1, "footer": ""}


def test_an_allowed_host_tool_leaves_as_an_instruction_and_nothing_executed_it(
    live: Live, daemon: AthenaDaemon
) -> None:
    """A host tool has no executor anywhere in this process (ADR 0010): the page runs it."""
    live.register()
    live.script(claude_round("Chasing it.\n" + op("host.invoices.chase", invoice="7")))

    reply = live.run("chase invoice 7")

    kinds = [kind for kind, _ in reply.frames()]
    assert kinds == ["text.delta", "tool.call", "turn.summary", "turn.finished"]
    call = reply.frames()[1][1]
    assert call["name"] == "host.invoices.chase"
    assert call["params"] == {"invoice": "7"}
    assert call["tier"] == 1
    assert daemon.catalog.classify("host.invoices.chase") is ToolClass.AUTO
    assert daemon.catalog.get("host.invoices.chase").executor is None
    assert daemon.approvals.pending(10).total == 0


def test_a_call_to_another_apps_tool_is_refused_foreign_origin(live: Live) -> None:
    """Structural policy rule 3, over HTTP: a session drives its own page and nobody else's."""
    live.register()
    live.register(OTHER_APP_ID, OTHER_PAGE_ORIGIN)
    live.script(
        claude_round("Paying the other one.\n" + op(f"host.{OTHER_APP_ID}.pay", invoice="9"))
    )

    reply = live.run("pay the crm invoice", origin=PAGE_ORIGIN)

    results = [payload for kind, payload in reply.frames() if kind == "tool.result"]
    assert len(results) == 1
    assert results[0]["error"] == "foreign_origin"
    assert f"host:{APP_ID}" in results[0]["output"]
    assert live.daemon.approvals.pending(10).total == 0, "a refused call filed a card"


def test_a_run_for_an_origin_with_no_session_is_refused_before_the_stream_opens(
    live: Live,
) -> None:
    reply = live.run("what is overdue?", origin="https://nobody.example")

    assert reply.status == 403
    assert reply.body["reason"] == "foreign_origin"
    assert "manifest" in reply.body["detail"]


def test_a_project_id_that_is_not_one_is_refused(live: Live) -> None:
    """Ids are minted in one place; a bare slug is not given a prefix here (README §3.5)."""
    live.register()

    reply = live.run("what is overdue?", project_id="the-tax-quarter")

    assert reply.status == 400
    assert reply.body["reason"] == "unknown_ref"


# -- the record ------------------------------------------------------------------------------


def test_the_turn_writes_marked_episodes_and_records_the_tier_that_answered(
    live: Live, daemon: AthenaDaemon
) -> None:
    """``[host:<origin>]``, ``[project:<id>]`` and ``tier`` are what act 4 reads back."""
    live.register()
    live.script(claude_round("Chased."))

    reply = live.run(
        "chase it",
        project_id=PROJECT,
        tool_results=[
            {
                "call_id": "c1",
                "name": "host.invoices.chase",
                "ok": True,
                "output": "a note was drafted",
                "tier": 2,
            }
        ],
    )

    assert reply.status == 200
    bodies = _episode_bodies(daemon, "conv_proj_000000000001")
    assert any(
        body.startswith(f"[host:{APP_ID} tier2] [project:{PROJECT}] host.invoices.chase returned")
        for body in bodies
    ), bodies
    assert f"[host:{APP_ID}] [project:{PROJECT}] chase it" in bodies
    assert f"[host:{APP_ID}] [project:{PROJECT}] Chased." in bodies


def test_a_project_moves_the_conversation_and_the_ledger_row_with_it(
    live: Live, daemon: AthenaDaemon
) -> None:
    """One project, one conversation, every page (README §3.5) — and one ledger row that says so."""
    live.register()
    live.script(claude_round("Noted."), claude_round("Noted again."))

    live.run("first", project_id=PROJECT)
    live.run("second")

    conversations = [row.conversation for row in daemon.ledger.recent(10).rows]
    assert conversations == ["conv_invoices", f"conv_{PROJECT}"]
    rows = daemon.ledger.recent(10).rows
    assert all(row.origin == f"host:{APP_ID}" for row in rows)
    assert all(row.rounds == 1 and not row.is_error for row in rows)


def _episode_bodies(daemon: AthenaDaemon, conversation: str) -> list[str]:
    """Every episode of one conversation, read back off disk through the index."""
    with daemon.brain.read_connection() as con:
        ids = [
            str(row[0])
            for row in con.execute(
                "SELECT id FROM companion_node WHERE kind = 'episode' AND session_id = ? "
                "ORDER BY created_at, id",
                (conversation,),
            ).fetchall()
        ]
    return [daemon.brain.read_body(node_id) for node_id in ids]

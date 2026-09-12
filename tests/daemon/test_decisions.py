"""``POST /decisions/<id>``: the gated path, closed (README §3.2 step 6).

A card is answered once, by the user, and the answer is proved against the row before anything is
allowed to happen. What comes back for a host tool is an ``execute`` instruction carrying the
parameters *the row* holds — not the ones this request sent — because that is what keeps an
approved card from being spent on a neighbouring call.
"""

from __future__ import annotations

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

PROJECT = "proj_00000000beef"


def _card(live: Live, *, project_id: str = "", invoice: str = "7") -> str:
    """Run one turn that proposes a gated call, and return the id of the card it filed."""
    live.register()
    live.script(
        claude_round("That needs your approval.\n" + op("host.invoices.pay", invoice=invoice))
    )
    body = {"project_id": project_id} if project_id else {}
    reply = live.run("pay it", **body)
    cards = [payload for kind, payload in reply.frames() if kind == "decision.requested"]
    assert len(cards) == 1, "the turn did not file exactly one card"
    return str(cards[0]["id"])


# -- approving ---------------------------------------------------------------------------------


def test_an_approval_comes_back_as_an_execute_with_the_same_action_and_params(
    live: Live, daemon: AthenaDaemon
) -> None:
    approval_id = _card(live)

    reply = live.request(
        f"/decisions/{approval_id}", method="POST", json_body={"choice": "approve"}
    )

    assert reply.status == 200
    body = reply.body
    assert body["ok"] is True
    assert body["status"] == "approved"
    assert body["execute"] == [
        {
            "call_id": body["execute"][0]["call_id"],
            "name": "host.invoices.pay",
            "params": {"invoice": "7"},
            "origin": f"host:{APP_ID}",
            "tier": 1,
            "approval_id": approval_id,
        }
    ]
    assert body["output"] == "", "a host tool is run by the page, never here"
    assert daemon.approvals.describe(approval_id).status == "approved"
    assert daemon.approvals.pending(10).total == 0


def test_the_execute_carries_the_rows_parameters_and_not_the_requests(live: Live) -> None:
    """The replay is measured against the grant, so a body cannot smuggle a second call in."""
    approval_id = _card(live, invoice="7")

    reply = live.request(
        f"/decisions/{approval_id}",
        method="POST",
        json_body={"choice": "approve", "params": {"invoice": "999"}},
    )

    assert reply.body["execute"][0]["params"] == {"invoice": "7"}


def test_an_approval_is_recorded_as_an_episode_of_the_cards_own_conversation(
    live: Live, daemon: AthenaDaemon
) -> None:
    approval_id = _card(live)

    live.request(
        f"/decisions/{approval_id}",
        method="POST",
        json_body={"choice": "approve", "answer": "yes, the one from Tuesday"},
    )

    bodies = _episodes(daemon, "conv_invoices")
    assert any(body.startswith(f"[host:{APP_ID}] [decision] the user approved") for body in bodies)
    assert any("the user added: yes, the one from Tuesday" in body for body in bodies)


# -- declining -----------------------------------------------------------------------------------


def test_a_decline_runs_nothing_and_is_ledgered_under_the_cards_conversation(
    live: Live, daemon: AthenaDaemon
) -> None:
    """A card filed during a project-scoped turn is answered and *recorded* under that project.

    The conversation comes off the approval row and not off this request, which is the only way a
    decision answered from a second surface lands where the turn that raised it did.
    """
    approval_id = _card(live, project_id=PROJECT)
    assert daemon.approvals.describe(approval_id).conversation == f"conv_{PROJECT}"

    reply = live.request(
        f"/decisions/{approval_id}", method="POST", json_body={"choice": "decline"}
    )

    assert reply.status == 200
    assert reply.body["status"] == "declined"
    assert reply.body["execute"] == []
    assert reply.body["conversation_id"] == f"conv_{PROJECT}"

    decision_rows = [row for row in daemon.ledger.recent(20).rows if row.trigger == "decision"]
    assert len(decision_rows) == 1
    row = decision_rows[0]
    assert row.conversation == f"conv_{PROJECT}"
    # Zero rounds: no model was invoked to answer a card, and the row says so rather than
    # charging the rollup for an invocation that never happened.
    assert (row.is_error, row.error_reason, row.rounds) == (True, "user_denied", 0)
    assert any("the user declined" in body for body in _episodes(daemon, f"conv_{PROJECT}"))


# -- the refusals ---------------------------------------------------------------------------------


def test_an_unknown_card_is_a_404_in_the_one_refusal_vocabulary(live: Live) -> None:
    live.register()

    reply = live.request(
        "/decisions/apr_000000000000", method="POST", json_body={"choice": "approve"}
    )

    assert reply.status == 404
    assert reply.body["reason"] == "unknown_ref"


def test_an_answer_the_card_never_offered_is_refused_and_leaves_the_row_pending(
    live: Live, daemon: AthenaDaemon
) -> None:
    """Exact string equality on the row's own options: a gate that guessed is a gate you can
    talk your way through (README §2 invariant 3)."""
    approval_id = _card(live)

    reply = live.request(
        f"/decisions/{approval_id}", method="POST", json_body={"choice": "sure, go ahead"}
    )

    assert reply.status == 409
    assert reply.body["reason"] == "pending_approval"
    assert daemon.approvals.describe(approval_id).status == "pending"


def test_a_second_answer_to_an_answered_card_is_refused(live: Live) -> None:
    approval_id = _card(live)
    first = live.request(
        f"/decisions/{approval_id}", method="POST", json_body={"choice": "approve"}
    )
    assert first.status == 200

    second = live.request(
        f"/decisions/{approval_id}", method="POST", json_body={"choice": "decline"}
    )

    assert second.status == 409
    assert second.body["reason"] == "pending_approval"


def test_a_decision_with_no_choice_is_refused(live: Live) -> None:
    approval_id = _card(live)

    reply = live.request(f"/decisions/{approval_id}", method="POST", json_body={})

    assert reply.status == 400
    assert reply.body["reason"] == "validator_failed"


def test_another_origin_may_not_answer_this_pages_card(live: Live) -> None:
    """The browser half of ``foreign_origin``: a neighbouring tab does not answer for this one."""
    approval_id = _card(live)
    live.register(OTHER_APP_ID, OTHER_PAGE_ORIGIN)

    reply = live.request(
        f"/decisions/{approval_id}",
        method="POST",
        json_body={"choice": "approve", "origin": OTHER_PAGE_ORIGIN},
    )

    assert reply.status == 403
    assert reply.body["reason"] == "foreign_origin"
    assert live.daemon.approvals.describe(approval_id).status == "pending"


def test_the_pages_own_origin_may_answer_its_card(live: Live) -> None:
    approval_id = _card(live)

    reply = live.request(
        f"/decisions/{approval_id}",
        method="POST",
        json_body={"choice": "approve", "origin": PAGE_ORIGIN},
    )

    assert reply.status == 200
    assert reply.body["status"] == "approved"


def _episodes(daemon: AthenaDaemon, conversation: str) -> list[str]:
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

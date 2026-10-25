"""``POST /decisions/<id>``: the gated path, closed (README §3.2 step 6).

A card is answered once, by the user, and the answer is proved against the row before anything is
allowed to happen. What comes back for a host tool is an ``execute`` instruction carrying the
parameters *the row* holds — not the ones this request sent — because that is what keeps an
approved card from being spent on a neighbouring call.
"""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass, replace
from typing import Any

from athena.contracts import ERROR_REASONS
from athena.contracts.manifest import HostTool
from athena.contracts.registry import ExecResult
from athena.daemon.routes import MAX_DISABLED_ORIGINS, tab_from
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
            # The turn named no tab, so the card is unbound and runs where it always did.
            "tab_id": None,
            "tab_nav": None,
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


# -- the tab a card was proposed on (ADR 0103) -------------------------------------------------


def test_a_card_filed_on_a_tab_comes_back_bound_in_the_inbox_and_the_execute(
    live: Live, daemon: AthenaDaemon
) -> None:
    live.register()
    live.script(claude_round(op("host.invoices.pay", invoice="7")))
    frames = live.run("pay it", tab_id=2, tab_nav=5).frames()
    (card,) = [payload for kind, payload in frames if kind == "decision.requested"]
    assert (card["tab_id"], card["tab_nav"]) == (2, 5)
    row = daemon.approvals.describe(str(card["id"]))
    assert (row.tab_id, row.tab_nav) == (2, 5)

    (pending,) = live.request("/decisions").body["pending"]
    assert (pending["tab_id"], pending["tab_nav"]) == (2, 5)

    reply = live.request(f"/decisions/{card['id']}", method="POST", json_body={"choice": "approve"})
    (execute,) = reply.body["execute"]
    assert (execute["tab_id"], execute["tab_nav"]) == (2, 5)


def test_the_tab_parse_takes_counts_and_nothing_else() -> None:
    assert tab_from({"tab_id": 2, "tab_nav": 5}) == (2, 5)
    assert tab_from({"tab_id": 2}) == (2, None)
    assert tab_from({"tab_nav": 5}) == (None, None), "a generation with no tab binds nothing"
    for raw in (-1, True, "2", 2.0, None, [2]):
        assert tab_from({"tab_id": raw, "tab_nav": 5}) == (None, None)
    assert tab_from({"tab_id": 2, "tab_nav": "5"}) == (2, None)
    assert tab_from({}) == (None, None)


def test_an_answer_naming_too_many_switched_off_origins_is_refused_whole_like_a_run(
    live: Live, daemon: AthenaDaemon
) -> None:
    """``disabled_origins`` is read off a decision as off a run, and past its cap it is refused
    the way ``POST /run`` refuses it: a 400 in the refusal vocabulary, the card left pending. A
    cut list would read the origins past the cap as switched on; an uncaught one was a 500."""
    approval_id = _card(live)
    too_many = [f"host:app{n}" for n in range(MAX_DISABLED_ORIGINS + 1)]

    reply = live.request(
        f"/decisions/{approval_id}",
        method="POST",
        json_body={"choice": "approve", "disabled_origins": too_many},
    )

    assert reply.status == 400
    assert reply.body["reason"] == "validator_failed"
    assert "disabled_origins" in reply.body["detail"]
    assert daemon.approvals.describe(approval_id).status == "pending"


# -- the inbox says whether a card will run, and what fixes it (ADR 0158) ------------------------

MAIL = "connector.gmail.send_mail"
#: The policy rule ids a person never reads: a blocked row's sentence names none of them.
RULE_IDS = ("per_lane_allow_list", "origin_enabled", "origin_pinning", "connector_enabled")


class _Mail:
    """A connector that sends at once and counts its sends."""

    def __init__(self) -> None:
        self.calls = 0

    def list_tools(self) -> Sequence[HostTool]:
        return [
            HostTool(
                name="send_mail",
                description="Send a message.",
                params_schema={"type": "object", "properties": {"to": {"type": "string"}}},
                reversible=True,
                side_effects="external",
            )
        ]

    def call(self, name: str, params: dict[str, Any]) -> ExecResult:
        self.calls += 1
        return ExecResult(ok=True, output=f"sent to {params.get('to', '')}", tier=3)


@dataclass
class _Switch:
    """The vault as rule 4 asks it, with a switch the test flips."""

    live: bool = True

    def is_live(self, connector_id: str) -> bool:
        return self.live


def _row(live: Live, approval_id: str, query: str = "") -> dict[str, Any]:
    reply = live.request(f"/decisions{query}")
    assert reply.status == 200
    (row,) = [row for row in reply.body["pending"] if row["id"] == approval_id]
    return dict(row)


def _counts(daemon: AthenaDaemon) -> tuple[int, int]:
    with daemon.brain.read_connection() as con:
        (episodes,) = con.execute(
            "SELECT COUNT(*) FROM companion_node WHERE kind = 'episode'"
        ).fetchone()
    return daemon.ledger.recent(1).total, int(episodes)


def _assert_plain(blocked: dict[str, Any]) -> None:
    sentence = blocked["sentence"]
    assert isinstance(sentence, str) and sentence.strip()
    assert not any(rule in sentence for rule in RULE_IDS), sentence
    assert blocked["reason"] in ERROR_REASONS


def test_a_host_card_on_a_live_switched_on_app_says_it_will_run(live: Live) -> None:
    approval_id = _card(live)

    row = _row(live, approval_id)

    assert row["will_run"] is True
    assert row["blocked"] is None


def test_a_card_of_a_switched_off_app_says_so_and_the_replay_agrees(live: Live) -> None:
    approval_id = _card(live)

    row = _row(live, approval_id, f"?disabled_origins=host:{APP_ID}")

    assert row["will_run"] is False
    blocked = row["blocked"]
    assert (blocked["reason"], blocked["rule"]) == ("foreign_origin", "origin_enabled")
    assert blocked["remedy"] == {"act": "switch_on", "origin": f"host:{APP_ID}"}
    _assert_plain(blocked)

    reply = live.request(
        f"/decisions/{approval_id}",
        method="POST",
        json_body={"choice": "approve", "disabled_origins": [f"host:{APP_ID}"]},
    )
    assert reply.status == 409
    assert reply.body["reason"] == "foreign_origin"


def test_a_card_whose_tools_left_the_catalog_says_open_the_app_and_the_replay_agrees(
    live: Live, daemon: AthenaDaemon
) -> None:
    approval_id = _card(live)
    daemon.catalog.drop_origin(f"host:{APP_ID}")

    row = _row(live, approval_id)

    assert row["will_run"] is False
    blocked = row["blocked"]
    assert (blocked["reason"], blocked["rule"]) == ("unknown_ref", "tools_gone")
    assert blocked["remedy"] == {"act": "open_app", "origin": PAGE_ORIGIN}
    _assert_plain(blocked)

    reply = live.request(
        f"/decisions/{approval_id}", method="POST", json_body={"choice": "approve"}
    )
    assert reply.status == 409
    assert reply.body["reason"] == "unknown_ref"


def test_a_connector_card_whose_connector_is_not_live_says_reconnect_and_the_replay_agrees(
    live: Live, daemon: AthenaDaemon
) -> None:
    live.register()
    mail = _Mail()
    switch = _Switch()
    daemon.catalog.merge_connector("gmail", mail)
    daemon.gate.policy = replace(daemon.gate.policy, connectors=switch)
    live.script(claude_round("That needs your approval.\n" + op(MAIL, to="ana@example.com")))
    (card,) = [p for kind, p in live.run("mail ana").frames() if kind == "decision.requested"]
    approval_id = str(card["id"])
    switch.live = False

    row = _row(live, approval_id)

    assert row["will_run"] is False
    blocked = row["blocked"]
    assert (blocked["reason"], blocked["rule"]) == ("unknown_ref", "connector_enabled")
    assert blocked["remedy"] == {"act": "reconnect", "connector": "gmail"}
    _assert_plain(blocked)

    reply = live.request(
        f"/decisions/{approval_id}", method="POST", json_body={"choice": "approve"}
    )
    assert reply.status == 409
    assert reply.body["reason"] == "unknown_ref"
    assert mail.calls == 0


def test_reading_a_blocked_card_writes_nothing_and_it_runs_once_switched_back_on(
    live: Live, daemon: AthenaDaemon
) -> None:
    approval_id = _card(live)
    before = _counts(daemon)

    _row(live, approval_id, f"?disabled_origins=host:{APP_ID}")
    _row(live, approval_id, f"?disabled_origins=host:{APP_ID}")

    assert daemon.approvals.describe(approval_id).status == "pending"
    assert _counts(daemon) == before
    reply = live.request(
        f"/decisions/{approval_id}", method="POST", json_body={"choice": "approve"}
    )
    assert reply.status == 200
    assert reply.body["status"] == "approved"


def test_an_inbox_naming_too_many_switched_off_origins_is_refused_whole_like_a_run(
    live: Live,
) -> None:
    _card(live)
    too_many = ",".join(f"host:app{n}" for n in range(MAX_DISABLED_ORIGINS + 1))

    reply = live.request(f"/decisions?disabled_origins={too_many}")

    assert reply.status == 400
    assert reply.body["reason"] == "validator_failed"
    assert "disabled_origins" in reply.body["detail"]


def test_a_long_inbox_keeps_every_row_key_and_its_footer(live: Live) -> None:
    for n in range(25):
        _card(live, invoice=str(n))

    reply = live.request("/decisions?limit=20")

    assert reply.status == 200
    rows = reply.body["pending"]
    assert (reply.body["showing"], reply.body["total"]) == (20, 25)
    assert reply.body["footer"] == "(showing 20 of 25)"
    keys = {
        "id",
        "action",
        "params",
        "rationale",
        "options",
        "origin",
        "conversation_id",
        "surface",
        "created_at",
        "expires_at",
        "tab_id",
        "tab_nav",
    }
    assert all(keys <= set(row) for row in rows)
    assert [row["params"]["invoice"] for row in rows] == [str(n) for n in range(20)]


def test_every_blocked_row_says_why_in_a_plain_sentence(live: Live, daemon: AthenaDaemon) -> None:
    switched_off = _card(live, invoice="1")
    row = _row(live, switched_off, f"?disabled_origins=host:{APP_ID}")
    assert row["blocked"] is not None
    _assert_plain(row["blocked"])

    daemon.catalog.drop_origin(f"host:{APP_ID}")
    row = _row(live, switched_off)
    assert row["blocked"] is not None
    _assert_plain(row["blocked"])

"""The read routes: bounded, announced, and off a read connection (README §2 invariant 4).

Every one of these answers a question the panel asks while a turn may be running, so every one of
them is tested for two things: the numbers are honest against a brain that was really seeded, and
the route answers while the writer lock is held by somebody else.

The brain is seeded the way a brain is written — episodes first, then a procedural citing one.
There is no bypass anywhere in this repository and there is not one here either: a fixture that
inserted a procedural with no live source would be testing a brain nobody can build.
"""

from __future__ import annotations

import json
import threading
from typing import Any

from athena.core.brain import Brain
from athena.core.ledger import Ledger
from athena.daemon.server import AthenaDaemon

from .conftest import APP_ID, Live, claude_round, op

ORIGIN = f"host:{APP_ID}"


def _card(daemon: AthenaDaemon, summary: str, invoice: str) -> str:
    row = daemon.approvals.create(
        "host.invoices.pay",
        {"invoice": invoice},
        origin=ORIGIN,
        conversation="conv_invoices",
        surface="panel",
        summary=summary,
    )
    return row.id


def _rows(ledger: Ledger, count: int, **overrides: Any) -> None:
    for index in range(count):
        fields: dict[str, Any] = {
            "engine": "claude_code",
            "model": f"model-{index}",
            "conversation": "conv_invoices",
            "origin": ORIGIN,
            "surface": "panel",
            "trigger": "chat",
            "rounds": 1,
            "cost_usd": 0.01 * (index + 1),
        }
        fields.update(overrides)
        ledger.record(**fields)


def _playbook(brain: Brain, trigger: str, behavior: str) -> str:
    """One procedural, written the only way a procedural can be: citing a live episode."""
    body = f"[{ORIGIN}] {behavior}"
    episode = brain.append_episode(body, role="user", session_id="conv_invoices")
    return brain.write_procedural(trigger, body, sources=[episode.id]).id


# -- GET /decisions --------------------------------------------------------------------------


def test_the_inbox_is_bounded_and_says_what_it_left_out(live: Live, daemon: AthenaDaemon) -> None:
    for index in range(5):
        _card(daemon, f"chase invoice {index}", str(index))

    reply = live.request("/decisions?limit=2")

    assert reply.status == 200
    body = reply.body
    assert (body["showing"], body["total"]) == (2, 5)
    assert body["footer"] == "(showing 2 of 5)"
    assert len(body["pending"]) == 2
    assert body["pending"][0]["action"] == "host.invoices.pay"
    assert body["pending"][0]["params"] == {"invoice": "0"}
    assert body["pending"][0]["options"] == ["approve", "decline"]
    assert body["pending"][0]["conversation_id"] == "conv_invoices"


def test_an_inbox_it_shows_whole_announces_nothing(live: Live, daemon: AthenaDaemon) -> None:
    _card(daemon, "chase invoice 1", "1")

    body = live.request("/decisions").body

    assert (body["showing"], body["total"], body["footer"]) == (1, 1, "")


def test_a_card_a_turn_filed_is_in_the_inbox_and_leaves_it_when_it_is_answered(
    live: Live,
) -> None:
    """The inbox is the approval table, not a second list kept beside it."""
    live.register()
    live.script(claude_round("Approval please.\n" + op("host.invoices.pay", invoice="7")))
    live.run("pay invoice 7")

    listed = live.request("/decisions").body
    assert listed["total"] == 1
    approval_id = listed["pending"][0]["id"]

    live.request(f"/decisions/{approval_id}", method="POST", json_body={"choice": "decline"})

    assert live.request("/decisions").body == {
        "ok": True,
        "pending": [],
        "showing": 0,
        "total": 0,
        "footer": "",
    }


# -- GET /ledger -----------------------------------------------------------------------------


def test_the_ledger_page_is_bounded_and_honest_about_the_population(
    live: Live, daemon: AthenaDaemon
) -> None:
    _rows(daemon.ledger, 7)

    body = live.request("/ledger?limit=3").body

    assert (body["showing"], body["total"]) == (3, 7)
    assert body["footer"] == "(showing 3 of 7)"
    assert [row["model"] for row in body["rows"]] == ["model-6", "model-5", "model-4"]
    assert all(row["origin"] == ORIGIN for row in body["rows"])


def test_a_limit_beyond_the_ceiling_is_clamped_and_junk_falls_back(
    live: Live, daemon: AthenaDaemon
) -> None:
    _rows(daemon.ledger, 3)

    assert live.request("/ledger?limit=99999").body["showing"] == 3
    assert live.request("/ledger?limit=not-a-number").body["showing"] == 3
    assert live.request("/ledger?limit=0").body["showing"] == 1


def test_a_failed_turn_is_a_row_and_not_a_gap(live: Live, daemon: AthenaDaemon) -> None:
    """A ledger that only records successes shows a cheap week (README §2 invariant 6)."""
    live.register()
    live.run("what is overdue?")  # no script: the engine cannot answer

    rows = live.request("/ledger").body["rows"]

    assert len(rows) == 1
    assert rows[0]["is_error"] is True
    assert rows[0]["error_reason"] == "engine_error"
    assert rows[0]["conversation_id"] == "conv_invoices"


# -- GET /ledger/rollup ----------------------------------------------------------------------


def test_the_rollup_sums_one_dimension_dearest_first(live: Live, daemon: AthenaDaemon) -> None:
    _rows(daemon.ledger, 2, model="opus", cost_usd=0.5)
    _rows(daemon.ledger, 3, model="haiku", cost_usd=0.01)

    body = live.request("/ledger/rollup?by=model").body

    assert body["by"] == "model"
    assert (body["showing"], body["total"], body["footer"]) == (2, 2, "")
    assert [row["key"] for row in body["rollup"]] == ["opus", "haiku"]
    assert body["rollup"][0]["turns"] == 2
    assert body["rollup"][0]["cost_usd"] == 1.0
    assert body["rollup"][1]["turns"] == 3


def test_the_rollup_defaults_to_model_and_refuses_a_dimension_that_is_not_one(
    live: Live, daemon: AthenaDaemon
) -> None:
    """``by`` is a key of a closed table; no caller's string ever reaches SQL."""
    _rows(daemon.ledger, 1)

    assert live.request("/ledger/rollup").body["by"] == "model"
    assert live.request("/ledger/rollup?by=origin").body["rollup"][0]["key"] == ORIGIN

    refused = live.request("/ledger/rollup?by=conversation_id%3BDROP%20TABLE%20companion_turn")

    assert refused.status == 400
    assert refused.body["reason"] == "unknown_ref"
    assert live.request("/ledger").body["total"] == 1


# -- GET /playbooks --------------------------------------------------------------------------


def test_playbooks_answers_the_procedurals_for_one_origin_bounded(
    live: Live, daemon: AthenaDaemon
) -> None:
    ids = [
        _playbook(daemon.brain, f"when invoice {n} is proposed", f"always raise a card, rule {n}")
        for n in range(3)
    ]

    body = live.request(f"/playbooks?origin={ORIGIN}&limit=2").body

    assert body["origin"] == ORIGIN
    assert (body["showing"], body["total"]) == (2, 3)
    assert body["footer"] == "(showing 2 of 3)"
    assert {item["id"] for item in body["items"]} <= set(ids)
    assert all(item["kind"] == "procedural" for item in body["items"])
    # Every one cites the episode it was distilled from, and the count is read back from the row.
    assert all(item["citations"] == 1 for item in body["items"])
    assert all(item["path"].startswith("procedurals/") for item in body["items"])


def test_playbooks_is_the_rules_and_not_the_conversation(live: Live, daemon: AthenaDaemon) -> None:
    """Episodes are the record; a playbook is what was learned from one."""
    episode = daemon.brain.append_episode(
        f"[{ORIGIN}] the user declined the payment card", role="user", session_id="conv_invoices"
    )
    daemon.brain.write_fact(
        "client/northwind", f"[{ORIGIN}] Northwind pays late", scope="world", sources=[episode.id]
    )
    _playbook(daemon.brain, "when a payment is proposed", "never auto-approve")

    body = live.request(f"/playbooks?origin={ORIGIN}").body

    assert body["total"] == 1
    assert body["items"][0]["kind"] == "procedural"


def test_playbooks_needs_an_origin(live: Live) -> None:
    reply = live.request("/playbooks")

    assert reply.status == 400
    assert reply.body["reason"] == "validator_failed"


def test_an_origin_with_nothing_distilled_answers_an_empty_page_and_says_so(live: Live) -> None:
    body = live.request("/playbooks?origin=host:nothing").body

    assert (body["showing"], body["total"], body["footer"]) == (0, 0, "")
    assert body["items"] == []


# -- every one of them, off a read connection --------------------------------------------------


def test_every_read_route_answers_while_the_writer_lock_is_held(
    live: Live, daemon: AthenaDaemon
) -> None:
    """The day-zero decision, proved on the routes that would otherwise queue behind a turn."""
    _card(daemon, "chase invoice 1", "1")
    _rows(daemon.ledger, 2)
    _playbook(daemon.brain, "when a payment is proposed", "never auto-approve")

    held = threading.Event()
    release = threading.Event()
    answers: list[tuple[str, int]] = []

    def hold() -> None:
        with daemon.writing():
            held.set()
            assert release.wait(20)

    holder = threading.Thread(target=hold, name="writer", daemon=True)
    holder.start()
    try:
        assert held.wait(10)
        assert daemon.lock.locked()
        for path in (
            "/health",
            "/decisions",
            "/ledger",
            "/ledger/rollup",
            f"/playbooks?origin={ORIGIN}",
        ):
            reply = live.request(path, timeout=5.0)
            answers.append((path, reply.status))
            assert reply.body.get("ok") is True, f"{path}: {json.dumps(reply.body)}"
    finally:
        release.set()
        holder.join(timeout=20)

    assert [status for _, status in answers] == [200, 200, 200, 200, 200]

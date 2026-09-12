"""Bounded and announced: the cap on a READ, and the shape of the read routes (README §2, §3.3).

Invariant 4 has two halves and both are here. A ``READ`` answer is capped by the *catalog* — not
by the executor that produced it — and the cut is announced in the answer the model is given, so
a page of memory that stopped short says that it stopped short. And every bounded read route
answers in one shape: ``showing``, ``total`` and a ``footer`` that is the ``(showing N of M)``
sentence, where ``total`` is the population the page was cut from and never the length of the page.
"""

from __future__ import annotations

from athena.core.catalog import READ_CAP
from athena.daemon.routes import DEFAULT_LIMIT, MAX_LIMIT

from .conftest import APP_ID, MODEL, Spawn, claude_round, op

#: Enough turns that the episodes recall renders exceed the cap. Each one's message is longer
#: than the brain's 500-byte excerpt, so four of them are two and a half caps of text.
STUFFING = 4
LONG_MESSAGE = (
    "invoice INV-118 is thirty-one days late and the studio has not been paid for it yet, "
    "which is the kind of thing the record has to hold in full rather than in summary. "
) * 5

#: One ``claude`` round costs this much in the recorded fixture, and the rollup sums it.
ROUND_COST = 0.04


def test_a_read_whose_answer_exceeds_the_cap_announces_what_it_cut(spawn: Spawn) -> None:
    daemon = spawn.scripted(
        [
            *[claude_round("Noted.") for _ in range(STUFFING)],
            claude_round("Let me look it up.\n" + op("core.recall", query="invoice")),
            claude_round("That is what I have."),
        ]
    )
    daemon.register()
    for _ in range(STUFFING):
        assert daemon.run(LONG_MESSAGE).status == 200

    reply = daemon.run("what do you remember about the invoice?")

    results = [payload for kind, payload in reply.frames() if kind == "tool.result"]
    assert len(results) == 1
    answer = results[0]
    assert answer["name"] == "core.recall"
    assert answer["ok"] is True
    assert answer["truncated"] is True
    body, _, footer = answer["output"].rpartition("\n")
    assert len(body) == READ_CAP, "the cap is the catalog's, in characters"
    total = int(footer.removeprefix("(showing ").removesuffix(")").split(" of ")[1])
    assert footer == f"(showing {READ_CAP} of {total})"
    assert total > READ_CAP


def test_the_ledger_and_its_rollup_answer_in_the_documented_shape_and_page_their_lists(
    spawn: Spawn,
) -> None:
    turns = 3
    daemon = spawn.scripted([claude_round("Noted.") for _ in range(turns)])
    daemon.register()
    for _ in range(turns):
        assert daemon.run("what is overdue?").status == 200

    whole = daemon.request("/ledger").body
    assert (whole["ok"], whole["showing"], whole["total"], whole["footer"]) == (
        True,
        turns,
        turns,
        "",
    )
    assert set(whole["rows"][0]) == {
        "row_id",
        "turn_id",
        "created_at",
        "engine",
        "model",
        "conversation_id",
        "origin",
        "surface",
        "trigger",
        "rounds",
        "input_tokens",
        "output_tokens",
        "cost_usd",
        "cost_estimated",
        "ms",
        "is_error",
        "error_reason",
    }
    assert [row["row_id"] for row in whole["rows"]] == sorted(
        (row["row_id"] for row in whole["rows"]), reverse=True
    ), "newest first"

    page = daemon.request("/ledger?limit=2").body
    assert (page["showing"], page["total"]) == (2, turns)
    assert page["footer"] == f"(showing 2 of {turns})"
    assert [row["row_id"] for row in page["rows"]] == [r["row_id"] for r in whole["rows"][:2]]

    # A ``limit`` is clamped into 1..MAX_LIMIT and junk falls back to the default; neither is
    # answered with an empty page or with everything.
    assert daemon.request("/ledger?limit=0").body["showing"] == 1
    assert daemon.request(f"/ledger?limit={MAX_LIMIT + 500}").body["showing"] == turns
    assert daemon.request("/ledger?limit=not-a-number").body["showing"] == min(turns, DEFAULT_LIMIT)

    rollup = daemon.request("/ledger/rollup?by=model").body
    assert rollup["by"] == "model"
    assert (rollup["showing"], rollup["total"], rollup["footer"]) == (1, 1, "")
    summed = rollup["rollup"][0]
    assert set(summed) == {
        "key",
        "turns",
        "errors",
        "rounds",
        "input_tokens",
        "output_tokens",
        "cost_usd",
        "ms",
    }
    assert summed["key"] == MODEL
    assert (summed["turns"], summed["errors"], summed["rounds"]) == (turns, 0, turns)
    assert round(summed["cost_usd"], 4) == round(ROUND_COST * turns, 4)

    by_origin = daemon.request("/ledger/rollup?by=origin").body
    assert [row["key"] for row in by_origin["rollup"]] == [f"host:{APP_ID}"]

    unknown = daemon.request("/ledger/rollup?by=trigger")
    assert unknown.status == 400
    assert unknown.body["reason"] == "unknown_ref"
    assert "origin" in unknown.body["detail"], "the refusal names the dimensions that exist"


def test_playbooks_answers_for_one_origin_and_says_honestly_that_it_has_none(
    spawn: Spawn,
) -> None:
    """A fresh brain has distilled nothing, and the honest answer to that is an empty page with
    its own ``(showing 0 of 0)`` arithmetic — not an omitted key."""
    daemon = spawn.scripted([claude_round("Noted.")])
    daemon.register()

    reply = daemon.request(f"/playbooks?origin=host:{APP_ID}")

    assert reply.status == 200
    assert reply.body == {
        "ok": True,
        "items": [],
        "showing": 0,
        "total": 0,
        "footer": "",
        "origin": f"host:{APP_ID}",
    }
    naked = daemon.request("/playbooks")
    assert naked.status == 400
    assert naked.body["reason"] == "validator_failed"

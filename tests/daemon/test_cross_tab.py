"""One request, a gated action in each of two open apps, over HTTP (ADR 0106).

``invoices`` is the focused page the session is pinned to; ``crm`` is open in another tab on a site
the person trusts, and the surface says so in ``open_apps`` with that tab's id and document. The
engine proposes a write in each. Both become cards: the invoices card bound to the focused tab, the
crm card bound to the crm tab, ``AUTO`` though ``chase`` is. Approving the crm card hands back an
``execute`` bound to the crm tab and spends the grant once; a repeat answer runs nothing.
"""

from __future__ import annotations

from typing import Any

import pytest

from athena.contracts.registry import OpenApp
from athena.daemon.routes import MAX_GATED_NAMES, ListTooLong, open_apps_from

from .conftest import APP_ID, OTHER_APP_ID, OTHER_PAGE_ORIGIN, PAGE_ORIGIN, Live, claude_round, op

PAY = f"host.{APP_ID}.pay"
CRM_CHASE = f"host.{OTHER_APP_ID}.chase"
OPEN = [{"app": f"host:{OTHER_APP_ID}", "origin": OTHER_PAGE_ORIGIN, "tab_id": 2, "tab_nav": 5}]


def _both(live: Live) -> None:
    assert live.register().status == 200
    assert live.register(OTHER_APP_ID, OTHER_PAGE_ORIGIN).status == 200


def _turn(live: Live, **body: Any) -> list[tuple[str, dict[str, Any]]]:
    live.script(claude_round(op(PAY, invoice="7") + "\n" + op(CRM_CHASE, invoice="7")))
    return live.run("settle invoice 7 and log it in the crm", tab_id=1, tab_nav=0, **body).frames()


def test_one_request_files_a_card_in_each_app_each_bound_to_its_own_tab(live: Live) -> None:
    _both(live)

    frames = _turn(live, open_apps=OPEN)

    cards = [p for k, p in frames if k == "decision.requested"]
    assert [c["action"] for c in cards] == [PAY, CRM_CHASE]
    assert [(c["tab_id"], c["tab_nav"]) for c in cards] == [(1, 0), (2, 5)]
    errors = [p["error"] for k, p in frames if k == "tool.result"]
    assert errors == ["pending_approval", "pending_approval"]
    rows = {row.action: row for row in live.daemon.approvals.pending(10).rows}
    assert (rows[CRM_CHASE].tab_id, rows[CRM_CHASE].tab_nav) == (2, 5)
    assert "it runs on the host:crm tab" in rows[CRM_CHASE].summary


def test_approving_the_crm_card_runs_on_the_crm_tab_once(live: Live) -> None:
    _both(live)
    _turn(live, open_apps=OPEN)
    card = next(r for r in live.daemon.approvals.pending(10).rows if r.action == CRM_CHASE)

    # The panel states the origin of the tab the card is bound to.
    answer = live.request(
        f"/decisions/{card.id}",
        method="POST",
        json_body={"choice": "approve", "origin": OTHER_PAGE_ORIGIN},
    )
    again = live.request(
        f"/decisions/{card.id}",
        method="POST",
        json_body={"choice": "approve", "origin": OTHER_PAGE_ORIGIN},
    )

    assert answer.status == 200, answer.body
    (execute,) = answer.body["execute"]
    assert (execute["name"], execute["tab_id"], execute["tab_nav"]) == (CRM_CHASE, 2, 5)
    assert live.daemon.approvals.describe(card.id).consumed
    # A repeat answer runs nothing: the route refuses it as it refuses any second answer (the
    # row is no longer pending), and the gate's replay of the spent grant would be
    # ``approval_spent`` (tests/harness/test_cross_tab.py).
    assert again.status == 409 and again.body["reason"] == "pending_approval", again.body
    assert "execute" not in again.body


def test_a_card_answered_in_the_name_of_the_wrong_tab_is_refused(live: Live) -> None:
    _both(live)
    _turn(live, open_apps=OPEN)
    card = next(r for r in live.daemon.approvals.pending(10).rows if r.action == CRM_CHASE)

    answer = live.request(
        f"/decisions/{card.id}",
        method="POST",
        json_body={"choice": "approve", "origin": PAGE_ORIGIN},
    )

    assert answer.status == 403 and answer.body["reason"] == "foreign_origin"
    assert not live.daemon.approvals.describe(card.id).consumed


@pytest.mark.parametrize(
    "body",
    [
        {},
        {"open_apps": OPEN, "gated_origins": [f"host:{OTHER_APP_ID}"]},
        {"open_apps": OPEN, "disabled_origins": [f"host:{OTHER_APP_ID}"]},
        {"open_apps": [{**OPEN[0], "origin": "https://elsewhere.example"}]},
    ],
    ids=["not open", "first sight", "switched off", "moved"],
)
def test_without_an_open_trusted_tab_the_crm_call_is_refused_foreign_origin(
    live: Live, body: dict[str, Any]
) -> None:
    _both(live)

    frames = _turn(live, **body)

    cards = [p for k, p in frames if k == "decision.requested"]
    assert [c["action"] for c in cards] == [PAY]
    errors = [p["error"] for k, p in frames if k == "tool.result"]
    assert errors == ["pending_approval", "foreign_origin"]


def test_open_apps_parsing_drops_what_it_cannot_read_and_refuses_a_long_list() -> None:
    assert open_apps_from({}) == ()
    assert open_apps_from({"open_apps": "host:crm"}) == ()
    good = {"app": "host:crm", "origin": "https://crm.example", "tab_id": 2}
    parsed = open_apps_from(
        {
            "open_apps": [
                good,
                {"app": "crm", "origin": "https://crm.example", "tab_id": 3},
                {"app": "connector:gmail", "origin": "https://mail.example", "tab_id": 4},
                {"app": "host:a", "origin": "https://a.example", "tab_id": -1},
                {"app": "host:b", "origin": "file:///etc", "tab_id": 5},
                {"app": "host:c", "origin": "https://c.example", "tab_id": True},
                {"app": "host:d", "origin": "https://d.example", "tab_id": 6, "tab_nav": "x"},
            ]
        }
    )
    assert parsed == (
        OpenApp("host:crm", "https://crm.example", 2, None),
        OpenApp("host:d", "https://d.example", 6, None),
    )
    twice = open_apps_from({"open_apps": [good, {**good, "tab_id": 9}]})
    assert twice == ()
    with pytest.raises(ListTooLong):
        open_apps_from({"open_apps": [good] * (MAX_GATED_NAMES + 1)})
